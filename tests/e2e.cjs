/* Teste ponta a ponta com um Supabase simulado em memória (nada sai do computador).
   Uso: NODE_PATH=/opt/npm-tools/node_modules node tests/e2e.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const SUPA = 'https://azkvclwozhneyougtcbn.supabase.co'; // localhost usa o banco de homologação (config.js escolhe pelo endereço)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const falhas = []; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FALHA ') + m); if (!c) falhas.push(m); };

function servidor() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      let f = path.join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0]));
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
    }).listen(0, () => res(s));
  });
}
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (email) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: 'u1', email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

function novoBanco(cfg) {
  const st = { reg: new Map(), pedidos: [], cfg, emailLogado: null };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  const json = (route, status, body, extra = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  st.handler = async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (p === '/auth/v1/token') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.password !== 'senhaCerta123') return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      st.emailLogado = b.email; st.logins = (st.logins || 0) + 1;
      const exp = Math.floor(Date.now() / 1000) + 3600;
      return json(route, 200, { access_token: jwt(b.email), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r1',
        user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: b.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    }
    if (p === '/auth/v1/logout') return json(route, 204, {});
    if (p === '/rest/v1/membros') {
      const email = st.emailLogado || (st.cfg.emailPadrao);
      if (st.cfg.semMembro) return json(route, 200, []);
      return json(route, 200, st.cfg.membros || [{ empresa_id: 'E1', papel: 'admin' }]);
    }
    if (p === '/rest/v1/empresas') return json(route, 200, st.cfg.empresas || [{ id: 'E1', nome: 'Durant Alfaiataria', vende_cliente_final: true, produz: false }]);
    if (p === '/rest/v1/rpc/convite_info') {
      const b = JSON.parse(req.postData() || '{}'), c = (st.convites || {})[b.p_token];
      return json(route, 200, c && c.status === 'pendente' ? [{ valido: true, email_mascarado: 'ma***@ex.com', empresa_nome: c.empresa_nome, papel: c.papel }] : [{ valido: false, email_mascarado: null, empresa_nome: null, papel: null }]);
    }
    if (p === '/auth/v1/signup') {
      const b = JSON.parse(req.postData() || '{}'), c = Object.values(st.convites || {}).find(x => x.email === b.email && x.status === 'pendente');
      if (!c) return json(route, 500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user: Cadastro somente com convite.' });
      st.emailLogado = b.email; const exp = Math.floor(Date.now() / 1000) + 3600;
      return json(route, 200, { access_token: jwt(b.email), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r1',
        user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: b.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    }
    if (p === '/rest/v1/rpc/aceitar_convite') {
      const b = JSON.parse(req.postData() || '{}'), c = (st.convites || {})[b.p_token]; st.aceites = (st.aceites || 0) + 1;
      if (!c || c.status !== 'pendente') return json(route, 400, { code: 'P0001', message: 'convite inválido ou expirado' });
      if (c.email !== st.emailLogado) return json(route, 400, { code: 'P0001', message: 'este convite é para outro e-mail' });
      c.status = 'aceito'; st.cfg.membros = (st.cfg.membros || []).concat([{ empresa_id: c.empresa_id, papel: c.papel }]);
      return json(route, 200, c.empresa_id);
    }
    if (p === '/rest/v1/rpc/reservar_numeros') {   // mesma regra da migration 0006
      const b = JSON.parse(req.postData() || '{}'); st.contadores = st.contadores || {}; st.rpcs = (st.rpcs || 0) + 1;
      const ch = b.p_empresa + '|' + b.p_nome, linhas = [...st.reg.values()].filter(r => r.empresa_id === b.p_empresa);
      const num = t => +(String(t).replace(/\D/g, '')) || 0;
      let piso = 0;
      if (b.p_nome === 'pedido') {
        const cf = linhas.find(r => r.id === 'sing~cfg'); piso = Math.max(2600, cf ? (JSON.parse(cf.j).ultimoPed || 0) : 0);
        if (st.contadores[ch] == null) linhas.filter(r => r.k === 'pedidos' || r.k === 'orcamentos').forEach(r => { const v = num(String(r.i).slice(2)); if (r.k === 'orcamentos' || v < 100000) piso = Math.max(piso, v); });
      } else if (st.contadores[ch] == null) linhas.filter(r => r.k === 'clientes').forEach(r => { piso = Math.max(piso, num(r.i)); });
      st.contadores[ch] = Math.max(st.contadores[ch] || 0, piso) + b.p_qtd;
      return json(route, 200, st.contadores[ch] - b.p_qtd + 1);
    }
    if (p === '/rest/v1/reg') {
      const q = u.searchParams, eq = k => (q.get(k) || '').replace(/^eq\./, '');
      if (!req.headers()['authorization'] || !/Bearer .+\..+\..+/.test(req.headers()['authorization'])) return json(route, 401, { message: 'sem sessão' });
      if (m === 'GET') {
        let rows = [...st.reg.values()].filter(r => r.empresa_id === eq('empresa_id'));
        if (q.get('id')) rows = rows.filter(r => r.id === eq('id'));
        if (q.get('k')) rows = rows.filter(r => r.k === eq('k'));
        rows.sort((a, b) => a.id.localeCompare(b.id));
        const off = +(q.get('offset') || 0), lim = q.get('limit') ? +q.get('limit') : rows.length;
        return json(route, 200, rows.slice(off, off + lim).map(({ k, i, n, j }) => ({ k, i, n, j })));
      }
      if (m === 'POST') {
        const body = JSON.parse(req.postData()); (Array.isArray(body) ? body : [body]).forEach(r => { st.writes = (st.writes || 0) + 1; st.reg.set(r.empresa_id + '|' + r.id, r); });
        return route.fulfill({ status: 201, headers: cors, body: '' });
      }
      if (m === 'DELETE') { st.reg.delete(eq('empresa_id') + '|' + eq('id')); return route.fulfill({ status: 204, headers: cors, body: '' }); }
    }
    return json(route, 404, { message: 'rota não simulada ' + p });
  };
  return st;
}

(async () => {
  const srv = await servidor(); const base = `http://localhost:${srv.address().port}/`;
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });

  async function abre(banco, ctx, qs) {
    ctx = ctx || await br.newContext();
    const pg = await ctx.newPage(); const erros = [];
    pg.on('pageerror', e => erros.push(String(e))); pg.on('dialog', d => d.dismiss());
    await pg.route(SUPA + '/**', banco.handler);
    await pg.goto(base + (qs || '')); return { pg, ctx, erros };
  }
  const loginUi = async (pg, email, senha) => { await pg.fill('#g-u', email); await pg.fill('#g-p', senha); await pg.click('#g-f button[type=submit]'); };

  console.log('1) login recusa senha errada e aceita a certa');
  const banco = novoBanco({});
  let { pg, ctx, erros } = await abre(banco);
  await pg.waitForSelector('#g-u');
  ok(await pg.isVisible('#g-u'), 'tela de login aparece primeiro (nada de dados antes do login)');
  ok(banco.reg.size === 0, 'nenhum dado lido/gravado antes de entrar');
  await loginUi(pg, 'hd@henriquedurant.com', 'errada');
  await pg.waitForSelector('#g-e:not([hidden])');
  ok((await pg.textContent('#g-e')).includes('incorretos'), 'senha errada mostra "E-mail ou senha incorretos."');
  await loginUi(pg, 'hd@henriquedurant.com', 'senhaCerta123');
  await pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  ok(await pg.isHidden('#gate'), 'entrou no sistema (tela de entrada some)');
  ok((await pg.textContent('#userchip')).includes('Luiz'), 'usuário do sistema mapeado pelo e-mail (Luiz)');
  await pg.waitForFunction(() => P.state === 'ok', null, { timeout: 15000 });
  const chaves = [...banco.reg.keys()];
  ok(chaves.some(k => k.endsWith('|sys~meta')), 'primeira carga grava o marcador sys~meta');
  ok(chaves.every(k => k.startsWith('E1|')), 'todo registro gravado leva o empresa_id da empresa');

  console.log('2) gravar, recarregar e ler de volta');
  await pg.evaluate(() => { S.clientes.push({ id: 9001, nome: 'Cliente Teste Adaptador' }); persistSoon(); });
  await pg.waitForFunction(() => P.state === 'ok' && P.last.has('clientes~9001'), null, { timeout: 15000 });
  ok([...banco.reg.values()].some(r => r.id === 'clientes~9001' && r.j.includes('Cliente Teste Adaptador')), 'cliente novo foi gravado no banco');
  await pg.reload(); await pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  ok(await pg.evaluate(() => S.clientes.some(c => c.id === 9001)), 'depois de recarregar, a sessão continua e o cliente volta do banco');

  console.log('3) apagar');
  await pg.evaluate(() => { S.clientes = S.clientes.filter(c => c.id !== 9001); persistSoon(); });
  await pg.waitForFunction(() => P.state === 'ok' && !P.last.has('clientes~9001'), null, { timeout: 15000 });
  ok(![...banco.reg.values()].some(r => r.id === 'clientes~9001'), 'cliente apagado some do banco');

  console.log('4) sair volta para o login');
  await pg.evaluate(() => sair()); await pg.waitForSelector('#g-u', { timeout: 15000 });
  ok(true, 'depois de sair, pede login de novo');
  ok(erros.length === 0, 'sem erros de JavaScript na página (' + erros.join(' | ') + ')');
  await ctx.close();

  console.log('5) conta sem empresa liberada');
  const b2 = novoBanco({ semMembro: true });
  ({ pg, ctx, erros } = await abre(b2));
  await pg.waitForSelector('#g-u'); await loginUi(pg, 'alguem@exemplo.com', 'senhaCerta123');
  await pg.waitForFunction(() => document.body.innerText.includes('Acesso não liberado'), null, { timeout: 15000 });
  ok(b2.reg.size === 0, 'sem empresa liberada: nada é lido nem gravado');
  await ctx.close();

  console.log('6) e-mail que entrou mas não é usuário do sistema');
  const b3 = novoBanco({});
  ({ pg, ctx, erros } = await abre(b3));
  await pg.waitForSelector('#g-u'); await loginUi(pg, 'outro@exemplo.com', 'senhaCerta123');
  await pg.waitForFunction(() => document.body.innerText.includes('Usuário não cadastrado'), null, { timeout: 15000 });
  ok(true, 'e-mail fora da lista de usuários do sistema é barrado');
  await ctx.close();

  console.log('7) duas empresas: escolher, lembrar, trocar e manter os dados separados');
  const b4 = novoBanco({
    membros: [{ empresa_id: 'E1', papel: 'admin' }, { empresa_id: 'E2', papel: 'parceiro' }],
    empresas: [{ id: 'E1', nome: 'Durant Alfaiataria', vende_cliente_final: true, produz: true }, { id: 'E2', nome: 'Ateliê da Maria', vende_cliente_final: false, produz: true }]
  });
  ({ pg, ctx, erros } = await abre(b4));
  await pg.waitForSelector('#g-u'); await loginUi(pg, 'hd@henriquedurant.com', 'senhaCerta123');
  await pg.waitForSelector('[data-emp]', { timeout: 15000 });
  const nomes = await pg.$$eval('[data-emp]', bs => bs.map(b => b.textContent));
  ok(nomes.length === 2 && nomes[0].includes('Durant Alfaiataria') && nomes[1].includes('Ateliê da Maria'), 'com 2 empresas, aparece a tela "Escolha a empresa" listando as duas');
  ok(nomes[1].includes('parceiro') && nomes[0].includes('administrador'), 'cada empresa mostra o papel da pessoa nela');
  ok(b4.reg.size === 0, 'nada é lido nem gravado antes de escolher a empresa');
  await pg.click('[data-emp="1"]');
  await pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  await pg.waitForFunction(() => P.state === 'ok', null, { timeout: 15000 });
  ok(await pg.evaluate(() => window.SB.empresa === 'E2' && window.SB.empresaNome === 'Ateliê da Maria' && window.SB.papel === 'parceiro' && window.SB.perfil.produz === true && window.SB.perfil.vende === false), 'entrou na empresa escolhida, com papel e perfil de negócio corretos');
  ok([...b4.reg.keys()].length > 0 && [...b4.reg.keys()].every(k => k.startsWith('E2|')), 'tudo que foi gravado leva o empresa_id da empresa escolhida (E2)');
  await pg.evaluate(() => { S.clientes.push({ id: 9002, nome: 'Cliente da Maria' }); persistSoon(); });
  await pg.waitForFunction(() => P.state === 'ok' && P.last.has('clientes~9002'), null, { timeout: 15000 });
  await pg.reload(); await pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  ok(await pg.evaluate(() => window.SB.empresa === 'E2' && S.clientes.some(c => c.id === 9002)), 'depois de recarregar, lembra a empresa escolhida (sem perguntar de novo)');
  await pg.click('#userchip');
  await pg.waitForSelector('#ac-troca', { timeout: 5000 });
  ok((await pg.textContent('.modal, #modal-root')).includes('Ateliê da Maria'), '"Sua conta" mostra a empresa atual e o botão de trocar');
  await pg.click('#ac-troca'); await pg.waitForSelector('[data-emp]', { timeout: 15000 });
  await pg.click('[data-emp="0"]');
  await pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  await pg.waitForFunction(() => P.state === 'ok', null, { timeout: 15000 });
  ok(await pg.evaluate(() => window.SB.empresa === 'E1' && window.SB.papel === 'admin'), 'depois de trocar, está na Durant como administrador');
  ok(await pg.evaluate(() => !S.clientes.some(c => c.id === 9002)), 'os dados da Maria NÃO aparecem na Durant (isolamento)');
  ok(erros.length === 0, 'sem erros de JavaScript na página (' + erros.join(' | ') + ')');
  await ctx.close();

  console.log('8) numeração: cada pessoa recebe um bloco do servidor, sem repetir número');
  const b5 = novoBanco({});
  const entra = async () => { const r = await abre(b5); await r.pg.waitForSelector('#g-u'); await loginUi(r.pg, 'hd@henriquedurant.com', 'senhaCerta123'); await r.pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 }); await r.pg.waitForFunction(() => P.state === 'ok', null, { timeout: 15000 }); return r; };
  const A = await entra();
  ok(await A.pg.evaluate(() => NUM.ativo() && NUM.sobra('pedido') === 5 && NUM.sobra('cliente') === 5), 'ao entrar, o sistema já reserva um bloco de pedidos e um de clientes no servidor');
  const nA = await A.pg.evaluate(() => [NUM.tomar('pedido'), NUM.tomar('pedido'), NUM.tomar('pedido')]);
  ok(nA.join() === '2601,2602,2603', 'primeiros pedidos saem em sequência a partir da numeração da empresa: ' + nA.join());
  await A.pg.waitForFunction(() => NUM.sobra('pedido') >= 5, null, { timeout: 15000 });
  const B = await entra();   // outra pessoa/dispositivo, mesmo banco
  const nB = await B.pg.evaluate(() => [NUM.tomar('pedido'), NUM.tomar('pedido')]);
  ok(nB[0] >= 2606 && !nB.some(n => nA.includes(n)), 'a outra pessoa recebe um bloco depois do primeiro, sem repetir número: ' + nB.join());
  const cA = await A.pg.evaluate(() => [novoIdCliente(), novoIdCliente()]), cB = await B.pg.evaluate(() => [novoIdCliente(), novoIdCliente()]);
  ok(new Set([...cA, ...cB]).size === 4, 'ids de cliente também não se repetem entre as duas pessoas: ' + [...cA, ...cB].join());
  await A.pg.reload(); await A.pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  ok(await A.pg.evaluate(() => NUM.tomar('pedido')) === 2604, 'depois de recarregar, a pessoa continua do número que sobrou no bloco dela (sem pular)');
  const livre = await A.pg.evaluate(() => { const a = NUM.ler('cliente')[0].a; S.clientes.push({ id: a, nome: 'Já existe' }); return [a, novoIdCliente()]; });
  ok(livre[1] !== livre[0], 'se o número reservado já estiver em uso no cadastro, o app pula para o próximo (nunca sobrescreve um cliente)');
  ok(b5.rpcs >= 5 && b5.rpcs < 12, 'poucas chamadas ao servidor (' + b5.rpcs + ')');
  ok(A.erros.length === 0 && B.erros.length === 0, 'sem erros de JavaScript na página (' + A.erros.concat(B.erros).join(' | ') + ')');
  await A.ctx.close(); await B.ctx.close();

  console.log('9) convite: o link leva à tela de aceite, cria a conta e entra na empresa certa');
  const b9 = novoBanco({ membros: [], empresas: [{ id: 'E7', nome: 'Ateliê da Maria', vende_cliente_final: true, produz: true }] });
  b9.convites = { TOK1: { email: 'maria@ex.com', papel: 'usuario', empresa_id: 'E7', empresa_nome: 'Ateliê da Maria', status: 'pendente' } };
  const r9 = await abre(b9, null, '?convite=TOK1');
  await r9.pg.waitForSelector('#g-p2', { timeout: 15000 });
  ok((await r9.pg.textContent('body')).includes('Ateliê da Maria') && (await r9.pg.textContent('body')).includes('ma***@ex.com'), 'a tela mostra a empresa e o e-mail mascarado');
  ok(!r9.pg.url().includes('convite='), 'o código sai do endereço do navegador');
  await r9.pg.fill('#g-u', 'outra@ex.com'); await r9.pg.fill('#g-p', 'senhaNova123'); await r9.pg.fill('#g-p2', 'senhaNova123'); await r9.pg.click('#g-f button[type=submit]');
  await r9.pg.waitForSelector('#g-e:not([hidden])', { timeout: 5000 });
  ok((await r9.pg.textContent('#g-e')).includes('não é o do convite'), 'e-mail diferente do convite é recusado com mensagem clara');
  await r9.pg.fill('#g-u', 'maria@ex.com'); await r9.pg.fill('#g-p2', 'diferente123'); await r9.pg.click('#g-f button[type=submit]');
  ok((await r9.pg.textContent('#g-e')).includes('não são iguais'), 'senhas diferentes são recusadas');
  await r9.pg.fill('#g-p2', 'senhaNova123'); await r9.pg.click('#g-f button[type=submit]');
  await r9.pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  ok(await r9.pg.evaluate(() => window.SB.empresa === 'E7' && window.SB.papel === 'usuario'), 'depois de criar a conta, a pessoa já está na empresa do convite com o papel certo');
  ok(b9.convites.TOK1.status === 'aceito', 'o convite foi marcado como usado');
  await r9.pg.reload(); await r9.pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  ok(b9.aceites === 1, 'recarregar não tenta aceitar de novo');
  ok(r9.erros.length === 0, 'sem erros de JavaScript na página (' + r9.erros.join(' | ') + ')');
  await r9.ctx.close();
  const r9b = await abre(b9, null, '?convite=TOK1');
  await r9b.pg.waitForSelector('#g-ok', { timeout: 15000 });
  ok((await r9b.pg.textContent('body')).includes('Convite inválido'), 'convite já usado mostra "Convite inválido"');
  await r9b.pg.click('#g-ok'); await r9b.pg.waitForSelector('#g-u');
  ok(true, 'e leva para a tela de entrada normal');
  await r9b.ctx.close();
  console.log('10) convite para quem já tem conta: entra e o convite é aceito');
  const b10 = novoBanco({ membros: [{ empresa_id: 'E1', papel: 'admin' }], empresas: [{ id: 'E1', nome: 'Durant Alfaiataria', vende_cliente_final: true, produz: false }, { id: 'E7', nome: 'Ateliê da Maria', vende_cliente_final: true, produz: true }] });
  b10.convites = { TOK2: { email: 'hd@henriquedurant.com', papel: 'parceiro', empresa_id: 'E7', empresa_nome: 'Ateliê da Maria', status: 'pendente' } };
  const r10 = await abre(b10, null, '?convite=TOK2'); await r10.pg.waitForSelector('#g-ja', { timeout: 15000 });
  await r10.pg.click('#g-ja'); await r10.pg.waitForSelector('#g-u');
  await loginUi(r10.pg, 'hd@henriquedurant.com', 'senhaCerta123');
  await r10.pg.waitForSelector('[data-emp], #userchip:not([hidden])', { timeout: 15000 });
  ok(await r10.pg.evaluate(() => (window.SB.empresa === 'E7' && window.SB.papel === 'parceiro')), 'quem já tinha conta entra direto na empresa nova (a que aceitou agora), como parceiro');
  ok(b10.convites.TOK2.status === 'aceito', 'convite marcado como usado');
  await r10.ctx.close();

  await br.close(); srv.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTUDO OK');
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(2); });
