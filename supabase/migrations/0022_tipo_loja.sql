-- 0022 — "Loja de tecido" passa a ser escolhida no painel, como Ateliê e Alfaiataria.
-- Loja = fornece_tecido ligado, não atende cliente final e não tem área para ateliês (como a Mark Bel).
-- Cliente da loja (somente_tecidos) continua só rótulo: quem cadastra é a própria loja.
create or replace function public.definir_tipo_empresa(p_empresa uuid, p_tipo text, p_area_atelies boolean default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_area boolean; v_vende boolean; v_forn boolean;
begin
  if not public._eh_plataforma() then raise exception 'só o administrador da plataforma altera o tipo da empresa' using errcode = '42501'; end if;
  if p_tipo not in ('atelie', 'alfaiataria', 'loja') then raise exception 'tipo inválido (o cliente da loja é cadastrado pela própria loja)' using errcode = '22023'; end if;
  if exists (select 1 from public.empresas e where e.id = p_empresa and e.somente_tecidos) then
    raise exception 'cliente da loja: o tipo não muda por aqui' using errcode = '22023';
  end if;
  select case p_tipo when 'atelie' then false when 'loja' then false else coalesce(p_area_atelies, e.produz) end into v_area from public.empresas e where e.id = p_empresa;
  if not found then raise exception 'empresa inexistente' using errcode = 'P0002'; end if;
  v_vende := p_tipo <> 'loja';
  v_forn  := p_tipo = 'loja';
  update public.empresas set tipo = p_tipo, vende_cliente_final = v_vende, produz = v_area, fornece_tecido = v_forn where id = p_empresa;
  perform public._audit_acao(p_empresa, 'update', 'empresa', p_empresa::text, jsonb_build_object('tipo', p_tipo, 'area_atelies', v_area, 'fornece_tecido', v_forn));
end $$;
revoke all on function public.definir_tipo_empresa(uuid, text, boolean) from public, anon;
grant execute on function public.definir_tipo_empresa(uuid, text, boolean) to authenticated;
