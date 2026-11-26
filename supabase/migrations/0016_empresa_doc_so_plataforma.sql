-- 0016 — CNPJ/CPF e tipo (PF/PJ) da empresa só mudam pela plataforma (painel de controle).
-- O administrador da empresa continua editando o restante do cadastro (razão social, contatos, endereço...).
-- Para ele, o documento e o tipo enviados são ignorados: valem os que já estão gravados.
create or replace function public.salvar_empresa(p_empresa uuid, p_cadastro jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc text; v_cad jsonb := '{}'::jsonb; k text; v_plat boolean := public._eh_plataforma(); v_old jsonb;
begin
  if public.papel_em(p_empresa) is distinct from 'admin' and not v_plat then raise exception 'sem permissão' using errcode = '42501'; end if;
  select cadastro into v_old from public.empresas where id = p_empresa;
  if not found then raise exception 'empresa inexistente' using errcode = 'P0002'; end if;
  foreach k in array array['tipo','razao','fantasia','doc','resp','email','tel','cidade','end','obs'] loop
    v_cad := v_cad || jsonb_build_object(k, left(btrim(coalesce(p_cadastro ->> k, '')), 200));
  end loop;
  if not v_plat then
    -- quem não é da plataforma não troca documento nem tipo: mantém o que já estava
    v_cad := v_cad || jsonb_build_object('doc', coalesce(v_old ->> 'doc', ''), 'tipo', coalesce(v_old ->> 'tipo', ''));
    update public.empresas set cadastro = v_cad where id = p_empresa;
    return;
  end if;
  v_doc := regexp_replace(coalesce(v_cad ->> 'doc', ''), '\D', '', 'g');
  if v_doc = '' then raise exception 'Informe o CNPJ (ou CPF) da empresa.' using errcode = '22023'; end if;
  if length(v_doc) not in (11, 14) then raise exception 'CPF tem 11 números e CNPJ tem 14.' using errcode = '22023'; end if;
  begin
    update public.empresas set cadastro = v_cad, cnpj = v_doc where id = p_empresa;
  exception when unique_violation then
    raise exception 'Este CNPJ/CPF já está cadastrado em outra empresa.' using errcode = '23505';
  end;
end $$;
revoke all on function public.salvar_empresa(uuid, jsonb) from public, anon;
grant execute on function public.salvar_empresa(uuid, jsonb) to authenticated;
