/* Regressões de autenticação com Supabase/DOM simulados, sem dependências.
   Executar: node tests/auth.cjs */
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'adapter.js'), 'utf8');
async function run(source) {
  function assert(value, message) { if (!value) throw new Error(message); }
  async function rejeita(p, message) { try { await p; } catch (e) { return; } throw new Error(message); }
  function ambiente(opts) {
    opts = opts || {};
    var chamadas = { dados: 0, validacoes: 0, saidas: 0, reloads: 0 };
    var session = { user: { id: 'u1', email: 'cache@ex.com' } };
    var listener, html = '';
    var nodes = {};
    function node(id) {
      return nodes[id] || (nodes[id] = { innerHTML: 'dados internos', value: '', hidden: false,
        querySelector: function () { return { disabled: false, textContent: 'Entrar' }; },
        addEventListener: function () {} });
    }
    var document = { title: '', getElementById: node, querySelectorAll: function () { return []; } };
    var memoria = new Map();
    var storage = { getItem: function (k) { return memoria.get(k) || null; },
      setItem: function (k,v) { memoria.set(k,v); }, removeItem: function (k) { memoria.delete(k); } };
    var auth = {
      onAuthStateChange: function (fn) { listener = fn; return { data: { subscription: {} } }; },
      getSession: async function () { return { data: { session: opts.semSessao ? null : session } }; },
      getUser: async function () { chamadas.validacoes++; if (opts.duranteValidacao) listener('SIGNED_IN', { user: { id: 'u2' } }); return opts.validacao || { data: { user: { id: 'u1', email: 'real@ex.com' } } }; },
      signOut: async function () { chamadas.saidas++; if (opts.erroSair) return { error: { status: 503 } };
        listener('SIGNED_OUT', null); return { error: null }; }
    };
    function consulta(nome) {
      chamadas.dados++;
      var q = {
        select: function () { return q; }, order: function () { return q; }, eq: function () { return q; },
        range: async function () { return { data: [] }; },
        maybeSingle: async function () { return { data: null }; },
        upsert: async function () { return {}; }, delete: function () { return q; },
        then: function (resolve, reject) {
          if (opts.duranteMembros && nome === 'membros') listener('SIGNED_OUT', null);
          return Promise.resolve({ data: nome === 'membros' ? (opts.semMembro ? [] : [{ empresa_id: 'E1', papel: 'admin' }]) :
            nome === 'empresas' ? [{ id: 'E1', nome: 'Teste' }] : [] }).then(resolve, reject);
        }
      };
      return q;
    }
    var sb = { auth: auth, from: consulta, rpc: async function () { return { error: { message: 'não disponível' } }; } };
    var window = { SUPABASE_CFG: { url: 'https://example.supabase.co', key: 'publishable', ambiente: 'teste' },
      supabase: { createClient: function () { return sb; } } };
    var P = { ready: true, user: { id: 'u1' } };
    var location = { hash: '#clientes', search: '', pathname: '/', origin: 'http://localhost',
      reload: function () { chamadas.reloads++; } };
    new Function('window','document','location','sessionStorage','localStorage','history','gate','gBox','P', source)(
      window, document, location, storage, storage, {}, function (s) { html = s; }, function (s) { return s; }, P);
    return { window: window, P: P, calls: chamadas, nodes: nodes,
      evento: function (e,s) { listener(e,s); }, html: function () { return html; } };
  }
  async function ticks() { for (var i = 0; i < 40; i++) await Promise.resolve(); }
  var resultados = [];
  async function teste(nome, fn) { await fn(); resultados.push(nome); }
  await teste('valida a sessão no servidor e usa a identidade confirmada', async function () {
    var a = ambiente(); await a.window.claude.use('db');
    assert(a.calls.validacoes === 1 && a.window.SB.autenticado, 'identidade não validada');
    assert(a.window.SB.email === 'real@ex.com', 'confiou no e-mail do armazenamento');
  });
  await teste('rota interna sem sessão não consulta dados', async function () {
    var a = ambiente({ semSessao: true }); a.window.claude.use('db'); await ticks();
    assert(a.calls.dados === 0 && !a.window.SB.autenticado && a.html().includes('Bem-vindo'), 'acesso anônimo liberado');
  });
  await teste('sessão revogada volta ao login sem ler dados', async function () {
    var a = ambiente({ validacao: { error: { status: 401 } } }); a.window.claude.use('db'); await ticks();
    assert(a.calls.saidas === 1 && a.calls.dados === 0 && a.html().includes('Bem-vindo'), 'sessão revogada aceita');
  });
  await teste('falha de rede na validação mantém o acesso bloqueado', async function () {
    var a = ambiente({ validacao: { error: { status: 503, message: 'network' } } });
    await rejeita(a.window.claude.use('db'), 'liberou acesso sem validação');
    assert(a.calls.dados === 0 && !a.window.SB.autenticado, 'leu dados sem validação');
  });
  await teste('usuário sem vínculo não entra na empresa', async function () {
    var a = ambiente({ semMembro: true }); a.window.claude.use('db'); await ticks();
    assert(!a.window.SB.autenticado && a.html().includes('Acesso não liberado'), 'usuário sem empresa autorizado');
  });
  await teste('logout em outra aba limpa a tela e bloqueia leituras e gravações', async function () {
    var a = ambiente(); var db = await a.window.claude.use('db'); var doc = db.collection().doc('x');
    a.evento('SIGNED_OUT', null);
    assert(!a.P.ready && !a.P.user && !a.window.SB.autenticado && !a.window.SB.empresa, 'contexto permaneceu aberto');
    assert(a.nodes.main.innerHTML === '' && a.nodes['modal-root'].innerHTML === '' && a.calls.reloads === 1, 'tela não foi limpa');
    await rejeita(doc.get(), 'leitura depois de logout'); await rejeita(doc.set({}), 'gravação depois de logout');
    await rejeita(doc.delete(), 'exclusão depois de logout');
    await rejeita(db.collection().where('k','==','cliente').get(), 'consulta depois de logout');
    await rejeita(a.window.SB.reservar('cliente', 1), 'RPC depois de logout');
  });
  await teste('troca de identidade encerra o contexto da empresa anterior', async function () {
    var a = ambiente(); await a.window.claude.use('db');
    a.evento('SIGNED_IN', { user: { id: 'u2' } });
    assert(!a.window.SB.autenticado && a.calls.reloads === 1, 'identidades misturadas');
  });
  await teste('renovação da mesma identidade preserva a sessão', async function () {
    var a = ambiente(); await a.window.claude.use('db');
    a.evento('TOKEN_REFRESHED', { user: { id: 'u1' } });
    assert(a.window.SB.autenticado && !a.calls.reloads, 'renovação interrompida');
  });
  await teste('logout durante a entrada impede liberar a interface', async function () {
    var a = ambiente({ duranteMembros: true });
    await rejeita(a.window.claude.use('db'), 'entrada concluída após logout');
    assert(!a.window.SB.autenticado && a.calls.dados === 1, 'corrida de sessão prosseguiu após perder o vínculo');
  });
  await teste('falha no logout mantém interface bloqueada e permite tentar novamente', async function () {
    var a = ambiente({ erroSair: true }); await a.window.claude.use('db'); await a.window.SB.sair();
    assert(!a.window.SB.autenticado && !a.P.ready && !a.calls.reloads, 'reabriu sessão após falha');
    assert(a.html().includes('Tentar novamente'), 'sem recuperação de falha');
  });
  await teste('troca de identidade durante validação interrompe antes das consultas', async function () {
    var a = ambiente({ duranteValidacao: true });
    await rejeita(a.window.claude.use('db'), 'entrada concluída após trocar de identidade');
    assert(!a.window.SB.autenticado && a.calls.dados === 0, 'corrida leu dados após troca');
  });
  await teste('sessão trocada durante validação inválida não desloga a nova identidade', async function () {
    var a = ambiente({ duranteValidacao: true, validacao: { error: { status: 401 } } });
    await rejeita(a.window.claude.use('db'), 'entrada concluída após trocar de identidade');
    assert(a.calls.saidas === 0 && a.calls.dados === 0, 'a sessão nova foi afetada pela validação anterior');
  });
  return resultados;
}
run(source).then(results => { results.forEach(name => console.log('ok - ' + name)); console.log(results.length + ' testes passaram.'); }).catch(error => { console.error(error); process.exitCode = 1; });
