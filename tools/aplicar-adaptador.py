#!/usr/bin/env python3
"""Aplica ao index.html as poucas mudanças que ligam o protótipo ao adaptador Supabase.
Pode ser rodado de novo sobre uma versão mais nova do protótipo (cada troca confere que o trecho existe uma única vez).
Uso: python3 tools/aplicar-adaptador.py index.html"""
import sys, io

path = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
s = io.open(path, encoding='utf-8').read()

TROCAS = [
    # 1) carrega supabase-js, a configuração e o adaptador antes do script principal
    ("<div id=\"modal-root\"></div>\n\n<script>\nconst VIEWS=[",
     "<div id=\"modal-root\"></div>\n\n<script src=\"vendor/supabase.js\"></script>\n<script src=\"config.js\"></script>\n<script src=\"adapter.js\"></script>\n<script>\nconst VIEWS=["),
    # 2) sistema privado: não indexar
    ("<title>Durant Ateliê</title>",
     "<title>Durant Ateliê</title>\n<meta name=\"robots\" content=\"noindex,nofollow\">"),
    # 3) depois de carregar, entra direto com o usuário do sistema que tem o mesmo e-mail do login
    ("const sid=sess.get(),u=sid&&S.cfg.usuarios.find(x=>x.id==sid&&x.ativo);\n if(u)entrar(u);else gateLogin();",
     "const sid=sess.get(),u=window.SB?S.cfg.usuarios.find(x=>x.ativo&&String(x.email||'').toLowerCase()===window.SB.email):(sid&&S.cfg.usuarios.find(x=>x.id==sid&&x.ativo));\n if(u)entrar(u);else if(window.SB)window.SB.semUsuario();else gateLogin();"),
    # 4) sair encerra a sessão do Supabase
    ("function sair(){sess.clr();",
     "function sair(){if(window.SB)return window.SB.sair();sess.clr();"),
    # 5) trocar senha na conta muda a senha do login do Supabase
    ("setSenha(u,p).then(()=>{toast('Senha alterada');flush()});",
     "if(window.SB)window.SB.client.auth.updateUser({password:p}).then(r=>{toast(r.error?'Não consegui alterar a senha':'Senha alterada')});else setSenha(u,p).then(()=>{toast('Senha alterada');flush()});"),
    # 6) ícones do site (favicon): gerados por tools/gerar-favicon.py a partir do emblema
    ("<meta name=\"robots\" content=\"noindex,nofollow\">",
     "<meta name=\"robots\" content=\"noindex,nofollow\">\n<link rel=\"icon\" href=\"favicon.ico\" sizes=\"any\">\n<link rel=\"icon\" type=\"image/png\" sizes=\"32x32\" href=\"favicon-32.png\">\n<link rel=\"apple-touch-icon\" href=\"apple-touch-icon.png\">\n<meta name=\"theme-color\" content=\"#243029\">"),
]

for antigo, novo in TROCAS:
    if novo in s:
        continue  # já aplicado
    n = s.count(antigo)
    if n != 1:
        sys.exit(f"ERRO: trecho esperado 1 vez, achei {n}: {antigo[:70]!r}")
    s = s.replace(antigo, novo)

io.open(path, 'w', encoding='utf-8').write(s)
print("adaptador aplicado em", path)
