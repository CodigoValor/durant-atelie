import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };
const sql = f => fs.readFileSync(new URL('../supabase/' + f, import.meta.url), 'utf8');
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
`);
for (const f of ['0001_base.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql', '0005_parceiro.sql', '0006_numeracao.sql', '0007_convites.sql']) await db.exec(sql('migrations/' + f));
const q = async (s, p) => (await db.query(s, p)).rows;
const O = (await q(`select id from public.empresas where nome='Durant Alfaiataria'`))[0].id;
await db.exec(`insert into public.empresas (id,nome) values ('22222222-2222-2222-2222-222222222222','HDA Produção')`);
const D = '22222222-2222-2222-2222-222222222222';
const ins = (e, id, k, i, j) => db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,$2,$3,$4,$5)`, [e, id, k, i, JSON.stringify(j)]);
await ins(O, 'clientes~1', 'clientes', '1', { nome: 'Cliente 0001' });
await ins(O, 'sing~cfg', 'sing', 'cfg', { usuarios: [{ id: 1, nome: 'Luiz' }], produtos: [{ id: 1, nome: 'Terno', valor: '4500' }] });
await ins(O, 'sing~cat', 'sing', 'cat', { tecidos: [{ id: 1 }] });
await ins(O, 'bkp~1', 'bkp', '1', { x: 1 });
await ins(D, 'pedidos~velho', 'pedidos', 'velho', { id: 'velho' });
await ins(D, 'sing~cfg', 'sing', 'cfg', { usuarios: [{ id: 9, nome: 'Henrique', email: 'durant.henrique@gmail.com' }] });
const run = sql('ferramentas/copiar_empresa_para_empresa.sql');
let m = null; try { await db.exec(run.replace("v_destino text := 'HDA Produção'", "v_destino text := 'Durant Alfaiataria'")); } catch (e) { m = e.message; }
ok(/PARE/.test(m || ''), 'origem = destino: o script PARA');
m = null; try { await db.exec(run); } catch (e) { m = e.message; }
ok(m === null, 'roda sem erro' + (m ? ': ' + m : ''));
ok((await q(`select count(*)::int n from public.reg where empresa_id=$1 and id='pedidos~velho'`, [D]))[0].n === 0, 'dados de teste antigos do destino saem');
ok((await q(`select count(*)::int n from public.reg where empresa_id=$1 and id='clientes~1'`, [D]))[0].n === 1, 'clientes copiados');
ok((await q(`select count(*)::int n from public.reg where empresa_id=$1 and k='bkp'`, [D]))[0].n === 0, 'bkp não vem');
const cfg = JSON.parse((await q(`select j from public.reg where empresa_id=$1 and id='sing~cfg'`, [D]))[0].j);
ok(cfg.produtos[0].valor === '4500' && cfg.usuarios.length === 1 && cfg.usuarios[0].email === 'durant.henrique@gmail.com', 'produtos copiados e usuários do destino preservados');
ok((await q(`select count(*)::int n from public.reg where empresa_id=$1`, [O]))[0].n === 5, 'a origem não muda (4 + catálogo público gerado pelo banco)');
const cat = (await q(`select j from public.reg where empresa_id=$1 and id='pub~catalogo'`, [D]));
ok(cat.length === 1, 'catálogo público do destino foi refeito pelo banco');
if (falhas.length) { console.log('\n' + falhas.length + ' FALHA(S)'); process.exit(1); }
console.log('\nTudo certo.');
