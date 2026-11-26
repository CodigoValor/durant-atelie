-- Durant Ateliê — módulo TECIDOS, parte 2: LOJA DE TECIDO como empresa, clientes com liberação e pedido enviado à loja
-- (cole inteiro no SQL Editor e clique em Run — SEMPRE primeiro na HOMOLOGAÇÃO; só depois de validar, na produção)
--
-- O que esta migração acrescenta à 0010:
--   • a loja de tecido passa a ser uma EMPRESA (empresas.fornece_tecido = true) com equipe própria (admin/usuario) e catálogo próprio;
--   • o cliente se cadastra sozinho (nome, telefone, CPF/CNPJ) e fica PENDENTE até a loja LIBERAR — só liberado vê catálogo e preços e pede;
--   • quem não usa o sistema todo ganha uma empresa "só tecidos" (empresas.somente_tecidos) — a área restrita;
--   • o pedido enviado à loja nasce no cliente (empresa dele) e a equipe da loja o enxerga e responde item a item;
--   • o PREÇO vem sempre do catálogo da loja (gatilho): o cliente não consegue informar nem alterar preço, status de item ou liberação.
--
-- Segurança (mesmas regras do resto do sistema): RLS em tudo, nada para anônimo, chaves compostas, auditoria imutável.
-- Mudanças de status e liberação só por funções (security definer) que conferem quem está chamando.
-- Depende de 0001, 0003, 0004, 0005 e 0010. Roda de novo sem quebrar.

-- 0) Perfis ---------------------------------------------------------------------------------------
alter table public.empresas add column if not exists somente_tecidos boolean not null default false;   -- área restrita: só pedir tecido

-- 1) Documento (CPF/CNPJ) -------------------------------------------------------------------------
create or replace function public.tec_so_digitos(t text) returns text
language sql immutable as $$ select regexp_replace(coalesce(t, ''), '\D', '', 'g') $$;

create or replace function public.tec_doc_valido(p_doc text) returns boolean
language plpgsql immutable as $$
declare d text := public.tec_so_digitos(p_doc); s int; i int; r int;
  pesos13 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos14 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if length(d) = 11 then
    if d ~ '^(\d)\1{10}$' then return false; end if;
    s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> substr(d, 10, 1)::int then return false; end if;
    s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    return r = substr(d, 11, 1)::int;
  elsif length(d) = 14 then
    if d ~ '^(\d)\1{13}$' then return false; end if;
    s := 0; for i in 1..12 loop s := s + substr(d, i, 1)::int * pesos13[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    if r <> substr(d, 13, 1)::int then return false; end if;
    s := 0; for i in 1..13 loop s := s + substr(d, i, 1)::int * pesos14[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    return r = substr(d, 14, 1)::int;
  end if;
  return false;
end $$;
alter function public.tec_so_digitos(text) set search_path = pg_catalog, public;
alter function public.tec_doc_valido(text) set search_path = pg_catalog, public;
grant execute on function public.tec_so_digitos(text), public.tec_doc_valido(text) to authenticated;
revoke all on function public.tec_so_digitos(text), public.tec_doc_valido(text) from anon;

-- 2) Vínculo cliente × loja (cadastro + liberação) --------------------------------------------------
create table if not exists public.tec_loja_clientes (
  id                 uuid primary key default gen_random_uuid(),
  loja_empresa_id    uuid not null references public.empresas (id) on delete cascade,
  cliente_empresa_id uuid not null references public.empresas (id) on delete cascade,
  user_id            uuid references auth.users (id) on delete set null,       -- quem se cadastrou
  tipo               text not null check (tipo in ('pf', 'pj')),
  nome               text not null check (length(btrim(nome)) > 0),
  documento          text not null check (public.tec_doc_valido(documento)),   -- só dígitos
  telefone           text,
  email              text,
  status             text not null default 'pendente' check (status in ('pendente', 'liberado', 'bloqueado', 'recusado')),
  decidido_em        timestamptz,
  decidido_por       uuid,
  criado_em          timestamptz not null default now(),
  unique (loja_empresa_id, cliente_empresa_id),
  unique (loja_empresa_id, documento)
);
create index if not exists tec_loja_clientes_cli_idx on public.tec_loja_clientes (cliente_empresa_id);

-- 3) Pedido e itens podem apontar para uma loja da plataforma -----------------------------------------
alter table public.tec_pedidos add column if not exists loja_empresa_id uuid references public.empresas (id);
alter table public.tec_pedidos add column if not exists confirmado_em timestamptz;      -- vendedor confirmou com o cliente
alter table public.tec_pedidos alter column loja_id drop not null;
alter table public.tec_pedidos drop constraint if exists tec_pedidos_destino_loja;
alter table public.tec_pedidos add constraint tec_pedidos_destino_loja check (loja_id is not null or loja_empresa_id is not null);
create index if not exists tec_pedidos_loja_emp_idx on public.tec_pedidos (loja_empresa_id, status);

alter table public.tec_pedido_itens add column if not exists catalogo_loja_id uuid references public.tec_catalogo (id) on delete set null;
alter table public.tec_pedido_itens add column if not exists preco_metro numeric(12,2);   -- preço do catálogo NO MOMENTO do pedido (gravado pelo servidor)

-- 4) Apoio de permissão ----------------------------------------------------------------------------------
create or replace function public.tec_liberado(p_cliente uuid, p_loja uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.tec_loja_clientes v
                 where v.cliente_empresa_id = p_cliente and v.loja_empresa_id = p_loja and v.status = 'liberado')
$$;
revoke all on function public.tec_liberado(uuid, uuid) from public, anon;
grant execute on function public.tec_liberado(uuid, uuid) to authenticated;

-- a loja enxerga o pedido ENVIADO (nunca o rascunho do cliente)
create or replace function public.tec_loja_ve_pedido(p_pedido uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.tec_pedidos p
                 where p.id = p_pedido and p.status <> 'rascunho' and p.loja_empresa_id is not null and public.tec_equipe(p.loja_empresa_id))
$$;
revoke all on function public.tec_loja_ve_pedido(uuid) from public, anon;
grant execute on function public.tec_loja_ve_pedido(uuid) to authenticated;

-- 5) Preço e descrição vêm do catálogo da loja (cliente não informa) -----------------------------------------
create or replace function public.tec_item_da_loja() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_loja uuid; v_cat record; v_st text;
begin
  select p.loja_empresa_id, p.status into v_loja, v_st from public.tec_pedidos p where p.empresa_id = new.empresa_id and p.id = new.pedido_id;
  if v_loja is null then return new; end if;                       -- pedido para loja fora da plataforma: regra antiga
  if new.catalogo_loja_id is null then raise exception 'pedido para a loja precisa de um tecido do catálogo da loja' using errcode = '23514'; end if;
  select c.* into v_cat from public.tec_catalogo c where c.id = new.catalogo_loja_id and c.empresa_id = v_loja and c.ativo;
  if not found then raise exception 'tecido não existe no catálogo desta loja' using errcode = '23514'; end if;
  if v_cat.preco_metro is null then raise exception 'tecido sem preço na loja' using errcode = '23514'; end if;
  new.preco_metro := v_cat.preco_metro;
  new.descricao   := coalesce(v_cat.nome, v_cat.composicao);
  if new.referencia is null or btrim(new.referencia) = '' then new.referencia := v_cat.referencia; end if;
  -- a referência digitada ("1009/6") precisa começar pelo artigo do catálogo
  if lower(split_part(btrim(new.referencia), '/', 1)) <> lower(btrim(v_cat.referencia)) then
    raise exception 'referência não confere com o tecido do catálogo' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pendente'; new.metragem_confirmada := null;
  elsif v_st = 'rascunho' then
    new.status := old.status; new.metragem_confirmada := old.metragem_confirmada;
  end if;
  return new;
end $$;
revoke all on function public.tec_item_da_loja() from public, anon, authenticated;
drop trigger if exists tec_itens_da_loja on public.tec_pedido_itens;
create trigger tec_itens_da_loja before insert or update on public.tec_pedido_itens
  for each row execute function public.tec_item_da_loja();

-- 6) Cadastro do cliente (a pessoa já criou o login pelo Supabase Auth: e-mail + senha) -------------------------
create or replace function public.tec_pedir_acesso(p_loja uuid, p_tipo text, p_nome text, p_documento text, p_telefone text, p_empresa uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := (select auth.uid()); v_emp uuid := p_empresa; v_doc text := public.tec_so_digitos(p_documento); v_id uuid; v_email text;
begin
  if v_user is null then raise exception 'entre para continuar' using errcode = '42501'; end if;
  if not exists (select 1 from public.empresas e where e.id = p_loja and e.fornece_tecido) then raise exception 'loja inexistente' using errcode = 'P0002'; end if;
  if p_tipo not in ('pf', 'pj') then raise exception 'tipo inválido' using errcode = '22023'; end if;
  if (p_tipo = 'pf' and length(v_doc) <> 11) or (p_tipo = 'pj' and length(v_doc) <> 14) or not public.tec_doc_valido(v_doc) then
    raise exception 'CPF ou CNPJ inválido' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_nome, ''))) < 2 then raise exception 'informe o nome' using errcode = '22023'; end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_user;

  if v_emp is not null then
    if public.papel_em(v_emp) is distinct from 'admin' then raise exception 'só o administrador da empresa pede acesso' using errcode = '42501'; end if;
  else
    -- já fez pedido de acesso a esta loja com este login? devolve o mesmo (idempotente)
    select v.id into v_id from public.tec_loja_clientes v where v.loja_empresa_id = p_loja and v.user_id = v_user;
    if v_id is not null then return v_id; end if;
    insert into public.empresas (nome, vende_cliente_final, produz, somente_tecidos) values (btrim(p_nome), false, false, true) returning id into v_emp;
    insert into public.membros (user_id, empresa_id, papel) values (v_user, v_emp, 'admin');
  end if;

  insert into public.tec_loja_clientes (loja_empresa_id, cliente_empresa_id, user_id, tipo, nome, documento, telefone, email)
  values (p_loja, v_emp, v_user, p_tipo, btrim(p_nome), v_doc, nullif(btrim(coalesce(p_telefone, '')), ''), v_email)
  returning id into v_id;
  perform public._audit_acao(p_loja, 'insert', 'tec_loja_clientes', v_id::text, jsonb_build_object('cliente_empresa_id', v_emp, 'tipo', p_tipo, 'status', 'pendente'));
  return v_id;
end $$;
revoke all on function public.tec_pedir_acesso(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.tec_pedir_acesso(uuid, text, text, text, text, uuid) to authenticated;

-- 7) Loja decide: liberar, recusar ou bloquear ------------------------------------------------------------------
create or replace function public.tec_decidir_cliente(p_vinculo uuid, p_decisao text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v record; v_novo text;
begin
  select * into v from public.tec_loja_clientes where id = p_vinculo;
  if not found or not public.tec_equipe(v.loja_empresa_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  v_novo := case p_decisao when 'liberar' then 'liberado' when 'recusar' then 'recusado' when 'bloquear' then 'bloqueado' else null end;
  if v_novo is null then raise exception 'decisão inválida' using errcode = '22023'; end if;
  update public.tec_loja_clientes set status = v_novo, decidido_em = now(), decidido_por = (select auth.uid()) where id = p_vinculo;
  perform public._audit_acao(v.loja_empresa_id, 'update', 'tec_loja_clientes', p_vinculo::text, jsonb_build_object('status', v_novo));
end $$;
revoke all on function public.tec_decidir_cliente(uuid, text) from public, anon;
grant execute on function public.tec_decidir_cliente(uuid, text) to authenticated;

-- 8) Cliente envia o pedido (rascunho → enviado) ----------------------------------------------------------------
create or replace function public.tec_enviar_pedido(p_pedido uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  select * into p from public.tec_pedidos where id = p_pedido;
  if not found or not public.tec_equipe(p.empresa_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p.loja_empresa_id is null then raise exception 'pedido não é para uma loja da plataforma' using errcode = '22023'; end if;
  if p.status <> 'rascunho' then raise exception 'pedido já foi enviado' using errcode = '22023'; end if;
  if not public.tec_liberado(p.empresa_id, p.loja_empresa_id) then raise exception 'cadastro ainda não liberado pela loja' using errcode = '42501'; end if;
  if not exists (select 1 from public.tec_pedido_itens i where i.empresa_id = p.empresa_id and i.pedido_id = p.id) then
    raise exception 'pedido sem itens' using errcode = '22023';
  end if;
  update public.tec_pedidos set status = 'enviado', enviado_em = now() where id = p_pedido;
end $$;
revoke all on function public.tec_enviar_pedido(uuid) from public, anon;
grant execute on function public.tec_enviar_pedido(uuid) to authenticated;

-- 9) Loja confirma com o cliente e responde item a item ------------------------------------------------------
create or replace function public.tec_confirmar_pedido(p_pedido uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  select * into p from public.tec_pedidos where id = p_pedido;
  if not found or p.loja_empresa_id is null or not public.tec_equipe(p.loja_empresa_id) or p.status = 'rascunho' then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  update public.tec_pedidos set confirmado_em = coalesce(confirmado_em, now()) where id = p_pedido;
end $$;
revoke all on function public.tec_confirmar_pedido(uuid) from public, anon;
grant execute on function public.tec_confirmar_pedido(uuid) to authenticated;

create or replace function public.tec_responder_item(p_item uuid, p_status text, p_metragem numeric default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare i record; p record; v_pend int; v_tot int;
begin
  select * into i from public.tec_pedido_itens where id = p_item;
  if not found then raise exception 'item inexistente' using errcode = 'P0002'; end if;
  select * into p from public.tec_pedidos where empresa_id = i.empresa_id and id = i.pedido_id;
  if p.loja_empresa_id is null or not public.tec_equipe(p.loja_empresa_id) or p.status in ('rascunho', 'cancelado') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_status not in ('disponivel', 'parcial', 'indisponivel') then raise exception 'resposta inválida' using errcode = '22023'; end if;
  if p_status = 'parcial' and (p_metragem is null or p_metragem <= 0 or p_metragem >= i.metragem) then
    raise exception 'metragem parcial deve ser maior que zero e menor que a pedida' using errcode = '22023';
  end if;
  update public.tec_pedido_itens set status = p_status,
    metragem_confirmada = case p_status when 'disponivel' then i.metragem when 'parcial' then p_metragem else 0 end
  where id = p_item;
  select count(*) filter (where status = 'pendente'), count(*) into v_pend, v_tot
  from public.tec_pedido_itens where empresa_id = i.empresa_id and pedido_id = i.pedido_id;
  update public.tec_pedidos set status = case when v_pend = 0 then 'concluido' else 'parcial' end
  where empresa_id = i.empresa_id and id = i.pedido_id;
end $$;
revoke all on function public.tec_responder_item(uuid, text, numeric) from public, anon;
grant execute on function public.tec_responder_item(uuid, text, numeric) to authenticated;

-- 10) Que lojas posso usar? (nome da loja sem abrir a tabela de empresas) ------------------------------------------
create or replace function public.tec_minhas_lojas(p_cliente uuid) returns table (vinculo_id uuid, loja_empresa_id uuid, loja_nome text, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.id, v.loja_empresa_id, e.nome, v.status
  from public.tec_loja_clientes v join public.empresas e on e.id = v.loja_empresa_id
  where v.cliente_empresa_id = p_cliente and public.tec_equipe(p_cliente)
$$;
revoke all on function public.tec_minhas_lojas(uuid) from public, anon;
grant execute on function public.tec_minhas_lojas(uuid) to authenticated;

-- lista pública mínima de lojas para a tela de cadastro (só o nome; sem dados de ninguém)
create or replace function public.tec_loja_publica(p_loja uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select e.nome from public.empresas e where e.id = p_loja and e.fornece_tecido
$$;
revoke all on function public.tec_loja_publica(uuid) from public;
grant execute on function public.tec_loja_publica(uuid) to anon, authenticated;

-- 11) Auditoria do vínculo ---------------------------------------------------------------------------------------
-- (auditar_tec usa empresa_id; o vínculo é auditado pelas funções acima via _audit_acao)

-- 12) RLS --------------------------------------------------------------------------------------------------------
alter table public.tec_loja_clientes enable row level security;
revoke all on public.tec_loja_clientes from anon, authenticated;
grant select on public.tec_loja_clientes to authenticated;           -- escrita só pelas funções
drop policy if exists tec_loja_clientes_ler on public.tec_loja_clientes;
create policy tec_loja_clientes_ler on public.tec_loja_clientes for select to authenticated
  using (public.tec_equipe(cliente_empresa_id) or public.tec_equipe(loja_empresa_id));

-- catálogo da loja: a equipe da loja gerencia (política da 0010); cliente LIBERADO só lê
drop policy if exists tec_catalogo_cliente_ler on public.tec_catalogo;
create policy tec_catalogo_cliente_ler on public.tec_catalogo for select to authenticated
  using (tec_catalogo.ativo and exists (select 1 from public.tec_loja_clientes v
                     where v.loja_empresa_id = tec_catalogo.empresa_id and v.status = 'liberado'
                       and public.tec_equipe(v.cliente_empresa_id)));

-- pedido: o cliente só cria/edita ENQUANTO rascunho; envio e respostas são por função
drop policy if exists tec_pedidos_inserir on public.tec_pedidos;
create policy tec_pedidos_inserir on public.tec_pedidos for insert to authenticated
  with check (public.tec_equipe(empresa_id)
              and (loja_empresa_id is null or (status = 'rascunho' and public.tec_liberado(empresa_id, loja_empresa_id))));
drop policy if exists tec_pedidos_atualizar on public.tec_pedidos;
create policy tec_pedidos_atualizar on public.tec_pedidos for update to authenticated
  using (public.tec_equipe(empresa_id) and (loja_empresa_id is null or status = 'rascunho'))
  with check (public.tec_equipe(empresa_id) and (loja_empresa_id is null or status = 'rascunho'));
drop policy if exists tec_pedidos_loja_ler on public.tec_pedidos;
create policy tec_pedidos_loja_ler on public.tec_pedidos for select to authenticated
  using (status <> 'rascunho' and loja_empresa_id is not null and public.tec_equipe(loja_empresa_id));

drop policy if exists tec_pedido_itens_inserir on public.tec_pedido_itens;
create policy tec_pedido_itens_inserir on public.tec_pedido_itens for insert to authenticated
  with check (public.tec_equipe(empresa_id) and exists (
    select 1 from public.tec_pedidos p where p.empresa_id = tec_pedido_itens.empresa_id and p.id = tec_pedido_itens.pedido_id
      and (p.loja_empresa_id is null or p.status = 'rascunho')));
drop policy if exists tec_pedido_itens_atualizar on public.tec_pedido_itens;
create policy tec_pedido_itens_atualizar on public.tec_pedido_itens for update to authenticated
  using (public.tec_equipe(empresa_id) and exists (
    select 1 from public.tec_pedidos p where p.empresa_id = tec_pedido_itens.empresa_id and p.id = tec_pedido_itens.pedido_id
      and (p.loja_empresa_id is null or p.status = 'rascunho')))
  with check (public.tec_equipe(empresa_id));
drop policy if exists tec_pedido_itens_loja_ler on public.tec_pedido_itens;
create policy tec_pedido_itens_loja_ler on public.tec_pedido_itens for select to authenticated
  using (public.tec_loja_ve_pedido(pedido_id));

-- Conferência: deve listar 8 tabelas com RLS ligado (true)
select c.relname as tabela, c.relrowsecurity as rls_ligado
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'tec\_%'
order by 1;
