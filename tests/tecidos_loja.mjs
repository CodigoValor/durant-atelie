// Módulo Tecidos parte 2 (0011): cadastro, liberação, preço do servidor, envio e resposta da loja — Postgres real em memória.
// Uso: node tests/tecidos_loja.mjs
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
const U = { ionaldo: '00000000-0000-0000-0000-0000000000a1', vend2: '00000000-0000-0000-0000-0000000000a2', luiz: '00000000-0000-0000-0000-0000000000b1', novo: '00000000-0000-0000-0000-0000000000b2', outro: '00000000-0000-0000-0000-0000000000b3', outraloja: '00000000-0000-0000-0000-0000000000c1' };
for (const [n, id] of Object.entries(U)) await db.exec(`insert into auth.users values ('${id}','${n}@exemplo.com')`);
for (const f of ['0001_base.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql', '0005_parceiro.sql', '0007_convites.sql', '0010_tecidos.sql']) await db.exec(sql(f));
await db.exec(sql('0011_tecidos_loja.sql'));
await db.exec(sql('0011_tecidos_loja.sql'));   // idempotente
ok(true, '0011_tecidos_loja.sql roda (duas vezes) sem erro');

const CPF = '529.982.247-25', CNPJ = '11.222.333/0001-81';
const rows = async q => (await db.query(q)).rows;
const n = async q => (await db.query(q)).rows[0].n;
const falha = async q => { try { await db.query(q); return false; } catch (e) { return e.message; } };
async function como(sub, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub','${sub || ''}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','',false);`); }
}

console.log('Cenário: Mark Bel (loja), outra loja e a empresa do Luiz (já usa o sistema)');
const MB = (await rows(`insert into public.empresas (nome, fornece_tecido) values ('Mark Bel', true) returning id`))[0].id;
const OL = (await rows(`insert into public.empresas (nome, fornece_tecido) values ('Outra Loja', true) returning id`))[0].id;
const DUR = (await rows(`select id from public.empresas where nome = 'Durant Alfaiataria'`))[0]?.id
  ?? (await rows(`insert into public.empresas (nome) values ('Durant Alfaiataria') returning id`))[0].id;
await db.exec(`insert into public.membros values ('${U.ionaldo}','${MB}','admin'), ('${U.vend2}','${MB}','usuario'), ('${U.luiz}','${DUR}','admin'), ('${U.outraloja}','${OL}','admin')`);
const LMB = (await rows(`insert into public.tec_lojas (empresa_id, nome) values ('${MB}','Mark Bel') returning id`))[0].id;
const LOL = (await rows(`insert into public.tec_lojas (empresa_id, nome) values ('${OL}','Outra Loja') returning id`))[0].id;
const A1009 = (await rows(`insert into public.tec_catalogo (empresa_id, loja_id, referencia, nome, preco_metro) values ('${MB}','${LMB}','1009','Tricoline prata 80/2',115) returning id`))[0].id;
const A0109 = (await rows(`insert into public.tec_catalogo (empresa_id, loja_id, referencia, nome, preco_metro) values ('${MB}','${LMB}','0109','Tricoline 120/2',205) returning id`))[0].id;
const INAT = (await rows(`insert into public.tec_catalogo (empresa_id, loja_id, referencia, nome, preco_metro, ativo) values ('${MB}','${LMB}','4157','Lã fria',230,false) returning id`))[0].id;
const AOL = (await rows(`insert into public.tec_catalogo (empresa_id, loja_id, referencia, nome, preco_metro) values ('${OL}','${LOL}','777','Outra',50) returning id`))[0].id;
ok((await n(`select count(*)::int n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and c.relname like 'tec\\_%' and c.relrowsecurity`)) === 8, 'as 8 tabelas tec_* têm RLS ligado');

console.log('CPF/CNPJ');
ok((await n(`select public.tec_doc_valido('${CPF}')::int n`)) === 1, 'CPF válido passa');
ok((await n(`select public.tec_doc_valido('${CNPJ}')::int n`)) === 1, 'CNPJ válido passa');
ok((await n(`select public.tec_doc_valido('111.111.111-11')::int n`)) === 0, 'CPF com dígitos repetidos é recusado');
ok((await n(`select public.tec_doc_valido('529.982.247-24')::int n`)) === 0, 'CPF com dígito errado é recusado');
ok((await n(`select public.tec_doc_valido('11.222.333/0001-80')::int n`)) === 0, 'CNPJ com dígito errado é recusado');

console.log('Cadastro do cliente novo (não usa o sistema)');
let V_NOVO, EMP_NOVO;
await como(U.novo, async () => {
  ok(!!(await falha(`select public.tec_pedir_acesso('${MB}','pf','Rafael Nunes','111.111.111-11','11999990000')`)), 'CPF inválido barra o cadastro');
  ok(!!(await falha(`select public.tec_pedir_acesso('${MB}','pj','Rafael','${CPF}','11999990000')`)), 'tipo PJ com CPF é recusado');
  ok(!!(await falha(`select public.tec_pedir_acesso('${DUR}','pf','Rafael Nunes','${CPF}','11999990000')`)), 'só pede acesso a empresa que é loja de tecido');
  V_NOVO = (await rows(`select public.tec_pedir_acesso('${MB}','pf','Rafael Nunes','${CPF}','11999990000') as id`))[0].id;
  const again = (await rows(`select public.tec_pedir_acesso('${MB}','pf','Rafael Nunes','${CPF}','11999990000') as id`))[0].id;
  ok(again === V_NOVO, 'pedir de novo devolve o mesmo cadastro (sem duplicar)');
  EMP_NOVO = (await rows(`select cliente_empresa_id as id from public.tec_loja_clientes where id='${V_NOVO}'`))[0].id;
  ok((await n(`select count(*)::int n from public.empresas where id='${EMP_NOVO}' and somente_tecidos`)) === 1, 'cria empresa da área restrita');
  const st = await rows(`select status from public.tec_loja_clientes where id='${V_NOVO}'`);
  ok(st[0].status === 'pendente', 'cadastro novo fica PENDENTE');
  ok(!!(await falha(`update public.tec_loja_clientes set status='liberado' where id='${V_NOVO}'`)), 'cliente não se libera sozinho');
  ok(!!(await falha(`insert into public.tec_loja_clientes (loja_empresa_id, cliente_empresa_id, tipo, nome, documento, status) values ('${OL}','${EMP_NOVO}','pf','x','${CPF.replace(/\D/g, '')}','liberado')`)), 'cliente não cria vínculo direto');
  ok((await n(`select count(*)::int n from public.tec_catalogo`)) === 0, 'pendente NÃO enxerga catálogo nem preços');
  ok(!!(await falha(`insert into public.tec_pedidos (empresa_id, loja_empresa_id) values ('${EMP_NOVO}','${MB}')`)), 'pendente NÃO cria pedido');
});
ok((await n(`select count(*)::int n from public.membros where empresa_id='${EMP_NOVO}' and user_id='${U.novo}' and papel='admin'`)) === 1, 'quem se cadastrou vira admin da própria empresa');

console.log('Mesmo CPF não cadastra duas vezes na mesma loja');
await como(U.outro, async () => {
  ok(!!(await falha(`select public.tec_pedir_acesso('${MB}','pf','Outro Nome','${CPF}','11999991111')`)), 'documento repetido na mesma loja é recusado');
});

console.log('Loja libera');
await como(U.novo, async () => ok(!!(await falha(`select public.tec_decidir_cliente('${V_NOVO}','liberar')`)), 'cliente não consegue liberar'));
await como(U.luiz, async () => ok(!!(await falha(`select public.tec_decidir_cliente('${V_NOVO}','liberar')`)), 'outra empresa não libera'));
await como(U.outraloja, async () => {
  ok((await n(`select count(*)::int n from public.tec_loja_clientes`)) === 0, 'outra loja não enxerga cliente de Mark Bel');
  ok(!!(await falha(`select public.tec_decidir_cliente('${V_NOVO}','liberar')`)), 'outra loja não libera cliente da Mark Bel');
});
await como(U.ionaldo, async () => {
  ok((await n(`select count(*)::int n from public.tec_loja_clientes where status='pendente'`)) === 1, 'Ionaldo vê o cadastro pendente');
  ok(!!(await falha(`select public.tec_decidir_cliente('${V_NOVO}','talvez')`)), 'decisão inválida é recusada');
  await db.query(`select public.tec_decidir_cliente('${V_NOVO}','liberar')`);
});
await como(U.novo, async () => {
  ok((await n(`select count(*)::int n from public.tec_catalogo`)) === 2, 'liberado enxerga só os tecidos ativos da loja (1009 e 0109)');
  const refs = (await rows(`select referencia from public.tec_catalogo order by 1`)).map(r => r.referencia);
  console.log('   refs:', refs.join(','));
  ok(refs.includes('1009') && !refs.includes('777'), 'liberado vê só o catálogo da loja que o liberou');
});

console.log('Luiz (já usa o sistema) pede acesso com a empresa dele e é liberado');
let V_LUIZ;
await como(U.luiz, async () => {
  ok(!!(await falha(`select public.tec_pedir_acesso('${MB}','pj','Durant Alfaiataria','${CNPJ}','11988887777','${EMP_NOVO}')`)), 'não pede acesso em nome de empresa dos outros');
  V_LUIZ = (await rows(`select public.tec_pedir_acesso('${MB}','pj','Durant Alfaiataria','${CNPJ}','11988887777','${DUR}') as id`))[0].id;
});
await como(U.vend2, async () => { await db.query(`select public.tec_decidir_cliente('${V_LUIZ}','liberar')`); ok(true, 'usuário (não admin) da loja também libera'); });

console.log('Pedido: preço vem do servidor');
let PED, IT1, IT2;
await como(U.luiz, async () => {
  PED = (await rows(`insert into public.tec_pedidos (empresa_id, loja_empresa_id, texto_original) values ('${DUR}','${MB}','1009/6 1,5m João') returning id`))[0].id;
  ok(!!(await falha(`insert into public.tec_pedidos (empresa_id, loja_empresa_id, status) values ('${DUR}','${MB}','enviado')`)), 'não cria pedido já enviado');
  ok(!!(await falha(`insert into public.tec_pedidos (empresa_id, loja_empresa_id) values ('${DUR}','${OL}')`)), 'não pede a loja que não o liberou');
  IT1 = (await rows(`insert into public.tec_pedido_itens (empresa_id, pedido_id, catalogo_loja_id, referencia, metragem, cliente_final, preco_metro, status) values ('${DUR}','${PED}','${A1009}','1009/6',1.5,'João Paiva',1,'disponivel') returning id`))[0].id;
  const it = (await rows(`select preco_metro, status, descricao from public.tec_pedido_itens where id='${IT1}'`))[0];
  ok(Number(it.preco_metro) === 115, 'preço informado pelo cliente é ignorado: gravou o do catálogo (115)');
  ok(it.status === 'pendente', 'status informado pelo cliente é ignorado (pendente)');
  ok(it.descricao === 'Tricoline prata 80/2', 'descrição vem do catálogo');
  IT2 = (await rows(`insert into public.tec_pedido_itens (empresa_id, pedido_id, catalogo_loja_id, referencia, metragem, cliente_final) values ('${DUR}','${PED}','${A0109}','0109/2',2,'Ricardo Alves') returning id`))[0].id;
  ok(!!(await falha(`insert into public.tec_pedido_itens (empresa_id, pedido_id, catalogo_loja_id, referencia, metragem) values ('${DUR}','${PED}','${AOL}','777',1)`)), 'item de tecido de OUTRA loja é recusado');
  ok(!!(await falha(`insert into public.tec_pedido_itens (empresa_id, pedido_id, catalogo_loja_id, referencia, metragem) values ('${DUR}','${PED}','${INAT}','4157',1)`)), 'tecido inativo é recusado');
  ok(!!(await falha(`insert into public.tec_pedido_itens (empresa_id, pedido_id, catalogo_loja_id, referencia, metragem) values ('${DUR}','${PED}','${A1009}','0109/2',1)`)), 'referência que não é do tecido escolhido é recusada');
  ok(!!(await falha(`insert into public.tec_pedido_itens (empresa_id, pedido_id, referencia, metragem) values ('${DUR}','${PED}','1009/6',1)`)), 'item sem tecido do catálogo é recusado');
  await db.query(`update public.tec_pedido_itens set preco_metro = 1, metragem = 2 where id='${IT1}'`);
  ok(Number((await rows(`select preco_metro from public.tec_pedido_itens where id='${IT1}'`))[0].preco_metro) === 115, 'trocar o preço depois também não cola');
  ok((await n(`select count(*)::int n from public.tec_pedidos`)) === 1, 'Luiz vê só o pedido dele');
});
await como(U.ionaldo, async () => ok((await n(`select count(*)::int n from public.tec_pedidos`)) === 0, 'loja NÃO vê rascunho do cliente'));

console.log('Envio');
await como(U.novo, async () => ok(!!(await falha(`select public.tec_enviar_pedido('${PED}')`)), 'outro cliente não envia pedido alheio'));
await como(U.luiz, async () => {
  await db.query(`select public.tec_enviar_pedido('${PED}')`);
  ok((await rows(`select status from public.tec_pedidos where id='${PED}'`))[0].status === 'enviado', 'pedido vira ENVIADO');
  ok(!!(await falha(`select public.tec_enviar_pedido('${PED}')`)), 'não envia duas vezes');
  await db.query(`update public.tec_pedidos set status='concluido' where id='${PED}'`);
  ok((await rows(`select status from public.tec_pedidos where id='${PED}'`))[0].status === 'enviado', 'cliente não muda o status depois de enviado');
  ok(!!(await falha(`update public.tec_pedido_itens set metragem = 99 where id='${IT1}'`)) || (await n(`select count(*)::int n from public.tec_pedido_itens where id='${IT1}' and metragem=99`)) === 0, 'cliente não altera item depois de enviado');
  ok(!!(await falha(`update public.tec_pedido_itens set status='disponivel' where id='${IT1}'`)) || (await rows(`select status from public.tec_pedido_itens where id='${IT1}'`))[0].status === 'pendente', 'cliente não marca item como disponível');
  ok((await n(`select count(*)::int n from public.tec_pedido_itens where pedido_id='${PED}'`)) === 2, 'cliente continua vendo os itens do pedido');
});
await como(U.novo, async () => ok((await n(`select count(*)::int n from public.tec_pedidos`)) === 0, 'outro cliente não vê o pedido do Luiz'));

console.log('Loja responde');
await como(U.outraloja, async () => ok((await n(`select count(*)::int n from public.tec_pedidos`)) === 0 && (await n(`select count(*)::int n from public.tec_pedido_itens`)) === 0, 'outra loja não enxerga o pedido'));
await como(U.ionaldo, async () => {
  ok((await n(`select count(*)::int n from public.tec_pedidos where id='${PED}'`)) === 1, 'Ionaldo vê o pedido enviado');
  ok((await n(`select count(*)::int n from public.tec_pedido_itens where pedido_id='${PED}'`)) === 2, 'Ionaldo vê os itens');
  ok(!!(await falha(`update public.tec_pedidos set status='concluido' where id='${PED}'`)) || (await rows(`select status from public.tec_pedidos where id='${PED}'`))[0].status === 'enviado', 'loja não edita pedido direto (só por função)');
  await db.query(`select public.tec_confirmar_pedido('${PED}')`);
  ok((await n(`select count(*)::int n from public.tec_pedidos where id='${PED}' and confirmado_em is not null`)) === 1, 'confirmação com o cliente fica registrada');
  ok(!!(await falha(`select public.tec_responder_item('${IT1}','parcial',5)`)), 'parcial maior que o pedido é recusado');
  ok(!!(await falha(`select public.tec_responder_item('${IT1}','parcial',null)`)), 'parcial sem metragem é recusado');
  await db.query(`select public.tec_responder_item('${IT1}','parcial',1.1)`);
  ok((await rows(`select status from public.tec_pedidos where id='${PED}'`))[0].status === 'parcial', 'pedido fica PARCIAL com item pendente');
  await db.query(`select public.tec_responder_item('${IT2}','indisponivel')`);
  const p = (await rows(`select status from public.tec_pedidos where id='${PED}'`))[0].status;
  ok(p === 'concluido', 'todos respondidos: pedido CONCLUÍDO');
  const it = (await rows(`select status, metragem_confirmada m from public.tec_pedido_itens where id='${IT1}'`))[0];
  ok(it.status === 'parcial' && Number(it.m) === 1.1, 'item parcial guarda a metragem confirmada');
  ok(Number((await rows(`select metragem_confirmada m from public.tec_pedido_itens where id='${IT2}'`))[0].m) === 0, 'indisponível confirma zero metro');
});
await como(U.luiz, async () => ok(!!(await falha(`select public.tec_responder_item('${IT1}','disponivel')`)), 'cliente não responde pelo vendedor'));
await como(U.outraloja, async () => ok(!!(await falha(`select public.tec_responder_item('${IT1}','disponivel')`)), 'outra loja não responde'));

console.log('Bloqueio e catálogo');
await como(U.ionaldo, async () => { await db.query(`select public.tec_decidir_cliente('${V_NOVO}','bloquear')`); });
await como(U.novo, async () => ok((await n(`select count(*)::int n from public.tec_catalogo`)) === 0, 'cliente bloqueado deixa de ver o catálogo'));
await como(U.luiz, async () => ok(!!(await falha(`insert into public.tec_catalogo (empresa_id, loja_id, referencia) values ('${DUR}','${LMB}','X')`)), 'cliente não escreve no catálogo da loja'));
await como(U.ionaldo, async () => {
  await db.query(`update public.tec_catalogo set preco_metro = 120 where id='${A1009}'`);
  ok(true, 'loja altera o preço do catálogo');
});
ok(Number((await rows(`select preco_metro from public.tec_pedido_itens where id='${IT1}'`))[0].preco_metro) === 115, 'pedido antigo mantém o preço da data do envio');

console.log('Auditoria');
ok((await n(`select count(*)::int n from public.audit_log where k = 'tec_loja_clientes'`)) >= 3, 'cadastro e liberação ficam no audit_log');

console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTudo certo');
process.exit(falhas.length ? 1 : 0);
