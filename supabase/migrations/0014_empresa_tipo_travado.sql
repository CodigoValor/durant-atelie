-- 0014 — CNPJ/CPF obrigatório no cadastro e tipo da empresa (alfaiataria/fábrica) travado.
-- O administrador da empresa edita só o cadastro. Quem define o que a empresa comprou (tipo) é o administrador da plataforma.
drop function if exists public.salvar_empresa(uuid, jsonb, boolean, boolean);

create or replace function public.salvar_empresa(p_empresa uuid, p_cadastro jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc text; v_cad jsonb := '{}'::jsonb; k text;
begin
  if public.papel_em(p_empresa) is distinct from 'admin' and not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  foreach k in array array['tipo','razao','fantasia','doc','resp','email','tel','cidade','end','obs'] loop
    v_cad := v_cad || jsonb_build_object(k, left(btrim(coalesce(p_cadastro ->> k, '')), 200));
  end loop;
  v_doc := regexp_replace(coalesce(v_cad ->> 'doc', ''), '\D', '', 'g');
  if v_doc = '' then raise exception 'Informe o CNPJ (ou CPF) da empresa.' using errcode = '22023'; end if;
  if length(v_doc) not in (11, 14) then raise exception 'CPF tem 11 números e CNPJ tem 14.' using errcode = '22023'; end if;
  begin
    update public.empresas set cadastro = v_cad, cnpj = v_doc where id = p_empresa;
  exception when unique_violation then
    raise exception 'Este CNPJ/CPF já está cadastrado em outra empresa.' using errcode = '23505';
  end;
end $$;

create or replace function public.definir_tipo_empresa(p_empresa uuid, p_vende boolean, p_produz boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'só o administrador da plataforma altera o tipo da empresa' using errcode = '42501'; end if;
  if not (coalesce(p_vende, false) or coalesce(p_produz, false)) then
    raise exception 'A empresa precisa ser alfaiataria ou fábrica (ou as duas).' using errcode = '22023';
  end if;
  update public.empresas set vende_cliente_final = p_vende, produz = p_produz where id = p_empresa;
end $$;

revoke all on function public.salvar_empresa(uuid, jsonb), public.definir_tipo_empresa(uuid, boolean, boolean) from public, anon;
grant execute on function public.salvar_empresa(uuid, jsonb), public.definir_tipo_empresa(uuid, boolean, boolean) to authenticated;
