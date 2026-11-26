-- SUBIDA PARA PRODUÇÃO: migrações 0010, 0011 e 0013 a 0025 num arquivo só (gerado em 26/11/2026).
-- COMO USAR: (1) backup da produção ANTES. (2) Rodar tudo de uma vez. Roda dentro de uma transação: se algo falhar, NADA é alterado.
-- NÃO rode duas vezes: a segunda rodada é recusada e desfeita por inteiro (nada fica pela metade).
-- No fim, a tabela de conferência deve mostrar "ok" em todas as linhas.
begin;

-- ======================================================================
-- 0010_tecidos
-- ======================================================================
-- Durant Ateliê — módulo TECIDOS: lojas/fornecedores de tecido, catálogo e pedido de tecido
-- (cole inteiro no SQL Editor e clique em Run — primeiro na HOMOLOGAÇÃO)
--
-- Escopo desta migração = lado COMPRADOR (a alfaiataria que pede tecido às lojas):
--   lojas e vendedores · catálogo de tecidos por loja (com apelidos) · destinos de entrega ·
--   pedido de tecido do dia (cabeçalho + itens, com cliente final e destino por item) · mensagens trocadas.
-- Módulo à parte: não toca em `reg`, nem em fábrica/ateliê. Só reaproveita empresas, membros, papel_em() e audit_log.
-- O lado LOJA (a loja de tecido como empresa, com painel próprio) fica para depois: `empresas.fornece_tecido` já marca o perfil.
--
-- Segurança (mesmas regras do resto do sistema):
--   • RLS ligado em todas as tabelas, nada para anônimo, permissões explícitas;
--   • só a EQUIPE da empresa (admin e usuário) acessa; o papel `parceiro` NÃO enxerga nada daqui;
--   • chaves estrangeiras COMPOSTAS (empresa_id, id): um registro nunca aponta para dado de outra empresa;
--   • exclusão: só admin (pedido em rascunho a equipe também apaga); o resto se desativa (ativo=false);
--   • toda criação/alteração/exclusão vai para o audit_log imutável.
-- Depende de 0001 (base), 0003 (audit_log), 0004 (perfil) e 0005 (papel_em). Roda de novo sem quebrar.

-- 0) Perfil: a empresa também pode ser uma loja de tecido (uso futuro) ---------------------------
alter table public.empresas add column if not exists fornece_tecido boolean not null default false;

-- 1) Apoio -------------------------------------------------------------------------------------
create or replace function public.tec_equipe(p_emp uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.papel_em(p_emp) in ('admin', 'usuario'), false)
$$;
revoke all on function public.tec_equipe(uuid) from public, anon;
grant execute on function public.tec_equipe(uuid) to authenticated;

create or replace function public.tec_admin(p_emp uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.papel_em(p_emp) = 'admin', false)
$$;
revoke all on function public.tec_admin(uuid) from public, anon;
grant execute on function public.tec_admin(uuid) to authenticated;

-- 2) Tabelas ------------------------------------------------------------------------------------
create table if not exists public.tec_lojas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  nome        text not null check (length(btrim(nome)) > 0),
  cnpj        text,
  whatsapp    text,                       -- número geral da loja (só dígitos, com DDI: 5511999998888)
  observacoes text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  criado_por  uuid,
  unique (empresa_id, id)
);
create unique index if not exists tec_lojas_nome_uq on public.tec_lojas (empresa_id, lower(btrim(nome)));

create table if not exists public.tec_vendedores (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null,
  loja_id     uuid not null,
  nome        text not null check (length(btrim(nome)) > 0),
  whatsapp    text,
  principal   boolean not null default false,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  criado_por  uuid,
  unique (empresa_id, id),
  foreign key (empresa_id, loja_id) references public.tec_lojas (empresa_id, id) on delete cascade
);
create index if not exists tec_vendedores_loja_idx on public.tec_vendedores (empresa_id, loja_id);

create table if not exists public.tec_catalogo (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null,
  loja_id      uuid not null,
  referencia   text not null check (length(btrim(referencia)) > 0),   -- como a loja chama: 405/3
  nome         text,
  composicao   text,
  largura_cm   numeric(6,1) check (largura_cm is null or largura_cm > 0),
  cor          text,
  preco_metro  numeric(12,2) check (preco_metro is null or preco_metro >= 0),
  apelidos     text[] not null default '{}',                           -- jeitos de pedir: {"o azul da imperiale"}
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),
  criado_por   uuid,
  unique (empresa_id, id),
  foreign key (empresa_id, loja_id) references public.tec_lojas (empresa_id, id) on delete cascade
);
create unique index if not exists tec_catalogo_ref_uq on public.tec_catalogo (empresa_id, loja_id, lower(btrim(referencia)));

create table if not exists public.tec_destinos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  nome        text not null check (length(btrim(nome)) > 0),           -- "Ateliê", "Maria", "WGT"
  endereco    text,
  observacoes text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  criado_por  uuid,
  unique (empresa_id, id)
);
create unique index if not exists tec_destinos_nome_uq on public.tec_destinos (empresa_id, lower(btrim(nome)));

create table if not exists public.tec_pedidos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id) on delete cascade,
  numero         integer,                               -- sequencial por empresa (preenchido por gatilho)
  dia            date not null default current_date,
  loja_id        uuid not null,
  vendedor_id    uuid,
  status         text not null default 'rascunho'
                   check (status in ('rascunho', 'enviado', 'parcial', 'concluido', 'cancelado')),
  texto_original text,                                   -- a mensagem como foi escrita/falada, para conferência
  enviado_em     timestamptz,
  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  unique (empresa_id, id),
  foreign key (empresa_id, loja_id)     references public.tec_lojas (empresa_id, id),
  foreign key (empresa_id, vendedor_id) references public.tec_vendedores (empresa_id, id)
);
create unique index if not exists tec_pedidos_numero_uq on public.tec_pedidos (empresa_id, numero);
create index if not exists tec_pedidos_dia_idx on public.tec_pedidos (empresa_id, dia desc);

create table if not exists public.tec_pedido_itens (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null,
  pedido_id           uuid not null,
  catalogo_id         uuid,
  referencia          text not null check (length(btrim(referencia)) > 0),  -- fica gravada mesmo se o catálogo mudar
  descricao           text,
  metragem            numeric(8,2) not null check (metragem > 0),
  cliente_final       text,                                                 -- para quem é o tecido: João Paiva
  destino_id          uuid,
  destino_texto       text,                                                 -- destino digitado que não existe no cadastro
  status              text not null default 'pendente'
                        check (status in ('pendente', 'disponivel', 'parcial', 'indisponivel')),
  metragem_confirmada numeric(8,2) check (metragem_confirmada is null or metragem_confirmada >= 0),
  obs                 text,
  criado_em           timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, pedido_id)   references public.tec_pedidos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, catalogo_id) references public.tec_catalogo (empresa_id, id) on delete set null (catalogo_id),
  foreign key (empresa_id, destino_id)  references public.tec_destinos (empresa_id, id) on delete set null (destino_id)
);
create index if not exists tec_itens_pedido_idx on public.tec_pedido_itens (empresa_id, pedido_id);

create table if not exists public.tec_mensagens (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null,
  pedido_id   uuid not null,
  direcao     text not null check (direcao in ('saida', 'entrada')),       -- saida = nós → vendedor; entrada = vendedor → nós
  corpo       text not null,
  criado_em   timestamptz not null default now(),
  criado_por  uuid,
  foreign key (empresa_id, pedido_id) references public.tec_pedidos (empresa_id, id) on delete cascade
);
create index if not exists tec_mensagens_pedido_idx on public.tec_mensagens (empresa_id, pedido_id, criado_em);

-- 3) Número do pedido: sequencial por empresa, sem furo nem repetição ---------------------------
create or replace function public.tec_numerar() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.numero is null then
    perform pg_advisory_xact_lock(hashtextextended('tec_pedidos:' || new.empresa_id::text, 0));
    select coalesce(max(numero), 0) + 1 into new.numero from public.tec_pedidos where empresa_id = new.empresa_id;
  end if;
  return new;
end $$;
revoke all on function public.tec_numerar() from public, anon, authenticated;
drop trigger if exists tec_pedidos_numerar on public.tec_pedidos;
create trigger tec_pedidos_numerar before insert on public.tec_pedidos
  for each row execute function public.tec_numerar();

-- Dono do registro e número não podem ser forjados nem trocados depois
create or replace function public.tec_dono() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then new.criado_por := (select auth.uid()); end if;
  else
    if new.empresa_id is distinct from old.empresa_id or new.id is distinct from old.id then
      raise exception 'registro não pode mudar de empresa nem de id';
    end if;
    new.criado_por := old.criado_por;
    if tg_table_name = 'tec_pedidos' then new.numero := old.numero; end if;
  end if;
  return new;
end $$;
revoke all on function public.tec_dono() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['tec_lojas', 'tec_vendedores', 'tec_catalogo', 'tec_destinos', 'tec_pedidos', 'tec_mensagens'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_dono', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.tec_dono()', t || '_dono', t);
  end loop;
end $$;

-- 4) Auditoria: mesma tabela imutável do resto do sistema (k = nome da tabela) ---------------------
create or replace function public.auditar_tec() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_emp uuid; v_id text; v_old jsonb; v_new jsonb;
  v_campos text[]; v_antes jsonb; v_depois jsonb; v_ip text;
begin
  if tg_op = 'DELETE' then v_emp := old.empresa_id; v_id := to_jsonb(old) ->> 'id'; v_old := to_jsonb(old);
  else v_emp := new.empresa_id; v_id := to_jsonb(new) ->> 'id'; v_new := to_jsonb(new); if tg_op = 'UPDATE' then v_old := to_jsonb(old); end if; end if;

  if tg_op = 'INSERT' then v_depois := v_new;
  elsif tg_op = 'DELETE' then v_antes := v_old;
  else
    select array_agg(key order by key) into v_campos
    from jsonb_object_keys(v_old || v_new) as key where (v_old -> key) is distinct from (v_new -> key);
    if v_campos is null then return null; end if;
    select jsonb_object_agg(c, v_old -> c), jsonb_object_agg(c, v_new -> c) into v_antes, v_depois from unnest(v_campos) as c;
  end if;

  begin
    v_ip := nullif(btrim(split_part(coalesce((current_setting('request.headers', true))::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then v_ip := null; end;

  insert into public.audit_log (empresa_id, user_id, acao, k, reg_id, campos, antes, depois, ip)
  values (v_emp, auth.uid(), lower(tg_op), tg_table_name, v_id, v_campos, v_antes, v_depois, v_ip);
  return null;
end $$;
revoke all on function public.auditar_tec() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['tec_lojas', 'tec_vendedores', 'tec_catalogo', 'tec_destinos', 'tec_pedidos', 'tec_pedido_itens'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_auditar', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.auditar_tec()', t || '_auditar', t);
  end loop;
end $$;

-- 5) RLS e permissões ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tec_lojas', 'tec_vendedores', 'tec_catalogo', 'tec_destinos', 'tec_pedidos', 'tec_pedido_itens', 'tec_mensagens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.tec_equipe(empresa_id))', t || '_ler', t);

    execute format('drop policy if exists %I on public.%I', t || '_inserir', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.tec_equipe(empresa_id))', t || '_inserir', t);

    execute format('drop policy if exists %I on public.%I', t || '_atualizar', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.tec_equipe(empresa_id)) with check (public.tec_equipe(empresa_id))', t || '_atualizar', t);
  end loop;
end $$;

-- exclusão: admin apaga qualquer coisa; a equipe só apaga o que ainda é rascunho
do $$
declare t text;
begin
  foreach t in array array['tec_lojas', 'tec_vendedores', 'tec_catalogo', 'tec_destinos', 'tec_mensagens'] loop
    execute format('drop policy if exists %I on public.%I', t || '_apagar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.tec_admin(empresa_id))', t || '_apagar', t);
  end loop;
end $$;

drop policy if exists tec_pedidos_apagar on public.tec_pedidos;
create policy tec_pedidos_apagar on public.tec_pedidos for delete to authenticated
  using (public.tec_admin(empresa_id) or (public.tec_equipe(empresa_id) and status = 'rascunho'));

drop policy if exists tec_pedido_itens_apagar on public.tec_pedido_itens;
create policy tec_pedido_itens_apagar on public.tec_pedido_itens for delete to authenticated
  using (public.tec_admin(empresa_id) or (public.tec_equipe(empresa_id) and exists (
    select 1 from public.tec_pedidos p where p.empresa_id = tec_pedido_itens.empresa_id and p.id = tec_pedido_itens.pedido_id and p.status = 'rascunho')));

-- Conferência: 7 tabelas com RLS ligado (true)
select c.relname as tabela, c.relrowsecurity as rls_ligado
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'tec\_%'
order by 1;

-- ======================================================================
-- 0011_tecidos_loja
-- ======================================================================
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

-- ======================================================================
-- 0013_cadastro_empresa
-- ======================================================================
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

-- ======================================================================
-- 0014_empresa_tipo_travado
-- ======================================================================
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

-- ======================================================================
-- 0015_painel_plataforma
-- ======================================================================
-- 0015 — Painel de controle do Alinhavo (só administrador da plataforma) e suspensão de empresa.
-- Suspender = a empresa some do acesso de todos os usuários (nada é apagado). Vale para todas as tabelas, porque
-- as regras de linha (RLS) leem `membros`, e a regra de leitura de `membros` passa a esconder empresas suspensas.
alter table public.empresas add column if not exists ativa boolean not null default true;
alter table public.empresas add column if not exists suspensa_em timestamptz;

create or replace function public.empresa_ativa(p_emp uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select e.ativa from public.empresas e where e.id = p_emp), false)
$$;
revoke all on function public.empresa_ativa(uuid) from public, anon;
grant execute on function public.empresa_ativa(uuid) to authenticated;

drop policy if exists membros_ler_proprio on public.membros;
create policy membros_ler_proprio on public.membros for select to authenticated
  using (user_id = (select auth.uid()) and public.empresa_ativa(empresa_id));

create or replace function public.papel_em(p_emp uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.papel from public.membros m where m.user_id = (select auth.uid()) and m.empresa_id = p_emp and public.empresa_ativa(p_emp)
$$;

-- Lista das empresas (só plataforma)
create or replace function public.plataforma_empresas() returns table (
  id uuid, nome text, cnpj text, cadastro jsonb, vende boolean, produz boolean, fornece boolean, so_tecidos boolean,
  ativa boolean, criado_em timestamptz, usuarios integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select e.id, e.nome, e.cnpj, e.cadastro, e.vende_cliente_final, e.produz, e.fornece_tecido, e.somente_tecidos,
           e.ativa, e.criado_em, (select count(*)::int from public.membros m where m.empresa_id = e.id)
      from public.empresas e order by e.criado_em, e.nome;
end $$;

-- Usuários de uma empresa (só plataforma)
create or replace function public.plataforma_usuarios(p_empresa uuid) returns table (email text, papel text, criado_em timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query select u.email::text, m.papel, m.criado_em from public.membros m join auth.users u on u.id = m.user_id
                where m.empresa_id = p_empresa order by m.criado_em;
end $$;

-- Suspender / reativar (só plataforma). Nunca apaga dados.
create or replace function public.plataforma_definir_ativa(p_empresa uuid, p_ativa boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.empresas set ativa = coalesce(p_ativa, true), suspensa_em = case when coalesce(p_ativa, true) then null else now() end where id = p_empresa;
  if not found then raise exception 'empresa inexistente' using errcode = 'P0002'; end if;
  perform public._audit_acao(p_empresa, 'update', 'empresa', p_empresa::text, jsonb_build_object('ativa', coalesce(p_ativa, true)));
end $$;

revoke all on function public.plataforma_empresas(), public.plataforma_usuarios(uuid), public.plataforma_definir_ativa(uuid, boolean) from public, anon;
grant execute on function public.plataforma_empresas(), public.plataforma_usuarios(uuid), public.plataforma_definir_ativa(uuid, boolean) to authenticated;

-- ======================================================================
-- 0016_empresa_doc_so_plataforma
-- ======================================================================
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

-- ======================================================================
-- 0018_tipo_empresa
-- ======================================================================
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

-- ======================================================================
-- 0019_nome_fantasia
-- ======================================================================
-- 0019 — o nome fantasia salvo no cadastro passa a ser o nome da empresa (empresas.nome, usado no sistema e na lista do painel).
-- A razão social continua só no cadastro.
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
    update public.empresas set cadastro = v_cad, nome = coalesce(nullif(v_cad ->> 'fantasia', ''), nome) where id = p_empresa;
    return;
  end if;
  v_doc := regexp_replace(coalesce(v_cad ->> 'doc', ''), '\D', '', 'g');
  if v_doc = '' then raise exception 'Informe o CNPJ (ou CPF) da empresa.' using errcode = '22023'; end if;
  if length(v_doc) not in (11, 14) then raise exception 'CPF tem 11 números e CNPJ tem 14.' using errcode = '22023'; end if;
  begin
    update public.empresas set cadastro = v_cad, cnpj = v_doc, nome = coalesce(nullif(v_cad ->> 'fantasia', ''), nome) where id = p_empresa;
  exception when unique_violation then
    raise exception 'Este CNPJ/CPF já está cadastrado em outra empresa.' using errcode = '23505';
  end;
end $$;
revoke all on function public.salvar_empresa(uuid, jsonb) from public, anon;
grant execute on function public.salvar_empresa(uuid, jsonb) to authenticated;

-- ======================================================================
-- 0020_razao_so_plataforma
-- ======================================================================
-- 0020 — razão social também só muda pela plataforma. A empresa edita contatos, endereço e nome fantasia.
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
        v_cad := v_cad || jsonb_build_object('doc', coalesce(v_old ->> 'doc', ''), 'tipo', coalesce(v_old ->> 'tipo', ''), 'razao', coalesce(v_old ->> 'razao', ''));
    update public.empresas set cadastro = v_cad, nome = coalesce(nullif(v_cad ->> 'fantasia', ''), nome) where id = p_empresa;
    return;
  end if;
  v_doc := regexp_replace(coalesce(v_cad ->> 'doc', ''), '\D', '', 'g');
  if v_doc = '' then raise exception 'Informe o CNPJ (ou CPF) da empresa.' using errcode = '22023'; end if;
  if length(v_doc) not in (11, 14) then raise exception 'CPF tem 11 números e CNPJ tem 14.' using errcode = '22023'; end if;
  begin
    update public.empresas set cadastro = v_cad, cnpj = v_doc, nome = coalesce(nullif(v_cad ->> 'fantasia', ''), nome) where id = p_empresa;
  exception when unique_violation then
    raise exception 'Este CNPJ/CPF já está cadastrado em outra empresa.' using errcode = '23505';
  end;
end $$;
revoke all on function public.salvar_empresa(uuid, jsonb) from public, anon;
grant execute on function public.salvar_empresa(uuid, jsonb) to authenticated;

-- ======================================================================
-- 0021_sem_tipo_fabrica
-- ======================================================================
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

-- ======================================================================
-- 0022_tipo_loja
-- ======================================================================
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

-- ======================================================================
-- 0023_painel_2fa
-- ======================================================================
-- Painel da plataforma exige verificação em duas etapas (TOTP, nível aal2 do Supabase Auth).
-- Sem o segundo fator, a pessoa pode ser administradora cadastrada, mas _eh_plataforma() é falso
-- e nenhuma função da plataforma responde. Quem decide é o servidor, não a tela.

create or replace function public._aal2() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
$$;
revoke all on function public._aal2() from public, anon, authenticated;

create or replace function public._eh_plataforma() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public._aal2() and exists (select 1 from public.plataforma_admins p where p.user_id = (select auth.uid()))
$$;
revoke all on function public._eh_plataforma() from public, anon, authenticated;

-- A tela precisa saber se a pessoa é administradora cadastrada (para pedir o segundo fator
-- em vez de "sem acesso"). Responde só sobre quem está logado; não revela ninguém.
create or replace function public.plataforma_admin_cadastrado() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.plataforma_admins p where p.user_id = (select auth.uid()))
$$;
revoke all on function public.plataforma_admin_cadastrado() from public, anon;
grant execute on function public.plataforma_admin_cadastrado() to authenticated;

-- Administradores da plataforma (inclui o administrador de emergência). Só com 2FA.
create or replace function public.plataforma_admins_listar() returns table (user_id uuid, email text, eu boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query select p.user_id, u.email::text, p.user_id = (select auth.uid())
    from public.plataforma_admins p join auth.users u on u.id = p.user_id order by u.email;
end $$;
revoke all on function public.plataforma_admins_listar() from public, anon;
grant execute on function public.plataforma_admins_listar() to authenticated;

create or replace function public.plataforma_admin_adicionar(p_email text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_id is null then raise exception 'essa pessoa ainda não tem conta: peça para ela entrar uma vez no sistema'; end if;
  insert into public.plataforma_admins (user_id) values (v_id) on conflict do nothing;
  perform public._audit_acao(null, 'insert', 'plataforma_admins', v_id::text, jsonb_build_object('email', lower(btrim(p_email))));
end $$;
revoke all on function public.plataforma_admin_adicionar(text) from public, anon;
grant execute on function public.plataforma_admin_adicionar(text) to authenticated;

create or replace function public.plataforma_admin_remover(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'você não pode remover o próprio acesso'; end if;
  if (select count(*) from public.plataforma_admins) <= 1 then raise exception 'precisa sobrar ao menos um administrador'; end if;
  delete from public.plataforma_admins where user_id = p_user;
  perform public._audit_acao(null, 'delete', 'plataforma_admins', p_user::text, null);
end $$;
revoke all on function public.plataforma_admin_remover(uuid) from public, anon;
grant execute on function public.plataforma_admin_remover(uuid) to authenticated;

-- ======================================================================
-- 0024_pessoas_cpf
-- ======================================================================
-- Cadastro único de pessoa (CPF único) e apoio ao login por CPF.
-- A pessoa é a conta de login (auth.users); o CPF identifica a pessoa em todas as empresas dela.

create or replace function public._cpf_ok(c text) returns boolean
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(c, ''), '\D', '', 'g'); s int; r int; i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;

create table if not exists public.pessoas (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  cpf       text not null unique check (cpf ~ '^[0-9]{11}$'),
  nome      text,
  criado_em timestamptz not null default now()
);
alter table public.pessoas enable row level security;
revoke all on public.pessoas from anon, authenticated;

create or replace function public.minha_pessoa() returns table (cpf text, nome text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.cpf, p.nome from public.pessoas p where p.user_id = (select auth.uid())
$$;
revoke all on function public.minha_pessoa() from public, anon;
grant execute on function public.minha_pessoa() to authenticated;

create or replace function public.salvar_minha_pessoa(p_cpf text, p_nome text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  if (select auth.uid()) is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not public._cpf_ok(v_cpf) then raise exception 'CPF inválido'; end if;
  begin
    insert into public.pessoas (user_id, cpf, nome) values ((select auth.uid()), v_cpf, nullif(btrim(coalesce(p_nome, '')), ''))
    on conflict (user_id) do update set cpf = excluded.cpf, nome = coalesce(excluded.nome, public.pessoas.nome);
  exception when unique_violation then
    raise exception 'este CPF já está cadastrado em outra conta';
  end;
end $$;
revoke all on function public.salvar_minha_pessoa(text, text) from public, anon;
grant execute on function public.salvar_minha_pessoa(text, text) to authenticated;

-- Login por CPF: só a função de servidor (service_role) consulta. Nunca exposta ao navegador.
create table if not exists public.login_cpf_falhas (
  cpf text primary key, falhas int not null default 0, bloqueado_ate timestamptz
);
alter table public.login_cpf_falhas enable row level security;
revoke all on public.login_cpf_falhas from anon, authenticated;

create or replace function public.login_cpf_email(p_cpf text) returns table (email text, bloqueado boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.email::text, coalesce(f.bloqueado_ate > now(), false)
  from public.pessoas p join auth.users u on u.id = p.user_id
  left join public.login_cpf_falhas f on f.cpf = p.cpf
  where p.cpf = regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')
$$;
create or replace function public.login_cpf_falha(p_cpf text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  if not exists (select 1 from public.pessoas where cpf = v) then return; end if;
  insert into public.login_cpf_falhas (cpf, falhas) values (v, 1)
  on conflict (cpf) do update set falhas = case when public.login_cpf_falhas.bloqueado_ate is not null and public.login_cpf_falhas.bloqueado_ate <= now() then 1 else public.login_cpf_falhas.falhas + 1 end;
  update public.login_cpf_falhas set bloqueado_ate = now() + interval '15 minutes', falhas = 0 where cpf = v and falhas >= 5;
end $$;
create or replace function public.login_cpf_ok(p_cpf text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.login_cpf_falhas where cpf = regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')
$$;
revoke all on function public.login_cpf_email(text), public.login_cpf_falha(text), public.login_cpf_ok(text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.login_cpf_email(text), public.login_cpf_falha(text), public.login_cpf_ok(text) to service_role;
  end if;
end $$;

-- ======================================================================
-- 0025_convite_empresa_tipo
-- ======================================================================
-- Convite de empresa nova já define o tipo (Ateliê, Alfaiataria ou Loja de tecido).
-- A empresa nasce com o tipo e os módulos certos; o administrador da plataforma não precisa ajustar depois.

alter table public.convites add column if not exists tipo text check (tipo is null or tipo in ('atelie', 'alfaiataria', 'loja'));

create or replace function public.criar_convite_empresa(p_email text, p_empresa_nome text, p_vende boolean, p_produz boolean, p_tipo text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_nome text := btrim(coalesce(p_empresa_nome, '')); v_token text; v_id uuid;
begin
  if not public._eh_plataforma() then raise exception 'só o administrador da plataforma cria empresas' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'e-mail inválido'; end if;
  if length(v_nome) < 2 or length(v_nome) > 120 then raise exception 'nome da empresa inválido (2 a 120 letras)'; end if;
  if p_tipo is null or p_tipo not in ('atelie', 'alfaiataria', 'loja') then raise exception 'escolha o tipo da empresa: ateliê, alfaiataria ou loja de tecido'; end if;
  update public.convites set status = 'cancelado'
   where empresa_id is null and email = v_email and empresa_nome = v_nome and status = 'pendente';
  v_token := public._novo_token();
  insert into public.convites (empresa_id, email, papel, empresa_nome, vende, produz, tipo, token_hash, criado_por)
  values (null, v_email, 'admin', v_nome, p_tipo <> 'loja', false, p_tipo, public._hash_token(v_token), (select auth.uid()))
  returning id into v_id;
  perform public._audit_acao(null, 'insert', 'convite', v_id::text, jsonb_build_object('email', v_email, 'empresa', v_nome, 'tipo', 'empresa_nova', 'tipo_empresa', p_tipo));
  return v_token;
end $$;
revoke all on function public.criar_convite_empresa(text, text, boolean, boolean, text) from public, anon;
grant execute on function public.criar_convite_empresa(text, text, boolean, boolean, text) to authenticated;

create or replace function public.aceitar_convite(p_token text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites; v_emp uuid;
begin
  if (select auth.uid()) is null then raise exception 'entre na sua conta para aceitar o convite' using errcode = '42501'; end if;
  select * into c from public.convites where token_hash = public._hash_token(p_token) for update;
  if not found or c.status <> 'pendente' or c.expira_em < now() then raise exception 'convite inválido ou expirado'; end if;
  if public._email_logado() is distinct from c.email then raise exception 'este convite é para outro e-mail'; end if;
  if c.empresa_id is null then
    insert into public.empresas (nome, vende_cliente_final, produz, fornece_tecido, tipo)
    values (btrim(c.empresa_nome), coalesce(c.vende, true), coalesce(c.produz, false), c.tipo = 'loja', c.tipo) returning id into v_emp;
  else
    v_emp := c.empresa_id;
  end if;
  insert into public.membros (user_id, empresa_id, papel, nome_parceiro) values ((select auth.uid()), v_emp, c.papel, c.nome_parceiro)
  on conflict (user_id, empresa_id) do nothing;
  update public.convites set status = 'aceito', aceito_em = now(), aceito_por = (select auth.uid()), empresa_id = v_emp where id = c.id;
  perform public._audit_acao(v_emp, 'update', 'convite', c.id::text, jsonb_build_object('status', 'aceito', 'papel', c.papel));
  return v_emp;
end $$;
revoke all on function public.aceitar_convite(text) from public, anon;
grant execute on function public.aceitar_convite(text) to authenticated;

-- ======================================================================
-- CONFERÊNCIA FINAL
-- ======================================================================
select 'tabelas novas' item, case when to_regclass('public.pessoas') is not null and to_regclass('public.login_cpf_falhas') is not null then 'ok' else 'FALTA' end resultado, '' detalhe
union all select 'empresas.tipo', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='empresas' and column_name='tipo') then 'ok' else 'FALTA' end, ''
union all select 'convites.tipo', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='convites' and column_name='tipo') then 'ok' else 'FALTA' end, ''
union all select 'criar_convite_empresa (5 argumentos)', case when exists (select 1 from pg_proc where proname='criar_convite_empresa' and pronargs=5) then 'ok' else 'FALTA' end, ''
union all select 'registros do app (reg)', case when count(*) >= 295 then 'ok' else 'CONFERIR' end, count(*)::text from public.reg
union all select 'empresas', case when count(*) >= 1 then 'ok' else 'FALTA' end, count(*)::text from public.empresas
union all select 'administradores', case when count(*) >= 1 then 'ok' else 'FALTA' end, count(*)::text from public.membros where papel='admin';
commit;
