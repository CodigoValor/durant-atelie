-- Durant Ateliê — numeração sem repetição entre pessoas (cole inteiro no SQL Editor e clique em Run)
-- O app deixa de calcular "o maior número que eu enxergo + 1" (um parceiro não enxerga os dos outros e repetiria números).
-- Agora cada pessoa RESERVA no servidor um bloco pequeno de números (contador atômico por empresa).
--   'pedido'  → sequência única de pedidos e orçamentos (P-2601, P-2602 ...)
--   'cliente' → id numérico dos clientes
-- O contador nunca volta e respeita a "Numeração" que o admin define em Configurações.
-- Depende de 0001 (base) e 0005 (papel_em e _audit_json_ou_nulo). Roda de novo sem quebrar.

create table if not exists public.contadores (
  empresa_id uuid   not null references public.empresas (id) on delete cascade,
  nome       text   not null check (nome in ('pedido', 'cliente')),
  ultimo     bigint not null,
  primary key (empresa_id, nome)
);
alter table public.contadores enable row level security;      -- sem política e sem permissão: só a função abaixo mexe
revoke all on public.contadores from anon, authenticated;

create or replace function public.reservar_numeros(p_empresa uuid, p_nome text, p_qtd int default 5) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_piso bigint := 0;    -- o maior número que já existe nos dados (ou que o admin fixou)
  v_ult  bigint;
begin
  if public.papel_em(p_empresa) is null then raise exception 'sem acesso a esta empresa' using errcode = '42501'; end if;
  if p_nome not in ('pedido', 'cliente') then raise exception 'contador desconhecido: %', p_nome; end if;
  if p_qtd is null or p_qtd < 1 or p_qtd > 50 then raise exception 'quantidade inválida (1 a 50)'; end if;

  -- piso vindo dos dados: só precisa na primeira vez, mas o piso do admin (cfg) vale sempre
  if p_nome = 'pedido' then
    v_piso := 2600;
    select greatest(v_piso, coalesce((public._audit_json_ou_nulo(j) ->> 'ultimoPed')::numeric, 0)::bigint)
      into v_piso from public.reg where empresa_id = p_empresa and id = 'sing~cfg';
    v_piso := coalesce(v_piso, 2600);
    if not exists (select 1 from public.contadores where empresa_id = p_empresa and nome = 'pedido') then
      -- igual ao app: pedidos (ignora ids gigantes de importação) e orçamentos, pelo número depois de "P-"
      select greatest(v_piso, coalesce(max(n), 0)) into v_piso from (
        select nullif(regexp_replace(substr(i, 3), '\D', '', 'g'), '')::numeric::bigint n
          from public.reg where empresa_id = p_empresa and k in ('pedidos', 'orcamentos')
           and length(regexp_replace(substr(i, 3), '\D', '', 'g')) between 1 and 9
           and (k = 'orcamentos' or nullif(regexp_replace(substr(i, 3), '\D', '', 'g'), '')::numeric < 100000)) x;
    end if;
  else
    if not exists (select 1 from public.contadores where empresa_id = p_empresa and nome = 'cliente') then
      select coalesce(max(nullif(regexp_replace(i, '\D', '', 'g'), '')::numeric::bigint), 0) into v_piso
        from public.reg where empresa_id = p_empresa and k = 'clientes'
         and length(regexp_replace(i, '\D', '', 'g')) between 1 and 9;
    end if;
  end if;

  insert into public.contadores (empresa_id, nome, ultimo) values (p_empresa, p_nome, v_piso + p_qtd)
  on conflict (empresa_id, nome) do update set ultimo = greatest(public.contadores.ultimo, v_piso) + p_qtd
  returning ultimo into v_ult;

  return v_ult - p_qtd + 1;     -- primeiro número do bloco; o bloco é [primeiro, primeiro + p_qtd - 1]
end $$;
revoke all on function public.reservar_numeros(uuid, text, int) from public, anon;
grant execute on function public.reservar_numeros(uuid, text, int) to authenticated;

-- Conferência: deve listar a função e a tabela com RLS ligado
select (select count(*) from pg_proc where proname = 'reservar_numeros') as funcao,
       (select relrowsecurity from pg_class where relname = 'contadores') as rls_ligado;
