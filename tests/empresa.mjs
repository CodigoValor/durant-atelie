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
for (const f of ['0001_base.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql', '0005_parceiro.sql', '0006_numeracao.sql', '0007_convites.sql', '0008_origem_parceiro.sql', '0009_andamento_parceiro.sql']) await db.exec(sql(f));
await db.exec(sql('0013_cadastro_empresa.sql')); await db.exec(sql('0013_cadastro_empresa.sql'));
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
await como(LUIZ, async () => { await db.query(`select public.salvar_empresa($1,$2::jsonb,true,true)`, [E1, cad({})]); });
const r = await q1(`select cnpj, vende_cliente_final v, produz p, cadastro->>'razao' razao from public.empresas where id=$1`, [E1]);
ok(r.cnpj === '12345678000190' && r.v && r.p && r.razao === 'Durant Alfaiataria Ltda.', 'administrador salva cadastro, CNPJ (só dígitos) e o que a empresa faz');
await como(MARIA, async () => ok(/sem permissão/.test(await falha(`select public.salvar_empresa($1,$2::jsonb,true,false)`, [E1, cad({})])), 'usuário comum não altera o cadastro da empresa'));
await como(ANA, async () => ok(/sem permissão/.test(await falha(`select public.salvar_empresa($1,$2::jsonb,true,false)`, [E1, cad({})])), 'administrador de outra empresa não altera esta'));
await como(ANA, async () => ok(/já está cadastrado/.test(await falha(`select public.salvar_empresa($1,$2::jsonb,true,false)`, [E2, cad({})])), 'CNPJ repetido em outra empresa é recusado'));
await como(LUIZ, async () => {
  ok(/precisa atender/.test(await falha(`select public.salvar_empresa($1,$2::jsonb,false,false)`, [E1, cad({})])), 'empresa sem alfaiataria e sem fábrica é recusada');
  doc = '123'; ok(/11 números e CNPJ tem 14/.test(await falha(`select public.salvar_empresa($1,$2::jsonb,true,false)`, [E1, cad({})])), 'documento com tamanho errado é recusado');
  doc = ''; await db.query(`select public.salvar_empresa($1,$2::jsonb,true,false)`, [E1, cad({})]);
});
ok((await q1(`select cnpj, produz from public.empresas where id=$1`, [E1])).cnpj === null, 'documento em branco limpa o CNPJ (não trava a unicidade)');
ok(/permission denied|sem permissão/.test(await como(MARIA, async () => await falha(`update public.empresas set produz=true where id=$1`, [E1]) || 'sem permissão')), 'cliente não altera a tabela de empresas direto');
console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTUDO OK'); process.exit(falhas.length ? 1 : 0);
