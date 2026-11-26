-- Painel da plataforma exige verificação em duas etapas (TOTP, nível aal2 do Supabase Auth).
-- Sem o segundo fator, a pessoa pode ser administradora cadastrada, mas _eh_plataforma() é falso
-- e nenhuma função da plataforma responde. Quem decide é o servidor, não a tela.

create or replace function public._aal2() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
$$;
revoke all on function public._aal2() from public, anon, authenticated;

create or replace function public._eh_plataforma() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public._aal2() and exists (select 1 from public.plataforma_admins p where p.user_id = (select auth.uid()))
$$;
revoke all on function public._eh_plataforma() from public, anon, authenticated;

-- A tela precisa saber se a pessoa é administradora cadastrada (para pedir o segundo fator
-- em vez de "sem acesso"). Responde só sobre quem está logado; não revela ninguém.
create or replace function public.plataforma_admin_cadastrado() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.plataforma_admins p where p.user_id = (select auth.uid()))
$$;
revoke all on function public.plataforma_admin_cadastrado() from public, anon;
grant execute on function public.plataforma_admin_cadastrado() to authenticated;

-- Administradores da plataforma (inclui o administrador de emergência). Só com 2FA.
create or replace function public.plataforma_admins_listar() returns table (user_id uuid, email text, eu boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query select p.user_id, u.email::text, p.user_id = (select auth.uid())
    from public.plataforma_admins p join auth.users u on u.id = p.user_id order by u.email;
end $$;
revoke all on function public.plataforma_admins_listar() from public, anon;
grant execute on function public.plataforma_admins_listar() to authenticated;

create or replace function public.plataforma_admin_adicionar(p_email text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_id is null then raise exception 'essa pessoa ainda não tem conta: peça para ela entrar uma vez no sistema'; end if;
  insert into public.plataforma_admins (user_id) values (v_id) on conflict do nothing;
  perform public._audit_acao(null, 'insert', 'plataforma_admins', v_id::text, jsonb_build_object('email', lower(btrim(p_email))));
end $$;
revoke all on function public.plataforma_admin_adicionar(text) from public, anon;
grant execute on function public.plataforma_admin_adicionar(text) to authenticated;

create or replace function public.plataforma_admin_remover(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'você não pode remover o próprio acesso'; end if;
  if (select count(*) from public.plataforma_admins) <= 1 then raise exception 'precisa sobrar ao menos um administrador'; end if;
  delete from public.plataforma_admins where user_id = p_user;
  perform public._audit_acao(null, 'delete', 'plataforma_admins', p_user::text, null);
end $$;
revoke all on function public.plataforma_admin_remover(uuid) from public, anon;
grant execute on function public.plataforma_admin_remover(uuid) to authenticated;
