-- 0013 — Cadastro da empresa que usa o Alinhavo (CNPJ único) e o que ela faz (alfaiataria e/ou fábrica).
-- Só o administrador da própria empresa altera. O CNPJ/CPF não pode repetir entre empresas.
-- Loja de tecido e cliente de loja continuam vindo do módulo de tecidos (fornece_tecido / somente_tecidos).
alter table public.empresas add column if not exists cadastro jsonb not null default '{}'::jsonb;
alter table public.empresas add column if not exists cnpj text;          -- só dígitos (11 = CPF, 14 = CNPJ)
create unique index if not exists empresas_cnpj_uk on public.empresas (cnpj) where cnpj is not null;

create or replace function public.salvar_empresa(p_empresa uuid, p_cadastro jsonb, p_vende boolean, p_produz boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc text; v_cad jsonb := '{}'::jsonb; k text;
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not (coalesce(p_vende, false) or coalesce(p_produz, false)) then
    raise exception 'A empresa precisa atender cliente final (alfaiataria) ou produzir para ateliês (fábrica).' using errcode = '22023';
  end if;
  foreach k in array array['tipo','razao','fantasia','doc','resp','email','tel','cidade','end','obs'] loop
    v_cad := v_cad || jsonb_build_object(k, left(btrim(coalesce(p_cadastro ->> k, '')), 200));
  end loop;
  v_doc := regexp_replace(coalesce(v_cad ->> 'doc', ''), '\D', '', 'g');
  if v_doc <> '' and length(v_doc) not in (11, 14) then raise exception 'CPF tem 11 números e CNPJ tem 14.' using errcode = '22023'; end if;
  begin
    update public.empresas set cadastro = v_cad, cnpj = nullif(v_doc, ''), vende_cliente_final = p_vende, produz = p_produz where id = p_empresa;
  exception when unique_violation then
    raise exception 'Este CNPJ/CPF já está cadastrado em outra empresa.' using errcode = '23505';
  end;
end $$;
revoke all on function public.salvar_empresa(uuid, jsonb, boolean, boolean) from public, anon;
grant execute on function public.salvar_empresa(uuid, jsonb, boolean, boolean) to authenticated;
