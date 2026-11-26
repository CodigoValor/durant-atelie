# Operação da homologação do Alinhavo

**Ambiente** — branch `homologacao`, projeto Supabase Homologação - Alinhavo e aliases `homolog.henriquedurant.com` e `painel-homolog.henriquedurant.com` na Vercel. Antes de escrever, confirme o projeto de banco e a branch do deploy pelo painel ou conector.

## Publicação estática e verificação

`node tools/build-vercel.mjs` publica em `dist/` somente as páginas, scripts e imagens necessários. A aplicação e o painel devem retornar 200, carregar o JavaScript e apontar para o banco de homologação. Uma migration SQL usada como controle deve retornar 404 no deploy. Depois que os dois aliases apontarem para a nova versão, rode `node tools/smoke-homologacao.mjs`. Para reverter o build, reverta o commit em homologação e verifique novamente o deploy nessa branch.

A primeira extração modular move o JavaScript do painel administrativo para `painel.js`. Preserve a ordem de carregamento de Supabase, configuração e painel. As próximas extrações devem manter contratos de armazenamento e autorização e entrar separadamente, começando por módulos que já tenham cobertura.

## Ensaio de recuperação

`PG_BIN=/caminho/postgresql/17/bin bash tools/ensaiar-recuperacao.sh` cria um servidor PostgreSQL descartável sem listener de rede, executa as migrations, sem o bootstrap operacional de administrador, e usa apenas dados sintéticos. Requer PostgreSQL 17, OpenSSL e execução como usuário não root. O tempo exibido mede somente esse ensaio. Ele verifica dump, criptografia, decriptação, restauração, identidade sintética, vínculo, documento, auditoria e RLS.

O workflow `Backup diário do banco (produção)` referencia segredos de produção. O ensaio usa um dump dos esquemas `auth` e `public` e credenciais descartáveis. Ele não valida o catálogo, as permissões ou os artefatos dos backups remotos. Fluxos Supabase Auth, objetos do Storage, restauração ponto a ponto e recuperação num projeto Supabase descartável precisam de validações próprias antes de assumir metas de RPO/RTO.

## Validação comercial

Antes do piloto, valide cada tipo de empresa com identidade sintética e dados separados. Acompanhe cadastro por convite, expiração e reenvio, habilitação do módulo correto, isolamento entre empresas, atendimento e coleta de erros. Meça taxa de ativação e tempo para concluir o primeiro fluxo de valor. O piloto também depende de definir planos, cobrança e processo de suporte.
