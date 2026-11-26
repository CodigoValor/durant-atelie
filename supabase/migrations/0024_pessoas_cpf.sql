-- Cadastro único de pessoa (CPF único) e apoio ao login por CPF.
-- A pessoa é a conta de login (auth.users); o CPF identifica a pessoa em todas as empresas dela.

create or replace function public._cpf_ok(c text) returns boolean
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(c, ''), '\D', '', 'g'); s int; r int; i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;

create table if not exists public.pessoas (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  cpf       text not null unique check (cpf ~ '^[0-9]{11}$'),
  nome      text,
  criado_em timestamptz not null default now()
);
alter table public.pessoas enable row level security;
revoke all on public.pessoas from anon, authenticated;

create or replace function public.minha_pessoa() returns table (cpf text, nome text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.cpf, p.nome from public.pessoas p where p.user_id = (select auth.uid())
$$;
revoke all on function public.minha_pessoa() from public, anon;
grant execute on function public.minha_pessoa() to authenticated;

create or replace function public.salvar_minha_pessoa(p_cpf text, p_nome text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  if (select auth.uid()) is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not public._cpf_ok(v_cpf) then raise exception 'CPF inválido'; end if;
  begin
    insert into public.pessoas (user_id, cpf, nome) values ((select auth.uid()), v_cpf, nullif(btrim(coalesce(p_nome, '')), ''))
    on conflict (user_id) do update set cpf = excluded.cpf, nome = coalesce(excluded.nome, public.pessoas.nome);
  exception when unique_violation then
    raise exception 'este CPF já está cadastrado em outra conta';
  end;
end $$;
revoke all on function public.salvar_minha_pessoa(text, text) from public, anon;
grant execute on function public.salvar_minha_pessoa(text, text) to authenticated;

-- Login por CPF: só a função de servidor (service_role) consulta. Nunca exposta ao navegador.
create table if not exists public.login_cpf_falhas (
  cpf text primary key, falhas int not null default 0, bloqueado_ate timestamptz
);
alter table public.login_cpf_falhas enable row level security;
revoke all on public.login_cpf_falhas from anon, authenticated;

create or replace function public.login_cpf_email(p_cpf text) returns table (email text, bloqueado boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.email::text, coalesce(f.bloqueado_ate > now(), false)
  from public.pessoas p join auth.users u on u.id = p.user_id
  left join public.login_cpf_falhas f on f.cpf = p.cpf
  where p.cpf = regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')
$$;
create or replace function public.login_cpf_falha(p_cpf text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  if not exists (select 1 from public.pessoas where cpf = v) then return; end if;
  insert into public.login_cpf_falhas (cpf, falhas) values (v, 1)
  on conflict (cpf) do update set falhas = case when public.login_cpf_falhas.bloqueado_ate is not null and public.login_cpf_falhas.bloqueado_ate <= now() then 1 else public.login_cpf_falhas.falhas + 1 end;
  update public.login_cpf_falhas set bloqueado_ate = now() + interval '15 minutes', falhas = 0 where cpf = v and falhas >= 5;
end $$;
create or replace function public.login_cpf_ok(p_cpf text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.login_cpf_falhas where cpf = regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')
$$;
revoke all on function public.login_cpf_email(text), public.login_cpf_falha(text), public.login_cpf_ok(text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.login_cpf_email(text), public.login_cpf_falha(text), public.login_cpf_ok(text) to service_role;
  end if;
end $$;
