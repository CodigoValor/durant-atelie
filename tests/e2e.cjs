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
    if (p === '/rest/v1/rpc/listar_membros') return json(route, 200, st.cfg.pessoas || [{ user_id: 'u1', email: st.emailLogado || 'hd@henriquedurant.com', papel: 'admin', desde: '2026-01-01' }]);
    if (p === '/rest/v1/rpc/listar_convites') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.p_empresa == null && !st.cfg.plataforma) return json(route, 403, { code: '42501', message: 'sem permissão' });
      return json(route, 200, Object.entries(st.convites || {}).filter(([, c]) => (b.p_empresa == null) === (c.empresa_id == null)).map(([t, c], i) => ({ id: 'cv' + t, email: c.email, papel: c.papel, empresa_nome: c.empresa_nome, status: c.status, estado: c.status === 'pendente' ? 'valido' : c.status === 'aceito' ? 'usado' : 'cancelado', expira_em: '2030-01-01T00:00:00Z', criado_em: '2026-01-01T00:00:00Z' })));
    }
    if (p === '/rest/v1/rpc/criar_convite' || p === '/rest/v1/rpc/criar_convite_empresa') {
      const b = JSON.parse(req.postData() || '{}'); st.convites = st.convites || {}; const t = 'NOVO' + Object.keys(st.convites).length;
      st.convites[t] = { email: b.p_email, papel: b.p_papel || 'admin', empresa_id: p.endsWith('_empresa') ? null : b.p_empresa, empresa_nome: b.p_empresa_nome || null, nome_parceiro: b.p_nome_parceiro || null, status: 'pendente' };
      return json(route, 200, t);
    }
    if (p === '/rest/v1/rpc/listar_origens') return json(route, 200, st.cfg.origens || []);
    if (p === '/rest/v1/rpc/andamento_parceiro') return json(route, 200, st.cfg.andamento || []);
    if (p === '/rest/v1/rpc/definir_nome_parceiro') { st.nomesParceiro = (st.nomesParceiro || []).concat([JSON.parse(req.postData() || '{}')]); return json(route, 204, null); }
    if (p === '/rest/v1/rpc/remover_membro') { st.removidos = (st.removidos || []).concat([JSON.parse(req.postData() || '{}').p_user]); return json(route, 204, null); }
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
        if (st.cfg.parceiroVe) rows = rows.filter(r => ['clientes', 'med', 'pedidos', 'orcamentos', 'pub'].includes(r.k));   /* mesma regra da RLS do parceiro (0005) */
        if (q.get('id')) rows = rows.filter(r => r.id === eq('id'));
        if (q.get('k')) rows = rows.filter(r => r.k === eq('k'));
        rows.sort((a, b) => a.id.localeCompare(b.id));
        const off = +(q.get('offset') || 0), lim = q.get('limit') ? +q.get('limit') : rows.length;
        return json(route, 200, rows.slice(off, off + lim).map(({ k, i, n, j }) => ({ k, i, n, j })));
      }
      if (m === 'POST') {
        const body = JSON.parse(req.postData());
        if (st.cfg.parceiroVe && (Array.isArray(body) ? body : [body]).some(r => !['clientes', 'med', 'pedidos', 'orcamentos'].includes(r.k))) { st.negados = (st.negados || 0) + 1; return json(route, 403, { code: '42501', message: 'new row violates row-level security policy' }); }
        (Array.isArray(body) ? body : [body]).forEach(r => { st.writes = (st.writes || 0) + 1; st.reg.set(r.empresa_id + '|' + r.id, r); });
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
  const b3 = novoBanco({ membros: [{ empresa_id: 'E1', papel: 'usuario' }] });
  ({ pg, ctx, erros } = await abre(b3));
  await pg.waitForSelector('#g-u'); await loginUi(pg, 'outro@exemplo.com', 'senhaCerta123');
  await pg.waitForFunction(() => document.body.innerText.includes('Usuário não cadastrado'), null, { timeout: 15000 });
  ok(true, 'e-mail fora da lista de usuários do sistema é barrado');
  await ctx.close();

  console.log('6b) administrador do servidor nunca fica trancado para fora (lista de usuários sem o e-mail dele)');
  const b3b = novoBanco({});
  ({ pg, ctx, erros } = await abre(b3b));
  await pg.waitForSelector('#g-u'); await loginUi(pg, 'durant.henrique@gmail.com', 'senhaCerta123');
  await pg.waitForFunction(() => !document.getElementById('gate') || document.getElementById('gate').style.display === 'none' || !document.body.innerText.includes('Usuário não cadastrado'), null, { timeout: 15000 });
  ok(!(await pg.evaluate(() => document.body.innerText.includes('Usuário não cadastrado'))), 'administrador do servidor entra mesmo sem estar na lista de usuários do app');
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
  ok(nomes[1].includes('ateliê') && nomes[0].includes('administrador'), 'cada empresa mostra o papel da pessoa nela');
  ok(b4.reg.size === 0, 'nada é lido nem gravado antes de escolher a empresa');
  await pg.click('[data-emp="1"]');
  await pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  await pg.waitForFunction(() => P.state === 'ok', null, { timeout: 15000 });
  ok(await pg.evaluate(() => window.SB.empresa === 'E2' && window.SB.empresaNome === 'Ateliê da Maria' && window.SB.papel === 'parceiro' && window.SB.perfil.produz === true && window.SB.perfil.vende === false), 'entrou na empresa escolhida, com papel e perfil de negócio corretos');
  ok([...b4.reg.keys()].every(k => k.startsWith('E2|')), 'tudo que foi gravado leva o empresa_id da empresa escolhida (E2); parceiro não grava configuração ao entrar');
  await pg.evaluate(() => { S.clientes.push({ id: 9002, nome: 'Cliente da Maria' }); persistSoon(); });
  await pg.waitForFunction(() => P.state === 'ok' && P.last.has('clientes~9002'), null, { timeout: 15000 });
  ok(b4.reg.has('E2|clientes~9002') && [...b4.reg.keys()].every(k => k.startsWith('E2|')), 'o cliente do parceiro foi gravado com o empresa_id da Maria (E2)');
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

  console.log('11) painel Acessos e convites (administrador)');
  const b11 = novoBanco({ plataforma: true, pessoas: [{ user_id: 'u1', email: 'hd@henriquedurant.com', papel: 'admin', desde: '2026-01-01' }, { user_id: 'u2', email: 'maria@ex.com', papel: 'usuario', desde: '2026-01-02' }] });
  const r11 = await abre(b11); await r11.pg.waitForSelector('#g-u'); await loginUi(r11.pg, 'hd@henriquedurant.com', 'senhaCerta123');
  await r11.pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  await r11.pg.evaluate(() => { ui.cfg = 'acessos'; location.hash = 'config'; });
  await r11.pg.waitForSelector('#ac-conv', { timeout: 15000 });
  ok((await r11.pg.textContent('#ac-box')).includes('maria@ex.com'), 'lista as pessoas com acesso');
  ok(await r11.pg.evaluate(() => document.getElementById('ac-np-l').hidden), 'o campo "empresa do parceiro" fica escondido para admin e usuário');
  await r11.pg.fill('#ac-em', 'ana@ex.com'); await r11.pg.selectOption('#ac-pp', 'parceiro');
  ok(await r11.pg.evaluate(() => !document.getElementById('ac-np-l').hidden), 'ao escolher parceiro, o campo aparece');
  await r11.pg.click('#ac-conv button[type=submit]'); await r11.pg.waitForTimeout(300);
  ok(/nome do ateliê/i.test(await r11.pg.textContent('#ac-er')) && !b11.convites, 'convite de parceiro sem o nome da empresa é barrado antes de enviar');
  await r11.pg.fill('#ac-np', 'Durant Alfaiataria'); await r11.pg.click('#ac-conv button[type=submit]');
  await r11.pg.waitForSelector('#ac-link', { timeout: 5000 });
  const lk = await r11.pg.inputValue('#ac-link');
  ok(/\?convite=NOVO0$/.test(lk) && b11.convites.NOVO0.papel === 'parceiro' && b11.convites.NOVO0.email === 'ana@ex.com' && b11.convites.NOVO0.nome_parceiro === 'Durant Alfaiataria', 'gera o convite de parceiro e mostra o link: ' + lk);
  ok((await r11.pg.textContent('#ac-box')).includes('ana@ex.com'), 'o convite aparece na lista de enviados');
  ok(await r11.pg.$('#ac-emp') !== null, 'quem é administrador da plataforma vê o formulário de empresa nova');
  await r11.pg.fill('#ae-em', 'dono@novo.com'); await r11.pg.fill('#ae-nm', 'Ateliê Novo'); await r11.pg.check('#ae-p'); await r11.pg.click('#ac-emp button[type=submit]');
  await r11.pg.waitForFunction(() => /convite=NOVO1/.test(document.getElementById('ac-link')?.value || ''), null, { timeout: 5000 });
  ok(b11.convites.NOVO1.empresa_id === null && b11.convites.NOVO1.empresa_nome === 'Ateliê Novo', 'gera o convite de empresa nova');
  await r11.pg.click('[data-mrm="u2"]'); await r11.pg.waitForSelector('#mform');
  await r11.pg.click('#mform button[type=submit]');
  await r11.pg.waitForFunction(() => !document.querySelector('[data-mrm="u2"]') || true, null, { timeout: 2000 });
  await r11.pg.waitForTimeout(500);
  ok((b11.removidos || []).includes('u2'), 'remover pede confirmação e remove o acesso');
  ok(r11.erros.length === 0, 'sem erros de JavaScript na página (' + r11.erros.join(' | ') + ')');
  await r11.ctx.close();
  const b12 = novoBanco({ membros: [{ empresa_id: 'E1', papel: 'usuario' }] });
  const r12 = await abre(b12); await r12.pg.waitForSelector('#g-u'); await loginUi(r12.pg, 'hd@henriquedurant.com', 'senhaCerta123');
  await r12.pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  ok(await r12.pg.evaluate(() => !CFGMENU.flatMap(g => g.i).some(i => i[0] === 'acessos')), 'quem não é administrador não vê o painel de acessos');
  await r12.ctx.close();

  console.log('13) parceiro: entra sem ler o que não pode, vê só o que é dele e só grava o permitido');
  const b13 = novoBanco({ andamento: [{ id: 'pedidos~P-26187', st: 'aceito', em: '2026-11-26T10:00:00Z', motivo: null }, { id: 'pedidos~P-26197', st: 'recusado', em: '2026-11-26T11:00:00Z', motivo: 'falta dados' }], parceiroVe: true, membros: [{ empresa_id: 'E7', papel: 'parceiro' }], empresas: [{ id: 'E7', nome: 'Ateliê da Maria', vende_cliente_final: true, produz: true }] });
  b13.reg.set('E7|pub~catalogo', { empresa_id: 'E7', id: 'pub~catalogo', k: 'pub', i: 'catalogo', j: JSON.stringify({ produtos: [{ id: 1, tipo: 'Terno', nome: 'Lã fria', valor: '4500', categoria: 'Alfaiataria', ativo: true }] }) });
  b13.reg.set('E7|clientes~5', { empresa_id: 'E7', id: 'clientes~5', k: 'clientes', i: '5', j: JSON.stringify({ id: 5, nome: 'Cliente do Luiz' }) });
  [['P-26187', true], ['P-26197', false]].forEach(([id, fin]) => b13.reg.set('E7|pedidos~' + id, { empresa_id: 'E7', id: 'pedidos~' + id, k: 'pedidos', i: id, j: JSON.stringify({ id, cli: 5, status: 'producao', item: 'Camisa', valor: 1500, dped: '2026-11-26', aprov: '2026-11-26', finOk: fin, pecas: [] }) }));
  b13.reg.set('E7|sys~meta', { empresa_id: 'E7', id: 'sys~meta', k: 'sys', i: 'meta', j: '{"v":1}' });
  const r13 = await abre(b13); await r13.pg.waitForSelector('#g-u'); await loginUi(r13.pg, 'hd@henriquedurant.com', 'senhaCerta123');
  await r13.pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  ok(await r13.pg.evaluate(() => PARC() && S.clientes.length === 1 && S.clientes[0].nome === 'Cliente do Luiz'), 'o parceiro entra e carrega só os clientes dele');
  ok(await r13.pg.evaluate(() => S.cfg.produtos.length === 1 && S.cfg.produtos[0].nome === 'Lã fria'), 'recebe o catálogo público (produtos e preços) da empresa');
  ok(await r13.pg.evaluate(() => P.user.grupo === 'Atendimento e vendas' && P.user.email === 'hd@henriquedurant.com'), 'parceiro NÃO herda o grupo Administrador do usuário de exemplo (grupo: ' + await r13.pg.evaluate(() => P.user.grupo) + ')');
  ok(await r13.pg.evaluate(() => JSON.stringify(prestAtivos('Alfaiataria')) === JSON.stringify([['hda', 'Ateliê da Maria']]) && prestAtivos('Camisaria').length === 1), 'em "Quem vai produzir" o parceiro vê a própria empresa dona coma fábricaa');
  await r13.pg.evaluate(() => { location.hash = 'pedidos'; }); await r13.pg.waitForTimeout(400);
  ok(await r13.pg.evaluate(() => S.pedidos.length === 2 && ['P-26187', 'P-26197'].every(i => document.querySelector('main').textContent.includes(i))), 'parceiro vê na lista os dois pedidos, inclusive o que ainda aguarda aprovação do pedido (finOk=false)');
  let t13 = await r13.pg.textContent('main');
  ok(t13.includes('Aceito') && t13.includes('Recusado pela fábrica') && !t13.includes('Tecido a pedir') && !t13.includes('0/15'), 'parceiro vê "Aceito" e "Recusado pela fábrica" na lista, sem o andamento interno (0/15)');
  await r13.pg.evaluate(() => { ui.det = 'P-26197'; render(); }); await r13.pg.waitForTimeout(300);
  t13 = await r13.pg.textContent('main');
  ok(t13.includes('Resposta da fábrica') && t13.includes('falta dados'), 'no detalhe o parceiro vê a resposta da fábrica e o motivo da recusa');
  const lkp = await r13.pg.evaluate(() => { const rec = S.pedidos.find(p => p.id === 'P-26197'), ac = S.pedidos.find(p => p.id === 'P-26187'); const antes = travado(ac); const st0 = ac.st; ac.st = 1; const depois = travado(ac); ac.st = st0; return { rec: travado(rec), antes, depois }; });
  ok(lkp.rec && !lkp.antes && lkp.depois, 'parceiro: recusado fica travado; aceito ainda pode ser editado até a fábrica entrar em produção; em produção trava');
  await r13.pg.evaluate(() => { ui.det = null; location.hash = 'painel'; render(); }); await r13.pg.waitForTimeout(300);
  ok(!(await r13.pg.textContent('main')).includes('Felipe'), 'painel do parceiro não traz lembretes de exemplo da empresa');
  await r13.pg.evaluate(() => { location.hash = 'pedidos'; ui.det = null; ui.draft = newDraft(5); render(); }); await r13.pg.waitForTimeout(300);
  ok(await r13.pg.evaluate(() => !document.getElementById('dest-card')), 'sem peças ainda, o quadro de destino não aparece');
  await r13.pg.click('[data-add="camisa"]'); await r13.pg.waitForTimeout(300);
  ok(await r13.pg.evaluate(() => document.getElementById('dest-card').compareDocumentPosition(document.querySelector('#ped .pcard')) & Node.DOCUMENT_POSITION_PRECEDING), 'o quadro de destino fica depois das peças')
  ok(await r13.pg.evaluate(() => !!document.getElementById('dest-card')), 'ao lançar pedido o parceiro vê "Para onde vai a peça pronta?"');
  await r13.pg.click('[data-destr="tipo|cliente"]'); await r13.pg.waitForTimeout(200);
  ok(await r13.pg.evaluate(() => !!document.querySelector('[data-dest="rua"]') && !!document.querySelector('[data-dest="tel"]')), 'escolher "direto ao cliente" pede o endereço e o telefone');
  await r13.pg.click('[data-destr="tipo|retirada"]'); await r13.pg.waitForTimeout(200); await r13.pg.click('[data-destr="quem|motoboy"]'); await r13.pg.waitForTimeout(200);
  ok(await r13.pg.evaluate(() => !!document.querySelector('[data-dest="quemNome"]') && !document.querySelector('[data-dest="rua"]')), 'retirada por motoboy pede o nome/empresa e some o endereço');
  ok(await r13.pg.evaluate(() => destErro(ui.draft.dest).includes('motoboy') && destErro({ tipo: 'parceiro' }) === '' && destErro({}).includes('Escolha') && destErro({ tipo: 'cliente', nome: 'A', tel: '11999990000', rua: 'R', num: '1', bairro: 'B', cidade: 'C' }) === '' && destErro({ tipo: 'cliente', nome: 'A' }).includes('telefone')), 'validação do destino: exige o que falta em cada escolha');
  await r13.pg.evaluate(() => { ui.draft.dest = destVazio(); document.getElementById('d-save').click(); }); await r13.pg.waitForTimeout(300);
  ok((await r13.pg.textContent('#toast, .toast, body')).includes('Escolha para onde a peça pronta'), 'não deixa salvar o pedido do parceiro sem escolher o destino');
  await r13.pg.evaluate(() => { ui.draft = null; render(); });
  const itens = await r13.pg.$$eval('#nav a', a => a.map(x => x.dataset.v));
  ok(itens.join() === 'painel,clientes,pedidos', 'menu do parceiro: só Painel, Clientes e Pedidos (' + itens.join() + ')');
  await r13.pg.evaluate(() => { location.hash = 'financeiro'; }); await r13.pg.waitForTimeout(300);
  ok(await r13.pg.evaluate(() => current() === 'painel'), 'tentar abrir uma tela proibida volta ao painel');
  await r13.pg.evaluate(() => { S.clientes.push({ id: 9100, nome: 'Novo do parceiro' }); S.cfg.nome_teste = 'x'; persistSoon(); });
  await r13.pg.waitForFunction(() => P.state === 'ok' && P.last.has('clientes~9100'), null, { timeout: 15000 });
  ok(b13.reg.has('E7|clientes~9100') && !b13.negados, 'grava o cliente novo e NÃO tenta gravar configurações (nada negado pelo servidor)');
  ok(![...b13.reg.keys()].some(k => k.includes('sing~') || k === 'E7|sys~meta' && b13.reg.get(k).j !== '{"v":1}'), 'nenhuma configuração nem marcador foi escrito pelo parceiro');
  ok(r13.erros.length === 0, 'sem erros de JavaScript na página (' + r13.erros.join(' | ') + ')');
  await r13.pg.evaluate(() => {
    window.SB.client.auth.refreshSession = async () => ({ data: { session: null } });
    const o = P.col.doc.bind(P.col); P.col.doc = id => { const d = o(id); d.set = async () => { throw Object.assign(new Error('permission denied for table reg'), { code: '42501' }); }; return d; };
    S.clientes.push({ id: 9200, nome: 'Cliente sessão' }); persistSoon();
  });
  await r13.pg.waitForSelector('#mdl', { timeout: 15000 });
  ok((await r13.pg.textContent('#mdl')).includes('Sua sessão expirou') && (await r13.pg.textContent('body')).includes('Sessão expirada'), 'sessão vencida: o sistema avisa em português (não mostra o código 42501) e diz que o que foi digitado não foi salvo');
  await r13.ctx.close();

  console.log('15) dono vê a origem: pedido de parceiro leva a etiqueta com o nome da empresa dele');
  const b15 = novoBanco({ membros: [{ empresa_id: 'E7', papel: 'admin' }], empresas: [{ id: 'E7', nome: 'HDA Produção', vende_cliente_final: false, produz: true }],
    origens: [{ id: 'pedidos~P-26188', nome: 'Durant Alfaiataria' }, { id: 'clientes~5', nome: 'Durant Alfaiataria' }] });
  const ped = { id: 'P-26188', cli: 5, status: 'aprovado', item: 'Camisa', valor: 1500, dped: '2026-11-26', aprov: '2026-11-26', pecas: [], dest: { tipo: 'cliente', nome: 'Maria Souza', tel: '(11) 98888-7777', rua: 'Rua das Flores', num: '10', bairro: 'Centro', cidade: 'Campinas' } };
  b15.reg.set('E7|clientes~5', { empresa_id: 'E7', id: 'clientes~5', k: 'clientes', i: '5', j: JSON.stringify({ id: 5, nome: 'Cliente 0005', cpf: '123.456.789-09', tel: '(19) 99999-0000', nasc: '1980-05-05', cidade: 'Campinas' }) });
  b15.reg.set('E7|pedidos~P-26188', { empresa_id: 'E7', id: 'pedidos~P-26188', k: 'pedidos', i: 'P-26188', j: JSON.stringify(ped) });
  b15.reg.set('E7|pedidos~P-1', { empresa_id: 'E7', id: 'pedidos~P-1', k: 'pedidos', i: 'P-1', j: JSON.stringify({ ...ped, id: 'P-1' }) });
  b15.reg.set('E7|sys~meta', { empresa_id: 'E7', id: 'sys~meta', k: 'sys', i: 'meta', j: '{"v":1}' });
  const r15 = await abre(b15); await r15.pg.waitForSelector('#g-u'); await loginUi(r15.pg, 'durant.henrique@gmail.com', 'senhaCerta123');
  await r15.pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  await r15.pg.waitForFunction(() => Object.keys(ORIGEM).length === 2, null, { timeout: 8000 });
  ok(await r15.pg.evaluate(() => origemDe('P-26188') === 'Durant Alfaiataria' && origemDe('P-1') === ''), 'a origem vem do servidor só para o pedido do parceiro');
  await r15.pg.evaluate(() => { location.hash = 'pedidos'; }); await r15.pg.waitForTimeout(400);
  const lin = await r15.pg.$$eval('[data-open]', els => els.map(e => e.textContent.replace(/\s+/g, ' ')));
  ok(!lin.some(t => t.includes('P-26188')) && lin.some(t => t.includes('P-1') && !t.includes('Durant Alfaiataria')), 'pedido de parceiro ainda não aceito NÃO aparece nos pedidos normais nem entra na produção');
  ok(await r15.pg.evaluate(() => !S.pedidos.some(p => p.id === 'P-26188') === false && !prodLinhas().some(l => JSON.stringify(l).includes('P-26188'))), 'e não entra nas linhas de produção');
  ok(await r15.pg.evaluate(() => !!document.querySelector('[data-v="prodparc"]')), 'menu do dono tem "Pedidos de produção"');
  await r15.pg.evaluate(() => { location.hash = 'prodparc'; }); await r15.pg.waitForTimeout(400);
  let tx = await r15.pg.textContent('main'); ok(tx.includes('P-26188') && tx.includes('Durant Alfaiataria') && tx.includes('Recebido') && !tx.includes('P-1 '), 'tela nova lista só o pedido do parceiro, com etiqueta e estado "Recebido"');
  ok(await r15.pg.evaluate(() => document.querySelector('[data-v="prodparc"] .nbadge')?.textContent === '1'), 'menu do dono mostra o número de pedidos recebidos (1)');
  await r15.pg.evaluate(() => { ui.det = 'P-26188'; location.hash = 'pedidos'; render(); }); await r15.pg.waitForTimeout(300);
  let t15 = await r15.pg.textContent('main');
  ok(t15.includes('Destino da peça pronta') && t15.includes('Maria Souza') && t15.includes('Rua das Flores'), 'dono vê o destino da peça (envio direto ao cliente) com o endereço informado pelo parceiro');
  await r15.pg.evaluate(() => { ui.det = null; location.hash = 'clientes'; ui.cli = 5; ui.tab = 'cadastro'; render(); }); await r15.pg.waitForTimeout(300);
  t15 = await r15.pg.textContent('main');
  ok(t15.includes('Cliente 0005') && !t15.includes('123.456.789-09') && !t15.includes('99999-0000') && !t15.includes('1980') && !t15.includes('Campinas') && t15.includes('ficam só com o ateliê'), 'dono vê só o nome do cliente do parceiro: CPF, telefone, nascimento e cidade ficam ocultos');
  ok(await r15.pg.evaluate(() => !document.getElementById('c-editar')), 'dono não edita o cadastro do cliente do parceiro');
  await r15.pg.evaluate(() => { location.hash = 'prodparc'; render(); }); await r15.pg.waitForTimeout(300);
  await r15.pg.click('button[data-ac="recusar"]'); await r15.pg.fill('#rc-m', 'Sem tecido'); await r15.pg.click('#mform button[type=submit]'); await r15.pg.waitForTimeout(300);
  tx = await r15.pg.textContent('main'); ok(tx.includes('Recusado') && tx.includes('Sem tecido'), 'recusar grava o motivo e mostra "Recusado"');
  await r15.pg.click('button[data-ac="reabrir"]'); await r15.pg.waitForTimeout(200);
  await r15.pg.click('button[data-ac="aceitar"]'); await r15.pg.waitForTimeout(300);
  ok((await r15.pg.textContent('main')).includes('Aceito'), 'aceitar muda para "Aceito"');
  await r15.pg.evaluate(() => { location.hash = 'pedidos'; }); await r15.pg.waitForTimeout(400);
  const lin2 = await r15.pg.$$eval('[data-open]', els => els.map(e => e.textContent.replace(/\s+/g, ' ')));
  ok(lin2.some(t => t.includes('P-26188') && t.includes('Durant Alfaiataria')), 'depois de aceito entra nos pedidos com a etiqueta do parceiro');
  await r15.pg.waitForFunction(() => P.last.has('cfg') || [...P.last.keys()].some(k => k.startsWith('sing~cfg')), null, { timeout: 8000 }).catch(() => {});
  ok(![...b15.reg.values()].some(r => r.k === 'pedidos' && /aceit|recusad/.test(r.j || '')), 'o aceite fica na configuração do dono, não dentro do pedido');
  await r15.pg.evaluate(() => { ui.det = 'P-26188'; render(); }); await r15.pg.waitForTimeout(300);
  ok((await r15.pg.textContent('body')).includes('pedido de Durant Alfaiataria'), 'no detalhe aparece "pedido de Durant Alfaiataria"');
  ok(![...b15.reg.values()].some(r => /Durant Alfaiataria/.test(r.j || '')), 'a origem nunca é gravada dentro dos dados');
  const d15 = await r15.pg.textContent('main');
  ok(!d15.includes('1.500') && d15.includes('Valor cobrado do ateliê') && d15.includes('a definir') && !d15.includes('Financeiro do pedido') && !d15.includes('Pagamento'), 'fábrica não vê valor, pagamento nem financeiro do pedido do ateliê (mostra "Valor cobrado do ateliê: a definir")');
  ok(await r15.pg.evaluate(() => !document.getElementById('o-aprovped') && !document.getElementById('o-pag') && !document.querySelector('[data-zap2]')), 'fábrica não tem botões de aprovar pedido, confirmar pagamento nem WhatsApp ao cliente no pedido do ateliê');
  await r15.pg.evaluate(() => { ui.det = null; location.hash = 'pedidos'; render(); }); await r15.pg.waitForTimeout(300);
  const l15 = await r15.pg.$$eval('[data-open]', els => els.map(e => e.textContent.replace(/\s+/g, ' ')));
  ok(l15.some(t => t.includes('P-26188')) && !l15.some(t => t.includes('P-26188') && t.includes('1.500')), 'na lista de pedidos o valor do ateliê não aparece');
  await r15.pg.evaluate(() => { location.hash = 'prodparc'; render(); }); await r15.pg.waitForTimeout(300);
  ok(!(await r15.pg.textContent('main')).includes('1.500'), 'na tela "Pedidos de produção" o valor também não aparece');
  ok(await r15.pg.evaluate(() => { const v = S.pedidos.filter(p => !vendaAtelie(p)).reduce((a, p) => a + (p.valor || 0), 0); return vendaAtelie(S.pedidos.find(p => p.id === 'P-26188')) === true && fluxoCalc().every(x => x.v <= v); }), 'o pedido do ateliê fica fora dos totais (painel e gráfico de faturamento)');
  await r15.pg.evaluate(() => { location.hash = 'painel'; render(); }); await r15.pg.waitForTimeout(300);
  const pn = await r15.pg.textContent('main');
  ok(pn.includes('não inclui 1 pedido de ateliê') && await r15.pg.evaluate(() => { const ym = TODAY().toISOString().slice(0, 7); return S.pedidos.filter(p => !vendaAtelie(p) && (p.aprov || '').slice(0, 7) === ym).reduce((a, p) => a + p.valor, 0) === 1500; }), 'o painel da fábrica soma só o pedido da própria fábrica (R$ 1.500) e avisa que não inclui o do ateliê');
  ok(r15.erros.length === 0, 'sem erros de JavaScript na página (' + r15.erros.join(' | ') + ')');
  await r15.pg.evaluate(() => { location.hash = 'pedidos'; ui.det = null; ui.draft = newDraft(5); render(); }); await r15.pg.waitForTimeout(300);
  await r15.pg.click('[data-add="paleto"]'); await r15.pg.waitForTimeout(300);
  await r15.pg.evaluate(() => { const p = ui.draft.pecas[0]; p.forroForn = 'Imperiale'; p.forroCod = ''; p.fechada = false; render(); }); await r15.pg.waitForTimeout(300);
  const fi = await r15.pg.$('[data-tec$="|forro"]');
  if (fi) {
    await fi.fill('42'); await r15.pg.waitForSelector('[data-newtec]', { timeout: 3000 });
    await r15.pg.click('[data-newtec]'); await r15.pg.waitForTimeout(400);
    ok(await r15.pg.evaluate(() => !document.querySelector('[data-newtec]') && ui.draft.pecas[0].forroCod === '42'), 'cadastrar forro novo pelo campo: o botão "+ Cadastrar" some e o código fica no campo');
  } else ok(false, 'campo de código do forro não encontrado no teste');
  const vf = await r15.pg.evaluate(() => { const p = S.pedidos.find(x => origemDe(x.id)); p.valorFab = 700; p.aprov = hoje();
    S.cfg.aceites = S.cfg.aceites || {}; S.cfg.aceites[p.id] = { st: 'aceito', em: new Date().toISOString(), por: 't' };
    const h = fechamentoHTML(origemDe(p.id), hoje().slice(0, 7)); window.__pid = p.id;
    return { h: h.slice(0,200), pend: p.id, tem: h.includes('700,00') && h.includes('Total') }; });
  await r15.pg.evaluate(() => { location.hash = 'pedidos'; }); await r15.pg.waitForTimeout(400);
  vf.campo = await r15.pg.evaluate(() => { ui.draft = null; ui.det = window.__pid; render(); return !!document.getElementById('vf-in') || document.querySelector('main').textContent.replace(/\s+/g,' ').slice(0,300); });
  if (vf.campo !== true) console.log('DBG', String(vf.campo));
  ok(vf.campo === true && vf.tem, 'fábrica define o valor cobrado do ateliê e o fechamento do mês soma esse valor (R$ 700)');
  const at = await r15.pg.evaluate(() => { const ids = S.clientes.slice(0, 1).map(c => c.id); ids.forEach(id => ORIGEM['clientes~' + id] = 'Ateliê Teste');
    S.cfg.atelies = { 'Ateliê Teste': { tipo: 'PJ', doc: '12.345.678/0001-90', resp: 'Ana' } };
    ui.draft = null; ui.det = null; ui.cli = null; ui.cModo = 'atel'; ui.atSel = null; ui.voltaAt = false; location.hash = 'clientes'; render();
    const t = document.querySelector('main').textContent, tem = id => !!document.getElementById(id);
    const r = { tabs: tem('cm-meus') && tem('cm-atel'), lista: !!document.querySelector('[data-atsel="Ateliê Teste"]'), ficha: t.includes('Ana') && t.includes('12.345.678/0001-90') && t.includes('Razão social') && t.includes('Convidar ateliê'), editar: tem('at-edit'), pedidos: tem('at-pedidos'), clientes: document.querySelectorAll('[data-atcli]').length, medidas: tem('at-med-edit') };
    document.getElementById('cm-meus').click(); r.meus = document.querySelectorAll('.citem[data-cli]').length === S.clientes.length - 1;
    ids.forEach(id => delete ORIGEM['clientes~' + id]); ui.cModo = 'meus'; return r; });
  ok(at.tabs && at.lista && at.ficha && at.editar && at.pedidos && at.clientes === 1 && at.medidas && at.meus, 'fábrica: aba Ateliês com lista, ficha (razão social, documento, responsável), barra fixa com "Convidar ateliê", clientes do ateliê e medidas ao lado; "Meus clientes" mostra só os próprios');
  await r15.ctx.close();

  console.log('14) Enter executa o login (e-mail e senha preenchidos)');
  const b14 = novoBanco({}); const r14 = await abre(b14); await r14.pg.waitForSelector('#g-u');
  await r14.pg.fill('#g-u', 'hd@henriquedurant.com'); await r14.pg.fill('#g-p', 'senhaCerta123'); await r14.pg.press('#g-p', 'Enter');
  await r14.pg.waitForSelector('#userchip:not([hidden])', { timeout: 15000 });
  ok(b14.logins === 1, 'Enter no campo de senha entrou uma única vez (sem duplicar)');
  await r14.ctx.close();
  const r14b = await abre(novoBanco({})); await r14b.pg.waitForSelector('#g-u');
  await r14b.pg.fill('#g-u', 'hd@henriquedurant.com'); await r14b.pg.fill('#g-p', 'senhaErrada'); await r14b.pg.press('#g-u', 'Enter');
  await r14b.pg.waitForSelector('#g-e:not([hidden])', { timeout: 5000 });
  ok((await r14b.pg.textContent('#g-e')).includes('incorretos') && await r14b.pg.isEnabled('#g-f .gbtn'), 'Enter no campo de e-mail também envia; erro aparece e o botão volta ao normal');
  await r14b.ctx.close();

  await br.close(); srv.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTUDO OK');
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(2); });
