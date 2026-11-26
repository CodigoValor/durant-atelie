import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };

// Cenário mínimo do Supabase: papéis, schema auth, auth.users e auth.uid()
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant select on auth.users to authenticated;  -- só para o teste conseguir semear; a migração não depende disso
`);
await db.exec(`insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a','hd@henriquedurant.com'),
  ('00000000-0000-0000-0000-00000000000b','maria@exemplo.com'),
  ('00000000-0000-0000-0000-00000000000c','intruso@exemplo.com');`);

await db.exec(fs.readFileSync(new URL('../supabase/migrations/0001_base.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(new URL('../supabase/migrations/0001_base.sql', import.meta.url), 'utf8')); // idempotente
ok(true, '0001_base.sql roda sem erro (e roda duas vezes sem quebrar)');
await db.exec(fs.readFileSync(new URL('../supabase/migrations/0004_perfil_empresa.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(new URL('../supabase/migrations/0004_perfil_empresa.sql', import.meta.url), 'utf8')); // idempotente
const perf = (await db.query(`select vende_cliente_final v, produz p from public.empresas where nome='Durant Alfaiataria'`)).rows[0];
ok(perf.v === true && perf.p === false, '0004_perfil_empresa.sql roda (duas vezes) e deixa o padrão: vende ao cliente final, não produz');

// segunda empresa (dados da Maria) e vínculos
await db.exec(`insert into public.empresas (nome) values ('Ateliê da Maria')`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/0002_primeiro_admin.sql', import.meta.url), 'utf8'));
await db.exec(`insert into public.membros (user_id, empresa_id, papel)
  select '00000000-0000-0000-0000-00000000000b', id, 'admin' from public.empresas where nome='Ateliê da Maria'`);
const emp = Object.fromEntries((await db.query(`select nome, id from public.empresas`)).rows.map(r => [r.nome, r.id]));
const E1 = emp['Durant Alfaiataria'], E2 = emp['Ateliê da Maria'];
const m = (await db.query(`select count(*)::int n from public.membros`)).rows[0].n;
ok(m === 2, '0002_primeiro_admin.sql liga só o e-mail certo (2 vínculos: Luiz e Maria)');

// como superusuário, semeia um documento de cada empresa
await db.exec(`insert into public.reg (empresa_id,id,k,i,j) values ('${E1}','clientes~1','clientes','1','{"nome":"Cliente do Luiz"}'),('${E2}','clientes~1','clientes','1','{"nome":"Cliente da Maria"}')`);

async function como(papel, sub, fn) {
  await db.exec(`set role ${papel}; select set_config('request.jwt.sub','${sub || ''}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false);`); }
}
const falha = async q => { try { await db.query(q); return false; } catch (e) { return e.message; } };
const A = '00000000-0000-0000-0000-00000000000a', C = '00000000-0000-0000-0000-00000000000c';

console.log('Luiz (membro da Durant)');
await como('authenticated', A, async () => {
  const r = (await db.query(`select j from public.reg`)).rows.map(x => x.j);
  ok(r.length === 1 && r[0].includes('Luiz'), 'vê só os documentos da própria empresa (não vê os da Maria)');
  await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ('${E1}','clientes~2','clientes','2','{"nome":"Novo"}')`);
  ok(true, 'grava na própria empresa');
  await db.query(`update public.reg set j='{"nome":"Editado"}' where id='clientes~2'`);
  ok((await db.query(`select j from public.reg where id='clientes~2'`)).rows[0].j.includes('Editado'), 'edita na própria empresa');
  ok(!!(await falha(`insert into public.reg (empresa_id,id,k,i,j) values ('${E2}','clientes~9','clientes','9','{}')`)), 'NÃO consegue gravar na empresa da Maria');
  const up = await db.query(`update public.reg set j='{"hack":1}' where empresa_id='${E2}'`);
  ok(up.affectedRows === 0, 'NÃO consegue alterar dados da Maria (0 linhas afetadas)');
  const del = await db.query(`delete from public.reg where empresa_id='${E2}'`);
  ok(del.affectedRows === 0, 'NÃO consegue apagar dados da Maria (0 linhas afetadas)');
  ok(!!(await falha(`update public.reg set empresa_id='${E2}' where id='clientes~2'`)), 'NÃO consegue "mudar" um documento seu para a empresa da Maria');
  ok(!!(await falha(`insert into public.membros (user_id,empresa_id,papel) values ('${A}','${E2}','admin')`)), 'NÃO consegue se dar acesso a outra empresa');
  ok(!!(await falha(`insert into public.empresas (nome) values ('x')`)), 'NÃO consegue criar empresa');
  ok((await db.query(`select count(*)::int n from public.membros`)).rows[0].n === 1, 'vê só o próprio vínculo');
  await db.query(`delete from public.reg where id='clientes~2'`);
  ok(true, 'apaga na própria empresa');
});

console.log('Intruso (conta criada, sem vínculo)');
await como('authenticated', C, async () => {
  ok((await db.query(`select count(*)::int n from public.reg`)).rows[0].n === 0, 'não vê nenhum documento');
  ok((await db.query(`select count(*)::int n from public.empresas`)).rows[0].n === 0, 'não vê nenhuma empresa');
  ok(!!(await falha(`insert into public.reg (empresa_id,id,k,i,j) values ('${E1}','x','x','x','{}')`)), 'NÃO consegue gravar em empresa nenhuma');
});

console.log('Visitante anônimo (sem login)');
await como('anon', '', async () => {
  ok(/permission denied/i.test(await falha(`select * from public.reg`)), 'não lê reg (permission denied)');
  ok(/permission denied/i.test(await falha(`select * from public.empresas`)), 'não lê empresas');
  ok(/permission denied/i.test(await falha(`select * from public.membros`)), 'não lê membros');
  ok(/permission denied/i.test(await falha(`insert into public.reg (empresa_id,id,k) values ('${E1}','x','x')`)), 'não grava');
  ok(/permission denied/i.test(await falha(`truncate public.reg`)), 'não consegue apagar tudo (truncate)');
});
await como('authenticated', A, async () => {
  ok(/permission denied/i.test(await falha(`truncate public.reg`)), 'nem o usuário logado consegue truncate');
});
const rls = (await db.query(`select relname, relrowsecurity from pg_class where relname in ('empresas','membros','reg') and relkind='r'`)).rows;
ok(rls.length === 3 && rls.every(r => r.relrowsecurity), 'RLS ligado nas 3 tabelas');
console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTUDO OK'); process.exit(falhas.length ? 1 : 0);
