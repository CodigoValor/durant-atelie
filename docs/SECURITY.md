# Política de segurança — proposta
Escopo: Alinhavo, seus ambientes, integrações e agentes. Complementa a política AGENTS.md em revisão no PR #2. Não declara conformidade certificada.

## Princípios
Menor privilégio, separação de ambientes, autorização no servidor, proteção de dados pessoais, revisão independente e rastreabilidade. RLS habilitada não garante isolamento: testar ações autorizadas e negadas por papel e empresa, inclusive RPC. MFA para contas administrativas onde disponível. Nunca expor segredos, tokens, dados de clientes ou vulnerabilidades exploráveis em canal público.

## Comunicação responsável
Reportar suspeitas diretamente ao proprietário por canal privado já autorizado; não abrir issue pública com detalhes técnicos exploráveis. Canal oficial de segurança ainda depende de definição do proprietário. Registrar impacto, evidências mínimas, contenção proposta e responsável. Não executar correções em produção sem autorização específica.

## Controles a validar
Inventário de credenciais e integrações (GitHub, Supabase, Vercel, Resend), privilégios mínimos, rotação, dependências e vendor, logs e retenção, análise de exposição, políticas de autorização e testes de regressão. Verificar restauração isolada com dados sintéticos e cobertura de backup, incluindo identidade e armazenamento quando aplicável.

## Privacidade
Minimizar coleta e acesso; documentar finalidade, base legal, retenção e atendimento aos titulares com apoio jurídico. Não afirmar conformidade LGPD sem avaliação apropriada. Não usar dados reais em homologação.
