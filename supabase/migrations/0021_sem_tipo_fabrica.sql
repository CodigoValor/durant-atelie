-- 0021 — o tipo Fábrica deixa de existir: fábrica é uma Alfaiataria (que atende consumidor e ateliê).
-- A área para ateliês deixa de ser escolhida no painel: o menu aparece quando houver ateliê cadastrado.
-- Quem já tinha a área ligada (ex.: HDA Produção) continua com ela (empresas.produz não é alterado).
-- O tipo cliente_loja continua só como rótulo das empresas do módulo de tecidos (a loja cadastra os clientes dela).
update public.empresas set tipo = 'alfaiataria' where tipo = 'fabrica';
alter table public.empresas drop constraint if exists empresas_tipo_check;
alter table public.empresas add constraint empresas_tipo_check check (tipo is null or tipo in ('atelie', 'alfaiataria', 'loja', 'cliente_loja'));

create or replace function public.definir_tipo_empresa(p_empresa uuid, p_tipo text, p_area_atelies boolean default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_area boolean;
begin
  if not public._eh_plataforma() then raise exception 'só o administrador da plataforma altera o tipo da empresa' using errcode = '42501'; end if;
  if p_tipo not in ('atelie', 'alfaiataria') then raise exception 'tipo inválido (a loja e o cliente da loja são definidos pelo módulo de tecidos)' using errcode = '22023'; end if;
  if exists (select 1 from public.empresas e where e.id = p_empresa and (e.fornece_tecido or e.somente_tecidos)) then
    raise exception 'empresa do módulo de tecidos: o tipo não muda por aqui' using errcode = '22023';
  end if;
  select case p_tipo when 'atelie' then false else coalesce(p_area_atelies, e.produz) end into v_area from public.empresas e where e.id = p_empresa;
  if not found then raise exception 'empresa inexistente' using errcode = 'P0002'; end if;
  update public.empresas set tipo = p_tipo, vende_cliente_final = true, produz = v_area where id = p_empresa;
  perform public._audit_acao(p_empresa, 'update', 'empresa', p_empresa::text, jsonb_build_object('tipo', p_tipo, 'area_atelies', v_area));
end $$;
revoke all on function public.definir_tipo_empresa(uuid, text, boolean) from public, anon;
grant execute on function public.definir_tipo_empresa(uuid, text, boolean) to authenticated;
