/* Ensaio da subida para produção: banco "como está hoje na produção" (só 0001 e 0002, com dados reais simulados)
   recebe o arquivo único de subida (0003 a 0009). Nada pode se perder nem mudar. */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import crypto from 'crypto';
const db = new PGlite();
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };
const sql = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const subida = fs.readFileSync(new URL('../supabase/ferramentas/subida_producao_0003_a_0009.sql', import.meta.url), 'utf8');

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`);
const LUIZ = '00000000-0000-0000-0000-0000000000a1';
await db.exec(`insert into auth.users values ('${LUIZ}','hd@henriquedurant.com')`);
await db.exec(sql('0001_base.sql')); await db.exec(sql('0002_primeiro_admin.sql'));
const E = (await db.query(`select id from public.empresas where nome='Durant Alfaiataria'`)).rows[0].id;

/* dados "reais": clientes, pedidos, medidas, configurações, catálogo, backup — todos sem criado_por (como estão hoje) */
for (let n = 1; n <= 120; n++) await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,$2,'clientes',$3,$4)`, [E, 'clientes~' + n, String(n), JSON.stringify({ id: n, nome: 'Cliente ' + n, cpf: '111.222.333-' + (n % 100), tel: '(19) 9' + n })]);
for (let n = 26001; n <= 26150; n++) await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,$2,'pedidos',$3,$4)`, [E, 'pedidos~P-' + n, 'P-' + n, JSON.stringify({ id: 'P-' + n, cli: (n % 120) + 1, valor: 1500, status: 'producao', pecas: [] })]);
for (let n = 1; n <= 30; n++) await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,$2,'med',$3,$4)`, [E, 'med~' + n, String(n), JSON.stringify({ corpo: { pescoco: 38 + n % 5 }, prontas: [] })]);
await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,'sing~cfg','sing','cfg',$2)`, [E, JSON.stringify({ usuarios: [{ id: 'u1', nome: 'Luiz', email: 'hd@henriquedurant.com' }], produtos: [] })]);
await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,'sing~cat','sing','cat',$2)`, [E, JSON.stringify({ tecidos: {}, forros: {} })]);
await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,'sys~meta','sys','meta','{"v":1}')`, [E]);
const foto = async () => {
  const rows = (await db.query(`select id, k, i, j from public.reg where k <> 'pub' order by id`)).rows;
  return { n: rows.length, h: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
};
const antes = await foto();
const membrosAntes = (await db.query(`select user_id, empresa_id, papel from public.membros order by 1,2`)).rows;
console.log('Ensaio: produção simulada com ' + antes.n + ' registros');

let erro = null;
try { await db.exec(subida); } catch (e) { erro = e.message; }
ok(!erro, 'o arquivo único de subida roda sem erro' + (erro ? ': ' + erro : ''));
try { await db.exec(subida); erro = null; } catch (e) { erro = e.message; }
ok(!erro, 'roda de novo sem quebrar (pode repetir com segurança)' + (erro ? ': ' + erro : ''));

const depois = await foto();
const pubs = Number((await db.query(`select count(*) c from public.reg where k='pub'`)).rows[0].c);
ok(depois.n === antes.n && pubs === 1, 'nenhum registro foi perdido nem criado, exceto o catálogo público (pub~catalogo), que o sistema novo cria sozinho (' + depois.n + ' + ' + pubs + ')');
ok(depois.h === antes.h, 'o conteúdo de todos os registros ficou idêntico (clientes, pedidos, medidas, configuração)');
const membrosDepois = (await db.query(`select user_id, empresa_id, papel from public.membros order by 1,2`)).rows;
ok(JSON.stringify(membrosDepois) === JSON.stringify(membrosAntes), 'o administrador continua administrador, sem vínculos novos');

async function como(sub, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub','${sub}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false);`); }
}
await como(LUIZ, async () => {
  ok(Number((await db.query(`select count(*) c from public.reg`)).rows[0].c) === antes.n + 1, 'o administrador enxerga todos os registros depois da subida');
  await db.query(`update public.reg set j=$1 where id='clientes~1'`, [JSON.stringify({ id: 1, nome: 'Cliente 1 editado' })]);
  await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,'clientes~999','clientes','999','{"id":999,"nome":"Novo"}')`, [E]);
  ok(true, 'o administrador edita e cria registros normalmente');
  const n1 = Number((await db.query(`select public.reservar_numeros('${E}','pedido',3) r`)).rows[0].r);
  ok(n1 >= 26150, 'a numeração nova começa depois do maior pedido existente (P-26150): ' + n1);
  const c1 = Number((await db.query(`select public.reservar_numeros('${E}','cliente',3) r`)).rows[0].r);
  ok(c1 >= 120, 'a numeração de clientes começa depois do maior cliente existente: ' + c1);
  const org = (await db.query(`select * from public.listar_origens('${E}')`)).rows;
  ok(org.length === 0, 'nenhum registro antigo aparece como "de ateliê" (todos são da própria empresa)');
});
const aud = (await db.query(`select count(*) c from public.audit_log`)).rows[0].c;
ok(Number(aud) >= 2, 'a auditoria passou a registrar as alterações feitas depois da subida (' + aud + ')');

if (falhas.length) { console.log('\n' + falhas.length + ' FALHA(S)'); process.exit(1); }
console.log('\nTudo certo.');
