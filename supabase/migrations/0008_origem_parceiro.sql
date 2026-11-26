-- Alinhavo — empresa do parceiro e origem dos documentos (cole inteiro no SQL Editor e clique em Run; roda de novo sem quebrar)
-- Depende de 0005 (parceiro) e 0007 (convites).
-- 1) Todo parceiro tem o NOME DA EMPRESA dele no vínculo (ex.: "Durant Alfaiataria"), informado ao convidar.
-- 2) O dono da produção pergunta "de quem é cada documento?" e o banco responde só com o nome do parceiro (nunca e-mail, nunca dado do cliente).

alter table public.membros  add column if not exists nome_parceiro text;
alter table public.convites add column if not exists nome_parceiro text;
alter table public.membros  drop constraint if exists membros_nome_parceiro_check;
alter table public.membros  add constraint membros_nome_parceiro_check check (nome_parceiro is null or length(btrim(nome_parceiro)) between 2 and 120);
alter table public.convites drop constraint if exists convites_nome_parceiro_check;
alter table public.convites add constraint convites_nome_parceiro_check check (nome_parceiro is null or length(btrim(nome_parceiro)) between 2 and 120);

-- Convite de usuário: parceiro precisa informar a empresa dele ---------------------------------------------------
drop function if exists public.criar_convite(uuid, text, text);
create or replace function public.criar_convite(p_empresa uuid, p_email text, p_papel text, p_nome_parceiro text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_token text; v_id uuid;
        v_nome text := nullif(btrim(coalesce(p_nome_parceiro, '')), '');
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'só o administrador da empresa convida' using errcode = '42501'; end if;
  if p_papel not in ('admin', 'usuario', 'parceiro') then raise exception 'papel inválido'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'e-mail inválido'; end if;
  if p_papel = 'parceiro' then
    if v_nome is null then raise exception 'informe o nome da empresa do parceiro'; end if;
    if length(v_nome) < 2 or length(v_nome) > 120 then raise exception 'nome da empresa do parceiro inválido (2 a 120 letras)'; end if;
  else
    v_nome := null;
  end if;
  if exists (select 1 from public.membros m join auth.users u on u.id = m.user_id
              where m.empresa_id = p_empresa and lower(u.email) = v_email) then
    raise exception 'essa pessoa já tem acesso a esta empresa';
  end if;
  update public.convites set status = 'cancelado'
   where empresa_id = p_empresa and email = v_email and status = 'pendente';
  v_token := public._novo_token();
  insert into public.convites (empresa_id, email, papel, nome_parceiro, token_hash, criado_por)
  values (p_empresa, v_email, p_papel, v_nome, public._hash_token(v_token), (select auth.uid())) returning id into v_id;
  perform public._audit_acao(p_empresa, 'insert', 'convite', v_id::text, jsonb_build_object('email', v_email, 'papel', p_papel, 'parceiro', v_nome));
  return v_token;
end $$;
revoke all on function public.criar_convite(uuid, text, text, text) from public, anon;
grant execute on function public.criar_convite(uuid, text, text, text) to authenticated;

-- Aceitar: leva o nome do parceiro para o vínculo -----------------------------------------------------------------
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
  insert into public.membros (user_id, empresa_id, papel, nome_parceiro) values ((select auth.uid()), v_emp, c.papel, c.nome_parceiro)
  on conflict (user_id, empresa_id) do nothing;
  update public.convites set status = 'aceito', aceito_em = now(), aceito_por = (select auth.uid()), empresa_id = v_emp where id = c.id;
  perform public._audit_acao(v_emp, 'update', 'convite', c.id::text, jsonb_build_object('status', 'aceito', 'papel', c.papel));
  return v_emp;
end $$;
revoke all on function public.aceitar_convite(text) from public, anon;
grant execute on function public.aceitar_convite(text) to authenticated;

-- Lista de pessoas: agora com o nome da empresa do parceiro --------------------------------------------------------
drop function if exists public.listar_membros(uuid);
create or replace function public.listar_membros(p_empresa uuid)
returns table (user_id uuid, email text, papel text, desde timestamptz, nome_parceiro text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select m.user_id, lower(u.email)::text, m.papel, m.criado_em, m.nome_parceiro
      from public.membros m join auth.users u on u.id = m.user_id
     where m.empresa_id = p_empresa order by m.criado_em;
end $$;
revoke all on function public.listar_membros(uuid) from public, anon;
grant execute on function public.listar_membros(uuid) to authenticated;

-- Corrigir/definir o nome da empresa de um parceiro que já existe -------------------------------------------------
create or replace function public.definir_nome_parceiro(p_empresa uuid, p_user uuid, p_nome text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'só o administrador altera isto' using errcode = '42501'; end if;
  if v_nome is null or length(v_nome) < 2 or length(v_nome) > 120 then raise exception 'nome da empresa inválido (2 a 120 letras)'; end if;
  update public.membros set nome_parceiro = v_nome where empresa_id = p_empresa and user_id = p_user and papel = 'parceiro';
  if not found then raise exception 'essa pessoa não é parceira desta empresa'; end if;
  perform public._audit_acao(p_empresa, 'update', 'membro', p_user::text, jsonb_build_object('parceiro', v_nome));
end $$;
revoke all on function public.definir_nome_parceiro(uuid, uuid, text) from public, anon;
grant execute on function public.definir_nome_parceiro(uuid, uuid, text) to authenticated;

-- De quem é cada documento? (equipe da empresa; devolve só id do documento e nome da empresa do parceiro) ---------
create or replace function public.listar_origens(p_empresa uuid)
returns table (id text, nome text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.papel_em(p_empresa) is null or public.papel_em(p_empresa) = 'parceiro' then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select r.id, coalesce(m.nome_parceiro, split_part(lower(u.email), '@', 1))::text
      from public.reg r
      join public.membros m on m.empresa_id = r.empresa_id and m.user_id = r.criado_por and m.papel = 'parceiro'
      join auth.users u on u.id = r.criado_por
     where r.empresa_id = p_empresa and r.k = any (public.kinds_parceiro());
end $$;
revoke all on function public.listar_origens(uuid) from public, anon;
grant execute on function public.listar_origens(uuid) to authenticated;

-- Conferência: deve listar as 5 funções
select count(*) as funcoes from pg_proc where proname in ('criar_convite', 'aceitar_convite', 'listar_membros', 'definir_nome_parceiro', 'listar_origens');
