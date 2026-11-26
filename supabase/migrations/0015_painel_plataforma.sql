-- 0015 — Painel de controle do Alinhavo (só administrador da plataforma) e suspensão de empresa.
-- Suspender = a empresa some do acesso de todos os usuários (nada é apagado). Vale para todas as tabelas, porque
-- as regras de linha (RLS) leem `membros`, e a regra de leitura de `membros` passa a esconder empresas suspensas.
alter table public.empresas add column if not exists ativa boolean not null default true;
alter table public.empresas add column if not exists suspensa_em timestamptz;

create or replace function public.empresa_ativa(p_emp uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select e.ativa from public.empresas e where e.id = p_emp), false)
$$;
revoke all on function public.empresa_ativa(uuid) from public, anon;
grant execute on function public.empresa_ativa(uuid) to authenticated;

drop policy if exists membros_ler_proprio on public.membros;
create policy membros_ler_proprio on public.membros for select to authenticated
  using (user_id = (select auth.uid()) and public.empresa_ativa(empresa_id));

create or replace function public.papel_em(p_emp uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.papel from public.membros m where m.user_id = (select auth.uid()) and m.empresa_id = p_emp and public.empresa_ativa(p_emp)
$$;

-- Lista das empresas (só plataforma)
create or replace function public.plataforma_empresas() returns table (
  id uuid, nome text, cnpj text, cadastro jsonb, vende boolean, produz boolean, fornece boolean, so_tecidos boolean,
  ativa boolean, criado_em timestamptz, usuarios integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select e.id, e.nome, e.cnpj, e.cadastro, e.vende_cliente_final, e.produz, e.fornece_tecido, e.somente_tecidos,
           e.ativa, e.criado_em, (select count(*)::int from public.membros m where m.empresa_id = e.id)
      from public.empresas e order by e.criado_em, e.nome;
end $$;

-- Usuários de uma empresa (só plataforma)
create or replace function public.plataforma_usuarios(p_empresa uuid) returns table (email text, papel text, criado_em timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query select u.email::text, m.papel, m.criado_em from public.membros m join auth.users u on u.id = m.user_id
                where m.empresa_id = p_empresa order by m.criado_em;
end $$;

-- Suspender / reativar (só plataforma). Nunca apaga dados.
create or replace function public.plataforma_definir_ativa(p_empresa uuid, p_ativa boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.empresas set ativa = coalesce(p_ativa, true), suspensa_em = case when coalesce(p_ativa, true) then null else now() end where id = p_empresa;
  if not found then raise exception 'empresa inexistente' using errcode = 'P0002'; end if;
  perform public._audit_acao(p_empresa, 'update', 'empresa', p_empresa::text, jsonb_build_object('ativa', coalesce(p_ativa, true)));
end $$;

revoke all on function public.plataforma_empresas(), public.plataforma_usuarios(uuid), public.plataforma_definir_ativa(uuid, boolean) from public, anon;
grant execute on function public.plataforma_empresas(), public.plataforma_usuarios(uuid), public.plataforma_definir_ativa(uuid, boolean) to authenticated;
