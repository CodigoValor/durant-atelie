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
  var SB = (window.SB = { email: '', empresa: null, empresaNome: '', empresas: [], perfil: null, papel: null, autenticado: false, client: sb });
  // A interface só é liberada depois de validar a identidade no Supabase.
  var authEpoch = 0;
  function bloquear() {
    SB.autenticado = false;
    SB.uid = null; SB.email = ''; SB.empresa = null; SB.empresaNome = '';
    SB.empresas = []; SB.papel = null; SB.perfil = null; SB.cadastro = null;
    if (typeof P !== 'undefined') { P.ready = false; P.user = null; }
    ['main', 'modal-root', 'umenu'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.innerHTML = '';
    });
    mostra('<p class="gmsg">Sessão encerrada. Entre novamente para continuar.</p>');
  }
  sb.auth.onAuthStateChange(function (evento, sessao) {
    // Não aguardar chamadas Auth dentro deste callback (o SDK mantém um lock).
    var mudouUsuario = SB.uid && sessao && sessao.user && sessao.user.id !== SB.uid;
    if (evento === 'SIGNED_OUT' || mudouUsuario) {
      authEpoch++;
      if (SB.autenticado || SB.uid) {
        bloquear();
        location.reload();
      }
    }
  });
  function exigirAcesso() {
    if (!SB.autenticado || !SB.uid || !SB.empresa) throw new Error('Sessão não autorizada.');
  }
  SB.trocarEmpresa = function () {
    sb.auth.getSession().then(function (r) { var u = r && r.data && r.data.session && r.data.session.user; if (u) lembrada(u.id, null); location.reload(); });
  };
  /* "Alternar para": entra direto na empresa escolhida, sem pedir senha de novo (vale uma vez; recarrega o sistema nela) */
  SB.alternarPara = function (id) {
    try { sessionStorage.setItem('alinhavo.alternar', id); } catch (e) {}
    location.reload();
  };
  var vemDeRecuperacao = /type=recovery/.test(location.hash);
  /* convite: o link traz ?convite=CÓDIGO. Guardamos o código (sobrevive a "confirme seu e-mail") e limpamos o endereço. */
  var CONVITE = (function () {
    var t = '';
    try { t = (new URLSearchParams(location.search).get('convite') || '').trim(); } catch (e) {}
    try {
      if (t) { sessionStorage.setItem('alinhavo.convite', t); var u = new URL(location.href); u.searchParams.delete('convite'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); }
      else t = sessionStorage.getItem('alinhavo.convite') || '';
    } catch (e) {}
    return t;
  })();
  function limpaConvite() { CONVITE = ''; try { sessionStorage.removeItem('alinhavo.convite'); } catch (e) {} }

  /* faixa fixa avisando que NÃO é o sistema real (impossível confundir homologação com produção) */
  if (cfg.ambiente === 'homologacao') {
    document.title = '[HOMOLOGAÇÃO] ' + document.title; SB.prefixoTitulo = '[HOMOLOGAÇÃO] ';
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
    x.status = st;
    x.code = (st === 429 || st === 503 || st === 0 || /fetch|network/i.test(msg)) ? 'unavailable' : ((e && e.code) || 'erro');
    return x;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* marca do produto (Alinhavo) + nome da empresa em uso */
  function aplicaMarca() {
    var nome = SB.empresaNome || '';
    document.title = (SB.prefixoTitulo || '') + (nome ? nome + ' · Alinhavo' : 'Alinhavo');
    [].forEach.call(document.querySelectorAll('[data-empresa]'), function (e) { e.textContent = (nome || 'GESTÃO DE ALFAIATARIAS').toUpperCase(); });
  }

  /* ---------- telas (usam as classes de estilo que o sistema já tem) ---------- */
  function mostra(html) {
    gate(gBox(html));
    /* Enter em qualquer campo envia o formulário da tela (login, convite, senha), mesmo em navegadores que não fazem isso sozinhos */
    [].forEach.call(document.querySelectorAll('#gate form'), function (f) {
      f.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing || ev.target.tagName === 'BUTTON' || ev.target.tagName === 'TEXTAREA') return;
        ev.preventDefault();
        if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      });
    });
  }
  function mensagemLogin(e) {
    var c = (e && (e.code || '')).toString(), m = (e && e.message) || '';
    if (c === 'invalid_credentials' || /invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
    if (c === 'email_not_confirmed') return 'Este e-mail ainda não foi confirmado.';
    if (e && (e.status === 429 || c === 'over_request_rate_limit')) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    return 'Não consegui entrar agora. Confira a conexão e tente de novo.';
  }
  function telaLogin(aviso) {
    return new Promise(function (resolve) {
      mostra('<p class="geyebrow">SEU ATELIÊ, EM BOAS MÃOS</p><h1>Bem-vindo de volta.</h1><p class="gsub">Entre para continuar o trabalho no seu ateliê.</p><form id="g-f" class="gform"><label>E-mail ou CPF<input id="g-u" type="text" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="voce@seuatelie.com.br ou 000.000.000-00"></label>' +
        '<label>Senha<input id="g-p" type="password" autocomplete="current-password"></label>' +
        '<p class="gerr" id="g-e" role="alert" ' + (aviso ? '' : 'hidden') + '>' + esc(aviso || '') + '</p>' +
        '<button class="gbtn" type="submit">Entrar no meu ateliê</button><button class="glink" type="button" id="g-forgot">Esqueceu a senha?</button></form>');
      var f = document.getElementById('g-f'), er = document.getElementById('g-e');
      f.onsubmit = function (ev) {
        ev.preventDefault();
        var em = document.getElementById('g-u').value.trim().toLowerCase(), pw = document.getElementById('g-p').value;
        if (!em || !pw) { er.textContent = 'Informe e-mail ou CPF e a senha.'; er.hidden = false; return; }
        var bt = f.querySelector('.gbtn'), txt = bt.textContent;
        if (bt.disabled) return;
        bt.disabled = true; bt.textContent = 'Entrando…'; er.hidden = true;
        var volta = function () { bt.disabled = false; bt.textContent = txt; };
        var soDig = em.replace(/\D/g, '');
        if (em.indexOf('@') < 0 && soDig.length === 11) {   // CPF: o servidor descobre o e-mail (o navegador nunca vê)
          fetch(cfg.url + '/functions/v1/login-cpf', { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.key, authorization: 'Bearer ' + cfg.key }, body: JSON.stringify({ cpf: soDig, password: pw }) })
            .then(function (resp) { return resp.json().catch(function () { return {}; }).then(function (b) { return { status: resp.status, body: b }; }); })
            .then(function (x) {
              if (x.status === 429) throw { status: 429 };
              if (x.status !== 200 || !x.body.access_token) throw { code: 'invalid_credentials' };
              return sb.auth.setSession({ access_token: x.body.access_token, refresh_token: x.body.refresh_token });
            })
            .then(function (r) {
              if (r.error || !r.data || !r.data.session) throw r.error || {};
              resolve(r.data.session);
            })
            .catch(function (e) { volta(); er.textContent = (e && e.code === 'invalid_credentials') ? 'CPF ou senha incorretos.' : mensagemLogin(e); er.hidden = false; });
          return;
        }
        sb.auth.signInWithPassword({ email: em, password: pw }).then(function (r) {
          if (r.error || !r.data || !r.data.session) { volta(); er.textContent = mensagemLogin(r.error); er.hidden = false; return; }
          resolve(r.data.session);
        }, function (e) { volta(); er.textContent = mensagemLogin(e); er.hidden = false; });
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
  function mensagemConvite(e) {
    var m = ((e && e.message) || '').toString(), c = ((e && e.code) || '').toString();
    if (/somente com convite/i.test(m)) return 'Este e-mail não é o do convite. Use o mesmo e-mail que recebeu o convite.';
    if (c === 'user_already_exists' || /already (registered|exists)/i.test(m)) return 'Este e-mail já tem conta. Use "Já tenho conta" para entrar.';
    if (c === 'weak_password' || /password/i.test(m)) return 'Escolha uma senha mais forte (8 caracteres ou mais).';
    if (e && (e.status === 429 || c === 'over_request_rate_limit')) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    if (c === 'signup_disabled' || /signups? (not allowed|are disabled|disabled)/i.test(m)) return 'O cadastro de novos usuários está desligado no Supabase (Authentication, Sign In / Providers, "Allow new users to sign up").';
    if (c === 'over_email_send_rate_limit' || /email rate limit/i.test(m)) return 'Limite de e-mails de confirmação do Supabase atingido. Aguarde uma hora ou desligue a confirmação de e-mail nos testes.';
    return 'Não consegui criar sua conta agora. Tente de novo em instantes. (detalhe: ' + (c || (e && e.status) || 'erro') + (m ? ' / ' + m.slice(0, 120) : '') + ')';
  }
  function telaConviteInvalido() {
    return new Promise(function (resolve) {
      limpaConvite();
      mostra('<h1>Convite inválido</h1><p class="gmsg">Este convite não existe, já foi usado ou expirou. Peça um novo convite a quem convidou você.</p>' +
        '<div class="gact"><button class="gbtn" id="g-ok">Ir para a entrada</button></div>');
      document.getElementById('g-ok').onclick = function () { resolve(); };
    });
  }
  /* Quem recebeu o link: cria a conta (ou diz que já tem) e devolve a sessão. null = foi para o login normal. */
  function telaConvite(info) {
    return new Promise(function (resolve) {
      var papel = PAPEL_TXT[info.papel] || info.papel;
      mostra('<p class="geyebrow">VOCÊ FOI CONVIDADO</p><h1>' + esc(info.empresa_nome || 'Alinhavo') + '</h1><p class="gsub">Convite para <b>' + esc(info.email_mascarado) + '</b>, como ' + esc(papel) + '. Crie sua senha para entrar.</p>' +
        '<form id="g-f" class="gform"><label>Seu e-mail (o mesmo do convite)<input id="g-u" type="email" autocomplete="username"></label>' +
        '<label>Crie uma senha<input id="g-p" type="password" autocomplete="new-password"></label>' +
        '<label>Repita a senha<input id="g-p2" type="password" autocomplete="new-password"></label>' +
        '<p class="gerr" id="g-e" role="alert" hidden></p><button class="gbtn" type="submit">Criar conta e entrar</button><button class="glink" type="button" id="g-ja">Já tenho conta</button></form>');
      var er = document.getElementById('g-e'), btn = document.querySelector('#g-f .gbtn');
      function erroTxt(t) { er.textContent = t; er.hidden = false; btn.disabled = false; }
      document.getElementById('g-ja').onclick = function () { resolve(null); };
      document.getElementById('g-f').onsubmit = function (ev) {
        ev.preventDefault();
        var em = document.getElementById('g-u').value.trim().toLowerCase(), p = document.getElementById('g-p').value, p2 = document.getElementById('g-p2').value;
        if (!em) return erroTxt('Informe seu e-mail.');
        if (p.length < 8) return erroTxt('A senha precisa ter pelo menos 8 caracteres.');
        if (p !== p2) return erroTxt('As senhas não são iguais.');
        btn.disabled = true; er.hidden = true;
        sb.auth.signUp({ email: em, password: p }).then(function (r) {
          if (r.error) return erroTxt(mensagemConvite(r.error));
          if (r.data && r.data.session) return resolve(r.data.session);
          mostra('<h1>Confirme seu e-mail</h1><p class="gmsg">Enviamos uma mensagem para ' + esc(em) + '. Abra o link dela e depois volte aqui para entrar. O convite será aceito na sua primeira entrada.</p>' +
            '<div class="gact"><button class="gbtn" id="g-ok">Ir para a entrada</button></div>');
          document.getElementById('g-ok').onclick = function () { resolve(null); };
        }, function (e) { erroTxt(mensagemConvite(e)); });
      };
    });
  }
  /* Antes de entrar na empresa: se há convite guardado e a pessoa está logada, aceita. Devolve o id da empresa ou null. */
  async function aceitarPendente() {
    if (!CONVITE) return null;
    var r = await sb.rpc('aceitar_convite', { p_token: CONVITE });
    if (r.error) {
      var m = r.error.message || '';
      if (/outro e-mail/i.test(m)) {
        await new Promise(function (resolve) {
          mostra('<h1>Convite para outro e-mail</h1><p class="gmsg">Este convite foi enviado para outro e-mail. Você entrou como ' + esc(SB.email) + '. Saia e entre com o e-mail que recebeu o convite.</p><div class="gact"><button class="gbtn" id="g-out">Sair</button></div>');
          document.getElementById('g-out').onclick = function () { limpaConvite(); SB.sair(); };
        });
        await new Promise(function () {});
      }
      limpaConvite();      // inválido, usado ou expirado: segue normal
      return null;
    }
    limpaConvite();
    return r.data || null;
  }
  function cpfValido(c) {
    c = String(c || '').replace(/\D/g, '');
    if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    var dv = function (n) { var s = 0; for (var i = 0; i < n; i++) s += +c[i] * (n + 1 - i); var r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === +c[9] && dv(10) === +c[10];
  }
  function cpfMascara(v) { var x = String(v || '').replace(/\D/g, '').slice(0, 11); return x.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'); }
  /* Quem ainda não tem CPF no cadastro de pessoa informa uma vez (permite entrar só com o CPF depois). Qualquer falha aqui não bloqueia a entrada. */
  async function pedirCpf() {
    var r;
    try { r = await sb.rpc('minha_pessoa'); } catch (e) { return; }
    if (!r || r.error || (r.data && r.data.length)) return;   // sem a função (ambiente antigo) ou já cadastrado
    await new Promise(function (resolve) {
      mostra('<p class="geyebrow">SEU CADASTRO</p><h1>Informe seu CPF</h1><p class="gmsg">Ele identifica você em todas as empresas e permite entrar usando só o CPF e a senha. Cada CPF vale para uma única conta.</p>' +
        '<form id="g-f" class="gform"><label>CPF<input id="g-cpf" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="000.000.000-00"></label><label>Como quer ser chamado (opcional)<input id="g-nome" autocomplete="given-name" maxlength="60" placeholder="Ex.: Luiz"></label>' +
        '<p class="gerr" id="g-e" role="alert" hidden></p><button class="gbtn" type="submit">Salvar e continuar</button><button class="glink" type="button" id="g-agora">Agora não</button></form>');
      var cp = document.getElementById('g-cpf'), er = document.getElementById('g-e');
      cp.oninput = function () { cp.value = cpfMascara(cp.value); };
      document.getElementById('g-agora').onclick = function () { resolve(); };
      document.getElementById('g-f').onsubmit = function (ev) {
        ev.preventDefault();
        if (!cpfValido(cp.value)) { er.textContent = 'CPF inválido. Confira os números.'; er.hidden = false; return; }
        sb.rpc('salvar_minha_pessoa', { p_cpf: cp.value, p_nome: document.getElementById('g-nome').value.trim() || null }).then(function (x) {
          if (x.error) { er.textContent = /já está cadastrado/.test(x.error.message || '') ? 'Este CPF já está cadastrado em outra conta.' : 'Não consegui salvar agora. Tente de novo.'; er.hidden = false; return; }
          resolve();
        }, function () { er.textContent = 'Não consegui salvar agora. Tente de novo.'; er.hidden = false; });
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

  var TIPO_TXT = { atelie: 'Ateliê', alfaiataria: 'Alfaiataria', loja: 'Loja de tecido', cliente_loja: 'Cliente da loja' };
  function rotuloEmpresa(x) {
    var t = x.tipo ? TIPO_TXT[x.tipo] : (x.fornece ? 'Loja de tecido' : (x.soTec ? 'Cliente da loja' : ''));
    var p = PAPEL_TXT[x.papel] || x.papel; p = p ? p.charAt(0).toUpperCase() + p.slice(1) : '';
    return (t ? t + ' · ' : '') + p;
  }
  function ladrilho(nome, tam) {
    return '<span style="width:' + tam + 'px;height:' + tam + 'px;border-radius:10px;background:#243430;color:#D9A441;display:flex;align-items:center;justify-content:center;font-family:\'Cormorant Garamond\',serif;font-size:' + Math.round(tam / 2) + 'px;font-weight:600;flex:none">' + esc(String(nome || '?').trim().charAt(0).toUpperCase()) + '</span>';
  }
  /* Cartões das empresas, na mesma tela do login, depois da senha. Resolve { emp, lembrar }. */
  function telaEscolherEmpresa(lista, nome, ultimoId) {
    return new Promise(function (resolve) {
      var cartoes = lista.map(function (x, i) {
        var ult = x.id === ultimoId;
        return '<button type="button" data-emp="' + i + '" style="display:flex;align-items:center;gap:12px;width:100%;margin:0 0 10px;text-align:left;cursor:pointer;font:inherit;color:inherit;border-radius:12px;padding:14px;' +
          (ult ? 'border:1.5px solid #D9A441;background:#F4EFE4' : 'border:1px solid #E6E1D8;background:#fff') + '">' + ladrilho(x.nome, 40) +
          '<span style="flex:1;min-width:0"><span style="display:block;font-weight:600;font-size:15px">' + esc(x.nome) + '</span><span style="display:block;font-size:12.5px;color:#6b726f">' + esc(rotuloEmpresa(x)) + '</span></span>' +
          (ult ? '<span style="font-size:12px;color:#8a6a26;font-weight:600">Último acesso</span>' : '') + '</button>';
      }).join('');
      mostra('<h1>Como você quer entrar?</h1><p class="gmsg">' + (nome ? 'Olá, ' + esc(nome) + '. ' : '') + 'Escolha a empresa:</p>' +
        '<div class="gform">' + cartoes + '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#4a524f;cursor:pointer"><input type="checkbox" id="g-lemb" style="width:16px;height:16px;accent-color:#B8893A">Lembrar esta escolha neste aparelho</label></div>' +
        '<div class="gact"><button class="glink" type="button" id="g-out">Trocar conta</button></div>');
      Array.prototype.forEach.call(document.querySelectorAll('[data-emp]'), function (b) {
        b.onclick = function () { resolve({ emp: lista[+b.getAttribute('data-emp')], lembrar: document.getElementById('g-lemb').checked }); };
      });
      document.getElementById('g-out').onclick = function () { SB.sair(); };
    });
  }
  var PAPEL_TXT = { admin: 'administrador', usuario: 'usuário', parceiro: 'ateliê' };
  function lembrada(uid, v) {   // só existe se a pessoa marcou "Lembrar esta escolha neste aparelho"
    try { if (v === undefined) return localStorage.getItem('alinhavo.lembrar.' + uid); if (v === null) localStorage.removeItem('alinhavo.lembrar.' + uid); else localStorage.setItem('alinhavo.lembrar.' + uid, v); } catch (e) {}
    return null;
  }
  function ultimaEmpresa(uid, v) {   // sempre guardada, só para marcar "Último acesso"
    try { if (v === undefined) return localStorage.getItem('alinhavo.ultima.' + uid); localStorage.setItem('alinhavo.ultima.' + uid, v); } catch (e) {}
    return null;
  }

  /* ---------- sessão e empresa ---------- */
  var entrando = null;
  function entrar() {
    if (entrando) return entrando;
    entrando = (async function () {
      var r = await sb.auth.getSession();
      var session = r && r.data && r.data.session;
      if (!session && CONVITE) {
        var ci = await sb.rpc('convite_info', { p_token: CONVITE });
        var info = ci && ci.data && ci.data[0];
        if (!info || !info.valido) await telaConviteInvalido();
        else { info.nova = !!info.empresa_nome; session = await telaConvite(info); }
      }
      // getSession recupera tokens; getUser valida a identidade com o servidor.
      var usuario = null;
      while (!usuario) {
        if (!session) session = await telaLogin();
        var epoch = authEpoch;
        var validacao = await sb.auth.getUser();
        if (validacao.error) {
          if (validacao.error.status === 401 || validacao.error.status === 403 ||
              /session_not_found|refresh_token_not_found|refresh_token_already_used|bad_jwt|user_not_found/.test(validacao.error.code || '')) {
            var saida = await sb.auth.signOut({ scope: 'local' });
            if (saida && saida.error) throw erro(saida.error);
            session = null;
            continue;
          }
          throw erro(validacao.error);
        }
        usuario = validacao.data && validacao.data.user;
        if (!usuario || usuario.id !== session.user.id) throw new Error('Não foi possível validar a sessão.');
      }
      session.user = usuario;
      if (vemDeRecuperacao) { await telaNovaSenha(); vemDeRecuperacao = false; }
      SB.email = String(session.user.email || '').toLowerCase();
      var recemEntrou = await aceitarPendente();
      await pedirCpf();
      if (recemEntrou) { lembrada(session.user.id, recemEntrou); SB.recemAceito = true; }
      var m = await sb.from('membros').select('empresa_id,papel').order('criado_em', { ascending: true });
      if (m.error) throw erro(m.error);
      if (!m.data || !m.data.length) { telaSemAcesso(SB.email); await new Promise(function () {}); }
      var em = await sb.from('empresas').select('*');
      if (em.error) throw erro(em.error);
      var porId = {}; (em.data || []).forEach(function (e) { porId[e.id] = e; });
      var lista = m.data.map(function (x) {
        var e = porId[x.empresa_id] || {};
        return { id: x.empresa_id, papel: x.papel, papelTxt: PAPEL_TXT[x.papel] || x.papel, nome: e.nome || 'Empresa',
          vende: e.vende_cliente_final !== false, produz: e.produz === true, fornece: e.fornece_tecido === true, soTec: e.somente_tecidos === true, tipo: e.tipo || null, cadastro: e.cadastro || {} };
      });
      SB.empresas = lista;
      var uid = session.user.id, esc1 = null, lemb = lembrada(uid), alt = null;
      try { alt = sessionStorage.getItem('alinhavo.alternar'); sessionStorage.removeItem('alinhavo.alternar'); } catch (e) {}
      var achar = function (id) { return id ? (lista.filter(function (x) { return x.id === id; })[0] || null) : null; };   // só vale se ainda for vínculo real
      esc1 = achar(alt) || achar(lemb);
      if (!esc1) {
        if (lista.length === 1) esc1 = lista[0];
        else {
          var pes = null; try { var rp = await sb.rpc('minha_pessoa'); pes = rp && rp.data && rp.data[0]; } catch (e) {}
          var esc2 = await telaEscolherEmpresa(lista, pes && pes.nome ? String(pes.nome).split(' ')[0] : '', ultimaEmpresa(uid));
          esc1 = esc2.emp;
          if (esc2.lembrar) lembrada(uid, esc1.id); else lembrada(uid, null);
        }
      }
      ultimaEmpresa(uid, esc1.id);
      if (epoch !== authEpoch) throw new Error('A sessão foi encerrada durante a entrada.');
      SB.autenticado = true;
      SB.uid = uid; SB.empresa = esc1.id; SB.papel = esc1.papel; SB.empresaNome = esc1.nome; SB.perfil = { vende: esc1.vende, produz: esc1.produz, fornece: esc1.fornece, soTec: esc1.soTec, tipo: esc1.tipo }; SB.cadastro = esc1.cadastro;
      aplicaMarca();
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
            exigirAcesso();
            var r = await sb.from('reg').select(COLS).eq('empresa_id', SB.empresa).eq('id', id).maybeSingle();
            if (r.error) throw erro(r.error);
            return docSnap(r.data);
          },
          set: async function (v) {
            exigirAcesso();
            var r = await sb.from('reg').upsert(
              { empresa_id: SB.empresa, id: id, k: v.k, i: v.i == null ? null : String(v.i), n: v.n == null ? null : v.n, j: v.j, atualizado_em: new Date().toISOString() },
              { onConflict: 'empresa_id,id' });
            if (r.error) throw erro(r.error);
          },
          delete: async function () {
            exigirAcesso();
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
              exigirAcesso();
              exigirAcesso();
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
    bloquear();
    try {
      var r = await sb.auth.signOut({ scope: 'local' });
      if (r && r.error) throw r.error;
      location.reload();
    } catch (e) {
      mostra('<h1>Não consegui encerrar a sessão</h1><p class="gmsg">Confira a conexão e tente novamente.</p><button class="gbtn" id="g-out">Tentar novamente</button>');
      document.getElementById('g-out').onclick = SB.sair;
    }
  };

  /* ---------- numeração: o servidor reserva um bloco de números (ver migration 0006) ---------- */
  SB.reservar = async function (nome, qtd) {
    exigirAcesso();
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
