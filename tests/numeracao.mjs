import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };
const sql = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
`);
const LUIZ = '00000000-0000-0000-0000-00000000000a', MARIA = '00000000-0000-0000-0000-00000000000b', OUTRO = '00000000-0000-0000-0000-00000000000c', INTRUSO = '00000000-0000-0000-0000-00000000000e';
await db.exec(`insert into auth.users values ('${LUIZ}','a'),('${MARIA}','b'),('${OUTRO}','c'),('${INTRUSO}','e')`);
for (const f of ['0001_base.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql', '0005_parceiro.sql', '0006_numeracao.sql']) await db.exec(sql(f));
await db.exec(sql('0006_numeracao.sql'));
ok(true, '0006_numeracao.sql roda duas vezes sem quebrar');

await db.exec(`insert into public.empresas (nome) values ('Ateliê da Maria')`);
const emp = Object.fromEntries((await db.query(`select nome, id from public.empresas`)).rows.map(r => [r.nome, r.id]));
const E1 = emp['Durant Alfaiataria'], E2 = emp['Ateliê da Maria'];
await db.exec(`insert into public.membros (user_id, empresa_id, papel) values ('${LUIZ}','${E1}','admin'),('${LUIZ}','${E2}','parceiro'),('${MARIA}','${E2}','admin'),('${OUTRO}','${E2}','parceiro')`);
// Maria já tinha movimento: pedidos até P-2650, um orçamento P-2655, um pedido importado gigante, clientes até 40
const ins = (e, id, k, i) => db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,$2,$3,$4,'{}')`, [e, id, k, i]);
await ins(E2, 'pedidos~P-2650', 'pedidos', 'P-2650'); await ins(E2, 'pedidos~P-9999999', 'pedidos', 'P-9999999');
await ins(E2, 'orcamentos~P-2655', 'orcamentos', 'P-2655'); await ins(E2, 'clientes~40', 'clientes', '40'); await ins(E2, 'clientes~7', 'clientes', '7');

async function como(sub, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub','${sub}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false);`); }
}
const res = async (e, n, q) => Number((await db.query(`select public.reservar_numeros('${e}','${n}'${q ? ',' + q : ''}) r`)).rows[0].r);
const falha = async q => { try { await db.query(q); return false; } catch (e) { return e.message; } };

console.log('Piso vem dos dados que já existem');
const luiz1 = await como(LUIZ, () => res(E2, 'pedido', 5));
ok(luiz1 === 2656, 'primeiro bloco do Luiz (parceiro) começa depois do maior orçamento/pedido da Maria: ' + luiz1);
const maria1 = await como(MARIA, () => res(E2, 'pedido', 5));
ok(maria1 === 2661, 'a Maria recebe o bloco seguinte, sem sobrepor: ' + maria1);
const outro1 = await como(OUTRO, () => res(E2, 'pedido', 10));
ok(outro1 === 2666, 'o outro parceiro recebe o seguinte: ' + outro1);
const luiz2 = await como(LUIZ, () => res(E2, 'pedido', 5));
ok(luiz2 === 2676, 'quando o Luiz pede mais, continua depois de todos: ' + luiz2);
const todos = [[luiz1, 5], [maria1, 5], [outro1, 10], [luiz2, 5]].flatMap(([a, n]) => [...Array(n).keys()].map(i => a + i));
ok(new Set(todos).size === 25 && todos.length === 25, 'nenhum número se repete entre as 4 reservas (25 números)');

console.log('Clientes');
ok(await como(LUIZ, () => res(E2, 'cliente', 3)) === 41, 'primeiro cliente do parceiro vem depois do maior id existente (40)');
ok(await como(OUTRO, () => res(E2, 'cliente', 3)) === 44, 'o outro parceiro não repete: 44');

console.log('A numeração fixada pelo admin vale');
await db.query(`insert into public.reg (empresa_id,id,k,i,j) values ('${E2}','sing~cfg','sing','cfg',$1)`, [JSON.stringify({ ultimoPed: 3000 })]);
ok(await como(MARIA, () => res(E2, 'pedido', 1)) === 3001, 'a Maria define "último número = 3000" e o próximo é 3001');
ok(await como(LUIZ, () => res(E2, 'pedido', 1)) === 3002, 'o parceiro segue depois (3002)');

console.log('Cada empresa tem a própria contagem');
ok(await como(LUIZ, () => res(E1, 'pedido', 1)) === 2601, 'na Durant (vazia) começa em 2601');
ok(await como(LUIZ, () => res(E1, 'pedido', 1)) === 2602, 'e segue em 2602');
ok(await como(LUIZ, () => res(E1, 'cliente', 1)) === 1, 'cliente da Durant começa em 1');

console.log('Segurança');
await como(INTRUSO, async () => {
  ok(/sem acesso/.test(await falha(`select public.reservar_numeros('${E2}','pedido',1)`)), 'quem não tem vínculo NÃO reserva número');
});
await como(LUIZ, async () => {
  ok(/desconhecido/.test(await falha(`select public.reservar_numeros('${E2}','os',1)`)), 'contador que não existe é recusado');
  ok(/inválida/.test(await falha(`select public.reservar_numeros('${E2}','pedido',1000)`)), 'não deixa reservar um bloco gigante');
  ok(/sem acesso/.test(await falha(`select public.reservar_numeros('00000000-0000-0000-0000-0000000000ff','pedido',1)`)), 'empresa inexistente é recusada');
  ok(!!(await falha(`select * from public.contadores`)), 'ninguém lê nem altera o contador direto (só pela função)');
  ok(!!(await falha(`update public.contadores set ultimo = 1`)), 'nem tenta voltar o contador');
});
await db.exec(`set role anon`);
ok(!!(await falha(`select public.reservar_numeros('${E2}','pedido',1)`)), 'anônimo não executa a função');
await db.exec(`reset role`);

console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTudo certo.');
process.exit(falhas.length ? 1 : 0);
