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
      return json(route, 200, [{ empresa_id: 'E1', papel: 'admin' }]);
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

  async function abre(banco, ctx) {
    ctx = ctx || await br.newContext();
    const pg = await ctx.newPage(); const erros = [];
    pg.on('pageerror', e => erros.push(String(e))); pg.on('dialog', d => d.dismiss());
    await pg.route(SUPA + '/**', banco.handler);
    await pg.goto(base); return { pg, ctx, erros };
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

  await br.close(); srv.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTUDO OK');
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(2); });
