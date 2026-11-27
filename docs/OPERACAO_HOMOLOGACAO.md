# Operação da homologação do Alinhavo

**Ambiente** — branch `homologacao`, projeto Supabase Homologação - Alinhavo e aliases `homolog.henriquedurant.com` e `painel-homolog.henriquedurant.com` na Vercel. Antes de escrever, confirme o projeto de banco e a branch do deploy pelo painel ou conector.

## Publicação estática e verificação

`node tools/build-vercel.mjs` publica em `dist/` somente as páginas, scripts e imagens necessários. A aplicação e o painel devem retornar 200, carregar o JavaScript e apontar para o banco de homologação. Uma migration SQL usada como controle deve retornar 404 no deploy. A cada atualização de `homologacao`, o GitHub Actions aguarda a versão esperada nos dois aliases e sinaliza falha se o deploy não passar. O check compara `versao.json` com o SHA do push. Execute `node tools/smoke-homologacao.mjs` para verificar manualmente a versão disponível. A entrega de notificações do GitHub depende das preferências dos mantenedores. Esse check é acionado por deploy e não mede disponibilidade entre publicações. Para reverter o build, reverta o commit em homologação e verifique novamente o deploy nessa branch.

A primeira extração modular move o JavaScript do painel administrativo para `painel.js`. Preserve a ordem de carregamento de Supabase, configuração e painel. As próximas extrações devem manter contratos de armazenamento e autorização e entrar separadamente, começando por módulos que já tenham cobertura.

## Ensaio de recuperação

`PG_BIN=/caminho/postgresql/17/bin bash tools/ensaiar-recuperacao.sh` cria um servidor PostgreSQL descartável sem listener de rede, executa as migrations, sem o bootstrap operacional de administrador, e usa apenas dados sintéticos. Requer PostgreSQL 17, OpenSSL e execução como usuário não root. O tempo exibido mede somente esse ensaio. Ele verifica dump, criptografia, decriptação, restauração, identidade sintética, vínculo, documento, auditoria e RLS.

O ensaio restaura um dump completo dos esquemas sintéticos e também um backup em SQL somente de dados, compactado e criptografado no formato operacional. Esse segundo caso usa as tabelas selecionadas no workflow de backup e pressupõe schema e identidades preparados no destino. Os gatilhos de aplicação são desabilitados apenas durante a transação do banco descartável. As restrições de chaves estrangeiras ficam ativas. A verificação cobre dois administradores de empresas distintas, usuário comum e identidade sem vínculo.

O ensaio usa credenciais descartáveis e não executa o workflow que referencia segredos de produção. A recuperação de identidades mantidas pelo Supabase Auth, objetos do Storage, mecanismos de restauração ponto a ponto e os artefatos remotos precisam de validações próprias antes de assumir metas de RPO/RTO.

## Validação comercial

Antes do piloto, valide cada tipo de empresa com identidade sintética e dados separados. Acompanhe cadastro por convite, expiração e reenvio, habilitação do módulo correto, isolamento entre empresas, atendimento e coleta de erros. Meça taxa de ativação e tempo para concluir o primeiro fluxo de valor. O piloto também depende de definir planos, cobrança e processo de suporte.
