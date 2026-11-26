/* Teste do histórico de medidas: versão automática, motivo, voltar versão, aviso da outra parte.
   Uso: NODE_PATH=/opt/npm-tools/node_modules node tests/medidas.cjs */
const { launchBrowser, localContext } = require('../tools/browser-test.cjs');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };
(async () => {
  const srv = await new Promise(res => { const s = http.createServer((q, r) => { const f = path.join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(fs.readFileSync(f)); }).listen(0, () => res(s)); });
  const br = await launchBrowser();
  const base = 'http://localhost:' + srv.address().port;
  const pg = await (await localContext(br, base)).newPage(); const erros = []; pg.on('pageerror', e => erros.push(String(e)));
  await pg.goto(`http://localhost:${srv.address().port}/`); await pg.waitForTimeout(800);
  
  const r = await pg.evaluate(() => {
    const cid = 9001, M = mc(cid), out = {};
    const k = Object.keys(FLD)[0];
    M.corpo[k] = 40; const s0 = { corpo: {}, peca: {}, rev: 0 };
    medAplicar(cid, s0, 'Nova medição', ''); out.primeira = { v: M.vCorpo || 1, h: M.hist.length, vers: (M.versCorpo || []).length };
    const s1 = { corpo: { ...M.corpo }, peca: JSON.parse(JSON.stringify(M.peca)), rev: M.rev };
    M.corpo[k] = 42; const d = medDiff(s1, M); out.diff = d.length + ':' + d[0].de + '>' + d[0].para;
    medAplicar(cid, s1, 'Ajuste após prova', 'ombro'); out.seg = { v: M.vCorpo, h: M.hist.length, rev: M.rev, ult: M.hist[M.hist.length - 1].motivo, vers: M.versCorpo.length, guard: M.versCorpo[M.versCorpo.length - 1].corpo[k] };
    const antes = M.vCorpo; const e = medVoltar(cid, 'corpo', M.versCorpo[M.versCorpo.length - 1].v);
    out.volta = { e, v: M.vCorpo, valor: M.corpo[k], antes, h: M.hist.length, mot: M.hist[M.hist.length - 1].motivo };
    out.semMudar = medDiff({ corpo: { ...M.corpo }, peca: JSON.parse(JSON.stringify(M.peca)) }, M).length;
    /* pedido guarda cópia e versão; medidas novas do cliente não trocam sozinhas */
    const p = { id: 'T-1', cli: cid, status: 'producao', pecas: [] }; p.medUsadas = medFoto(cid);
    out.ped0 = { v: p.medUsadas.vCorpo, aviso: !!medNovaVersao(p), val: medBase(p).corpo[k] };
    const s2 = { corpo: { ...M.corpo }, peca: JSON.parse(JSON.stringify(M.peca)), rev: M.rev };
    M.corpo[k] = 45; medAplicar(cid, s2, 'Correção de medida', '');
    out.ped1 = { aviso: !!medNovaVersao(p), val: medBase(p).corpo[k], atual: M.corpo[k] };
    p.medUsadas = medFoto(cid); out.ped2 = { aviso: !!medNovaVersao(p), val: medBase(p).corpo[k] };
    /* prova que pediu ajuste liga com a nova versão das medidas */
    const pe = { id: 'T-2', cli: cid, status: 'producao', pecas: [{ uid: 77, provas: [{ d: '2026-11-20', resultado: 'ajuste', ajustes: [{ pt: 'Ombro', cm: -1 }] }] }], log: [] };
    S.pedidos.push(pe); ui.provaRef = { ped: 'T-2', uid: 77, idx: 0, cli: cid };
    const s3 = { corpo: { ...M.corpo }, peca: JSON.parse(JSON.stringify(M.peca)), rev: M.rev };
    M.corpo[k] = 44; medAplicar(cid, s3, 'Ajuste após prova', '');
    const mv = pe.pecas[0].provas[0].medAjuste; out.prova = { v: mv && mv.vCorpo, igual: mv && mv.vCorpo === M.vCorpo, ref: ui.provaRef, log: pe.log.length };
    return out;
  });
  console.log(JSON.stringify(r));
  ok(r.primeira.vers === 0 && r.primeira.h === 1, 'primeira medição entra no histórico sem criar versão antiga vazia');
  ok(r.diff === '1:40>42', 'diferença mostra de 40 para 42');
  ok(r.seg.v === 2 && r.seg.vers === 1 && r.seg.guard === 40 && r.seg.rev === 2 && r.seg.ult === 'Ajuste após prova', 'alteração guarda a versão anterior (40), cria versão nova e soma revisão');
  ok(!r.volta.e && r.volta.v === r.volta.antes + 1 && r.volta.valor === 40 && /Voltou/.test(r.volta.mot), 'voltar a uma versão restaura 40 criando versão nova (nada apagado)');
  ok(r.semMudar === 0, 'sem mudança, sem diferença');
  ok(r.ped0.val === 40 && !r.ped0.aviso, 'pedido nasce com cópia das medidas e sem aviso');
  ok(r.ped1.aviso && r.ped1.val === 40 && r.ped1.atual === 45, 'cliente ganha medida nova: pedido avisa mas continua com a antiga (40)');
  ok(!r.ped2.aviso && r.ped2.val === 45, 'ao escolher "usar as atuais" o pedido passa a 45 e o aviso some');
  ok(r.prova.igual && r.prova.ref === null && r.prova.log === 1, 'prova com ajuste guarda a versão nova das medidas, quem fez, e entra no histórico do pedido');
  ok(erros.length === 0, 'sem erros de JavaScript ' + erros.join('|'));
  await br.close(); srv.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTUDO OK'); process.exit(falhas.length ? 1 : 0);
})();
