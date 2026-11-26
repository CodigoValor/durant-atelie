-- Andamento dos pedidos do parceiro (só leitura) -------------------------------------------------------------------
-- O parceiro lança o pedido; o dono aceita ou recusa. A decisão fica na configuração do dono (que o parceiro não lê).
-- Esta função devolve ao parceiro SÓ o resultado dos pedidos que ele mesmo criou: id, estado, data e motivo da recusa.
-- Não devolve nada da produção interna, de custos nem de prestadores.
create or replace function public.andamento_parceiro(p_empresa uuid)
returns table (id text, st text, em text, motivo text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ac jsonb := '{}'::jsonb;
begin
  if public.papel_em(p_empresa) is distinct from 'parceiro' then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce((c.j::jsonb) -> 'aceites', '{}'::jsonb) into v_ac
    from public.reg c where c.empresa_id = p_empresa and c.id = 'sing~cfg';
  v_ac := coalesce(v_ac, '{}'::jsonb);
  return query
    select r.id::text,
           coalesce(v_ac -> r.i ->> 'st', 'recebido')::text,
           (v_ac -> r.i ->> 'em')::text,
           (v_ac -> r.i ->> 'motivo')::text
      from public.reg r
     where r.empresa_id = p_empresa and r.k = 'pedidos' and r.criado_por = (select auth.uid());
end $$;
revoke all on function public.andamento_parceiro(uuid) from public, anon;
grant execute on function public.andamento_parceiro(uuid) to authenticated;

-- Conferência: deve listar as 6 funções
select count(*) as funcoes from pg_proc
 where proname in ('criar_convite', 'aceitar_convite', 'listar_membros', 'definir_nome_parceiro', 'listar_origens', 'andamento_parceiro');
