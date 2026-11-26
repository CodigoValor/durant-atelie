# Inventário inicial do banco
Fonte: esquema public de homologação consultado em 26/11/2026 e migration 0001. Somente metadados; não contém registros de clientes. A lista não representa confirmação de paridade com produção.

| Grupo | Tabelas | Finalidade |
|---|---|---|
| Identidade e acesso | empresas, membros, pessoas, plataforma_admins, login_cpf_falhas | Empresas, vínculos, identidade e controle de acesso |
| Convites | convites | Onboarding, status e metadados de envio |
| Gestão operacional | reg, contadores | Registros genéricos e numeração |
| Auditoria | audit_log | Histórico de operações |
| Tecidos | tec_catalogo, tec_destinos, tec_loja_clientes, tec_lojas, tec_mensagens, tec_pedido_itens, tec_pedidos, tec_vendedores | Operação de fornecimento e pedidos |

17 tabelas públicas identificadas. A consulta anterior de metadados confirmou RLS habilitada em todas; isso não demonstra correção das políticas nem segurança das funções privilegiadas.

## Relacionamentos confirmados na base
empresas.id identifica empresa; membros associa auth.users.id a empresas.id, com chave composta user_id + empresa_id; reg usa chave empresa_id + id e referência à empresa. Campos k, i, n e j representam registros genéricos; j é texto, não jsonb. A tabela reg também tem criado_por no esquema atual. Os campos de identificação dos módulos de tecidos indicam vínculos entre pedidos, itens, lojas e catálogo; as constraints completas ainda precisam ser inventariadas.

## Gestão de mudanças
Migrations versionadas em supabase/migrations; números não consecutivos não provam ausência de migração. Comparar histórico efetivo antes de aplicar. Testar banco limpo e atualização incremental com dados sintéticos. Não migrar nem restaurar produção sem autorização específica.

## Pendências
Catálogo completo de colunas, constraints, índices, funções, grants, políticas e dependências; classificação de dados e retenção; testes de isolamento por operação; revisão de cobertura de backup e recuperação. Não publicar detalhes exploráveis nem dados pessoais em issues.
