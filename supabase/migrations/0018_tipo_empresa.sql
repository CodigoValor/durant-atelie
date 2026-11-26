-- 0018 — Tipo da empresa (rótulo comercial) separado dos módulos que ligam recursos.
-- Tipo: atelie | alfaiataria | fabrica | loja | cliente_loja. Não muda menu; define preço/implantação.
-- Módulo "área para ateliês" = empresas.produz (menu Pedidos de produção). empresas.vende_cliente_final é informativo.
alter table public.empresas add column if not exists tipo text;
alter table public.empresas drop constraint if exists empresas_tipo_check;
alter table public.empresas add constraint empresas_tipo_check check (tipo is null or tipo in ('atelie', 'alfaiataria', 'fabrica', 'loja', 'cliente_loja'));

-- Preenche as empresas existentes (regra segura; ajuste fino é feito no painel)
update public.empresas set tipo = case
    when fornece_tecido then 'loja'
    when somente_tecidos then 'cliente_loja'
    when produz and not vende_cliente_final then 'fabrica'
    else 'alfaiataria' end
 where tipo is null;

drop function if exists public.definir_tipo_empresa(uuid, boolean, boolean);
create or replace function public.definir_tipo_empresa(p_empresa uuid, p_tipo text, p_area_atelies boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_vende boolean; v_area boolean;
begin
  if not public._eh_plataforma() then raise exception 'só o administrador da plataforma altera o tipo da empresa' using errcode = '42501'; end if;
  if p_tipo not in ('atelie', 'alfaiataria', 'fabrica') then raise exception 'tipo inválido (a loja e o cliente da loja são definidos pelo módulo de tecidos)' using errcode = '22023'; end if;
  if exists (select 1 from public.empresas e where e.id = p_empresa and (e.fornece_tecido or e.somente_tecidos)) then
    raise exception 'empresa do módulo de tecidos: o tipo não muda por aqui' using errcode = '22023';
  end if;
  v_vende := p_tipo <> 'fabrica';
  v_area  := case p_tipo when 'fabrica' then true when 'atelie' then false else coalesce(p_area_atelies, false) end;
  update public.empresas set tipo = p_tipo, vende_cliente_final = v_vende, produz = v_area where id = p_empresa;
  if not found then raise exception 'empresa inexistente' using errcode = 'P0002'; end if;
  perform public._audit_acao(p_empresa, 'update', 'empresa', p_empresa::text, jsonb_build_object('tipo', p_tipo, 'area_atelies', v_area));
end $$;

drop function if exists public.plataforma_empresas();
create or replace function public.plataforma_empresas() returns table (
  id uuid, nome text, cnpj text, cadastro jsonb, tipo text, vende boolean, produz boolean, fornece boolean, so_tecidos boolean,
  ativa boolean, criado_em timestamptz, usuarios integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select e.id, e.nome, e.cnpj, e.cadastro, e.tipo, e.vende_cliente_final, e.produz, e.fornece_tecido, e.somente_tecidos,
           e.ativa, e.criado_em, (select count(*)::int from public.membros m where m.empresa_id = e.id)
      from public.empresas e order by e.criado_em, e.nome;
end $$;

revoke all on function public.definir_tipo_empresa(uuid, text, boolean), public.plataforma_empresas() from public, anon;
grant execute on function public.definir_tipo_empresa(uuid, text, boolean), public.plataforma_empresas() to authenticated;
