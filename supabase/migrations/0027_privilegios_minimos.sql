-- Somente funções auxiliares com referências qualificadas ou funções nativas.
alter function public._cfg_publico_campos() set search_path = pg_catalog, pg_temp;
alter function public._chaves_privadas() set search_path = pg_catalog, pg_temp;
alter function public._sem_chaves(jsonb, text[]) set search_path = pg_catalog, pg_temp;
alter function public._audit_json_ou_nulo(text) set search_path = pg_catalog, pg_temp;
alter function public.audit_log_imutavel() set search_path = pg_catalog, pg_temp;
alter function public._audit_json(text) set search_path = pg_catalog, pg_temp;
alter function public.kinds_parceiro() set search_path = pg_catalog, pg_temp;
alter function public._novo_token() set search_path = pg_catalog, pg_temp;
alter function public._hash_token(text) set search_path = pg_catalog, pg_temp;
alter function public._cpf_ok(text) set search_path = pg_catalog, pg_temp;

-- O acionador gerenciado pelo Supabase permanece habilitado.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- O painel usa a assinatura de cinco parâmetros e exige um tipo explícito.
revoke execute on function public.criar_convite_empresa(text, text, boolean, boolean)
  from public, anon, authenticated;

create or replace function public.empresa_ativa(p_emp uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from public.empresas e join public.membros m on m.empresa_id = e.id
    where e.id = p_emp and e.ativa and m.user_id = (select auth.uid())
  )
$$;

create or replace function public.tec_liberado(p_cliente uuid, p_loja uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select (public.tec_equipe(p_cliente) or public.tec_equipe(p_loja)) and exists (
    select 1 from public.tec_loja_clientes v
    where v.cliente_empresa_id = p_cliente and v.loja_empresa_id = p_loja and v.status = 'liberado'
  )
$$;
