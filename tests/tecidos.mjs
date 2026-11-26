// Módulo Tecidos (0010): isolamento entre empresas, papéis, integridade e auditoria — Postgres real em memória.
// Uso: node tests/tecidos.mjs
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
  grant select on auth.users to authenticated;
`);
const U = { admin: '00000000-0000-0000-0000-00000000000a', usuario: '00000000-0000-0000-0000-00000000000b', parceiro: '00000000-0000-0000-0000-00000000000c', outra: '00000000-0000-0000-0000-00000000000d', intruso: '00000000-0000-0000-0000-00000000000e' };
for (const [n, id] of Object.entries(U)) await db.exec(`insert into auth.users values ('${id}','${n}@exemplo.com')`);

for (const f of ['0001_base.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql', '0005_parceiro.sql']) await db.exec(sql(f));
await db.exec(sql('0010_tecidos.sql'));
await db.exec(sql('0010_tecidos.sql'));   // idempotente
ok(true, '0010_tecidos.sql roda (duas vezes) sem erro');

await db.exec(`insert into public.empresas (nome) values ('Ateliê da Outra')`);
const emp = Object.fromEntries((await db.query(`select nome, id from public.empresas`)).rows.map(r => [r.nome, r.id]));
const E1 = emp['Durant Alfaiataria'], E2 = emp['Ateliê da Outra'];
await db.exec(`insert into public.membros (user_id, empresa_id, papel) values
  ('${U.admin}','${E1}','admin'), ('${U.usuario}','${E1}','usuario'), ('${U.parceiro}','${E1}','parceiro'), ('${U.outra}','${E2}','admin')`);

const rls = (await db.query(`select c.relname t, c.relrowsecurity r from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'tec\_%' and c.relkind='r'`)).rows;
ok(rls.length === 7 && rls.every(x => x.r), 'as 7 tabelas tec_* existem e todas têm RLS ligado');

async function como(sub, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub','${sub || ''}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false);`); }
}
const falha = async q => { try { await db.query(q); return false; } catch (e) { return e.message; } };
const n = async q => (await db.query(q)).rows[0].n;

console.log('Admin da Durant monta o cenário');
let LS, IMP, VEND, CAT, DEST, P1, P2, ITEM;
await como(U.admin, async () => {
  LS = (await db.query(`insert into public.tec_lojas (empresa_id, nome, whatsapp) values ('${E1}','LS Tecidos','5511999990001') returning id`)).rows[0].id;
  IMP = (await db.query(`insert into public.tec_lojas (empresa_id, nome) values ('${E1}','Imperiale') returning id`)).rows[0].id;
  VEND = (await db.query(`insert into public.tec_vendedores (empresa_id, loja_id, nome, whatsapp, principal) values ('${E1}','${LS}','Carlos','5511999990002',true) returning id`)).rows[0].id;
  CAT = (await db.query(`insert into public.tec_catalogo (empresa_id, loja_id, referencia, nome, composicao, largura_cm, preco_metro, apelidos) values ('${E1}','${LS}','405/3','Azul marinho','100% lã',150,380.5,'{"azul marinho da ls"}') returning id`)).rows[0].id;
  DEST = (await db.query(`insert into public.tec_destinos (empresa_id, nome) values ('${E1}','Maria') returning id`)).rows[0].id;
  P1 = (await db.query(`insert into public.tec_pedidos (empresa_id, loja_id, vendedor_id, texto_original) values ('${E1}','${LS}','${VEND}','405/3 1,80m João Paiva') returning id`)).rows[0].id;
  P2 = (await db.query(`insert into public.tec_pedidos (empresa_id, loja_id) values ('${E1}','${LS}') returning id`)).rows[0].id;
  ITEM = (await db.query(`insert into public.tec_pedido_itens (empresa_id, pedido_id, catalogo_id, referencia, metragem, cliente_final, destino_id) values ('${E1}','${P1}','${CAT}','405/3',1.8,'João Paiva','${DEST}') returning id`)).rows[0].id;
  const nums = (await db.query(`select numero from public.tec_pedidos order by numero`)).rows.map(r => r.numero);
  ok(nums.join() === '1,2', 'numeração do pedido é sequencial por empresa (1, 2)');
  ok((await db.query(`select criado_por from public.tec_pedidos where id='${P1}'`)).rows[0].criado_por === U.admin, 'criado_por é o usuário real do login');
});

console.log('Integridade');
await como(U.admin, async () => {
  ok(!!(await falha(`insert into public.tec_catalogo (empresa_id, loja_id, referencia) values ('${E1}','${LS}',' 405/3 ')`)), 'não repete a mesma referência na mesma loja (ignora caixa e espaços)');
  await db.query(`insert into public.tec_catalogo (empresa_id, loja_id, referencia) values ('${E1}','${IMP}','405/3')`);
  ok(true, 'a mesma referência pode existir em outra loja');
  ok(!!(await falha(`insert into public.tec_pedido_itens (empresa_id, pedido_id, referencia, metragem) values ('${E1}','${P1}','X',0)`)), 'metragem zero é recusada');
  ok(!!(await falha(`insert into public.tec_pedido_itens (empresa_id, pedido_id, referencia, metragem) values ('${E1}','${P1}','X',-1)`)), 'metragem negativa é recusada');
  ok(!!(await falha(`update public.tec_pedidos set status='voando' where id='${P1}'`)), 'status inválido é recusado');
  await db.query(`update public.tec_pedidos set numero=99 where id='${P1}'`);
  ok((await n(`select numero n from public.tec_pedidos where id='${P1}'`)) === 1, 'o número do pedido nunca muda');
  await db.query(`insert into public.tec_pedidos (empresa_id, loja_id, criado_por) values ('${E1}','${LS}','${U.outra}')`);
  ok((await n(`select count(*)::int n from public.tec_pedidos where criado_por='${U.outra}'`)) === 0, 'criado_por forjado é sobrescrito pelo servidor');
});
// apagar item do catálogo mantém o item do pedido, só solta o vínculo (e não zera empresa_id)
await como(U.admin, async () => {
  const c2 = (await db.query(`insert into public.tec_catalogo (empresa_id, loja_id, referencia) values ('${E1}','${LS}','TEMP') returning id`)).rows[0].id;
  const it = (await db.query(`insert into public.tec_pedido_itens (empresa_id, pedido_id, catalogo_id, referencia, metragem) values ('${E1}','${P2}','${c2}','TEMP',1) returning id`)).rows[0].id;
  await db.query(`delete from public.tec_catalogo where id='${c2}'`);
  const r = (await db.query(`select catalogo_id, empresa_id, referencia from public.tec_pedido_itens where id='${it}'`)).rows[0];
  ok(r && r.catalogo_id === null && r.empresa_id === E1 && r.referencia === 'TEMP', 'apagar tecido do catálogo não apaga o pedido: o item fica com a referência gravada');
});

console.log('Outra empresa (admin da Ateliê da Outra)');
await como(U.outra, async () => {
  for (const t of ['tec_lojas', 'tec_vendedores', 'tec_catalogo', 'tec_destinos', 'tec_pedidos', 'tec_pedido_itens'])
    ok((await n(`select count(*)::int n from public.${t}`)) === 0, `não vê nada de ${t}`);
  ok(!!(await falha(`insert into public.tec_lojas (empresa_id, nome) values ('${E1}','Invasora')`)), 'NÃO cria loja na empresa da Durant');
  ok(!!(await falha(`insert into public.tec_pedidos (empresa_id, loja_id) values ('${E2}','${LS}')`)), 'NÃO cria pedido na própria empresa apontando para a loja da Durant (chave composta)');
  const l = await db.query(`update public.tec_lojas set nome='hack' where id='${LS}'`);
  ok(l.affectedRows === 0, 'NÃO altera a loja da Durant');
  const d = await db.query(`delete from public.tec_pedidos where id='${P1}'`);
  ok(d.affectedRows === 0, 'NÃO apaga pedido da Durant');
  const mv = await db.query(`update public.tec_pedidos set empresa_id='${E2}' where id='${P1}'`);
  ok(mv.affectedRows === 0, 'NÃO "move" pedido da Durant para a própria empresa');
  await db.query(`insert into public.tec_lojas (empresa_id, nome) values ('${E2}','LS Tecidos')`);
  ok(true, 'pode ter uma loja com o mesmo nome na própria empresa (nomes são por empresa)');
});

console.log('Usuário (equipe)');
await como(U.usuario, async () => {
  ok((await n(`select count(*)::int n from public.tec_pedidos`)) >= 2, 'enxerga os pedidos da empresa');
  await db.query(`insert into public.tec_pedidos (empresa_id, loja_id) values ('${E1}','${LS}')`);
  await db.query(`update public.tec_pedidos set status='enviado', enviado_em=now() where id='${P1}'`);
  ok(true, 'cria pedido e marca como enviado');
  const dl = await db.query(`delete from public.tec_lojas where id='${IMP}'`);
  ok(dl.affectedRows === 0, 'NÃO apaga loja (só admin)');
  const dp = await db.query(`delete from public.tec_pedidos where id='${P1}'`);
  ok(dp.affectedRows === 0, 'NÃO apaga pedido já enviado (só admin)');
  const di = await db.query(`delete from public.tec_pedido_itens where id='${ITEM}'`);
  ok(di.affectedRows === 0, 'NÃO apaga item de pedido já enviado');
  const dr = await db.query(`delete from public.tec_pedidos where id='${P2}'`);
  ok(dr.affectedRows === 1, 'apaga pedido que ainda é rascunho');
});

console.log('Parceiro e intruso');
await como(U.parceiro, async () => {
  for (const t of ['tec_lojas', 'tec_catalogo', 'tec_pedidos', 'tec_pedido_itens', 'tec_mensagens'])
    ok((await n(`select count(*)::int n from public.${t}`)) === 0, `parceiro não vê ${t}`);
  ok(!!(await falha(`insert into public.tec_lojas (empresa_id, nome) values ('${E1}','x')`)), 'parceiro NÃO cria loja');
});
await como(U.intruso, async () => {
  ok((await n(`select count(*)::int n from public.tec_lojas`)) === 0, 'quem não é de nenhuma empresa não vê nada');
  ok(!!(await falha(`insert into public.tec_lojas (empresa_id, nome) values ('${E1}','x')`)), 'quem não é de nenhuma empresa NÃO grava');
});
await como('', async () => {});
await db.exec(`set role anon`);
ok(!!(await falha(`select * from public.tec_lojas`)), 'anônimo NÃO lê nada (sem permissão)');
await db.exec(`reset role`);

console.log('Auditoria');
await como(U.admin, async () => {
  const a = (await db.query(`select acao, k, user_id from public.audit_log where k='tec_pedidos' order by id`)).rows;
  ok(a.some(x => x.acao === 'insert' && x.user_id === U.admin), 'criação de pedido foi registrada com o usuário real');
  ok((await n(`select count(*)::int n from public.audit_log where k='tec_pedidos' and acao='update' and campos @> array['status']`)) >= 1, 'a mudança de status foi registrada (campo e valor)');
  ok((await n(`select count(*)::int n from public.audit_log where k='tec_pedidos' and acao='delete'`)) === 1, 'a exclusão do rascunho foi registrada');
  ok(!!(await falha(`update public.audit_log set acao='insert'`)), 'o log continua imutável');
});
await como(U.usuario, async () => { ok((await n(`select count(*)::int n from public.audit_log`)) === 0, 'usuário comum não lê o log (só admin)'); });

if (falhas.length) { console.log('\n' + falhas.length + ' falha(s)'); process.exit(1); }
console.log('\nTudo certo.');
