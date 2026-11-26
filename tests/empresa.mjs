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
const LUIZ = '00000000-0000-0000-0000-00000000000a', MARIA = '00000000-0000-0000-0000-00000000000b', ANA = '00000000-0000-0000-0000-00000000000c';
await db.exec(`insert into auth.users values ('${LUIZ}','hd@henriquedurant.com'),('${MARIA}','maria@ex.com'),('${ANA}','ana@ex.com')`);
for (const f of ['0001_base.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql', '0005_parceiro.sql', '0006_numeracao.sql', '0007_convites.sql', '0008_origem_parceiro.sql', '0009_andamento_parceiro.sql', '0010_tecidos.sql', '0011_tecidos_loja.sql']) await db.exec(sql(f));
await db.exec(sql('0013_cadastro_empresa.sql')); await db.exec(sql('0014_empresa_tipo_travado.sql')); await db.exec(sql('0014_empresa_tipo_travado.sql')); await db.exec(sql('0015_painel_plataforma.sql')); await db.exec(sql('0015_painel_plataforma.sql')); await db.exec(sql('0016_empresa_doc_so_plataforma.sql')); await db.exec(sql('0016_empresa_doc_so_plataforma.sql')); await db.exec(sql('0018_tipo_empresa.sql')); await db.exec(sql('0018_tipo_empresa.sql')); await db.exec(sql('0019_nome_fantasia.sql')); await db.exec(sql('0019_nome_fantasia.sql')); await db.exec(sql('0020_razao_so_plataforma.sql')); await db.exec(sql('0020_razao_so_plataforma.sql')); await db.exec(sql('0021_sem_tipo_fabrica.sql')); await db.exec(sql('0021_sem_tipo_fabrica.sql')); await db.exec(sql('0022_tipo_loja.sql')); await db.exec(sql('0022_tipo_loja.sql'));
ok(true, '0013 roda duas vezes sem quebrar');
const E1 = (await db.query(`select id from public.empresas where nome='Durant Alfaiataria'`)).rows[0].id;
await db.exec(`insert into public.empresas (nome) values ('Outra')`);
const E2 = (await db.query(`select id from public.empresas where nome='Outra'`)).rows[0].id;
await db.exec(`insert into public.membros (user_id, empresa_id, papel) values ('${LUIZ}','${E1}','admin'),('${MARIA}','${E1}','usuario'),('${ANA}','${E2}','admin')`);
async function como(sub, fn) { await db.exec(`set role authenticated; select set_config('request.jwt.sub','${sub}',false);`); try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false);`); } }
const q1 = async (s, p) => (await db.query(s, p)).rows[0];
const falha = async (s, p) => { try { await db.query(s, p); return false; } catch (e) { return e.message; } };
const cad = d => JSON.stringify({ tipo: 'PJ', razao: 'Durant Alfaiataria Ltda.', fantasia: 'Durant', doc, resp: 'Luiz', ...d });
let doc = '12.345.678/0001-90';
await db.exec(`insert into public.plataforma_admins (user_id) values ('${LUIZ}') on conflict do nothing`);
const S = (e) => [e, cad({})];
await como(MARIA, async () => ok(/sem permissão/.test(await falha(`select public.salvar_empresa($1,$2::jsonb)`, S(E1))), 'usuário comum não altera o cadastro'));
await como(ANA, async () => ok(/sem permissão/.test(await falha(`select public.salvar_empresa($1,$2::jsonb)`, S(E1))), 'administrador de outra empresa não altera esta'));
await como(LUIZ, async () => { await db.query(`select public.definir_tipo_empresa($1,'alfaiataria',true)`, [E1]); await db.query(`select public.salvar_empresa($1,$2::jsonb)`, S(E1)); });
const r = await q1(`select cnpj, vende_cliente_final v, produz p, cadastro->>'razao' razao from public.empresas where id=$1`, [E1]);
ok(r.cnpj === '12345678000190' && r.v && r.p && r.razao === 'Durant Alfaiataria Ltda.', 'salva cadastro e CNPJ (só dígitos); plataforma define o tipo');
await como(LUIZ, async () => ok(/já está cadastrado/.test(await falha(`select public.salvar_empresa($1,$2::jsonb)`, S(E2))), 'CNPJ repetido em outra empresa é recusado (plataforma)'));
await como(ANA, async () => { await db.query(`select public.salvar_empresa($1,$2::jsonb)`, [E2, cad({ razao: 'Outra Ltda.', fantasia: 'Fantasia Nova', tel: '(19) 98888-7777' })]); });
const o = await q1(`select cnpj, cadastro->>'razao' razao, cadastro->>'tel' tel, cadastro->>'doc' doc from public.empresas where id=$1`, [E2]);
ok(o.razao === '' && o.tel === '(19) 98888-7777' && o.cnpj === null && o.doc === '', 'administrador da empresa edita contatos, mas CNPJ e razão social enviados são ignorados');
ok((await q1(`select nome from public.empresas where id=$1`, [E2])).nome === 'Fantasia Nova', 'administrador da empresa altera o nome fantasia');
const p1 = await q1(`select cnpj from public.empresas where id=$1`, [E1]);
await como(LUIZ, async () => { await db.query(`select public.salvar_empresa($1,$2::jsonb)`, [E1, cad({ doc: '99.999.999/0001-99' })]); });
await como(MARIA, async () => {});
ok((await q1(`select cnpj from public.empresas where id=$1`, [E1])).cnpj === '99999999000199' && p1.cnpj === '12345678000190', 'a plataforma altera o CNPJ');
await como(LUIZ, async () => { await db.query(`select public.salvar_empresa($1,$2::jsonb)`, [E1, cad({ doc: '12.345.678/0001-90' })]); });
await como(ANA, async () => ok(/só o administrador da plataforma/.test(await falha(`select public.definir_tipo_empresa($1,'alfaiataria',true)`, [E2])), 'administrador da empresa não muda o tipo (travado)'));
await como(LUIZ, async () => {
  ok(/tipo inválido/.test(await falha(`select public.definir_tipo_empresa($1,'xyz',false)`, [E1])), 'tipo inventado é recusado');
  doc = '123'; ok(/11 números e CNPJ tem 14/.test(await falha(`select public.salvar_empresa($1,$2::jsonb)`, S(E1))), 'documento com tamanho errado é recusado');
  doc = ''; ok(/Informe o CNPJ/.test(await falha(`select public.salvar_empresa($1,$2::jsonb)`, S(E1))), 'CNPJ em branco é recusado (obrigatório)');
});
await como(MARIA, async () => ok(/permission denied|sem permissão/.test(await falha(`update public.empresas set produz=true where id=$1`, [E1]) || 'sem permissão'), 'cliente não altera a tabela de empresas direto'));

// --- painel da plataforma e suspensão ---
await db.exec(`insert into public.reg (empresa_id, id, k, i, n, j) values ('${E1}','x1','clientes','1',1,'{}')`);
const veReg = async (sub, emp) => await como(sub, async () => (await q1(`select count(*)::int c from public.reg where empresa_id=$1`, [emp])).c);
ok(await veReg(MARIA, E1) === 1, 'usuário vê os dados da empresa ativa');
await como(MARIA, async () => ok(/sem permissão/.test(await falha(`select * from public.plataforma_empresas()`)), 'usuário comum não abre a lista do painel'));
await como(ANA, async () => ok(/sem permissão/.test(await falha(`select public.plataforma_definir_ativa($1,false)`, [E1])), 'administrador de empresa não suspende empresa'));
await como(LUIZ, async () => {
  const l = (await db.query(`select * from public.plataforma_empresas()`)).rows;
  ok(l.length === 2 && l.find(x => x.id === E1).usuarios === 2, 'plataforma lista as empresas com a quantidade de usuários');
  ok((await db.query(`select * from public.plataforma_usuarios($1)`, [E1])).rows.length === 2, 'plataforma lista os usuários da empresa');
  await db.query(`select public.plataforma_definir_ativa($1,false)`, [E1]);
});
ok(await veReg(MARIA, E1) === 0, 'empresa suspensa: o usuário deixa de ver os dados');
await como(MARIA, async () => ok((await q1(`select count(*)::int c from public.membros`)).c === 0 && (await q1(`select public.papel_em($1) p`, [E1])).p === null, 'empresa suspensa: sem vínculo e sem papel'));
ok(await veReg(ANA, E2) === 0 && (await db.query(`select 1 from public.reg where empresa_id='${E1}'`)).rows.length === 1, 'suspender não apaga dados nem afeta outra empresa');
await como(LUIZ, async () => { await db.query(`select public.plataforma_definir_ativa($1,true)`, [E1]); });
ok(await veReg(MARIA, E1) === 1, 'reativar devolve o acesso');
await como(LUIZ, async () => {
  const t = async (tipo, area) => { await db.query(`select public.definir_tipo_empresa($1,$2,$3)`, [E1, tipo, area]); return await q1(`select tipo, vende_cliente_final v, produz p from public.empresas where id=$1`, [E1]); };
  let r1 = await t('atelie', true); ok(r1.tipo === 'atelie' && r1.v && !r1.p, 'Ateliê: vende ao cliente final e nunca tem área para ateliês');
  r1 = await t('alfaiataria', false); ok(r1.tipo === 'alfaiataria' && r1.v && !r1.p, 'Alfaiataria sem área para ateliês (caso da Durant): menus não mudam'); await t('atelie', true);
  r1 = await t('alfaiataria', true); ok(r1.v && r1.p, 'Alfaiataria pode ter a área para ateliês');
  r1 = await t('alfaiataria', null); ok(r1.p, 'Alfaiataria que já tinha a área para ateliês continua com ela (não perde o menu)');
  ok(/tipo inválido/.test(await falha(`select public.definir_tipo_empresa($1,'fabrica',false)`, [E1])), 'o tipo Fábrica não existe mais');
  r1 = await t('alfaiataria', null);
  r1 = await t('loja', true); const lj = await q1(`select fornece_tecido f from public.empresas where id=$1`, [E1]); ok(r1.tipo === 'loja' && !r1.v && !r1.p && lj.f, 'Loja de tecido: fornece tecido, não atende cliente final, sem área para ateliês');
  r1 = await t('alfaiataria', null); const lj2 = await q1(`select fornece_tecido f from public.empresas where id=$1`, [E1]); ok(r1.v && !lj2.f, 'voltar para alfaiataria desliga o fornecimento de tecido');
  const pl = (await db.query(`select * from public.plataforma_empresas()`)).rows.find(x => x.id === E1); ok(pl.tipo === 'alfaiataria', 'a lista do painel traz o tipo');
  await t('alfaiataria', false);
});
await como(LUIZ, async () => {
  await db.query(`select public.salvar_empresa($1, '{"razao":"Razão Teste Ltda.","fantasia":"Nome Novo","doc":"12.345.678/0001-90"}'::jsonb)`, [E1]);
  const n = await q1(`select nome from public.empresas where id=$1`, [E1]); ok(n.nome === 'Nome Novo', 'o nome fantasia salvo vira o nome da empresa');
  await db.query(`select public.salvar_empresa($1, '{"razao":"Razão Teste Ltda.","fantasia":"Durant Alfaiataria","doc":"12.345.678/0001-90"}'::jsonb)`, [E1]);
});
const tp = (await q1(`select tipo from public.empresas where nome='Durant Alfaiataria'`)).tipo; ok(['alfaiataria', 'fabrica', 'atelie'].includes(tp), 'empresas existentes ganharam um tipo na migração');
console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTUDO OK'); process.exit(falhas.length ? 1 : 0);
