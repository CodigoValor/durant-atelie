/* Ensaio da 2ª subida: banco "como está hoje na produção" (0001 a 0009 + dados reais simulados)
   recebe o arquivo único 0010 a 0025. Nada pode se perder nem mudar. */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import crypto from 'crypto';
const db = new PGlite();
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };
const sql = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const subida = fs.readFileSync(new URL('../supabase/ferramentas/subida_producao_0010_a_0025.sql', import.meta.url), 'utf8');
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
`);
const LUIZ = '00000000-0000-0000-0000-0000000000a1';
await db.exec(`insert into auth.users values ('${LUIZ}','hd@henriquedurant.com')`);
for (const f of ['0001_base.sql', '0002_primeiro_admin.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql', '0005_parceiro.sql', '0006_numeracao.sql', '0007_convites.sql', '0008_origem_parceiro.sql', '0009_andamento_parceiro.sql']) await db.exec(sql(f));
const E = (await db.query(`select id from public.empresas where nome='Durant Alfaiataria'`)).rows[0].id;
for (let n = 1; n <= 120; n++) await db.query(`insert into public.reg (empresa_id,id,k,i,j,criado_por) values ($1,$2,'clientes',$3,$4,$5)`, [E, 'clientes~' + n, String(n), JSON.stringify({ id: n, nome: 'Cliente ' + n, cpf: '111.222.333-44' }), LUIZ]);
for (let n = 26001; n <= 26150; n++) await db.query(`insert into public.reg (empresa_id,id,k,i,j,criado_por) values ($1,$2,'pedidos',$3,$4,$5)`, [E, 'pedidos~P-' + n, 'P-' + n, JSON.stringify({ id: 'P-' + n, cli: (n % 120) + 1, valor: 1000 + n }), LUIZ]);
await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,'sing~cfg','sing','cfg',$2)`, [E, JSON.stringify({ usuarios: [{ id: 'u1', nome: 'Luiz', email: 'hd@henriquedurant.com' }] })]);
const foto = async () => {
  const rows = (await db.query(`select id, k, i, j from public.reg order by id`)).rows;
  const emp = (await db.query(`select id, nome, vende_cliente_final, produz from public.empresas order by id`)).rows;
  const mem = (await db.query(`select user_id, empresa_id, papel from public.membros order by 1,2`)).rows;
  const cont = (await db.query(`select * from public.contadores order by 1,2`)).rows;
  const h = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
  return { n: rows.length, reg: h(rows), emp: h(emp), mem: h(mem), cont: h(cont) };
};
const antes = await foto();
console.log('Ensaio: produção simulada com ' + antes.n + ' registros');
let erro = null;
try { await db.exec(subida); } catch (e) { erro = e.message; }
ok(!erro, 'o arquivo único de subida roda sem erro' + (erro ? ': ' + erro : ''));
try { await db.exec(subida); erro = null; } catch (e) { erro = e.message; await db.exec('rollback'); }
console.log('  (2ª rodada: ' + (erro ? 'recusada e desfeita — não rode duas vezes' : 'passou') + ')');
const depois = await foto();
ok(depois.n === antes.n && depois.reg === antes.reg, 'todos os registros (clientes, pedidos, configuração) ficaram idênticos');
ok(depois.emp === antes.emp, 'a empresa existente ficou com o mesmo nome e as mesmas configurações');
ok(depois.mem === antes.mem, 'o administrador continua administrador, sem vínculos novos');
ok(depois.cont === antes.cont, 'os contadores de numeração ficaram iguais');
const e = (await db.query(`select tipo, cnpj from public.empresas where id=$1`, [E])).rows[0];
console.log('  empresa existente depois: tipo=' + e.tipo + ' cnpj=' + e.cnpj);
ok(['alfaiataria', 'atelie', 'loja'].includes(e.tipo), 'a empresa existente recebeu um tipo válido (' + e.tipo + ')');
for (const t of ['pessoas', 'login_cpf_falhas']) ok((await db.query(`select to_regclass('public.${t}') r`)).rows[0].r !== null, 'tabela ' + t + ' criada');
async function como(sub, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub','${sub}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false);`); }
}
await como(LUIZ, async () => {
  ok(Number((await db.query(`select count(*) c from public.reg`)).rows[0].c) === antes.n, 'o administrador enxerga todos os registros depois da subida');
  await db.query(`update public.reg set j=$1 where id='clientes~1'`, [JSON.stringify({ id: 1, nome: 'Cliente 1 editado' })]);
  ok(true, 'o administrador continua editando registros');
  const n1 = Number((await db.query(`select public.reservar_numeros('${E}','pedido',2) r`)).rows[0].r);
  ok(n1 >= 26150, 'a numeração de pedidos continua depois do maior existente: ' + n1);
});
if (falhas.length) { console.log('\n' + falhas.length + ' FALHA(S)'); process.exit(1); }
console.log('\nTudo certo.');
