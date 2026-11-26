import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };
const sql = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`);
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', U = '00000000-0000-0000-0000-00000000000d';
await db.exec(`insert into auth.users values ('${A}','hd@henriquedurant.com'),('${B}','outro@exemplo.com'),('${U}','usuario@exemplo.com')`);
await db.exec(sql('0001_base.sql')); await db.exec(sql('0002_primeiro_admin.sql'));
await db.exec(sql('0003_auditoria.sql')); await db.exec(sql('0003_auditoria.sql'));
ok(true, '0003_auditoria.sql roda sem erro (e roda duas vezes sem quebrar)');

await db.exec(`insert into public.empresas (nome) values ('Outra empresa')`);
const emp = Object.fromEntries((await db.query(`select nome,id from public.empresas`)).rows.map(r => [r.nome, r.id]));
const E1 = emp['Durant Alfaiataria'], E2 = emp['Outra empresa'];
await db.exec(`insert into public.membros (user_id,empresa_id,papel) values
  ('${B}','${E2}','admin'), ('${U}','${E1}','usuario')`);

async function como(papel, sub, fn) {
  await db.exec(`set role ${papel}; select set_config('request.jwt.sub','${sub || ''}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false);`); }
}
const falha = async q => { try { await db.query(q); return false; } catch (e) { return e.message; } };
const log = async (where = 'true') => (await db.query(`select * from public.audit_log where ${where} order by id`)).rows;

console.log('Registro automático (Luiz, admin da Durant)');
await como('authenticated', A, async () => {
  await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ('${E1}','clientes~1','clientes','1','{"nome":"Ana","tel":"111","cidade":"SP"}')`);
  await db.query(`update public.reg set j='{"nome":"Ana","tel":"222","cidade":"SP"}' where id='clientes~1'`);
  await db.query(`update public.reg set j='{"nome":"Ana","tel":"222","cidade":"SP"}', atualizado_em=now() where id='clientes~1'`); // mesmo conteúdo
  await db.query(`update public.reg set j='{"nome":"Ana Maria","tel":"222","cidade":"Campinas"}' where id='clientes~1'`);
  await db.query(`delete from public.reg where id='clientes~1'`);
});
let l = await log();
ok(l.length === 4, `4 eventos registrados: criar, alterar, alterar, apagar (regravar igual não conta) — achei ${l.length}`);
ok(l[0].acao === 'insert' && l[0].depois.nome === 'Ana' && l[0].antes === null, 'criar guarda o documento inteiro em "depois"');
ok(l[1].acao === 'update' && JSON.stringify(l[1].campos) === '["tel"]' && l[1].antes.tel === '111' && l[1].depois.tel === '222', 'alterar guarda só o campo que mudou (tel: 111 → 222)');
ok(!('nome' in l[1].antes) && !('cidade' in l[1].antes), 'não repete os campos que não mudaram');
ok(JSON.stringify(l[2].campos) === '["cidade","nome"]', 'vários campos alterados são listados');
ok(l[3].acao === 'delete' && l[3].antes.nome === 'Ana Maria', 'apagar guarda o documento inteiro em "antes" (dá para recuperar)');
ok(l.every(x => x.user_id === A && x.empresa_id === E1 && x.k === 'clientes' && x.reg_id === 'clientes~1' && x.em), 'todo evento leva usuário real, empresa, tipo, id e hora do servidor');

console.log('Ruído e casos especiais');
await como('authenticated', A, async () => {
  await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ('${E1}','bkp~x~0','bkp','x','{"grande":1}'),('${E1}','sys~meta','sys','meta','{"v":1}')`);
  await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ('${E1}','cat~1','cat','1','[1,2,3]')`);
  await db.query(`update public.reg set j='[1,2,4]' where id='cat~1'`);
  await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ('${E1}','x~1','x','1','texto que não é json')`);
});
ok((await log(`k in ('bkp','sys')`)).length === 0, 'backups internos (bkp) e marcador (sys) não entram no log');
l = await log(`reg_id='cat~1'`);
ok(l.length === 2 && l[1].antes.toString() === '1,2,3' && l[1].depois.toString() === '1,2,4', 'documento que é lista também registra antes/depois');
l = await log(`reg_id='x~1'`);
ok(l.length === 1 && l[0].depois === 'texto que não é json', 'conteúdo que não é JSON não derruba a gravação (guardado como texto)');

console.log('Imutabilidade');
await como('authenticated', A, async () => {
  ok(/permission denied/i.test(await falha(`insert into public.audit_log (empresa_id,acao,k,reg_id) values ('${E1}','insert','x','x')`)), 'usuário não consegue inserir linha no log');
  ok(/permission denied/i.test(await falha(`update public.audit_log set k='x'`)), 'usuário não consegue alterar o log');
  ok(/permission denied/i.test(await falha(`delete from public.audit_log`)), 'usuário não consegue apagar o log');
  ok(/permission denied/i.test(await falha(`truncate public.audit_log`)), 'usuário não consegue truncar o log');
});
ok(/imut/i.test(await falha(`update public.audit_log set k='x'`)), 'nem direto no banco o log pode ser alterado');
ok(/imut/i.test(await falha(`delete from public.audit_log`)), 'nem direto no banco o log pode ser apagado');
ok(/imut/i.test(await falha(`truncate public.audit_log`)), 'nem direto no banco o log pode ser truncado');

console.log('Quem pode ler');
await como('authenticated', A, async () => {
  const n = (await db.query(`select count(*)::int n from public.audit_log`)).rows[0].n;
  ok(n > 0 && (await db.query(`select count(*)::int n from public.audit_log where empresa_id='${E2}'`)).rows[0].n === 0, 'admin da Durant lê o log da Durant e nada de outra empresa');
});
await como('authenticated', U, async () => {
  ok((await db.query(`select count(*)::int n from public.audit_log`)).rows[0].n === 0, 'usuário comum (não admin) não lê o log');
});
await como('authenticated', B, async () => {
  await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ('${E2}','clientes~1','clientes','1','{"nome":"Dela"}')`);
  const r = (await db.query(`select empresa_id from public.audit_log`)).rows;
  ok(r.length === 1 && r[0].empresa_id === E2, 'admin de outra empresa vê só o log dela');
});
await como('anon', '', async () => {
  ok(/permission denied/i.test(await falha(`select * from public.audit_log`)), 'anônimo não lê o log');
});

console.log('Fora do app');
await db.exec(`insert into public.reg (empresa_id,id,k,i,j) values ('${E1}','clientes~7','clientes','7','{"nome":"Direto"}')`);
l = await log(`reg_id='clientes~7'`);
ok(l.length === 1 && l[0].user_id === null, 'alteração feita direto no banco (sem login) também é registrada, com usuário vazio');
await db.exec(`select set_config('request.headers','{"x-forwarded-for":"203.0.113.9, 10.0.0.1"}',false)`);
await db.exec(`insert into public.reg (empresa_id,id,k,i,j) values ('${E1}','clientes~8','clientes','8','{}')`);
ok((await log(`reg_id='clientes~8'`))[0].ip === '203.0.113.9', 'guarda o IP de origem (primeiro do x-forwarded-for)');

const rls = (await db.query(`select relname, relrowsecurity from pg_class where relname in ('empresas','membros','reg','audit_log') and relkind='r'`)).rows;
ok(rls.length === 4 && rls.every(r => r.relrowsecurity), 'RLS ligado nas 4 tabelas');
console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTUDO OK'); process.exit(falhas.length ? 1 : 0);
