-- Alinhavo — copiar os dados de UMA empresa para OUTRA, dentro do mesmo banco.
-- >>> RODE SOMENTE NO SUPABASE DE HOMOLOGAÇÃO (azkvclwozhneyougtcbn). <<<
-- Uso típico: a Durant da homologação já tem a cópia anonimizada da produção; isto leva essa mesma cópia para 'HDA Produção',
-- para testar o fluxo do parceiro com catálogo, produtos, tecidos e preços de verdade.
--
-- O que faz: apaga os dados de teste da empresa de destino, copia tudo da origem (clientes já embaralhados) e MANTÉM os usuários
-- do destino (quem foi convidado continua entrando). Não copia bkp, sys nem pub (o catálogo público é refeito sozinho pelo banco).
-- Trava: não deixa copiar para a própria origem e só roda se origem e destino existirem neste banco.

do $$
declare
  v_origem  text := 'Durant Alfaiataria';   -- quem já tem os dados
  v_destino text := 'HDA Produção';         -- quem vai receber
  v_o uuid; v_d uuid; v_usuarios jsonb; v_n int;
begin
  select id into v_o from public.empresas where nome = v_origem  limit 1;
  select id into v_d from public.empresas where nome = v_destino limit 1;
  if v_o is null then raise exception 'empresa de origem "%" não encontrada', v_origem; end if;
  if v_d is null then raise exception 'empresa de destino "%" não encontrada', v_destino; end if;
  if v_o = v_d then raise exception 'PARE: origem e destino são a mesma empresa. Nada foi alterado.'; end if;
  if not exists (select 1 from public.reg where empresa_id = v_o) then raise exception 'a origem não tem dados'; end if;

  -- guarda os usuários do destino (convidados) antes de limpar
  select (j::jsonb -> 'usuarios') into v_usuarios from public.reg where empresa_id = v_d and id = 'sing~cfg';

  delete from public.reg where empresa_id = v_d;
  delete from public.contadores where empresa_id = v_d;

  insert into public.reg (empresa_id, id, k, i, n, j, atualizado_em)
    select v_d, id, k, i, n, j, atualizado_em from public.reg
     where empresa_id = v_o and k not in ('bkp', 'sys', 'pub');

  -- devolve os usuários do destino à configuração copiada
  if v_usuarios is not null and jsonb_typeof(v_usuarios) = 'array' then
    update public.reg set j = jsonb_set(j::jsonb, '{usuarios}', v_usuarios)::text
     where empresa_id = v_d and id = 'sing~cfg';
  end if;

  select count(*) into v_n from public.reg where empresa_id = v_d;
  raise notice 'Cópia concluída: % linhas em %.', v_n, v_destino;
end $$;

-- Conferência: linhas por empresa
select e.nome, count(*) as linhas from public.reg r join public.empresas e on e.id = r.empresa_id group by 1 order by 1;
