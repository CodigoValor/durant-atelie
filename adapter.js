/* Adaptador Supabase para o Durant Ateliê.
   O protótipo nasceu dentro do Claude e grava num banco de documentos (claude.use('db')).
   Fora do Claude, este arquivo oferece o mesmo contrato, só que guardando no Supabase,
   com login real (Supabase Auth) e isolamento por empresa (RLS).
   Dentro do Claude (window.claude presente) ele não faz nada. */
(function () {
  'use strict';
  if (window.claude || !window.SUPABASE_CFG || !window.supabase) return;

  var cfg = window.SUPABASE_CFG;
  var sb = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  var SB = (window.SB = { email: '', empresa: null, empresaNome: '', empresas: [], perfil: null, papel: null, client: sb });
  SB.trocarEmpresa = function () {
    sb.auth.getSession().then(function (r) { var u = r && r.data && r.data.session && r.data.session.user; if (u) lembrada(u.id, null); location.reload(); });
  };
  var vemDeRecuperacao = /type=recovery/.test(location.hash);

  /* faixa fixa avisando que NÃO é o sistema real (impossível confundir homologação com produção) */
  if (cfg.ambiente === 'homologacao') {
    document.title = '[HOMOLOGAÇÃO] ' + document.title;
    var faixa = document.createElement('div');
    faixa.textContent = 'HOMOLOGAÇÃO — ambiente de testes, não é o sistema real';
    faixa.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#b3261e;color:#fff;' +
      'font:600 12px/1 system-ui,sans-serif;letter-spacing:.06em;text-align:center;padding:7px 8px;pointer-events:none');
    (document.body ? Promise.resolve() : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); }))
      .then(function () { document.body.appendChild(faixa); });
  }

  /* erros no formato que o protótipo espera (code === 'unavailable' dispara nova tentativa) */
  function erro(e) {
    var msg = (e && e.message) || 'erro';
    var x = new Error(msg);
    var st = e && e.status;
    x.code = (st === 429 || st === 503 || st === 0 || /fetch|network/i.test(msg)) ? 'unavailable' : ((e && e.code) || 'erro');
    return x;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- telas (usam as classes de estilo que o sistema já tem) ---------- */
  function mostra(html) { gate(gBox(html)); }
  function mensagemLogin(e) {
    var c = (e && (e.code || '')).toString(), m = (e && e.message) || '';
    if (c === 'invalid_credentials' || /invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
    if (c === 'email_not_confirmed') return 'Este e-mail ainda não foi confirmado.';
    if (e && (e.status === 429 || c === 'over_request_rate_limit')) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    return 'Não consegui entrar agora. Confira a conexão e tente de novo.';
  }
  function telaLogin(aviso) {
    return new Promise(function (resolve) {
      mostra('<p class="geyebrow">SEU ATELIÊ, EM BOAS MÃOS</p><h1>Bem-vindo de volta.</h1><p class="gsub">Entre para continuar o trabalho no seu ateliê.</p><form id="g-f" class="gform"><label>E-mail<input id="g-u" type="email" autocomplete="username" placeholder="voce@seuatelie.com.br"></label>' +
        '<label>Senha<input id="g-p" type="password" autocomplete="current-password"></label>' +
        '<p class="gerr" id="g-e" role="alert" ' + (aviso ? '' : 'hidden') + '>' + esc(aviso || '') + '</p>' +
        '<button class="gbtn" type="submit">Entrar no meu ateliê</button><button class="glink" type="button" id="g-forgot">Esqueceu a senha?</button></form>');
      var f = document.getElementById('g-f'), er = document.getElementById('g-e');
      f.onsubmit = function (ev) {
        ev.preventDefault();
        var em = document.getElementById('g-u').value.trim().toLowerCase(), pw = document.getElementById('g-p').value;
        if (!em || !pw) { er.textContent = 'Informe e-mail e senha.'; er.hidden = false; return; }
        sb.auth.signInWithPassword({ email: em, password: pw }).then(function (r) {
          if (r.error || !r.data || !r.data.session) { er.textContent = mensagemLogin(r.error); er.hidden = false; return; }
          resolve(r.data.session);
        }, function (e) { er.textContent = mensagemLogin(e); er.hidden = false; });
      };
      document.getElementById('g-forgot').onclick = function () { telaEsqueci().then(function () { resolve(telaLogin()); }); };
    });
  }
  function telaEsqueci() {
    return new Promise(function (resolve) {
      mostra('<h1>Esqueci minha senha</h1><p class="gmsg">Informe seu e-mail. Enviamos um link para criar uma nova senha.</p>' +
        '<form id="g-f" class="gform"><label>E-mail<input id="g-u" type="email" autocomplete="username" placeholder="voce@seuatelie.com.br"></label>' +
        '<p class="gerr" id="g-e" role="alert" hidden></p><button class="gbtn" type="submit">Enviar link</button><button class="glink" type="button" id="g-back">Voltar</button></form>');
      var er = document.getElementById('g-e');
      document.getElementById('g-back').onclick = function () { resolve(); };
      document.getElementById('g-f').onsubmit = function (ev) {
        ev.preventDefault();
        var em = document.getElementById('g-u').value.trim().toLowerCase();
        if (!em) { er.textContent = 'Informe o e-mail.'; er.hidden = false; return; }
        sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname }).then(function (r) {
          if (r.error) { er.textContent = 'Não consegui enviar agora. Tente de novo em instantes.'; er.hidden = false; return; }
          mostra('<h1>Confira seu e-mail</h1><p class="gmsg">Se esse e-mail estiver cadastrado, o link chega em instantes. Ele abre esta página para você criar a nova senha.</p><div class="gact"><button class="glink" id="g-back">Voltar</button></div>');
          document.getElementById('g-back').onclick = function () { resolve(); };
        });
      };
    });
  }
  function telaNovaSenha() {
    return new Promise(function (resolve) {
      mostra('<h1>Nova senha</h1><p class="gmsg">Crie uma senha com pelo menos 8 caracteres.</p>' +
        '<form id="g-f" class="gform"><label>Nova senha<input id="g-p" type="password" autocomplete="new-password"></label>' +
        '<label>Repita a senha<input id="g-p2" type="password" autocomplete="new-password"></label>' +
        '<p class="gerr" id="g-e" role="alert" hidden></p><button class="gbtn" type="submit">Salvar nova senha</button></form>');
      var er = document.getElementById('g-e');
      document.getElementById('g-f').onsubmit = function (ev) {
        ev.preventDefault();
        var p = document.getElementById('g-p').value, p2 = document.getElementById('g-p2').value;
        if (p.length < 8) { er.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; er.hidden = false; return; }
        if (p !== p2) { er.textContent = 'As senhas não são iguais.'; er.hidden = false; return; }
        sb.auth.updateUser({ password: p }).then(function (r) {
          if (r.error) { er.textContent = 'Não consegui salvar a senha. Peça um novo link e tente de novo.'; er.hidden = false; return; }
          history.replaceState(null, '', location.pathname);
          resolve();
        });
      };
    });
  }
  function telaSemUsuario() {
    mostra('<h1>Usuário não cadastrado</h1><p class="gmsg">O e-mail ' + esc(SB.email) + ' entrou, mas não está cadastrado como usuário no sistema. Peça ao administrador em Configurações, Usuários.</p>' +
      '<div class="gact"><button class="gbtn" id="g-out">Sair</button></div>');
    document.getElementById('g-out').onclick = function () { SB.sair(); };
  }
  function telaSemAcesso(email) {
    mostra('<h1>Acesso não liberado</h1><p class="gmsg">A conta ' + esc(email) + ' ainda não foi liberada para nenhuma empresa. Peça ao administrador do sistema.</p>' +
      '<div class="gact"><button class="gbtn" id="g-out">Sair</button></div>');
    document.getElementById('g-out').onclick = function () { SB.sair(); };
  }

  function telaEscolherEmpresa(lista) {
    return new Promise(function (resolve) {
      var botoes = lista.map(function (x, i) {
        var tipo = (x.vende ? 'vende ao cliente final' : '') + (x.vende && x.produz ? ' · ' : '') + (x.produz ? 'produz' : '');
        return '<button class="gbtn" type="button" data-emp="' + i + '" style="display:block;width:100%;margin:0 0 10px;text-align:left">' +
          esc(x.nome) + '<span style="display:block;font-size:12px;font-weight:400;opacity:.8">' + esc(x.papelTxt) + (tipo ? ' · ' + esc(tipo) : '') + '</span></button>';
      }).join('');
      mostra('<h1>Escolha a empresa</h1><p class="gmsg">Sua conta tem acesso a mais de uma empresa. Você pode trocar depois em "Sua conta".</p>' +
        '<div class="gform">' + botoes + '</div><div class="gact"><button class="glink" type="button" id="g-out">Sair</button></div>');
      Array.prototype.forEach.call(document.querySelectorAll('[data-emp]'), function (b) {
        b.onclick = function () { resolve(lista[+b.getAttribute('data-emp')]); };
      });
      document.getElementById('g-out').onclick = function () { SB.sair(); };
    });
  }
  var PAPEL_TXT = { admin: 'administrador', usuario: 'usuário', parceiro: 'parceiro' };
  function lembrada(uid, v) {
    try { if (v === undefined) return localStorage.getItem('durant.empresa.' + uid); if (v === null) localStorage.removeItem('durant.empresa.' + uid); else localStorage.setItem('durant.empresa.' + uid, v); } catch (e) {}
    return null;
  }

  /* ---------- sessão e empresa ---------- */
  var entrando = null;
  function entrar() {
    if (entrando) return entrando;
    entrando = (async function () {
      var r = await sb.auth.getSession();
      var session = r && r.data && r.data.session;
      while (!session) session = await telaLogin();
      if (vemDeRecuperacao) { await telaNovaSenha(); vemDeRecuperacao = false; }
      SB.email = String(session.user.email || '').toLowerCase();
      var m = await sb.from('membros').select('empresa_id,papel').order('criado_em', { ascending: true });
      if (m.error) throw erro(m.error);
      if (!m.data || !m.data.length) { telaSemAcesso(SB.email); await new Promise(function () {}); }
      var em = await sb.from('empresas').select('*');
      if (em.error) throw erro(em.error);
      var porId = {}; (em.data || []).forEach(function (e) { porId[e.id] = e; });
      var lista = m.data.map(function (x) {
        var e = porId[x.empresa_id] || {};
        return { id: x.empresa_id, papel: x.papel, papelTxt: PAPEL_TXT[x.papel] || x.papel, nome: e.nome || 'Empresa',
          vende: e.vende_cliente_final !== false, produz: e.produz === true };
      });
      SB.empresas = lista;
      var uid = session.user.id, esc1 = null, lemb = lembrada(uid);
      if (lemb) esc1 = lista.filter(function (x) { return x.id === lemb; })[0] || null;   // só vale se ainda for vínculo real
      if (!esc1) esc1 = lista.length === 1 ? lista[0] : await telaEscolherEmpresa(lista);
      lembrada(uid, esc1.id);
      SB.uid = uid; SB.empresa = esc1.id; SB.papel = esc1.papel; SB.empresaNome = esc1.nome; SB.perfil = { vende: esc1.vende, produz: esc1.produz };
    })();
    entrando.catch(function () { entrando = null; });
    return entrando;
  }

  /* ---------- "banco de documentos" com o mesmo contrato do Claude ---------- */
  var COLS = 'k,i,n,j';
  function linha(r) { return { k: r.k, i: r.i, n: r.n == null ? undefined : r.n, j: r.j }; }
  function docSnap(row) { return { exists: !!row, data: function () { return row ? linha(row) : undefined; } }; }

  function colecao() {
    return {
      doc: function (id) {
        return {
          get: async function () {
            var r = await sb.from('reg').select(COLS).eq('empresa_id', SB.empresa).eq('id', id).maybeSingle();
            if (r.error) throw erro(r.error);
            return docSnap(r.data);
          },
          set: async function (v) {
            var r = await sb.from('reg').upsert(
              { empresa_id: SB.empresa, id: id, k: v.k, i: v.i == null ? null : String(v.i), n: v.n == null ? null : v.n, j: v.j, atualizado_em: new Date().toISOString() },
              { onConflict: 'empresa_id,id' });
            if (r.error) throw erro(r.error);
          },
          delete: async function () {
            var r = await sb.from('reg').delete().eq('empresa_id', SB.empresa).eq('id', id);
            if (r.error) throw erro(r.error);
          }
        };
      },
      where: function (campo, op, valor) {
        if (op !== '==') throw new Error('Operador não suportado: ' + op);
        var lim = 1000;
        var q = {
          limit: function (n) { lim = n; return q; },
          get: async function () {
            var out = [], de = 0, passo = 500;
            while (out.length < lim) {
              var r = await sb.from('reg').select(COLS).eq('empresa_id', SB.empresa).eq(campo, valor)
                .order('id', { ascending: true }).range(de, de + passo - 1);
              if (r.error) throw erro(r.error);
              out = out.concat(r.data);
              if (r.data.length < passo) break;
              de += passo;
            }
            out = out.slice(0, lim);
            return { docs: out.map(function (row) { return { data: function () { return linha(row); } }; }) };
          }
        };
        return q;
      }
    };
  }

  /* ---------- logout ---------- */
  SB.semUsuario = telaSemUsuario;
  SB.sair = async function () {
    try { await sb.auth.signOut(); } catch (e) {}
    location.reload();
  };

  /* ---------- numeração: o servidor reserva um bloco de números (ver migration 0006) ---------- */
  SB.reservar = async function (nome, qtd) {
    var r = await sb.rpc('reservar_numeros', { p_empresa: SB.empresa, p_nome: nome, p_qtd: qtd });
    if (r.error) throw erro(r.error);
    return Number(r.data);
  };

  /* ---------- o que o protótipo pede ao Claude ---------- */
  window.claude = {
    use: async function (nome) {
      if (nome === 'db') { await entrar(); return { collection: colecao }; }
      if (nome === 'user') {
        return {
          canEdit: async function () { return true; },
          isOwner: async function () { return SB.papel === 'admin'; }
        };
      }
      throw new Error('Recurso indisponível fora do Claude: ' + nome);
    }
  };
})();
