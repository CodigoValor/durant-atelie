# Autenticação e acesso protegido

O Alinhavo é uma SPA estática com navegação por fragmentos (`#clientes`, `#pedidos` etc.). O HTML e os arquivos JavaScript são públicos. A interface exige uma identidade validada e vínculo com a empresa; a proteção dos dados é aplicada pelo Supabase com permissões, RLS e validações das RPCs.

## Fluxo

1. O adaptador recupera os tokens com `getSession()` e valida a identidade no servidor com `getUser()`, antes de consultar os dados da empresa.
2. Sessões ausentes ou rejeitadas por autenticação voltam ao login. Falhas de conexão mantêm a entrada bloqueada.
3. Os vínculos de empresa são consultados sob RLS. Uma empresa lembrada no aparelho só é usada se ainda estiver na lista autorizada.
4. Só depois dessas verificações `SB.autenticado` é ativado e o aplicativo recebe a coleção de dados.
5. `SIGNED_OUT` ou uma mudança de identidade bloqueiam imediatamente a interface, limpam os elementos internos e recarregam a página. A renovação de tokens do mesmo usuário não interrompe o trabalho.
6. O logout explícito bloqueia a interface antes de chamar o Supabase. Se falhar, mostra uma opção para tentar novamente, sem reabrir o aplicativo.
7. As operações do adaptador sobre `reg` e a reserva de números também verificam o contexto de acesso.

O callback de `onAuthStateChange` não aguarda chamadas ao SDK, para evitar locks de autenticação. O contador de eventos impede concluir uma entrada que sofreu logout durante a validação/carregamento.

## Verificação

Execute `node tests/auth.cjs`. Os testes usam Supabase e DOM simulados, sem novas dependências, e cobrem identidade validada, sessão ausente/revogada, falha de rede, falta de vínculo, logout em outra aba, troca de usuário, renovação, corrida durante a entrada e falha de logout.

A suíte de navegador existente continua em `npm run test:e2e`; ela deve ser executada em um ambiente com Node e Playwright. Os testes simulados não substituem um teste de login real no navegador.

Na inspeção do projeto de homologação, `empresas`, `membros` e `reg` estavam com RLS ativo e sem privilégios de SELECT/INSERT/UPDATE/DELETE para `anon`. As políticas e RPCs existentes não foram alteradas.

## Limites

A interface é uma camada de experiência de uso. Ela não substitui a autorização do banco; uma revogação de vínculo precisa continuar sendo imposta pelas políticas/RPCs. Encerrar sessões não invalida imediatamente todos os JWTs já emitidos. Não foram adicionadas rotas de servidor nem alterações de configuração do provedor Auth.

As mudanças foram preparadas a partir da branch `homologacao`. A produção exige o fluxo de revisão e promoção descrito no README.
