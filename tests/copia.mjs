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
for (const f of ['0001_base.sql', '0003_auditoria.sql', '0004_perfil_empresa.sql', '0005_parceiro.sql', '0006_numeracao.sql', '0007_convites.sql', '0008_origem_parceiro.sql']) await db.exec(sql('migrations/' + f));
const OLD = '11111111-1111-1111-1111-111111111111';
const NEW = (await db.query(`select id from public.empresas where nome='Durant Alfaiataria'`)).rows[0].id;
const script = sql('ferramentas/copia_producao_anonimizada.sql');
const tenta = async s => { try { await db.exec(s); return null; } catch (e) { return e.message; } };

console.log('Segurança');
ok(/rode o bloco 1|COLE-AQUI|invalid input syntax/i.test(await tenta(script)), 'com o id de exemplo (não preenchido) o script não roda');
// trava: id informado = Durant deste banco (simula rodar na produção)
const emProducao = script.replaceAll('COLE-AQUI-O-ID-DA-EMPRESA-DE-PRODUCAO', NEW);
const msgProd = await tenta(emProducao.slice(emProducao.indexOf('-- ===== BLOCO 2')));
ok(/PARE/.test(msgProd || ''), 'se o id for o da própria Durant (produção), o script PARA: ' + (msgProd || '').slice(0, 60));

console.log('Cópia');
await db.exec(`insert into public.reg (empresa_id,id,k,i,j) values ('${NEW}','pedidos~P-1','pedidos','P-1','{"id":"P-1","cli":"antigo"}')`);   // dado de teste antigo da homologação
const pre = script.replaceAll('COLE-AQUI-O-ID-DA-EMPRESA-DE-PRODUCAO', OLD);
await db.exec(pre.slice(0, pre.indexOf('-- ===== BLOCO 2')));       // bloco 1: rascunho
const ins = (id, k, i, j) => db.query(`insert into public.reg (empresa_id,id,k,i,j) values ($1,$2,$3,$4,$5)`, [OLD, id, k, i, JSON.stringify(j)]);
await ins('clientes~7', 'clientes', '7', { id: 7, nome: 'Henrique Toledo', cpf: '123.456.789-09', tel: '(19) 99999-0000', nasc: '1980-02-02', email: 'h@x.com', cidade: 'Campinas', historia: 'conta que viaja muito', pagto: 'pix', eventos: [] });
await ins('clientes~8', 'clientes', '8', { id: 8, nome: 'Ana', cpf: '000', tel: '1' });
await ins('pedidos~P-2650', 'pedidos', 'P-2650', { id: 'P-2650', cli: 7, cliNome: 'Henrique Toledo', valor: 4500 });
await ins('sing~lembAv', 'sing', 'lembAv', [{ txt: 'Ligar para Henrique Toledo amanhã' }]);
await ins('sing~cfg', 'sing', 'cfg', { usuarios: [{ id: 1, nome: 'Luiz', email: 'hd@henriquedurant.com', grupo: 'Administrador', hash: 'SEGREDO', salt: 'SAL' }], produtos: [{ id: 1, nome: 'Terno', valor: '4500', custo: '2000' }] });
await ins('bkp~1', 'bkp', '1', { copia: 'tudo, com Henrique Toledo' });
const msg = await tenta(pre.slice(pre.indexOf('-- ===== BLOCO 2')));
ok(msg === null, 'bloco 2 roda sem erro' + (msg ? ': ' + msg : ''));
const q = async (s, p) => (await db.query(s, p)).rows;
const todos = (await q(`select j from public.reg`)).map(r => r.j).join('\n');
ok(!/Henrique Toledo/.test(todos), 'o nome real não aparece em nenhum documento (clientes, pedidos, avisos)');
const c7 = JSON.parse((await q(`select j from public.reg where empresa_id=$1 and id='clientes~7'`, [NEW]))[0].j);
ok(c7.nome === 'Cliente 0007' && c7.cpf === '' && c7.tel === '' && c7.nasc === '' && c7.email === '' && c7.cidade === '' && c7.historia === '', 'cliente: nome vira "Cliente 0007" e CPF, telefone, nascimento, e-mail, cidade e história saem');
ok(c7.pagto === 'pix' && Array.isArray(c7.eventos), 'campos sem dado pessoal ficam (forma de pagamento)');
const p = JSON.parse((await q(`select j from public.reg where empresa_id=$1 and id='pedidos~P-2650'`, [NEW]))[0].j);
ok(p.cliNome === 'Cliente 0007' && p.valor === 4500 && p.cli === 7, 'o pedido mantém valor e vínculo, com o nome trocado');
ok(JSON.parse((await q(`select j from public.reg where empresa_id=$1 and id='sing~lembAv'`, [NEW]))[0].j)[0].txt === 'Ligar para Cliente 0007 amanhã', 'avisos também têm o nome trocado');
const cfg = JSON.parse((await q(`select j from public.reg where empresa_id=$1 and id='sing~cfg'`, [NEW]))[0].j);
ok(!JSON.stringify(cfg).includes('SEGREDO') && !JSON.stringify(cfg).includes('SAL') && cfg.usuarios[0].email === 'hd@henriquedurant.com' && cfg.produtos[0].valor === '4500', 'senhas somem das configurações; preços e usuários continuam');
ok((await q(`select count(*)::int n from public.reg where empresa_id=$1 and k='bkp'`, [NEW]))[0].n === 0, 'cópias de segurança (bkp) não vêm');
ok((await q(`select count(*)::int n from public.reg where empresa_id=$1 and id='pedidos~P-1'`, [NEW]))[0].n === 0, 'dados de teste antigos da homologação foram removidos');
ok((await q(`select count(*)::int n from public.reg where empresa_id=$1`, [OLD]))[0].n === 0 && (await q(`select count(*)::int n from public.empresas where id=$1`, [OLD]))[0].n === 0, 'o rascunho é apagado ao final');
ok((await q(`select count(*)::int n from public.reg where empresa_id=$1 and k='clientes'`, [NEW]))[0].n === 2, 'os 2 clientes foram para a Durant');
const c8 = JSON.parse((await q(`select j from public.reg where empresa_id=$1 and id='clientes~8'`, [NEW]))[0].j);
ok(c8.nome === 'Cliente 0008' && c8.cpf === '', 'nome curto também é embaralhado no cadastro');
if (falhas.length) { console.log('\n' + falhas.length + ' FALHA(S)'); process.exit(1); }
console.log('\nTudo certo.');
