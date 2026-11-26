# Arquitetura do Alinhavo
Inventário inicial: homologacao @ 40c79c2, README, vercel.json, árvore do repositório e esquema de homologação consultado em 26/11/2026. Não é auditoria completa do código.

## Arquitetura atual
Aplicação web estática sem build: index.html concentra a maior parte do sistema; painel.html é o painel administrativo; tecidos/index.html e tecidos/pedido.html são interfaces adicionais. adapter.js integra persistência; config.js seleciona ambiente; vendor/supabase.js fornece cliente. Vercel entrega arquivos e reescreve a raiz dos hosts do painel. Supabase fornece Auth, PostgreSQL, RLS e RPC; Edge Functions login-cpf e enviar-convite estão versionadas. Resend integra comunicação transacional. GitHub Actions contém rotina de backup; CI de regressão está proposta no PR #9.

Fluxo conceitual: navegador → Vercel (arquivos estáticos) → Supabase (Auth/API/RPC) → PostgreSQL; envio de convite → Edge Function → serviço de e-mail. A autorização efetiva deve residir no backend, não nos controles visuais.

## Ambientes
main representa produção; homologacao representa teste. Projetos de banco separados. config.js escolhe o ambiente por lista de hosts; conferir também projeto e alvo efetivos antes de operar. Dados reais não entram em homologação. Nenhuma promoção sem autorização expressa.

## Evolução proposta
Monólito modular incremental: separar apresentação, domínio, persistência e integrações, com limites claros entre identidade, gestão operacional, parceiros, tecidos e administração. Introduzir contratos e testes antes de extrair componentes do index.html. Avaliar modelagem relacional para registros críticos sem quebrar compatibilidade. Não decidir framework novo ou microsserviços sem análise de custo, risco e benefício.

## Lacunas
Mapear dependências internas, contratos RPC, fluxos de erro e desempenho; validar comportamento real de cada ambiente; registrar decisões arquiteturais em ADRs. A topologia descrita não comprova capacidade de carga nem disponibilidade.
