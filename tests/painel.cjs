// Painel de controle: tela com cliente Supabase de mentira (sem rede), confere lista, busca, detalhe, tipo, suspensão e convite.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const raiz = path.join(__dirname, '..'); let falhas = 0; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas++; };
const srv = http.createServer((q, r) => { const f = path.join(raiz, q.url.split('?')[0] === '/' ? 'painel.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html' }); r.end(d); } }); });
const STUB = `window.__chamadas=[];window.supabase={createClient:function(){var L=[{id:'a',nome:'Durant Alfaiataria',cnpj:'12345678000190',cadastro:{tipo:'PJ',razao:'Durant Ltda.',doc:'12.345.678/0001-90'},tipo:'alfaiataria',vende:true,produz:false,fornece:false,so_tecidos:false,ativa:true,criado_em:'2026-03-12T00:00:00Z',usuarios:2},{id:'b',nome:'Mark Bel',cnpj:null,cadastro:{},tipo:'loja',vende:false,produz:false,fornece:true,so_tecidos:false,ativa:true,criado_em:'2026-11-20T00:00:00Z',usuarios:1}];
var F=window.__f||(window.__f={nivel:'aal2',tem:true,ok:'123456',adm:true,ap:[]});return{auth:{getSession:async()=>({data:{session:{user:{email:'hd@henriquedurant.com'}}}}),signOut:async()=>({}),signInWithPassword:async()=>({}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:F.nivel,nextLevel:'aal2'}}),listFactors:async()=>({data:{totp:F.tem?[{id:'f1',status:'verified'}]:[],all:F.tem?[{id:'f1',status:'verified'}]:[{id:'velho',status:'unverified'}]}}),unenroll:async(x)=>{F.ap.push(['unenroll',x.factorId]);return{}},enroll:async()=>({data:{id:'novo',totp:{qr_code:'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>',secret:'ABCDEF234567'}}}),challenge:async()=>({data:{id:'ch1'}}),verify:async(x)=>{F.ap.push(['verify',x.factorId,x.code]);if(x.code===F.ok){F.nivel='aal2';return{}}return{error:{message:'invalid'}}}}},
rpc:async function(n,a){window.__chamadas.push([n,a]);if(n==='plataforma_admin_cadastrado')return{data:F.adm};if(n==='plataforma_admins_listar')return{data:[{user_id:'u1',email:'hd@henriquedurant.com',eu:true},{user_id:'u2',email:'emergencia@x.com',eu:false}]};if(n==='plataforma_admin_adicionar'||n==='plataforma_admin_remover')return{data:null};if(n==='plataforma_empresas')return{data:L};if(n==='plataforma_usuarios')return{data:[{email:'luiz@x.com',papel:'admin'}]};if(n==='criar_convite_empresa')return{data:'TOKEN123'};if(n==='definir_tipo_empresa'){L.forEach(function(e){if(e.id===a.p_empresa){e.tipo=a.p_tipo;e.produz=a.p_tipo==='fabrica'?true:(a.p_tipo==='atelie'?false:a.p_area_atelies)}});return{}}if(n==='plataforma_definir_ativa'){L.forEach(function(e){if(e.id===a.p_empresa)e.ativa=a.p_ativa});return{}}return{}}}}};`;
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
  ok(/Mark Bel/.test(await pg.locator('h2').innerText()) && (await pg.locator('.tp[data-tipo]:disabled').count()) === 0 && (await pg.locator('.tp.on[data-tipo="loja"]').count()) === 1, 'loja de tecido abre com o tipo Loja de tecido marcado');
  await pg.fill('#q', ''); await pg.locator('.it').first().click();
  await pg.fill('#c-doc', '11111111111111'); await pg.click('#salvar');
  ok(/CNPJ inválido/.test(await pg.locator('#msg').innerText()), 'CNPJ inválido é barrado antes de enviar');
  await pg.fill('#c-tel', '19988887777'); ok((await pg.inputValue('#c-tel')) === '(19) 98888-7777', 'telefone com máscara');
  await pg.click('.tp[data-tipo="atelie"]'); await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => window.__chamadas.some(c => c[0] === 'definir_tipo_empresa' && c[1].p_tipo === 'atelie')), 'trocar o tipo chama a função da plataforma');
  ok(await pg.locator('#c-doc').evaluate(el => el.parentElement.parentElement.firstElementChild.querySelector('select') !== null) && (await pg.locator('#c-carregar').count()) === 1, 'o documento vem primeiro e há o botão de carregar dados');
  await pg.click('#susp'); await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => window.__chamadas.some(c => c[0] === 'plataforma_definir_ativa' && c[1].p_ativa === false)) && /Suspensa/.test(await pg.locator('#det .no').first().innerText()), 'suspender chama a função e marca a empresa como suspensa');
  await pg.click('#nova'); await pg.fill('#n-nome', 'Ateliê Novo'); await pg.fill('#n-em', 'novo@x.com'); await pg.click('#n-ok'); await pg.waitForTimeout(100);
  ok(/tipo/i.test(await pg.locator('#n-msg').innerText()) && !(await pg.evaluate(() => window.__chamadas.some(c => c[0] === 'criar_convite_empresa'))), 'nova empresa sem tipo é barrada antes de enviar');
  await pg.selectOption('#n-tipo', 'loja'); await pg.click('#n-ok'); await pg.waitForSelector('.lnk');
  ok(await pg.evaluate(() => window.__chamadas.some(c => c[0] === 'criar_convite_empresa' && c[1].p_tipo === 'loja' && c[1].p_vende === false)), 'o convite de empresa leva o tipo escolhido');
  ok(/\/\?convite=TOKEN123$/.test(await pg.locator('.lnk').innerText()), 'nova empresa gera o link de convite para o sistema');
  // --- segundo fator ---
  const nova = async (f) => { const p = await b.newPage({ viewport: { width: 1280, height: 760 } }); const e = []; p.on('pageerror', x => e.push(x.message));
    await p.addInitScript(f => { window.__f = Object.assign({ nivel: 'aal1', tem: true, ok: '123456', adm: true, ap: [] }, f); }, f);
    await p.route('**/vendor/supabase.js', r => r.fulfill({ contentType: 'text/javascript', body: STUB })); await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '' })); await p.goto(url); return [p, e]; };
  { const [p] = await nova({ nivel: 'aal1', tem: true }); await p.waitForSelector('#cd');
    ok(/duas etapas/i.test(await p.locator('.sub').first().innerText()) && (await p.locator('.it').count()) === 0, 'com senha só (aal1) e autenticador já ativo: pede o código e não abre o painel');
    await p.fill('#cd', '000000'); await p.click('#go'); await p.waitForTimeout(100);
    ok(/incorreto/.test(await p.locator('#msg').innerText()) && (await p.locator('.it').count()) === 0, 'código errado é recusado');
    await p.fill('#cd', '123456'); await p.click('#go'); await p.waitForSelector('.it');
    ok(await p.evaluate(() => window.__f.ap.some(a => a[0] === 'verify' && a[1] === 'f1' && a[2] === '123456')), 'código certo abre o painel');
    await p.click('#adms'); await p.waitForSelector('#ad-l .us');
    ok((await p.locator('#ad-l .us').count()) === 2 && (await p.locator('[data-rm]').count()) === 1, 'janela de administradores lista os dois e só permite remover o outro'); await p.close(); }
  { const [p] = await nova({ nivel: 'aal1', tem: false }); await p.waitForSelector('#qr');
    ok((await p.locator('#seg').innerText()) === 'ABCDEF234567' && await p.evaluate(() => window.__f.ap.some(a => a[0] === 'unenroll' && a[1] === 'velho')), 'primeira vez: mostra QR e chave, e descarta cadastro pela metade');
    await p.fill('#cd', '123456'); await p.click('#go'); await p.waitForSelector('.it'); ok(true, 'ativa o autenticador e entra no painel'); await p.close(); }
  { const [p] = await nova({ nivel: 'aal1', tem: false, adm: false }); await p.waitForSelector('.login');
    ok(/Sem acesso/.test(await p.locator('#msg').innerText()) && (await p.locator('#qr').count()) === 0, 'quem não é administrador não vê nem a tela de ativação: "Sem acesso"'); await p.close(); }
  ok(erros.length === 0, 'sem erros de JavaScript' + (erros.length ? ': ' + erros[0] : ''));
  await b.close(); srv.close(); console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK'); process.exit(falhas ? 1 : 0);
})();
