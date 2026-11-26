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
const LUIZ = '00000000-0000-0000-0000-00000000000a', MARIA = '00000000-0000-0000-0000-00000000000b',
      OUTRO = '00000000-0000-0000-0000-00000000000c', FUNC = '00000000-0000-0000-0000-00000000000d';
await db.exec(`insert into auth.users values ('${LUIZ}','hd@henriquedurant.com'),('${MARIA}','maria@exemplo.com'),('${OUTRO}','outro@exemplo.com'),('${FUNC}','func@exemplo.com')`);

for (const f of ['0001_base.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql']) await db.exec(sql(f));
await db.exec(sql('0005_parceiro.sql'));
await db.exec(sql('0005_parceiro.sql'));   // idempotente
ok(true, '0005_parceiro.sql roda duas vezes sem quebrar');

await db.exec(`insert into public.empresas (nome) values ('Ateliê da Maria')`);
const emp = Object.fromEntries((await db.query(`select nome, id from public.empresas`)).rows.map(r => [r.nome, r.id]));
const E1 = emp['Durant Alfaiataria'], E2 = emp['Ateliê da Maria'];
await db.exec(`insert into public.membros (user_id, empresa_id, papel) values
  ('${LUIZ}','${E1}','admin'), ('${LUIZ}','${E2}','parceiro'),
  ('${MARIA}','${E2}','admin'), ('${OUTRO}','${E2}','parceiro'), ('${FUNC}','${E2}','usuario')`);

// semente da empresa da Maria (como superusuário, equivale ao que ela já tinha antes dos parceiros)
const cfg = { produtos: [{ nome: 'Terno', preco: 4000, custo: 1800 }], servicos: [{ nome: 'Ajuste', preco: 150 }],
  contas: [{ banco: 'Itaú', ag: '1234', cc: '99999-9' }], usuarios: [{ email: 'maria@exemplo.com', hash: 'segredo' }],
  grupos: [{ nome: 'Admin' }], ultimoPed: 120, bkpLista: [1, 2] };
const cat = { tecidos: { Italiano: [{ cod: 'T1', nome: 'Lã 120', preco: 300, custo: 150, fornecedor: 'Fulano' }] }, forros: {} };
await db.query(`insert into public.reg (empresa_id,id,k,i,j) values
  ('${E2}','sing~cfg','sing','cfg',$1), ('${E2}','sing~cat','sing','cat',$2),
  ('${E2}','clientes~1','clientes','1','{"nome":"Cliente antigo da Maria"}'),
  ('${E2}','receber~1','receber','1','{"valor":500}')`, [JSON.stringify(cfg), JSON.stringify(cat)]);

async function como(sub, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub','${sub}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false);`); }
}
const falha = async (q, p) => { try { await db.query(q, p); return false; } catch (e) { return e.message; } };
const ins = (emp, id, k, j, extra = '') => `insert into public.reg (empresa_id,id,k,i,j${extra ? ',criado_por' : ''}) values ('${emp}','${id}','${k}','${id.split('~')[1]}','${j}'${extra ? `,'${extra}'` : ''})`;

console.log('Catálogo público (gatilho)');
{
  const r = (await db.query(`select j from public.reg where empresa_id='${E2}' and id='pub~catalogo'`)).rows;
  ok(r.length === 1, 'o catálogo público foi criado a partir da configuração da empresa');
  const p = JSON.parse(r[0].j);
  ok(p.produtos?.[0]?.preco === 4000 && p.servicos?.[0]?.preco === 150, 'traz produtos e serviços com preço');
  ok(!('custo' in p.produtos[0]), 'NÃO traz o custo do produto');
  ok(!('contas' in p) && !('usuarios' in p) && !('grupos' in p) && !('ultimoPed' in p) && !('bkpLista' in p), 'NÃO traz contas, usuários, grupos, numeração nem backups');
  ok(p.cat?.tecidos?.Italiano?.[0]?.preco === 300 && !('custo' in p.cat.tecidos.Italiano[0]) && !('fornecedor' in p.cat.tecidos.Italiano[0]), 'catálogo de tecidos sai com preço, sem custo nem fornecedor');
  ok(!JSON.stringify(p).includes('Itaú') && !JSON.stringify(p).includes('segredo'), 'nenhum dado sensível aparece em lugar nenhum do catálogo');
  ok((await db.query(`select count(*)::int n from public.reg where empresa_id='${E1}' and k='pub'`)).rows[0].n === 0, 'empresa sem configuração não ganha catálogo');
}

console.log('Luiz como PARCEIRO no ateliê da Maria');
await como(LUIZ, async () => {
  await db.query(ins(E2, 'clientes~100', 'clientes', '{"nome":"Henrique Toledo"}'));
  await db.query(ins(E2, 'pedidos~100', 'pedidos', '{"id":"P-100"}'));
  await db.query(ins(E2, 'orcamentos~100', 'orcamentos', '{"id":"O-100"}'));
  await db.query(ins(E2, 'med~100', 'med', '{"ombro":46}'));
  ok(true, 'lança cliente, medidas, pedido e orçamento');
  ok((await db.query(`select criado_por from public.reg where id='clientes~100' and empresa_id='${E2}'`)).rows[0].criado_por === LUIZ, 'o servidor grava ele como dono');
  await db.query(ins(E2, 'clientes~101', 'clientes', '{"nome":"Forjado"}', OUTRO));
  ok((await db.query(`select criado_por from public.reg where id='clientes~101' and empresa_id='${E2}'`)).rows[0].criado_por === LUIZ, 'NÃO consegue forjar outro dono ao criar');
  const vistos = (await db.query(`select id from public.reg where empresa_id='${E2}' order by id`)).rows.map(x => x.id);
  ok(JSON.stringify(vistos) === JSON.stringify(['clientes~100', 'clientes~101', 'med~100', 'orcamentos~100', 'pedidos~100', 'pub~catalogo']), 'vê só os próprios documentos + o catálogo público: ' + vistos.join(', '));
  ok(!vistos.includes('sing~cfg') && !vistos.includes('receber~1') && !vistos.includes('clientes~1'), 'NÃO vê configuração, financeiro nem o cliente antigo da Maria');
  ok(!!(await falha(ins(E2, 'receber~9', 'receber', '{}'))), 'NÃO consegue criar contas a receber');
  ok(!!(await falha(ins(E2, 'sing~cfg2', 'sing', '{}'))), 'NÃO consegue criar configuração');
  ok(!!(await falha(ins(E2, 'pub~catalogo2', 'pub', '{"produtos":[{"preco":1}]}'))), 'NÃO consegue escrever no catálogo público');
  ok((await db.query(`update public.reg set j='{"hack":1}' where id='pub~catalogo' and empresa_id='${E2}'`)).affectedRows === 0, 'NÃO consegue alterar o catálogo público');
  ok((await db.query(`delete from public.reg where id='pub~catalogo' and empresa_id='${E2}'`)).affectedRows === 0, 'NÃO consegue apagar o catálogo público');
  ok((await db.query(`update public.reg set j='{"nome":"Henrique T."}' where id='clientes~100' and empresa_id='${E2}'`)).affectedRows === 1, 'edita o que é dele');
  ok((await db.query(`update public.reg set j='{"x":1}' where id in ('sing~cfg','receber~1','clientes~1') and empresa_id='${E2}'`)).affectedRows === 0, 'NÃO consegue editar configuração, financeiro nem cliente da Maria');
  ok((await db.query(`delete from public.reg where id in ('sing~cfg','receber~1','clientes~1') and empresa_id='${E2}'`)).affectedRows === 0, 'NÃO consegue apagar nada que não é dele');
  ok(!!(await falha(`update public.reg set k='receber' where id='clientes~100' and empresa_id='${E2}'`)) || (await db.query(`select k from public.reg where id='clientes~100' and empresa_id='${E2}'`)).rows[0].k === 'clientes', 'NÃO consegue converter o tipo de um documento');
  await db.query(`update public.reg set criado_por='${OUTRO}' where id='clientes~100' and empresa_id='${E2}'`);
  ok((await db.query(`select criado_por from public.reg where id='clientes~100' and empresa_id='${E2}'`)).rows[0].criado_por === LUIZ, 'NÃO consegue passar o documento para outro dono');
  ok(!!(await falha(`update public.reg set empresa_id='${E1}' where id='clientes~100' and empresa_id='${E2}'`)), 'NÃO consegue levar o documento para a própria empresa nem outra');
  ok(!!(await falha(`insert into public.membros (user_id,empresa_id,papel) values ('${LUIZ}','${E2}','admin')`)), 'NÃO consegue se promover');
  ok(!!(await falha(`update public.membros set papel='admin' where empresa_id='${E2}'`)) || (await db.query(`select papel from public.membros where empresa_id='${E2}' and user_id='${LUIZ}'`)).rows[0].papel === 'parceiro', 'NÃO consegue mudar o próprio papel');
  ok((await db.query(`select count(*)::int n from public.audit_log`)).rows[0].n === 0, 'NÃO lê o log de auditoria');
});

console.log('Outro alfaiate (parceiro) com o MESMO cliente final');
await como(OUTRO, async () => {
  await db.query(ins(E2, 'clientes~200', 'clientes', '{"nome":"Henrique Toledo"}'));
  const meus = (await db.query(`select id, j from public.reg where empresa_id='${E2}' and k='clientes'`)).rows;
  ok(meus.length === 1 && meus[0].id === 'clientes~200', 'vê só o Henrique Toledo dele, não o do Luiz');
  ok((await db.query(`select count(*)::int n from public.reg where empresa_id='${E2}' and k in ('pedidos','med','orcamentos')`)).rows[0].n === 0, 'não vê pedidos, medidas nem orçamentos do Luiz');
  ok((await db.query(`update public.reg set j='{"hack":1}' where id='clientes~100' and empresa_id='${E2}'`)).affectedRows === 0, 'NÃO altera o cliente do Luiz');
  ok((await db.query(`delete from public.reg where id='pedidos~100' and empresa_id='${E2}'`)).affectedRows === 0, 'NÃO apaga o pedido do Luiz');
  ok(!!(await falha(ins(E2, 'clientes~100', 'clientes', '{"nome":"Sequestro"}'))), 'NÃO consegue sobrescrever um id que é do Luiz (nem por inserção)');
  ok(!!(await falha(`insert into public.reg (empresa_id,id,k,i,j) values ('${E2}','clientes~100','clientes','100','{"nome":"Sequestro"}') on conflict (empresa_id,id) do update set j=excluded.j`)), 'NÃO consegue sobrescrever com upsert');
});

console.log('Maria (admin) e funcionário (usuário) no próprio ateliê');
await como(MARIA, async () => {
  const todos = (await db.query(`select id from public.reg where empresa_id='${E2}' and k='clientes'`)).rows.map(r => r.id).sort();
  ok(JSON.stringify(todos) === JSON.stringify(['clientes~1', 'clientes~100', 'clientes~101', 'clientes~200']), 'vê os clientes de todos os parceiros e os próprios: ' + todos.join(', '));
  const nomes = (await db.query(`select j from public.reg where empresa_id='${E2}' and id in ('clientes~100','clientes~200')`)).rows.map(r => JSON.parse(r.j).nome);
  ok(nomes.length === 2 && nomes.every(n => n.startsWith('Henrique T')), 'o mesmo cliente final aparece em dois cadastros separados, um de cada parceiro');
  ok((await db.query(`update public.reg set j='{"nome":"Revisado"}' where id='clientes~100' and empresa_id='${E2}'`)).affectedRows === 1, 'edita o cliente de um parceiro');
  ok((await db.query(`select criado_por from public.reg where id='clientes~100' and empresa_id='${E2}'`)).rows[0].criado_por === LUIZ, 'o dono do documento continua sendo o parceiro');
  ok(!!(await falha(ins(E2, 'pub~x', 'pub', '{}'))), 'nem a admin escreve direto no catálogo público');
  ok((await db.query(`select count(*)::int n from public.audit_log where k='clientes' and user_id='${LUIZ}'`)).rows[0].n >= 1, 'a auditoria registra o parceiro como autor (admin lê o log)');
});
await como(FUNC, async () => {
  ok((await db.query(`select count(*)::int n from public.reg where empresa_id='${E2}'`)).rows[0].n >= 8, 'usuário da equipe continua vendo tudo da empresa');
  await db.query(ins(E2, 'clientes~300', 'clientes', '{"nome":"Balcão"}'));
  ok(true, 'e continua gravando');
});

console.log('Luiz na própria empresa (admin) não muda');
await como(LUIZ, async () => {
  await db.query(ins(E1, 'clientes~1', 'clientes', '{"nome":"Cliente do Luiz"}'));
  await db.query(ins(E1, 'receber~1', 'receber', '{"v":1}'));
  const ids = (await db.query(`select empresa_id from public.reg where id in ('clientes~1','receber~1')`)).rows;
  ok(ids.length === 2 && ids.every(x => x.empresa_id === E1), 'como admin da Durant lê e grava normalmente, e continua sem ver o legado da Maria');
});

console.log('Catálogo acompanha a configuração');
await db.query(`update public.reg set j=$1 where empresa_id='${E2}' and id='sing~cfg'`, [JSON.stringify({ ...cfg, produtos: [{ nome: 'Terno', preco: 4500, custo: 1 }, { nome: 'Colete', preco: 900 }] })]);
{
  const p = JSON.parse((await db.query(`select j from public.reg where empresa_id='${E2}' and id='pub~catalogo'`)).rows[0].j);
  ok(p.produtos.length === 2 && p.produtos[0].preco === 4500 && !('custo' in p.produtos[0]), 'quando a Maria muda a tabela de preços, o catálogo dos parceiros acompanha (sem custo)');
}
ok((await db.query(`select count(*)::int n from public.audit_log where k='pub'`)).rows[0].n === 0, 'o catálogo derivado não polui o log de auditoria');
await como(LUIZ, async () => {
  const p = JSON.parse((await db.query(`select j from public.reg where empresa_id='${E2}' and id='pub~catalogo'`)).rows[0].j);
  ok(p.produtos.length === 2, 'o parceiro enxerga o preço novo');
});

console.log('Visitante anônimo');
await db.exec(`set role anon`);
ok(/permission denied/i.test(await falha(`select * from public.reg`)), 'anônimo não lê nada');
await db.exec(`reset role`);

console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTudo certo.');
process.exit(falhas.length ? 1 : 0);
