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
