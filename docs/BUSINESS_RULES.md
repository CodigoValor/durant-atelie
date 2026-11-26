# Regras de negócio — inventário inicial
Fonte: README e migrations 0001, 0025 e 0026, homologacao @ 40c79c2. Regras a seguir não constituem inventário integral; validar com proprietário e testes.

## Empresas e acesso
Empresas possuem tipos ateliê, alfaiataria e loja de tecido no fluxo de convite de nova empresa. A criação pelo fluxo da plataforma requer autorização administrativa. A aceitação exige autenticação, convite válido, pendente e não expirado e correspondência de e-mail. Cria empresa quando necessário e associa membro ao papel previsto. Convites aceitos não devem ser reutilizados.

## Convites e comunicação
A migration 0026 introduz envio de e-mail e alternativa de link na tela. O limite definido é três solicitações de envio por convite, com intervalo mínimo de um minuto. O contador registra solicitações autorizadas antes do resultado do provedor; não equivale a confirmação de entrega. Não afirmar que uma mensagem foi entregue com base somente no contador. Validar falhas, reenvios e experiência do usuário.

## Gestão operacional
A base armazena documentos por empresa e tipo de registro. Existem módulos de parceiros, numeração e tecidos e testes dedicados. Regras detalhadas de pedidos, medidas, preços, produção, estoque, aprovações e permissões por papel precisam de levantamento específico; não inferir automaticamente a partir de nomes de arquivos.

## Decisões comerciais pendentes
Planos, limites, cobrança, tabela de preços por ateliê e vínculos comerciais entre empresas devem ser aprovados pelo proprietário. Não converter hipóteses em regras implementadas sem especificação e critérios de aceite.
