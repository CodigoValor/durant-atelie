import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };
const sql = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
`);
const LUIZ = '00000000-0000-0000-0000-00000000000a', MARIA = '00000000-0000-0000-0000-00000000000b', ANA = '00000000-0000-0000-0000-00000000000c';
await db.exec(`insert into auth.users values ('${LUIZ}','hd@henriquedurant.com'),('${MARIA}','maria@ex.com'),('${ANA}','ana@ex.com')`);
for (const f of ['0001_base.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql', '0005_parceiro.sql', '0006_numeracao.sql', '0007_convites.sql', '0008_origem_parceiro.sql', '0009_andamento_parceiro.sql', '0010_tecidos.sql', '0011_tecidos_loja.sql']) await db.exec(sql(f));
await db.exec(sql('0013_cadastro_empresa.sql')); await db.exec(sql('0014_empresa_tipo_travado.sql')); await db.exec(sql('0014_empresa_tipo_travado.sql')); await db.exec(sql('0015_painel_plataforma.sql')); await db.exec(sql('0015_painel_plataforma.sql')); await db.exec(sql('0016_empresa_doc_so_plataforma.sql')); await db.exec(sql('0016_empresa_doc_so_plataforma.sql')); await db.exec(sql('0018_tipo_empresa.sql')); await db.exec(sql('0018_tipo_empresa.sql')); await db.exec(sql('0019_nome_fantasia.sql')); await db.exec(sql('0019_nome_fantasia.sql')); await db.exec(sql('0020_razao_so_plataforma.sql')); await db.exec(sql('0020_razao_so_plataforma.sql')); await db.exec(sql('0021_sem_tipo_fabrica.sql')); await db.exec(sql('0021_sem_tipo_fabrica.sql')); await db.exec(sql('0022_tipo_loja.sql')); await db.exec(sql('0022_tipo_loja.sql')); await db.exec(sql('0023_painel_2fa.sql')); await db.exec(sql('0023_painel_2fa.sql')); await db.exec(sql('0024_pessoas_cpf.sql')); await db.exec(sql('0024_pessoas_cpf.sql')); await db.exec(sql('0025_convite_empresa_tipo.sql')); await db.exec(sql('0025_convite_empresa_tipo.sql')); await db.exec(sql('0026_convite_envio_email.sql')); await db.exec(sql('0026_convite_envio_email.sql'));
ok(true, '0013 roda duas vezes sem quebrar');
const E1 = (await db.query(`select id from public.empresas where nome='Durant Alfaiataria'`)).rows[0].id;
await db.exec(`insert into public.empresas (nome) values ('Outra')`);
const E2 = (await db.query(`select id from public.empresas where nome='Outra'`)).rows[0].id;
await db.exec(`insert into public.membros (user_id, empresa_id, papel) values ('${LUIZ}','${E1}','admin'),('${MARIA}','${E1}','usuario'),('${ANA}','${E2}','admin')`);
async function como(sub, fn, aal = 'aal2') { await db.exec(`set role authenticated; select set_config('request.jwt.sub','${sub}',false); select set_config('request.jwt.claims','{"aal":"${aal}"}',false);`); try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false); select set_config('request.jwt.claims','',false);`); } }
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
// --- 2FA do painel (migração 0023): só vale com aal2 ---
await como(LUIZ, async () => ok(/sem permissão/.test(await falha(`select * from public.plataforma_empresas()`)), 'painel recusa quem entrou só com senha (aal1), mesmo sendo administrador'), 'aal1');
await como(LUIZ, async () => ok((await q1(`select public.plataforma_admin_cadastrado() v`)).v === true, 'a tela descobre que a pessoa é administradora e precisa do segundo fator'), 'aal1');
await como(MARIA, async () => ok((await q1(`select public.plataforma_admin_cadastrado() v`)).v === false, 'quem não é administrador recebe falso'), 'aal1');
await como(LUIZ, async () => ok((await db.query(`select * from public.plataforma_empresas()`)).rows.length >= 2, 'com o segundo fator (aal2) o painel responde'));
await como(LUIZ, async () => ok(/só o administrador da plataforma/.test(await falha(`select public.definir_tipo_empresa($1,'atelie',false)`, [E2])), 'trocar tipo também exige aal2'), 'aal1');
await como(LUIZ, async () => ok(/sem permissão/.test(await falha(`select public.plataforma_admin_adicionar('ana@ex.com')`)), 'adicionar administrador exige aal2'), 'aal1');
await como(LUIZ, async () => { await db.query(`select public.plataforma_admin_adicionar('ana@ex.com')`); });
await como(ANA, async () => ok((await db.query(`select * from public.plataforma_admins_listar()`)).rows.length === 2, 'o administrador de emergência entra com o próprio segundo fator e vê os dois'));
await como(LUIZ, async () => ok(/ainda não tem conta/.test(await falha(`select public.plataforma_admin_adicionar('ninguem@ex.com')`)), 'e-mail sem conta é recusado'));
await como(LUIZ, async () => ok(/próprio acesso/.test(await falha(`select public.plataforma_admin_remover($1)`, [LUIZ])), 'não dá para remover o próprio acesso'));
await como(LUIZ, async () => { await db.query(`select public.plataforma_admin_remover($1)`, [ANA]); });
await como(ANA, async () => ok(/sem permissão/.test(await falha(`select * from public.plataforma_empresas()`)), 'administrador removido perde o acesso'));
// --- pessoa com CPF único e login por CPF (migração 0024) ---
const CPF1 = '529.982.247-25', CPF2 = '111.444.777-35';
await como(MARIA, async () => ok(/CPF inválido/.test(await falha(`select public.salvar_minha_pessoa('111.111.111-11')`)), 'CPF inválido (dígitos repetidos) é recusado'));
await como(MARIA, async () => ok(/CPF inválido/.test(await falha(`select public.salvar_minha_pessoa('529.982.247-24')`)), 'CPF com dígito verificador errado é recusado'));
await como(MARIA, async () => { await db.query(`select public.salvar_minha_pessoa($1,'Maria')`, [CPF1]); ok((await q1(`select cpf from public.minha_pessoa()`)).cpf === '52998224725', 'a pessoa salva o CPF (só dígitos) e consulta o próprio'); });
await como(ANA, async () => ok(/já está cadastrado/.test(await falha(`select public.salvar_minha_pessoa($1)`, [CPF1])), 'o mesmo CPF não entra em duas contas'));
await como(ANA, async () => { await db.query(`select public.salvar_minha_pessoa($1)`, [CPF2]); ok((await q1(`select cpf from public.minha_pessoa()`)).cpf === '11144477735', 'outra pessoa cadastra o próprio CPF'); });
await como(ANA, async () => ok(!!(await falha(`select * from public.login_cpf_email('52998224725')`)), 'o navegador não consegue descobrir o e-mail de um CPF'));
await db.exec(`set role service_role`);
{ const r = await q1(`select * from public.login_cpf_email('529.982.247-25')`); ok(r.email === 'maria@ex.com' && r.bloqueado === false, 'a função de servidor resolve CPF em e-mail');
  ok((await db.query(`select * from public.login_cpf_email('00000000000')`)).rows.length === 0, 'CPF desconhecido não resolve');
  for (let k = 0; k < 4; k++) await db.query(`select public.login_cpf_falha('52998224725')`);
  ok((await q1(`select bloqueado from public.login_cpf_email('52998224725')`)).bloqueado === false, 'quatro erros ainda não bloqueiam');
  await db.query(`select public.login_cpf_falha('52998224725')`);
  ok((await q1(`select bloqueado from public.login_cpf_email('52998224725')`)).bloqueado === true, 'cinco erros bloqueiam o login por CPF por 15 minutos');
  await db.query(`select public.login_cpf_ok('52998224725')`);
  ok((await q1(`select bloqueado from public.login_cpf_email('52998224725')`)).bloqueado === false, 'login certo zera o contador');
  await db.query(`select public.login_cpf_falha('99999999999')`); }
await db.exec(`reset role`);
ok((await q1(`select count(*)::int n from public.login_cpf_falhas where cpf='99999999999'`)).n === 0, 'CPF desconhecido não gera registro de falha');
// --- convite de empresa nova já com o tipo (migração 0025) ---
await como(MARIA, async () => ok(/só o administrador da plataforma/.test(await falha(`select public.criar_convite_empresa('novo@ex.com','Nova','true','false','atelie')`)), 'só a plataforma cria convite de empresa'));
await como(LUIZ, async () => ok(/escolha o tipo/.test(await falha(`select public.criar_convite_empresa('novo@ex.com','Nova Ltda',true,false,null)`)), 'convite de empresa sem tipo é recusado'));
await como(LUIZ, async () => ok(/escolha o tipo/.test(await falha(`select public.criar_convite_empresa('novo@ex.com','Nova Ltda',true,false,'fabrica')`)), 'tipo antigo "fábrica" é recusado'));
let tokLoja, tokAt;
await como(LUIZ, async () => { tokLoja = (await q1(`select public.criar_convite_empresa('loja@ex.com','Loja Nova',true,false,'loja') t`)).t; tokAt = (await q1(`select public.criar_convite_empresa('maria@ex.com','Ateliê Novo',true,false,'atelie') t`)).t; });
await db.exec(`update auth.users set email='loja@ex.com' where id='${ANA}'`);
await como(ANA, async () => { await db.query(`select public.aceitar_convite($1)`, [tokLoja]); });
{ const e = await q1(`select tipo, vende_cliente_final v, produz p, fornece_tecido f from public.empresas where nome='Loja Nova'`); ok(e.tipo === 'loja' && e.v === false && e.p === false && e.f === true, 'empresa criada por convite de loja nasce como Loja de tecido (fornece tecido, não vende ao cliente final)'); }
await como(MARIA, async () => { await db.query(`select public.aceitar_convite($1)`, [tokAt]); });
{ const e = await q1(`select tipo, vende_cliente_final v, produz p, fornece_tecido f from public.empresas where nome='Ateliê Novo'`); ok(e.tipo === 'atelie' && e.v === true && e.p === false && e.f === false, 'empresa criada por convite de ateliê nasce como Ateliê'); }
const tp = (await q1(`select tipo from public.empresas where nome='Durant Alfaiataria'`)).tipo; ok(['alfaiataria', 'fabrica', 'atelie'].includes(tp), 'empresas existentes ganharam um tipo na migração');
// --- envio do convite por e-mail (migração 0026) ---
let tokEnv;
await como(LUIZ, async () => { tokEnv = (await q1(`select public.criar_convite_empresa('envio@ex.com','Empresa Envio',true,false,'atelie') t`)).t; });
await como(MARIA, async () => ok(/sem permissão/.test(await falha(`select * from public.convite_para_envio($1)`, [tokEnv])), 'quem não é da plataforma não consegue os dados de um convite de empresa nova'));
await como(LUIZ, async () => ok(/inválido ou expirado/.test(await falha(`select * from public.convite_para_envio('codigo-que-nao-existe-123')`)), 'código inexistente é recusado'));
await como(LUIZ, async () => { const r = await q1(`select * from public.convite_para_envio($1)`, [tokEnv]); ok(r.email === 'envio@ex.com' && r.empresa_nome === 'Empresa Envio' && r.papel === 'admin' && r.envio === 1, 'a plataforma recebe e-mail, empresa e papel do convite (envio 1)'); });
await como(LUIZ, async () => ok(/aguarde 1 minuto/.test(await falha(`select * from public.convite_para_envio($1)`, [tokEnv])), 'reenvio em menos de 1 minuto é recusado'));
await db.exec(`update public.convites set ultimo_envio = now() - interval '2 minutes'`);
await como(LUIZ, async () => { await db.query(`select * from public.convite_para_envio($1)`, [tokEnv]); });
await db.exec(`update public.convites set ultimo_envio = now() - interval '2 minutes'`);
await como(LUIZ, async () => { await db.query(`select * from public.convite_para_envio($1)`, [tokEnv]); });
await db.exec(`update public.convites set ultimo_envio = now() - interval '2 minutes'`);
await como(LUIZ, async () => ok(/limite de 3/.test(await falha(`select * from public.convite_para_envio($1)`, [tokEnv])), 'o 4º e-mail do mesmo convite é recusado'));
let tokUsr;
await como(LUIZ, async () => { tokUsr = (await q1(`select public.criar_convite($1,'novo-usuario@ex.com','usuario') t`, [E1])).t; });
await como(ANA, async () => ok(/sem permissão/.test(await falha(`select * from public.convite_para_envio($1)`, [tokUsr])), 'administrador de outra empresa não envia convite desta'));
await como(MARIA, async () => ok(/sem permissão/.test(await falha(`select * from public.convite_para_envio($1)`, [tokUsr])), 'usuário comum não envia convite'));
await como(LUIZ, async () => { const r = await q1(`select * from public.convite_para_envio($1)`, [tokUsr]); ok(r.email === 'novo-usuario@ex.com' && r.papel === 'usuario', 'administrador da empresa recebe os dados do convite de usuário'); });
const idUsr = (await q1(`select id from public.convites where token_hash = public._hash_token($1)`, [tokUsr])).id;
await como(ANA, async () => ok(/sem permissão/.test(await falha(`select public.cancelar_convite($1)`, [idUsr])), 'administrador de outra empresa não cancela convite desta (correção)'));
await como(MARIA, async () => ok(/sem permissão/.test(await falha(`select public.cancelar_convite($1)`, [idUsr])), 'usuário comum não cancela convite'));
ok((await q1(`select status from public.convites where id = $1`, [idUsr])).status === 'pendente', 'o convite continua pendente depois das tentativas');
await como(LUIZ, async () => { await db.query(`select public.cancelar_convite($1)`, [idUsr]); });
ok((await q1(`select status from public.convites where id = $1`, [idUsr])).status === 'cancelado', 'o administrador da empresa cancela o convite');
ok((await q1(`select count(*)::int n from public.audit_log where depois ? 'email_enviado_para'`)).n >= 4, 'cada envio fica na auditoria');
await db.exec(`reset role`);
try { await db.query(`set role anon`); ok(/permission denied/.test(await falha(`select * from public.convite_para_envio($1)`, [tokEnv])), 'sem login não chama a função'); } finally { await db.exec(`reset role`); }
console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTUDO OK'); process.exit(falhas.length ? 1 : 0);
