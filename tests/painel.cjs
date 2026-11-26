// Painel de controle: tela com cliente Supabase de mentira (sem rede), confere lista, busca, detalhe, tipo, suspensão e convite.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const raiz = path.join(__dirname, '..'); let falhas = 0; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas++; };
const srv = http.createServer((q, r) => { const f = path.join(raiz, q.url.split('?')[0] === '/' ? 'painel.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html' }); r.end(d); } }); });
const STUB = `window.__chamadas=[];window.supabase={createClient:function(){var L=[{id:'a',nome:'Durant Alfaiataria',cnpj:'12345678000190',cadastro:{tipo:'PJ',razao:'Durant Ltda.',doc:'12.345.678/0001-90'},tipo:'alfaiataria',vende:true,produz:false,fornece:false,so_tecidos:false,ativa:true,criado_em:'2026-03-12T00:00:00Z',usuarios:2},{id:'b',nome:'Mark Bel',cnpj:null,cadastro:{},tipo:'loja',vende:false,produz:false,fornece:true,so_tecidos:false,ativa:true,criado_em:'2026-11-20T00:00:00Z',usuarios:1}];
return{auth:{getSession:async()=>({data:{session:{user:{email:'hd@henriquedurant.com'}}}}),signOut:async()=>({}),signInWithPassword:async()=>({})},
rpc:async function(n,a){window.__chamadas.push([n,a]);if(n==='plataforma_empresas')return{data:L};if(n==='plataforma_usuarios')return{data:[{email:'luiz@x.com',papel:'admin'}]};if(n==='criar_convite_empresa')return{data:'TOKEN123'};if(n==='definir_tipo_empresa'){L.forEach(function(e){if(e.id===a.p_empresa){e.tipo=a.p_tipo;e.produz=a.p_tipo==='fabrica'?true:(a.p_tipo==='atelie'?false:a.p_area_atelies)}});return{}}if(n==='plataforma_definir_ativa'){L.forEach(function(e){if(e.id===a.p_empresa)e.ativa=a.p_ativa});return{}}return{}}}}};`;
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = 'http://localhost:' + srv.address().port + '/';
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 760 } }); const erros = [];
  pg.on('pageerror', e => erros.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.route('**/vendor/supabase.js', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await pg.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await pg.goto(url); await pg.waitForSelector('.it');
  ok((await pg.locator('.it').count()) === 2, 'lista as empresas à esquerda');
  ok(/Durant Ltda/.test(await pg.locator('h2').innerText()) && /Durant Alfaiataria/.test(await pg.locator('.it.sel').innerText()) && (await pg.inputValue('#c-doc')) === '12.345.678/0001-90', 'abre a primeira empresa com o CNPJ no cadastro');
  ok(await pg.locator('.tp.on').innerText().then(t => /Alfaiataria/.test(t)), 'mostra o tipo Alfaiataria (ateliê e fábrica)');
  await pg.fill('#q', 'mark'); ok((await pg.locator('.it').count()) === 1, 'busca por nome filtra a lista');
  await pg.locator('.it').first().click(); await pg.waitForSelector('h2');
  ok(/Mark Bel/.test(await pg.locator('h2').innerText()) && (await pg.locator('.tp[data-tipo]:disabled').count()) === 2, 'empresa de tecidos abre com o tipo travado');
  await pg.fill('#q', ''); await pg.locator('.it').first().click();
  await pg.fill('#c-doc', '11111111111111'); await pg.click('#salvar');
  ok(/CNPJ inválido/.test(await pg.locator('#msg').innerText()), 'CNPJ inválido é barrado antes de enviar');
  await pg.fill('#c-tel', '19988887777'); ok((await pg.inputValue('#c-tel')) === '(19) 98888-7777', 'telefone com máscara');
  await pg.click('.tp[data-tipo="atelie"]'); await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => window.__chamadas.some(c => c[0] === 'definir_tipo_empresa' && c[1].p_tipo === 'atelie')), 'trocar o tipo chama a função da plataforma');
  ok(await pg.locator('#c-doc').evaluate(el => el.parentElement.parentElement.firstElementChild.querySelector('select') !== null) && (await pg.locator('#c-carregar').count()) === 1, 'o documento vem primeiro e há o botão de carregar dados');
  await pg.click('#susp'); await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => window.__chamadas.some(c => c[0] === 'plataforma_definir_ativa' && c[1].p_ativa === false)) && /Suspensa/.test(await pg.locator('#det .no').first().innerText()), 'suspender chama a função e marca a empresa como suspensa');
  await pg.click('#nova'); await pg.fill('#n-nome', 'Ateliê Novo'); await pg.fill('#n-em', 'novo@x.com'); await pg.click('#n-ok'); await pg.waitForSelector('.lnk');
  ok(/\/\?convite=TOKEN123$/.test(await pg.locator('.lnk').innerText()), 'nova empresa gera o link de convite para o sistema');
  ok(erros.length === 0, 'sem erros de JavaScript' + (erros.length ? ': ' + erros[0] : ''));
  await b.close(); srv.close(); console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK'); process.exit(falhas ? 1 : 0);
})();
