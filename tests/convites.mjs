import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };
const sql = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
`);
const LUIZ = '00000000-0000-0000-0000-00000000000a', MARIA = '00000000-0000-0000-0000-00000000000b', ANA = '00000000-0000-0000-0000-00000000000c', INTRUSO = '00000000-0000-0000-0000-00000000000e';
await db.exec(`insert into auth.users values ('${LUIZ}','hd@henriquedurant.com'),('${MARIA}','maria@ex.com'),('${ANA}','ana@ex.com'),('${INTRUSO}','intruso@ex.com')`);
for (const f of ['0001_base.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql', '0005_parceiro.sql', '0006_numeracao.sql', '0007_convites.sql']) await db.exec(sql(f));
await db.exec(sql('0007_convites.sql'));      // 0007 roda duas vezes; só depois vem a 0008 (as migrações rodam sempre em ordem)
await db.exec(sql('0008_origem_parceiro.sql')); await db.exec(sql('0008_origem_parceiro.sql'));
await db.exec(sql('0009_andamento_parceiro.sql')); await db.exec(sql('0009_andamento_parceiro.sql'));
ok(true, '0007, 0008 e 0009 rodam duas vezes sem quebrar');

const E1 = (await db.query(`select id from public.empresas where nome='Durant Alfaiataria'`)).rows[0].id;
await db.exec(`insert into public.membros (user_id, empresa_id, papel) values ('${LUIZ}','${E1}','admin'),('${MARIA}','${E1}','usuario')`);
async function como(sub, fn, role = 'authenticated') {
  await db.exec(`set role ${role}; select set_config('request.jwt.sub','${sub}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false);`); }
}
const q1 = async (s, p) => (await db.query(s, p)).rows[0];
const falha = async (s, p) => { try { await db.query(s, p); return false; } catch (e) { return e.message; } };

console.log('Plataforma');
ok((await q1(`select count(*)::int n from public.plataforma_admins`)).n === 1, 'o Luiz é o administrador da plataforma');
let tokEmp;
await como(MARIA, async () => ok(/só o administrador da plataforma/.test(await falha(`select public.criar_convite_empresa('x@ex.com','Ateliê X',true,false)`)), 'quem não é da plataforma não cria empresa'));
await como(LUIZ, async () => {
  ok(/e-mail inválido/.test(await falha(`select public.criar_convite_empresa('xx','Ateliê X',true,false)`)), 'e-mail inválido recusado');
  ok(/precisa vender/.test(await falha(`select public.criar_convite_empresa('x@ex.com','Ateliê X',false,false)`)), 'empresa sem vender nem produzir recusada');
  tokEmp = (await q1(`select public.criar_convite_empresa('Novo@Ex.com ','Ateliê Novo',true,true) t`)).t;
});
ok(typeof tokEmp === 'string' && tokEmp.length >= 60, 'código do link é longo e aleatório');
ok(!(await q1(`select count(*)::int n from public.convites where token_hash = $1`, [tokEmp])).n, 'o banco NÃO guarda o código puro (só o hash)');
ok((await q1(`select email from public.convites`)).email === 'novo@ex.com', 'e-mail normalizado (minúsculo, sem espaço)');

console.log('Convite visível sem login (mascarado)');
const info = await como('', async () => q1(`select * from public.convite_info($1)`, [tokEmp]), 'anon');
ok(info.valido && info.email_mascarado === 'no***@ex.com' && info.empresa_nome === 'Ateliê Novo', 'anônimo vê o nome da empresa e o e-mail mascarado');
ok(!(await como('', async () => q1(`select * from public.convite_info('lixo')`), 'anon')).valido, 'código errado: inválido');
await como('', async () => ok(!!(await falha(`select * from public.convites`)), 'anônimo não lê a tabela'), 'anon');
await como(LUIZ, async () => ok(!!(await falha(`select * from public.convites`)), 'nem o Luiz lê a tabela direto (só pelas funções)'));

console.log('Cadastro só com convite');
ok(/somente com convite/.test(await falha(`insert into auth.users (email) values ('qualquer@ex.com')`)), 'e-mail sem convite não consegue criar conta');
await db.exec(`insert into auth.users (email) values ('novo@ex.com')`);
ok(true, 'e-mail com convite pendente cria a conta');
const NOVO = (await q1(`select id from auth.users where email='novo@ex.com'`)).id;

console.log('Aceitar convite de empresa nova');
await como(INTRUSO, async () => ok(/outro e-mail/.test(await falha(`select public.aceitar_convite($1)`, [tokEmp])), 'outro e-mail não aceita'));
ok(/entre na sua conta/.test(await como('', async () => falha(`select public.aceitar_convite($1)`, [tokEmp]), 'authenticated')), 'sem login não aceita');
const novaEmp = await como(NOVO, async () => (await q1(`select public.aceitar_convite($1) e`, [tokEmp])).e);
const e = await q1(`select nome, vende_cliente_final v, produz p from public.empresas where id=$1`, [novaEmp]);
ok(e.nome === 'Ateliê Novo' && e.v === true && e.p === true, 'empresa criada com o perfil do convite');
ok((await q1(`select papel from public.membros where empresa_id=$1 and user_id=$2`, [novaEmp, NOVO])).papel === 'admin', 'quem aceitou virou administrador');
await como(LUIZ, async () => {
  const l = (await db.query(`select * from public.listar_convites(null)`)).rows;
  ok(l.length === 1 && l[0].estado === 'usado' && l[0].empresa_nome === 'Ateliê Novo', 'o convite de empresa já aceito continua na lista da plataforma, como "usado"');
});
await como(NOVO, async () => ok(/inválido ou expirado/.test(await falha(`select public.aceitar_convite($1)`, [tokEmp])), 'o convite só funciona uma vez'));

console.log('Convite de usuário');
let tokU, tokOld;
await como(MARIA, async () => ok(/só o administrador/.test(await falha(`select public.criar_convite('${E1}','ana@ex.com','usuario')`)), 'usuário comum não convida'));
await como(INTRUSO, async () => ok(/só o administrador/.test(await falha(`select public.criar_convite('${E1}','ana@ex.com','usuario')`)), 'quem é de fora não convida'));
await como(LUIZ, async () => {
  ok(/já tem acesso/.test(await falha(`select public.criar_convite('${E1}','maria@ex.com','usuario')`)), 'não convida quem já tem acesso');
  ok(/papel inválido/.test(await falha(`select public.criar_convite('${E1}','ana@ex.com','dono')`)), 'papel inválido recusado');
  const t1 = (await q1(`select public.criar_convite('${E1}','ana@ex.com','parceiro','Durant Alfaiataria') t`)).t;
  tokU = (await q1(`select public.criar_convite('${E1}','ana@ex.com','usuario') t`)).t;
  tokOld = t1;
  const l = (await db.query(`select * from public.listar_convites('${E1}')`)).rows;
  ok(l.length === 2 && l.some(x => x.estado === 'valido') && l.some(x => x.estado === 'cancelado'), 'lista mostra válido e cancelado');
});
await como(MARIA, async () => ok(/sem permissão/.test(await falha(`select * from public.listar_convites('${E1}')`)), 'usuário comum não vê convites'));
ok((await q1(`select count(*)::int n from public.convites where email='ana@ex.com' and status='pendente'`)).n === 1, 'reenviar cancela o anterior (um pendente por pessoa)');
ok(!(await como('', async () => q1(`select * from public.convite_info($1)`, [tokOld]), 'anon')).valido, 'o link antigo deixa de valer');
await db.exec(`insert into auth.users (email) values ('ana@ex.com')`).catch(() => {});
await como(ANA, async () => {
  const emp = (await q1(`select public.aceitar_convite($1) e`, [tokU])).e;
  ok(emp === E1, 'Ana entra na empresa existente');
});
ok((await q1(`select papel from public.membros where empresa_id=$1 and user_id=$2`, [E1, ANA])).papel === 'usuario', 'com o papel convidado');

console.log('Expiração e cancelamento');
let tokX;
await como(LUIZ, async () => { tokX = (await q1(`select public.criar_convite('${E1}','velho@ex.com','usuario') t`)).t; });
await db.exec(`update public.convites set expira_em = now() - interval '1 day' where email='velho@ex.com'`);
ok(/somente com convite/.test(await falha(`insert into auth.users (email) values ('velho@ex.com')`)), 'convite expirado não libera cadastro');
ok(!(await como('', async () => q1(`select * from public.convite_info($1)`, [tokX]), 'anon')).valido, 'e o link mostra inválido');
let idC;
await como(LUIZ, async () => {
  await q1(`select public.criar_convite('${E1}','cancela@ex.com','usuario')`);
  idC = (await q1(`select id from public.listar_convites('${E1}') where email='cancela@ex.com'`)).id;
  await db.query(`select public.cancelar_convite($1)`, [idC]);
});
ok((await q1(`select status from public.convites where id=$1`, [idC])).status === 'cancelado', 'cancelar funciona');
await como(MARIA, async () => ok(/sem permissão/.test(await falha(`select public.cancelar_convite($1)`, [idC])), 'usuário comum não cancela'));

console.log('Último administrador');
await como(LUIZ, async () => {
  ok(/pelo menos um administrador/.test(await falha(`select public.remover_membro('${E1}','${LUIZ}')`)), 'não remove o único admin');
  ok(/pelo menos um administrador/.test(await falha(`select public.alterar_papel('${E1}','${LUIZ}','usuario')`)), 'não rebaixa o único admin');
  await db.query(`select public.alterar_papel('${E1}','${MARIA}','admin')`);
  await db.query(`select public.alterar_papel('${E1}','${LUIZ}','usuario')`);
});
ok((await q1(`select papel from public.membros where user_id='${LUIZ}' and empresa_id='${E1}'`)).papel === 'usuario', 'com outro admin, rebaixar é permitido');
await como(MARIA, async () => {
  await db.query(`select public.remover_membro('${E1}','${ANA}')`);
  const m = (await db.query(`select * from public.listar_membros('${E1}')`)).rows;
  ok(m.length === 2, 'Maria (admin) remove a Ana e vê 2 membros');
});
await db.exec(`delete from public.empresas where id='${novaEmp}'`);
ok(true, 'apagar a empresa inteira não é bloqueado pela regra do último admin');

console.log('Auditoria');
ok((await q1(`select count(*)::int n from public.audit_log where k in ('convite','membro')`)).n >= 6, 'convites e mudanças de acesso ficam registrados');

console.log('Origem do parceiro (0008)');
let tokP;
await como(MARIA, async () => {
  ok(/informe o nome da empresa do parceiro/.test(await falha(`select public.criar_convite('${E1}','ana@ex.com','parceiro')`)), 'convite de parceiro exige o nome da empresa dele');
  tokP = (await q1(`select public.criar_convite('${E1}','ana@ex.com','parceiro','  Durant Alfaiataria ') t`)).t;
});
await como(ANA, async () => { await db.query(`select public.aceitar_convite($1)`, [tokP]); });
ok((await q1(`select nome_parceiro n from public.membros where empresa_id=$1 and user_id=$2`, [E1, ANA])).n === 'Durant Alfaiataria', 'o nome da empresa vai do convite para o vínculo (sem espaços nas pontas)');
await como(ANA, async () => { await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,'pedidos~P-9','pedidos','P-9','{}')`, [E1]); });
await como(MARIA, async () => { await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,'pedidos~P-1','pedidos','P-1','{}')`, [E1]); });
await como(MARIA, async () => {
  const o = (await db.query(`select * from public.listar_origens('${E1}')`)).rows;
  ok(o.length === 1 && o[0].id === 'pedidos~P-9' && o[0].nome === 'Durant Alfaiataria', 'o dono recebe só os documentos do parceiro, com o nome da empresa dele (os da própria equipe não entram)');
});
await como(ANA, async () => ok(/sem permissão/.test(await falha(`select * from public.listar_origens('${E1}')`)), 'o parceiro não consulta origens'));
await como(ANA, async () => ok(/só o administrador/.test(await falha(`select public.definir_nome_parceiro('${E1}','${ANA}','Outra')`)), 'o parceiro não muda o próprio nome'));
await como(MARIA, async () => {
  ok(/não é parceira/.test(await falha(`select public.definir_nome_parceiro('${E1}','${MARIA}','X Y')`)), 'só vale para quem é parceiro');
  await db.query(`select public.definir_nome_parceiro('${E1}','${ANA}','Durant Ateliê')`);
  const o = (await db.query(`select * from public.listar_origens('${E1}')`)).rows;
  ok(o[0].nome === 'Durant Ateliê', 'admin corrige o nome e a origem acompanha');
  const m = (await db.query(`select * from public.listar_membros('${E1}')`)).rows.find(x => x.user_id === ANA);
  ok(m && m.nome_parceiro === 'Durant Ateliê', 'a lista de pessoas mostra o nome da empresa do parceiro');
});

console.log('Andamento do parceiro (0009)');
await como(ANA, async () => { await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,'pedidos~P-10','pedidos','P-10','{}')`, [E1]); });
await como(MARIA, async () => {
  await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,'sing~cfg','sing','cfg',$2) on conflict (empresa_id,id) do update set j=excluded.j`, [E1, JSON.stringify({ aceites: { 'P-9': { st: 'aceito', em: '2026-11-26T10:00:00Z', por: 'Maria' }, 'P-10': { st: 'recusado', em: '2026-11-26T11:00:00Z', por: 'Maria', motivo: 'falta dados' }, 'P-1': { st: 'aceito' } } })]);
  ok(/sem permissão/.test(await falha(`select * from public.andamento_parceiro('${E1}')`)), 'o dono não usa a função do parceiro');
});
await como(ANA, async () => {
  const a = (await db.query(`select * from public.andamento_parceiro('${E1}') order by id`)).rows;
  ok(a.length === 2 && a[0].id === 'pedidos~P-10' && a[0].st === 'recusado' && a[0].motivo === 'falta dados' && a[1].id === 'pedidos~P-9' && a[1].st === 'aceito', 'o parceiro recebe o estado e o motivo só dos pedidos dele');
  ok(!a.some(x => x.id === 'pedidos~P-1'), 'não recebe o estado de pedido de outra pessoa da equipe');
  ok(!JSON.stringify(a).includes('Maria'), 'não recebe quem decidiu nem outros dados da configuração');
});
await como(MARIA, async () => { await db.query(`delete from public.reg where empresa_id=$1 and id='sing~cfg'`, [E1]); });
await como(ANA, async () => {
  const a = (await db.query(`select * from public.andamento_parceiro('${E1}')`)).rows;
  ok(a.length === 2 && a.every(x => x.st === 'recebido'), 'sem decisão do dono, todos aparecem como "recebido"');
});

if (falhas.length) { console.log('\n' + falhas.length + ' FALHA(S)'); process.exit(1); }
console.log('\nTudo certo.');
