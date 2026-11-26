-- Convite de empresa nova já define o tipo (Ateliê, Alfaiataria ou Loja de tecido).
-- A empresa nasce com o tipo e os módulos certos; o administrador da plataforma não precisa ajustar depois.

alter table public.convites add column if not exists tipo text check (tipo is null or tipo in ('atelie', 'alfaiataria', 'loja'));

create or replace function public.criar_convite_empresa(p_email text, p_empresa_nome text, p_vende boolean, p_produz boolean, p_tipo text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_nome text := btrim(coalesce(p_empresa_nome, '')); v_token text; v_id uuid;
begin
  if not public._eh_plataforma() then raise exception 'só o administrador da plataforma cria empresas' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'e-mail inválido'; end if;
  if length(v_nome) < 2 or length(v_nome) > 120 then raise exception 'nome da empresa inválido (2 a 120 letras)'; end if;
  if p_tipo is null or p_tipo not in ('atelie', 'alfaiataria', 'loja') then raise exception 'escolha o tipo da empresa: ateliê, alfaiataria ou loja de tecido'; end if;
  update public.convites set status = 'cancelado'
   where empresa_id is null and email = v_email and empresa_nome = v_nome and status = 'pendente';
  v_token := public._novo_token();
  insert into public.convites (empresa_id, email, papel, empresa_nome, vende, produz, tipo, token_hash, criado_por)
  values (null, v_email, 'admin', v_nome, p_tipo <> 'loja', false, p_tipo, public._hash_token(v_token), (select auth.uid()))
  returning id into v_id;
  perform public._audit_acao(null, 'insert', 'convite', v_id::text, jsonb_build_object('email', v_email, 'empresa', v_nome, 'tipo', 'empresa_nova', 'tipo_empresa', p_tipo));
  return v_token;
end $$;
revoke all on function public.criar_convite_empresa(text, text, boolean, boolean, text) from public, anon;
grant execute on function public.criar_convite_empresa(text, text, boolean, boolean, text) to authenticated;

create or replace function public.aceitar_convite(p_token text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites; v_emp uuid;
begin
  if (select auth.uid()) is null then raise exception 'entre na sua conta para aceitar o convite' using errcode = '42501'; end if;
  select * into c from public.convites where token_hash = public._hash_token(p_token) for update;
  if not found or c.status <> 'pendente' or c.expira_em < now() then raise exception 'convite inválido ou expirado'; end if;
  if public._email_logado() is distinct from c.email then raise exception 'este convite é para outro e-mail'; end if;
  if c.empresa_id is null then
    insert into public.empresas (nome, vende_cliente_final, produz, fornece_tecido, tipo)
    values (btrim(c.empresa_nome), coalesce(c.vende, true), coalesce(c.produz, false), c.tipo = 'loja', c.tipo) returning id into v_emp;
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
