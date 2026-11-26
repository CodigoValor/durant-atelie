# Governança do GitHub — proposta de implantação
Status: proposta, não configuração ativa. Relacionado à issue #3 e aos PRs #2 e #9.

## Objetivo
Separar autoria, revisão, homologação e release. Preservar a operação atual e exigir autorização explícita para produção.

## Sequência
1. Confirmar plano do GitHub, visibilidade, permissões administrativas, identidade dos agentes, integrações Vercel e Supabase e efeitos de eventual privatização. Não alterar visibilidade sem autorização.
2. Revisar e incorporar template e CODEOWNERS em homologação; validar reconhecimento dos arquivos. O template pode depender de sua presença na branch padrão; não promover apenas para ativá-lo sem autorização.
3. Completar CI (#4) com lockfile, execução verde em PR e verificação de isolamento. Não exigir check inexistente ou nunca executado.
4. Preparar regras para homologacao: PR obrigatório, bloquear exclusão e force push, exigir resolução de conversas e check de regressão comprovado. Exigir aprovação independente quando houver identidade habilitada distinta do autor. Não habilitar gate que torne impossível uma aprovação legítima; resolver identidade antes.
5. Preparar regras para main: PR obrigatório, bloquear exclusão e force push, revisão independente, restringir bypass, checks próprios para PRs de release (o workflow proposto atualmente só roda para homologacao). Exigir autorização do proprietário vinculada à release. Não ativar configuração administrativa sem autorização específica.
6. Validar em branch descartável que push direto, force push e merge sem requisitos são rejeitados; confirmar caminho autorizado. Registrar evidências. Não testar escrita em main.
7. Revisar proteção de segredos, ambientes de backup, permissões de deploy e acesso direto ao banco separadamente; branch protection não controla operações externas ao GitHub.

## Identidade e aprovação
CODEOWNERS inicialmente aponta para o proprietário do repositório. Se o PR for criado sob a mesma identidade, ele não poderá satisfazer a aprovação independente sozinho. Parecer de outro agente é revisão técnica, não necessariamente aprovação reconhecida pelo GitHub. Identificar revisor distinto com acesso adequado antes de ativar exigência. Não criar contas artificiais ou contornar gates.

## Critérios de aceite
- Configuração efetiva verificada por leitura e testes em branch descartável.
- CI estável e checks com nome confirmado; nenhum segredo de produção nos testes.
- Acesso Vercel preservado; publicação de produção continua dependente de autorização.
- Procedimento de reversão administrativa documentado: proprietário autorizado restaura configuração anterior se houver bloqueio, registra motivo e revalida; não usar bypass silencioso.

## Estado inicial
Branches main e homologacao retornaram protected=false na consulta de 26/11/2026. Isso não comprova ausência de todas as possíveis regras externas. Plano, regras efetivas e permissões administrativas ainda precisam de confirmação. Nenhuma regra foi ativada por este documento.
