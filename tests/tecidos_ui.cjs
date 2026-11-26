/* Teste da tela /tecidos num navegador real (nada sai do computador; sem banco: a demonstração guarda no navegador).
   Uso: node tests/tecidos_ui.cjs   (usa o Chrome do sistema se existir; senão o do Playwright) */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };

function servidor() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]);
      if (u === '/tecidos' || u === '/tecidos/') u = '/tecidos/index.html';   // como o Vercel faz (cleanUrls)
      const f = path.join(ROOT, u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
    }).listen(0, () => res(s));
  });
}

(async () => {
  const srv = await servidor(); const base = 'http://localhost:' + srv.address().port;
  const exe = fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined;
  const br = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort());   // sem internet: fontes externas não carregam
  const page = await ctx.newPage();
  const erros = []; page.on('pageerror', e => erros.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) erros.push(m.text()); });
  let alertou = false; page.on('dialog', d => { alertou = true; d.dismiss(); });
  await page.addInitScript(() => { window.__abertos = []; window.open = (u) => { window.__abertos.push(String(u)); return null; }; });   // não sai para a internet: só registra o link
  await page.goto(base + '/tecidos');

  console.log('Abertura');
  ok((await page.title()) === 'Alinhavo · Tecidos', 'a página abre em /tecidos (sem barra no fim, como no Vercel)');
  ok(await page.locator('#d-loja option').count() === 3, 'vem com as 3 lojas de exemplo');

  console.log('Interpretar o exemplo');
  await page.click('[data-a="exemplo"]');
  let linhas = await page.locator('#d-itens tbody tr').count();
  ok(linhas === 3, 'o exemplo vira 3 itens (' + linhas + ')');
  const val = (i, f) => page.locator(`#d-itens tbody tr:nth-child(${i}) [data-f="${f}"]`).inputValue();
  ok((await val(1, 'referencia')) === '405/3' && (await val(1, 'metragem')) === '1,8' && (await val(1, 'cliente_final')) === 'João Paiva', 'item 1: 405/3 · 1,8 m · João Paiva');
  ok((await val(2, 'referencia')) === '405/7' && (await val(2, 'metragem')) === '2,4' && (await val(2, 'cliente_final')) === 'Marcos Lima', 'item 2: 405/7 · 2,4 m · Marcos Lima');
  ok((await val(3, 'referencia')) === '512' && (await val(3, 'metragem')) === '3,2' && (await val(3, 'cliente_final')) === 'Ricardo Alves', 'item 3: 512 · 3,2 m · Ricardo Alves');
  const dest = i => page.locator(`#d-itens tbody tr:nth-child(${i}) [data-f="destino_id"] option:checked`).textContent();
  ok((await dest(1)) === 'Ateliê' && (await dest(2)) === 'Maria' && (await dest(3)) === 'WGT', 'destinos certos: "para mim" → Ateliê, "pra Maria" → Maria, "na WGT" → WGT');
  const msg = await page.locator('#d-msg').textContent();
  ok(/Entrega: Ateliê\*/.test(msg) && /Entrega: Maria\*/.test(msg) && /Entrega: WGT\*/.test(msg), 'a mensagem separa os itens por destino');
  ok(/1\) Ref\. 405\/3 \(Azul marinho liso, Azul marinho\) — 1,80 m — Cliente: João Paiva/.test(msg), 'cada linha traz referência, metragem e cliente');
  ok(/Total: 7,40 m em 3 itens\./.test(msg), 'o total da mensagem bate (7,40 m em 3 itens)');
  ok(/nº 1 /.test(msg), 'o pedido já mostra o número que vai receber (nº 1)');

  console.log('Frases do dia a dia (interpretador)');
  const T = (txt, loja) => page.evaluate(([t, l]) => { const e = window.__tec.estado(); return window.__tec.interpretar(t, l || e.lojas[0].id).itens.map(i => ({ r: i.referencia, m: i.metragem, c: i.cliente_final, d: (e.destinos.find(x => x.id === i.destino_id) || {}).nome || '', match: i.match })); }, [txt, loja]);
  let r = await T('fulano, eu quero o tecido 405/3, 1,80m dele, para o meu cliente, que é o João Paiva');
  ok(r.length === 1 && r[0].r === '405/3' && r[0].m === 1.8 && r[0].c === 'João Paiva', 'frase longa e solta (como no zap): tecido, metragem e "que é o João Paiva"');
  r = await T('405/3 1,80m João Paiva enviar pra mim, 405/7 2m Pedro Souza enviar pra Maria');
  ok(r.length === 2 && r[0].d === 'Ateliê' && r[1].d === 'Maria' && r[1].m === 2, 'dois pedidos na mesma linha são separados');
  r = await T('405/3 180cm para o Paulo Lemos');
  ok(r.length === 1 && r[0].m === 1.8, '"180cm" vira 1,80 m');
  r = await T('quero 3 metros do 405/3 pro cliente Ana Maria da Silva, entregar no atelie');
  ok(r.length === 1 && r[0].m === 3 && r[0].c === 'Ana Maria da Silva' && r[0].d === 'Ateliê', 'nome composto com "da" e destino sem acento');
  r = await T('azul marinho da ls 2,5m para o Bruno Reis');
  ok(r.length === 1 && r[0].r === '405/3' && r[0].m === 2.5, 'o apelido ("azul marinho da ls") acha o tecido certo');
  r = await T('9999 2m para o Paulo Lemos');
  ok(r.length === 1 && r[0].match === 'desconhecido', 'referência que não está no catálogo é sinalizada, não inventada');
  r = await T('210/1 2m para o Paulo Lemos');
  ok(r.length === 1 && r[0].match === 'outra_loja', 'referência que existe em outra loja é sinalizada (Imperiale)');
  r = await T('405/3 2m\npara o Paulo Lemos\nenviar na WGT');
  ok(r.length === 1 && r[0].c === 'Paulo Lemos' && r[0].d === 'WGT', 'o pedido escrito em linhas separadas é juntado');
  r = await T('405/3 2m\n405/7 1,5m\ntudo para a Maria');
  ok(r.length === 2 && r[0].d === 'Maria' && r[1].d === 'Maria', '"tudo para a Maria" vale para todos os itens');
  r = await T('bom dia, tudo bem?');
  ok(r.length === 0, 'conversa sem tecido não gera item');

  console.log('Segurança');
  await page.click('[data-a="limpar"]');
  await page.fill('#d-texto', '405/3 2m para o <img src=x onerror=alert(1)> Fulano');
  await page.click('[data-a="interpretar"]');
  await page.fill('#d-itens tbody tr:nth-child(1) [data-f="cliente_final"]', '<img src=x onerror=alert(1)>');
  await page.waitForTimeout(200);
  ok(!alertou && (await page.locator('#app img').count()) === 0, 'texto com HTML não vira HTML nem executa script');

  console.log('Validação antes de enviar');
  await page.click('[data-a="limpar"]');
  await page.fill('#d-texto', '405/3 para o João Paiva');
  await page.click('[data-a="interpretar"]');
  ok((await page.locator('#d-itens .chip.crit').count()) === 1, 'item sem metragem aparece em vermelho');
  await page.click('[data-a="enviar"]');
  ok((await page.locator('#d-itens tr.err').count()) === 1 && (await page.locator('[data-a="enviar"]').count()) === 1, 'não envia sem metragem e destaca a linha');
  await page.fill('#d-itens tbody tr:nth-child(1) [data-f="metragem"]', '1,5');
  ok(/1,50 m/.test(await page.locator('#d-msg').textContent()), 'ao digitar a metragem a mensagem atualiza na hora');

  console.log('Enviar pelo WhatsApp');
  await page.click('[data-a="limpar"]');
  await page.click('[data-a="exemplo"]');
  await page.click('[data-a="enviar"]');
  const u = (await page.evaluate(() => window.__abertos))[0] || '';
  ok(/^https:\/\/wa\.me\/\?text=/.test(u), 'abre o WhatsApp com a mensagem pronta (sem número cadastrado, o WhatsApp pede o contato)');
  ok(decodeURIComponent(u).includes('Pedido de tecido nº 1') && decodeURIComponent(u).includes('Total: 7,40 m'), 'o texto do link é a mensagem completa');
  ok(/Pedido nº 1/.test(await page.locator('#app').textContent()) && /Enviado/.test(await page.locator('#app').textContent()), 'vai para a lista de Pedidos como nº 1, Enviado');
  ok((await page.locator('.kpi b').first().textContent()) === '1', 'o resumo do dia conta 1 pedido');

  console.log('Resposta do vendedor');
  await page.click('[data-a="resposta"]');
  await page.fill('#r-txt', '1 ok\n2 sem estoque\n3 só 1,20 m');
  const prev = await page.locator('#r-prev').textContent();
  ok(/Item 1/.test(prev) && /Item 2/.test(prev) && /Item 3/.test(prev) && /1,20 m/.test(prev), 'mostra o que vai aplicar antes de aplicar');
  await page.click('#r-ok');
  const st = i => page.locator(`tr[data-it]:nth-child(${i}) select option:checked`).textContent();
  ok((await st(1)) === 'Disponível' && (await st(2)) === 'Sem estoque' && (await st(3)) === 'Parcial', 'item 1 disponível, 2 sem estoque, 3 parcial');
  ok(/Confirmado: 1,20 m/.test(await page.locator('#app').textContent()), 'guarda a metragem confirmada do item parcial');
  ok(/Respondido/.test(await page.locator('.ped-h .chip').first().textContent()), 'pedido passa a "Respondido" quando todos os itens têm resposta');
  ok((await page.locator('.kpi b').nth(3).textContent()) === '3/3', 'KPI de itens respondidos: 3/3');

  console.log('Resposta com frase solta');
  const rr = await page.evaluate(() => { const it = [{ referencia: '405/3' }, { referencia: '405/7' }, { referencia: '512' }]; return [window.__tec.interpretarResposta('tudo ok', it).length, window.__tec.interpretarResposta('2 não tem\n405/3 beleza', it).map(x => x.i + ':' + x.st).join(','), window.__tec.interpretarResposta('sem problema, separo amanhã', it).length]; });
  ok(rr[0] === 3, '"tudo ok" marca todos os itens');
  ok(rr[1] === '1:indisponivel,0:disponivel', '"2 não tem" e "405/3 beleza" (pelo nome do tecido)');
  ok(rr[2] === 0, '"sem problema" não é confundido com "sem estoque"');

  console.log('Catálogo, lojas e persistência');
  await page.click('[data-a="aba"][data-v="catalogo"]');
  await page.click('[data-a="tec-novo"]');
  await page.fill('#dlg [name="referencia"]', '777/1'); await page.fill('#dlg [name="nome"]', 'Teste'); await page.fill('#dlg [name="preco_metro"]', '1.234,50'); await page.fill('#dlg [name="apelidos"]', 'o teste, tecido teste');
  await page.click('#dlg button[type="submit"]');
  ok(/777\/1/.test(await page.locator('#app').textContent()) && /1\.234,50/.test(await page.locator('#app').textContent()), 'cadastra um tecido (preço 1.234,50 lido certo)');
  await page.click('[data-a="tec-novo"]'); await page.fill('#dlg [name="referencia"]', ' 777/1 ');
  await page.click('#dlg button[type="submit"]');
  ok(/Já existe essa referência/.test(await page.locator('#f-err').textContent()), 'não deixa repetir a referência na mesma loja');
  await page.click('[data-a="dlg-fechar"]');
  await page.click('[data-a="aba"][data-v="lojas"]');
  await page.click('[data-a="loja-nova"]'); await page.fill('#dlg [name="nome"]', ' ls tecidos ');
  await page.click('#dlg button[type="submit"]');
  ok(/Já existe uma loja/.test(await page.locator('#f-err').textContent()), 'não deixa repetir o nome da loja (ignora caixa e espaço)');
  await page.click('[data-a="dlg-fechar"]');
  await page.reload();
  await page.click('[data-a="aba"][data-v="pedidos"]');
  ok(/Pedido nº 1/.test(await page.locator('#app').textContent()), 'depois de recarregar a página o pedido continua lá');
  await page.click('[data-a="aba"][data-v="catalogo"]');
  ok(/777\/1/.test(await page.locator('#app').textContent()), 'e o tecido novo também');

  console.log('Celular');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.click('[data-a="aba"][data-v="pedido"]');
  const larg = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(larg <= 392, 'sem rolagem lateral na tela (largura ' + larg + ' px em tela de 390)');

  ok(erros.length === 0, 'nenhum erro no console' + (erros.length ? ': ' + erros.join(' | ') : ''));
  await br.close(); srv.close();
  if (falhas.length) { console.log('\n' + falhas.length + ' falha(s)'); process.exit(1); }
  console.log('\nTudo certo.');
})().catch(e => { console.error(e); process.exit(1); });
