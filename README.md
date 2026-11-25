# Durant Ateliê

Sistema de gestão da Durant Alfaiataria. É uma página única (`index.html`), sem etapa de build.

## Como funciona hoje
- `index.html`: o sistema (origem: protótipo do Claude, v179).
- `adapter.js` + `config.js` + `vendor/supabase.js`: fora do Claude, o sistema grava no **Supabase** (login real e isolamento por empresa). Dentro do Claude, o adaptador não faz nada.
- `supabase/migrations/`: SQL do banco. `0001_base.sql` cria tabelas, regras de segurança (RLS) e permissões; `0002_primeiro_admin.sql` liga o primeiro administrador.
- `tools/aplicar-adaptador.py`: reaplica as poucas mudanças do `index.html` ao adaptador (pode ser rodado de novo numa versão mais nova do protótipo).
- `tests/`: `e2e.cjs` (login, gravar, recarregar, apagar, sair, com Supabase simulado) e `rls.mjs` (isolamento entre empresas num Postgres real em memória).

## Regras
- Dados reais de clientes e backups **nunca** entram neste repositório (veja `.gitignore`).
- A chave em `config.js` é a *publishable* (pública por desenho). A `service_role` nunca entra aqui.
- Toda tabela nova nasce com RLS ligado e permissões explícitas (sem acesso anônimo).

## Colocar no ar (Vercel)
Projeto estático: *Framework Preset = Other*, sem comando de build, diretório raiz. Domínio: `sistema.henriquedurant.com` (CNAME no DNS).

## Ambientes (produção × homologação)

| | Produção | Homologação |
|---|---|---|
| Branch | `main` | `homologacao` |
| Endereço | `sistema.henriquedurant.com` (e `durant-atelie.vercel.app`) | qualquer outro (prévia da Vercel da branch, localhost) |
| Banco | Supabase `jkhjixfdlpucaebulpdh` (dados reais) | Supabase `azkvclwozhneyougtcbn` (só dados de teste) |

- `config.js` escolhe o banco **pelo endereço**: só os endereços listados em `HOSTS_PRODUCAO` usam o banco real; qualquer outro usa a homologação. `tests/ambientes.cjs` garante isso.
- Na homologação aparece uma faixa vermelha "HOMOLOGAÇÃO" e o título da aba ganha o prefixo `[HOMOLOGAÇÃO]`.
- Fluxo: desenvolver e testar na branch `homologacao` → validar com dados de exemplo → só então fazer merge na `main` (vai para produção).
- Mudanças de banco: aplicar a migration primeiro no banco de homologação, testar, e só depois no de produção.
- **Nunca** importar backup real (dados de clientes) na homologação.
