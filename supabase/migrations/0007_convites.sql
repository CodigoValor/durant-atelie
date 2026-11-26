-- Alinhavo — convites e acessos (cole inteiro no SQL Editor e clique em Run)
-- 1) Cadastro SOMENTE POR CONVITE: ninguém cria conta nem empresa sem um convite válido.
-- 2) Convite de EMPRESA NOVA: só o administrador da plataforma (o Luiz) cria; quem aceita vira administrador da empresa nova.
-- 3) Convite de USUÁRIO: o administrador de uma empresa convida pessoas como admin, usuário ou parceiro.
-- 4) Proteção do último administrador de cada empresa.
-- O link do convite leva um código secreto; o banco guarda só o "hash" dele (quem ler a tabela não consegue montar um link).
-- Convite vale 7 dias, é para UM e-mail e só funciona uma vez.
--
-- ATENÇÃO (Supabase): para o convite funcionar, ligue "Allow new users to sign up" em Authentication > Sign In / Providers.
-- Mesmo ligado, o gatilho abaixo recusa qualquer cadastro cujo e-mail não tenha convite pendente.
-- Consequência: para criar um usuário "na mão" pelo painel do Supabase, crie antes o convite desse e-mail (ou desligue o gatilho
-- por um momento: alter table auth.users disable trigger so_com_convite;  ... depois: enable trigger so_com_convite;).
-- Depende de 0001 (base), 0003 (audit_log), 0004 (perfil da empresa) e 0005 (papel_em). Roda de novo sem quebrar.

-- 1) Administradores da plataforma -----------------------------------------------
create table if not exists public.plataforma_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.plataforma_admins enable row level security;
revoke all on public.plataforma_admins from anon, authenticated;
insert into public.plataforma_admins (user_id)
select u.id from auth.users u where lower(u.email) = 'hd@henriquedurant.com'
on conflict do nothing;

-- 2) Convites ---------------------------------------------------------------------
create table if not exists public.convites (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid references public.empresas (id) on delete cascade,   -- nulo = convite para CRIAR uma empresa nova
  email        text not null check (email = lower(btrim(email)) and length(email) between 5 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  papel        text not null check (papel in ('admin', 'usuario', 'parceiro')),
  empresa_nome text check (empresa_nome is null or length(btrim(empresa_nome)) between 2 and 120),
  vende        boolean,
  produz       boolean,
  token_hash   text not null unique,
  status       text not null default 'pendente' check (status in ('pendente', 'aceito', 'cancelado')),
  expira_em    timestamptz not null default now() + interval '7 days',
  criado_por   uuid,
  criado_em    timestamptz not null default now(),
  aceito_em    timestamptz,
  aceito_por   uuid,
  check (empresa_id is not null or (empresa_nome is not null and papel = 'admin'))
);
create index if not exists convites_empresa_idx on public.convites (empresa_id, status);
create index if not exists convites_email_idx on public.convites (email, status);
alter table public.convites enable row level security;     -- sem política e sem permissão: só as funções abaixo mexem
revoke all on public.convites from anon, authenticated;

-- 3) Apoio -----------------------------------------------------------------------
create or replace function public._email_logado() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(u.email) from auth.users u where u.id = (select auth.uid())
$$;
create or replace function public._eh_plataforma() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.plataforma_admins p where p.user_id = (select auth.uid()))
$$;
create or replace function public._novo_token() returns text
language sql volatile as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;
create or replace function public._hash_token(t text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(t, ''), 'utf8')), 'hex') $$;
create or replace function public._audit_acao(p_emp uuid, p_acao text, p_k text, p_id text, p_depois jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ip text;
begin
  begin
    v_ip := nullif(btrim(split_part(coalesce((current_setting('request.headers', true))::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then v_ip := null;
  end;
  insert into public.audit_log (empresa_id, user_id, acao, k, reg_id, depois, ip)
  values (coalesce(p_emp, '00000000-0000-0000-0000-000000000000'::uuid), (select auth.uid()), p_acao, p_k, p_id, p_depois, v_ip);
end $$;
revoke all on function public._email_logado() from public, anon, authenticated;
revoke all on function public._eh_plataforma() from public, anon, authenticated;
revoke all on function public._novo_token() from public, anon, authenticated;
revoke all on function public._hash_token(text) from public, anon, authenticated;
revoke all on function public._audit_acao(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- 4) Criar convite de USUÁRIO (administrador da empresa) — devolve o código do link, uma única vez ------
create or replace function public.criar_convite(p_empresa uuid, p_email text, p_papel text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_token text; v_id uuid;
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'só o administrador da empresa convida' using errcode = '42501'; end if;
  if p_papel not in ('admin', 'usuario', 'parceiro') then raise exception 'papel inválido'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'e-mail inválido'; end if;
  if exists (select 1 from public.membros m join auth.users u on u.id = m.user_id
              where m.empresa_id = p_empresa and lower(u.email) = v_email) then
    raise exception 'essa pessoa já tem acesso a esta empresa';
  end if;
  update public.convites set status = 'cancelado'                                   -- um convite pendente por pessoa e empresa
   where empresa_id = p_empresa and email = v_email and status = 'pendente';
  v_token := public._novo_token();
  insert into public.convites (empresa_id, email, papel, token_hash, criado_por)
  values (p_empresa, v_email, p_papel, public._hash_token(v_token), (select auth.uid())) returning id into v_id;
  perform public._audit_acao(p_empresa, 'insert', 'convite', v_id::text, jsonb_build_object('email', v_email, 'papel', p_papel));
  return v_token;
end $$;

-- 5) Criar convite de EMPRESA NOVA (só administrador da plataforma) -------------------------------------
create or replace function public.criar_convite_empresa(p_email text, p_empresa_nome text, p_vende boolean, p_produz boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_nome text := btrim(coalesce(p_empresa_nome, '')); v_token text; v_id uuid;
begin
  if not public._eh_plataforma() then raise exception 'só o administrador da plataforma cria empresas' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'e-mail inválido'; end if;
  if length(v_nome) < 2 or length(v_nome) > 120 then raise exception 'nome da empresa inválido (2 a 120 letras)'; end if;
  if not coalesce(p_vende, true) and not coalesce(p_produz, false) then raise exception 'a empresa precisa vender ao cliente final, produzir, ou os dois'; end if;
  update public.convites set status = 'cancelado'
   where empresa_id is null and email = v_email and empresa_nome = v_nome and status = 'pendente';
  v_token := public._novo_token();
  insert into public.convites (empresa_id, email, papel, empresa_nome, vende, produz, token_hash, criado_por)
  values (null, v_email, 'admin', v_nome, coalesce(p_vende, true), coalesce(p_produz, false), public._hash_token(v_token), (select auth.uid()))
  returning id into v_id;
  perform public._audit_acao(null, 'insert', 'convite', v_id::text, jsonb_build_object('email', v_email, 'empresa', v_nome, 'tipo', 'empresa_nova'));
  return v_token;
end $$;

-- 6) Cancelar ------------------------------------------------------------------------------------------
create or replace function public.cancelar_convite(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites;
begin
  select * into c from public.convites where id = p_id for update;
  if not found then raise exception 'convite não encontrado'; end if;
  if not ((c.empresa_id is not null and public.papel_em(c.empresa_id) = 'admin') or (c.empresa_id is null and public._eh_plataforma())) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if c.status <> 'pendente' then raise exception 'este convite não está pendente'; end if;
  update public.convites set status = 'cancelado' where id = p_id;
  perform public._audit_acao(c.empresa_id, 'update', 'convite', p_id::text, jsonb_build_object('status', 'cancelado'));
end $$;

-- 7) Listas para a tela de administração -------------------------------------------------------
create or replace function public.listar_convites(p_empresa uuid default null)
returns table (id uuid, email text, papel text, empresa_nome text, status text, estado text, expira_em timestamptz, criado_em timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_empresa is null then
    if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  elsif public.papel_em(p_empresa) is distinct from 'admin' then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select c.id, c.email, c.papel, c.empresa_nome, c.status,
           case c.status when 'aceito' then 'usado' when 'cancelado' then 'cancelado'
                else case when c.expira_em < now() then 'expirado' else 'valido' end end,
           c.expira_em, c.criado_em
      from public.convites c
     where (p_empresa is null and c.empresa_nome is not null)          -- convites de empresa nova, inclusive os já aceitos
        or (p_empresa is not null and c.empresa_id = p_empresa)
     order by c.criado_em desc limit 200;
end $$;

create or replace function public.listar_membros(p_empresa uuid)
returns table (user_id uuid, email text, papel text, desde timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select m.user_id, lower(u.email)::text, m.papel, m.criado_em
      from public.membros m join auth.users u on u.id = m.user_id
     where m.empresa_id = p_empresa order by m.criado_em;
end $$;

-- 8) Quem recebeu o link vê para onde foi convidado (sem login; e-mail mascarado) ----------------------
create or replace function public.convite_info(p_token text)
returns table (valido boolean, email_mascarado text, empresa_nome text, papel text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites; v_nome text;
begin
  select * into c from public.convites where token_hash = public._hash_token(p_token);
  if not found or c.status <> 'pendente' or c.expira_em < now() then
    return query select false, null::text, null::text, null::text; return;
  end if;
  select coalesce(c.empresa_nome, e.nome) into v_nome from (select 1) x left join public.empresas e on e.id = c.empresa_id;
  return query select true, left(split_part(c.email, '@', 1), 2) || '***@' || split_part(c.email, '@', 2), v_nome, c.papel;
end $$;

-- 9) Aceitar (já logado, com o MESMO e-mail do convite) ------------------------------------------------
create or replace function public.aceitar_convite(p_token text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites; v_emp uuid;
begin
  if (select auth.uid()) is null then raise exception 'entre na sua conta para aceitar o convite' using errcode = '42501'; end if;
  select * into c from public.convites where token_hash = public._hash_token(p_token) for update;
  if not found or c.status <> 'pendente' or c.expira_em < now() then raise exception 'convite inválido ou expirado'; end if;
  if public._email_logado() is distinct from c.email then raise exception 'este convite é para outro e-mail'; end if;
  if c.empresa_id is null then
    insert into public.empresas (nome, vende_cliente_final, produz)
    values (btrim(c.empresa_nome), coalesce(c.vende, true), coalesce(c.produz, false)) returning id into v_emp;
  else
    v_emp := c.empresa_id;
  end if;
  insert into public.membros (user_id, empresa_id, papel) values ((select auth.uid()), v_emp, c.papel)
  on conflict (user_id, empresa_id) do nothing;
  update public.convites set status = 'aceito', aceito_em = now(), aceito_por = (select auth.uid()), empresa_id = v_emp where id = c.id;
  perform public._audit_acao(v_emp, 'update', 'convite', c.id::text, jsonb_build_object('status', 'aceito', 'papel', c.papel));
  return v_emp;
end $$;

-- 10) Papéis e remoção de pessoas (só admin da empresa) -----------------------------------------------
create or replace function public.alterar_papel(p_empresa uuid, p_user uuid, p_papel text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'só o administrador altera papéis' using errcode = '42501'; end if;
  if p_papel not in ('admin', 'usuario', 'parceiro') then raise exception 'papel inválido'; end if;
  update public.membros set papel = p_papel where empresa_id = p_empresa and user_id = p_user;
  if not found then raise exception 'pessoa não encontrada nesta empresa'; end if;
  perform public._audit_acao(p_empresa, 'update', 'membro', p_user::text, jsonb_build_object('papel', p_papel));
end $$;

create or replace function public.remover_membro(p_empresa uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'só o administrador remove pessoas' using errcode = '42501'; end if;
  delete from public.membros where empresa_id = p_empresa and user_id = p_user;
  if not found then raise exception 'pessoa não encontrada nesta empresa'; end if;
  perform public._audit_acao(p_empresa, 'delete', 'membro', p_user::text, null);
end $$;

-- 11) Nunca deixar uma empresa sem administrador ------------------------------------------------------------
create or replace function public.proteger_ultimo_admin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.papel = 'admin' and (tg_op = 'DELETE' or new.papel <> 'admin') then
    if exists (select 1 from public.empresas e where e.id = old.empresa_id)                      -- empresa sendo apagada: libera
       and not exists (select 1 from public.membros m where m.empresa_id = old.empresa_id and m.papel = 'admin' and m.user_id <> old.user_id) then
      raise exception 'a empresa precisa de pelo menos um administrador';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.proteger_ultimo_admin() from public, anon, authenticated;
drop trigger if exists membros_ultimo_admin on public.membros;
create trigger membros_ultimo_admin before update or delete on public.membros
  for each row execute function public.proteger_ultimo_admin();

-- 12) Cadastro só com convite (gatilho na tabela de usuários do Supabase) --------------------------------------
create or replace function public.so_com_convite() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.convites c
              where c.email = lower(btrim(new.email)) and c.status = 'pendente' and c.expira_em > now()) then
    return new;
  end if;
  raise exception 'Cadastro somente com convite.';
end $$;
revoke all on function public.so_com_convite() from public, anon, authenticated;
drop trigger if exists so_com_convite on auth.users;
create trigger so_com_convite before insert on auth.users
  for each row execute function public.so_com_convite();

-- 13) Permissões das funções (anônimo só enxerga o aviso do convite) --------------------------------------------
revoke all on function public.criar_convite(uuid, text, text) from public, anon;
revoke all on function public.criar_convite_empresa(text, text, boolean, boolean) from public, anon;
revoke all on function public.cancelar_convite(uuid) from public, anon;
revoke all on function public.listar_convites(uuid) from public, anon;
revoke all on function public.listar_membros(uuid) from public, anon;
revoke all on function public.aceitar_convite(text) from public, anon;
revoke all on function public.alterar_papel(uuid, uuid, text) from public, anon;
revoke all on function public.remover_membro(uuid, uuid) from public, anon;
revoke all on function public.convite_info(text) from public;
grant execute on function public.criar_convite(uuid, text, text) to authenticated;
grant execute on function public.criar_convite_empresa(text, text, boolean, boolean) to authenticated;
grant execute on function public.cancelar_convite(uuid) to authenticated;
grant execute on function public.listar_convites(uuid) to authenticated;
grant execute on function public.listar_membros(uuid) to authenticated;
grant execute on function public.aceitar_convite(text) to authenticated;
grant execute on function public.alterar_papel(uuid, uuid, text) to authenticated;
grant execute on function public.remover_membro(uuid, uuid) to authenticated;
grant execute on function public.convite_info(text) to anon, authenticated;

-- Conferência: administradores da plataforma (deve ter 1) e gatilhos ativos
select (select count(*) from public.plataforma_admins) as admins_da_plataforma,
       (select count(*) from pg_trigger where tgname in ('so_com_convite', 'membros_ultimo_admin') and not tgisinternal) as gatilhos;
