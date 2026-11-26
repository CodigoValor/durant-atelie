-- Durant Ateliê — perfil de negócio da empresa (cole inteiro no SQL Editor e clique em Run)
-- Uma empresa pode VENDER ao cliente final (ponto de venda), PRODUZIR (receber pedidos de produção), ou os dois.
-- Por ora só registra o perfil; as telas passam a usá-lo nas próximas fatias.
alter table public.empresas add column if not exists vende_cliente_final boolean not null default true;
alter table public.empresas add column if not exists produz boolean not null default false;

-- Conferência: lista as empresas com o perfil de cada uma
select nome, vende_cliente_final, produz from public.empresas order by nome;
