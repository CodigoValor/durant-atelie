-- SUBIDA PARA PRODUÇÃO: migrações 0003 a 0009 num arquivo só (gerado em 26/11/2026).
-- COMO USAR: (1) faça o backup da produção ANTES. (2) Cole este arquivo inteiro no SQL Editor do Supabase de PRODUÇÃO e clique em Run.
-- Tudo roda dentro de uma transação: se algo falhar, NADA é alterado (volta ao estado anterior). Pode rodar de novo com segurança.
-- No fim aparece uma tabela de conferência: todas as linhas devem mostrar "ok".
begin;

-- ======================================================================
-- 0003_auditoria.sql
-- ======================================================================
-- Durant Ateliê — log de auditoria imutável (cole inteiro no SQL Editor e clique em Run)
-- Registra, no servidor, TODA criação / alteração / exclusão de documento (tabela reg):
-- quem (usuário real do login), quando (hora do servidor), de onde (IP) e o que mudou (antes e depois).
-- Ninguém consegue editar nem apagar o log pela API; só administradores da empresa conseguem ler.
-- Não registra: backups internos do app (k='bkp'), o marcador de sistema (k='sys') e o catálogo público derivado (k='pub'), por serem ruído.

-- 1) Tabela ----------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  empresa_id uuid        not null,          -- sem chave estrangeira de propósito: o log sobrevive a qualquer exclusão
  user_id    uuid,                          -- auth.uid() de quem fez (nulo = feito direto no banco, fora do app)
  acao       text        not null check (acao in ('insert', 'update', 'delete')),
  k          text        not null,          -- tipo do documento (clientes, pedidos, ...)
  reg_id     text        not null,          -- id do documento em reg
  campos     text[],                        -- update: quais campos mudaram
  antes      jsonb,                         -- update: só os campos que mudaram (valor antigo) | delete: documento inteiro
  depois     jsonb,                         -- update: só os campos que mudaram (valor novo)   | insert: documento inteiro
  ip         text,
  em         timestamptz not null default now()
);
create index if not exists audit_log_empresa_em_idx  on public.audit_log (empresa_id, em desc);
create index if not exists audit_log_registro_idx    on public.audit_log (empresa_id, k, reg_id, em desc);

-- 2) Imutável: nem update, nem delete, nem truncate ---------------------------
create or replace function public.audit_log_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log é imutável (somente inclusão)';
end $$;

drop trigger if exists audit_log_sem_alterar on public.audit_log;
create trigger audit_log_sem_alterar before update or delete on public.audit_log
  for each row execute function public.audit_log_imutavel();
drop trigger if exists audit_log_sem_truncar on public.audit_log;
create trigger audit_log_sem_truncar before truncate on public.audit_log
  for each statement execute function public.audit_log_imutavel();

-- 3) Gatilho que escreve o log ---------------------------------------------
create or replace function public._audit_json(t text) returns jsonb
language plpgsql immutable as $$
begin
  return t::jsonb;
exception when others then
  return to_jsonb(t);   -- conteúdo que não é JSON válido é guardado como texto
end $$;

create or replace function public.auditar_reg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_k text; v_id text; v_emp uuid;
  v_old jsonb; v_new jsonb;
  v_campos text[]; v_antes jsonb; v_depois jsonb;
  v_ip text;
begin
  if tg_op = 'DELETE' then v_k := old.k; v_id := old.id; v_emp := old.empresa_id;
  else                     v_k := new.k; v_id := new.id; v_emp := new.empresa_id; end if;

  if v_k in ('bkp', 'sys', 'pub') then return null; end if;

  if tg_op = 'INSERT' then
    v_depois := public._audit_json(new.j);
  elsif tg_op = 'DELETE' then
    v_antes := public._audit_json(old.j);
  else
    v_old := public._audit_json(old.j);
    v_new := public._audit_json(new.j);
    if jsonb_typeof(v_old) = 'object' and jsonb_typeof(v_new) = 'object' then
      select array_agg(key order by key) into v_campos
      from jsonb_object_keys(v_old || v_new) as key
      where (v_old -> key) is distinct from (v_new -> key);
      if v_campos is null then return null; end if;   -- regravou o mesmo conteúdo: nada a registrar
      select jsonb_object_agg(c, v_old -> c), jsonb_object_agg(c, v_new -> c)
        into v_antes, v_depois from unnest(v_campos) as c;
    else
      if v_old is not distinct from v_new then return null; end if;
      v_antes := v_old; v_depois := v_new;
    end if;
  end if;

  begin
    v_ip := nullif(btrim(split_part(coalesce((current_setting('request.headers', true))::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then
    v_ip := null;
  end;

  insert into public.audit_log (empresa_id, user_id, acao, k, reg_id, campos, antes, depois, ip)
  values (v_emp, auth.uid(), lower(tg_op), v_k, v_id, v_campos, v_antes, v_depois, v_ip);
  return null;
end $$;

revoke all on function public.auditar_reg() from public, anon, authenticated;
revoke all on function public._audit_json(text) from public, anon, authenticated;

drop trigger if exists reg_auditar on public.reg;
create trigger reg_auditar after insert or update or delete on public.reg
  for each row execute function public.auditar_reg();

-- 4) Quem lê: só administradores da própria empresa --------------------------
alter table public.audit_log enable row level security;
drop policy if exists audit_log_ler on public.audit_log;
create policy audit_log_ler on public.audit_log for select to authenticated
  using (empresa_id in (
    select m.empresa_id from public.membros m
    where m.user_id = (select auth.uid()) and m.papel = 'admin'));

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;   -- sem insert/update/delete: quem escreve é o gatilho

-- Conferência: 4 tabelas com RLS ligado (true) e o gatilho de auditoria ativo em reg
select c.relname as tabela, c.relrowsecurity as rls_ligado
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('empresas', 'membros', 'reg', 'audit_log')
order by 1;

-- ======================================================================
-- 0004_perfil_empresa.sql
-- ======================================================================
-- Durant Ateliê — perfil de negócio da empresa (cole inteiro no SQL Editor e clique em Run)
-- Uma empresa pode VENDER ao cliente final (ponto de venda), PRODUZIR (receber pedidos de produção), ou os dois.
-- Por ora só registra o perfil; as telas passam a usá-lo nas próximas fatias.
alter table public.empresas add column if not exists vende_cliente_final boolean not null default true;
alter table public.empresas add column if not exists produz boolean not null default false;

-- Conferência: lista as empresas com o perfil de cada uma
select nome, vende_cliente_final, produz from public.empresas order by nome;

-- ======================================================================
-- 0005_parceiro.sql
-- ======================================================================
-- Durant Ateliê — papel PARCEIRO no servidor (cole inteiro no SQL Editor e clique em Run)
-- Um parceiro é uma pessoa de FORA da empresa (ex.: o Luiz dentro do ateliê da Maria) que lança pedidos de produção.
--   • só enxerga e edita o que ELE MESMO criou, e só nos tipos liberados (clientes, medidas, pedidos, orçamentos);
--   • nunca lê configurações, financeiro, usuários nem contas bancárias;
--   • enxerga um catálogo público (k='pub') mantido por gatilho a partir de uma lista de campos permitidos.
-- Dois parceiros diferentes da mesma empresa NUNCA se veem, mesmo que atendam o mesmo cliente final:
-- cada um tem o próprio cadastro, ligado a quem criou.
-- Depende de 0001 (base). Roda de novo sem quebrar.

-- 1) Novo papel ------------------------------------------------------------
alter table public.membros drop constraint if exists membros_papel_check;
alter table public.membros add constraint membros_papel_check check (papel in ('admin', 'usuario', 'parceiro'));

-- 2) Dono do documento -----------------------------------------------------
alter table public.reg add column if not exists criado_por uuid;   -- nulo = documento anterior a esta migração (só a equipe enxerga)
create index if not exists reg_criado_por_idx on public.reg (empresa_id, criado_por);

-- 3) Funções de apoio (definer, para a regra não depender de ler membros pelo RLS) ---
create or replace function public.papel_em(p_emp uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.papel from public.membros m where m.user_id = (select auth.uid()) and m.empresa_id = p_emp
$$;
revoke all on function public.papel_em(uuid) from public, anon;
grant execute on function public.papel_em(uuid) to authenticated;

-- Tipos de documento que um parceiro pode criar/ler/editar (os dele). Para liberar mais, é só mudar aqui.
create or replace function public.kinds_parceiro() returns text[]
language sql immutable as $$ select array['clientes', 'med', 'pedidos', 'orcamentos']::text[] $$;
revoke all on function public.kinds_parceiro() from public, anon;
grant execute on function public.kinds_parceiro() to authenticated;

-- 4) Gatilho do dono: ninguém consegue forjar criado_por nem trocar o tipo do documento ------
create or replace function public.reg_dono() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then new.criado_por := (select auth.uid()); end if;
  else
    if new.empresa_id is distinct from old.empresa_id or new.id is distinct from old.id then
      raise exception 'documento não pode mudar de empresa nem de id';    -- vale para todos os papéis
    end if;
    new.criado_por := old.criado_por;                                   -- o dono nunca muda
    if public.papel_em(old.empresa_id) = 'parceiro' then new.k := old.k; end if;   -- parceiro não "converte" documento
  end if;
  if new.k = 'pub' then new.criado_por := null; end if;
  return new;
end $$;
revoke all on function public.reg_dono() from public, anon, authenticated;

drop trigger if exists reg_dono on public.reg;
create trigger reg_dono before insert or update on public.reg
  for each row execute function public.reg_dono();

-- 5) Regras de acesso a reg ---------------------------------------------------
-- equipe (admin/usuario): como antes, exceto k='pub' (só o gatilho escreve)
-- parceiro: só os próprios documentos, nos tipos liberados; lê também o catálogo público (k='pub')
drop policy if exists reg_ler on public.reg;
create policy reg_ler on public.reg for select to authenticated using (
  case public.papel_em(empresa_id)
    when 'admin'    then true
    when 'usuario'  then true
    when 'parceiro' then k = 'pub' or (criado_por = (select auth.uid()) and k = any (public.kinds_parceiro()))
    else false end);

drop policy if exists reg_inserir on public.reg;
create policy reg_inserir on public.reg for insert to authenticated with check (
  case public.papel_em(empresa_id)
    when 'admin'    then k <> 'pub'
    when 'usuario'  then k <> 'pub'
    when 'parceiro' then k = any (public.kinds_parceiro()) and criado_por = (select auth.uid())
    else false end);

drop policy if exists reg_atualizar on public.reg;
create policy reg_atualizar on public.reg for update to authenticated
  using (
    case public.papel_em(empresa_id)
      when 'admin'    then k <> 'pub'
      when 'usuario'  then k <> 'pub'
      when 'parceiro' then criado_por = (select auth.uid()) and k = any (public.kinds_parceiro())
      else false end)
  with check (
    case public.papel_em(empresa_id)
      when 'admin'    then k <> 'pub'
      when 'usuario'  then k <> 'pub'
      when 'parceiro' then criado_por = (select auth.uid()) and k = any (public.kinds_parceiro())
      else false end);

drop policy if exists reg_apagar on public.reg;
create policy reg_apagar on public.reg for delete to authenticated using (
  case public.papel_em(empresa_id)
    when 'admin'    then k <> 'pub'
    when 'usuario'  then k <> 'pub'
    when 'parceiro' then criado_por = (select auth.uid()) and k = any (public.kinds_parceiro())
    else false end);

-- 6) Catálogo público derivado ---------------------------------------------------
-- Campos de sing~cfg que o parceiro pode ver (produtos, serviços e tabelas de apoio). Tudo o mais fica de fora:
-- contas, bancos, usuários, grupos, backups, numeração, clube etc.
create or replace function public._cfg_publico_campos() returns text[]
language sql immutable as $$
  select array['produtos', 'servicos', 'tipostec', 'industrias', 'materiais', 'categorias']::text[]
$$;
-- Chaves que nunca saem no catálogo, em qualquer nível (custos e margens do produtor)
create or replace function public._chaves_privadas() returns text[]
language sql immutable as $$
  select array['custo', 'custos', 'cost', 'margem', 'margens', 'markup', 'fornecedor', 'fornecedores', 'obs_interna']::text[]
$$;

create or replace function public._sem_chaves(v jsonb, ks text[]) returns jsonb
language plpgsql immutable as $$
declare r jsonb; e record;
begin
  if jsonb_typeof(v) = 'object' then
    r := '{}'::jsonb;
    for e in select key, value from jsonb_each(v) loop
      if not (e.key = any (ks)) then r := r || jsonb_build_object(e.key, public._sem_chaves(e.value, ks)); end if;
    end loop;
    return r;
  elsif jsonb_typeof(v) = 'array' then
    return coalesce((select jsonb_agg(public._sem_chaves(x, ks)) from jsonb_array_elements(v) x), '[]'::jsonb);
  end if;
  return v;
end $$;

create or replace function public.atualizar_catalogo_publico() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cfg jsonb; v_cat jsonb; v_pub jsonb := '{}'::jsonb; c text;
begin
  if new.k <> 'sing' or new.i not in ('cfg', 'cat') then return null; end if;
  select public._audit_json_ou_nulo(j) into v_cfg from public.reg where empresa_id = new.empresa_id and id = 'sing~cfg';
  select public._audit_json_ou_nulo(j) into v_cat from public.reg where empresa_id = new.empresa_id and id = 'sing~cat';
  if jsonb_typeof(v_cfg) = 'object' then
    foreach c in array public._cfg_publico_campos() loop
      if v_cfg ? c then v_pub := v_pub || jsonb_build_object(c, public._sem_chaves(v_cfg -> c, public._chaves_privadas())); end if;
    end loop;
  end if;
  if v_cat is not null then v_pub := v_pub || jsonb_build_object('cat', public._sem_chaves(v_cat, public._chaves_privadas())); end if;
  insert into public.reg (empresa_id, id, k, i, j, atualizado_em)
  values (new.empresa_id, 'pub~catalogo', 'pub', 'catalogo', v_pub::text, now())
  on conflict (empresa_id, id) do update set j = excluded.j, atualizado_em = now()
    where public.reg.j is distinct from excluded.j;
  return null;
end $$;
revoke all on function public.atualizar_catalogo_publico() from public, anon, authenticated;

create or replace function public._audit_json_ou_nulo(t text) returns jsonb
language plpgsql immutable as $$
begin
  return t::jsonb;
exception when others then
  return null;
end $$;
revoke all on function public._audit_json_ou_nulo(text) from public, anon, authenticated;

drop trigger if exists reg_catalogo_publico on public.reg;
create trigger reg_catalogo_publico after insert or update on public.reg
  for each row when (new.k = 'sing' and new.i in ('cfg', 'cat'))
  execute function public.atualizar_catalogo_publico();

-- Primeira carga do catálogo para empresas que já têm configuração (simula uma edição sem mudar nada)
update public.reg set atualizado_em = atualizado_em where k = 'sing' and i = 'cfg';

-- Conferência: papéis aceitos e quantas empresas já têm catálogo público
select (select count(*) from public.reg where k = 'pub') as catalogos_publicos,
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'membros_papel_check') as papeis;

-- ======================================================================
-- 0006_numeracao.sql
-- ======================================================================
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

-- ======================================================================
-- 0007_convites.sql
-- ======================================================================
-- (Só no arquivo de subida: permite rodar o arquivo de novo. A 0008 muda funções criadas pela 0007; sem estas linhas,
--  repetir o arquivo recriaria as versões antigas ao lado das novas.)
drop function if exists public.criar_convite(uuid, text, text);
drop function if exists public.criar_convite(uuid, text, text, text);
drop function if exists public.listar_membros(uuid);
-- Alinhavo — convites e acessos (cole inteiro no SQL Editor e clique em Run)
-- 1) Cadastro SOMENTE POR CONVITE: ninguém cria conta nem empresa sem um convite válido.
-- 2) Convite de EMPRESA NOVA: só o administrador da plataforma (o Luiz) cria; quem aceita vira administrador da empresa nova.
-- 3) Convite de USUÁRIO: o administrador de uma empresa convida pessoas como admin, usuário ou parceiro.
-- 4) Proteção do último administrador de cada empresa.
-- O link do convite leva um código secreto; o banco guarda só o "hash" dele (quem ler a tabela não consegue montar um link).
-- Convite vale 7 dias, é para UM e-mail e só funciona uma vez.
--
-- ATENÇÃO (Supabase): para o convite funcionar, ligue "Allow new users to sign up" em Authentication > Sign In / Providers.
-- Mesmo ligado, o gatilho abaixo recusa qualquer cadastro cujo e-mail não tenha convite pendente.
-- Consequência: para criar um usuário "na mão" pelo painel do Supabase, crie antes o convite desse e-mail (ou desligue o gatilho
-- por um momento: alter table auth.users disable trigger so_com_convite;  ... depois: enable trigger so_com_convite;).
-- Depende de 0001 (base), 0003 (audit_log), 0004 (perfil da empresa) e 0005 (papel_em). Roda de novo sem quebrar.

-- 1) Administradores da plataforma -----------------------------------------------
create table if not exists public.plataforma_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.plataforma_admins enable row level security;
revoke all on public.plataforma_admins from anon, authenticated;
insert into public.plataforma_admins (user_id)
select u.id from auth.users u where lower(u.email) = 'hd@henriquedurant.com'
on conflict do nothing;

-- 2) Convites ---------------------------------------------------------------------
create table if not exists public.convites (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid references public.empresas (id) on delete cascade,   -- nulo = convite para CRIAR uma empresa nova
  email        text not null check (email = lower(btrim(email)) and length(email) between 5 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  papel        text not null check (papel in ('admin', 'usuario', 'parceiro')),
  empresa_nome text check (empresa_nome is null or length(btrim(empresa_nome)) between 2 and 120),
  vende        boolean,
  produz       boolean,
  token_hash   text not null unique,
  status       text not null default 'pendente' check (status in ('pendente', 'aceito', 'cancelado')),
  expira_em    timestamptz not null default now() + interval '7 days',
  criado_por   uuid,
  criado_em    timestamptz not null default now(),
  aceito_em    timestamptz,
  aceito_por   uuid,
  check (empresa_id is not null or (empresa_nome is not null and papel = 'admin'))
);
create index if not exists convites_empresa_idx on public.convites (empresa_id, status);
create index if not exists convites_email_idx on public.convites (email, status);
alter table public.convites enable row level security;     -- sem política e sem permissão: só as funções abaixo mexem
revoke all on public.convites from anon, authenticated;

-- 3) Apoio -----------------------------------------------------------------------
create or replace function public._email_logado() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(u.email) from auth.users u where u.id = (select auth.uid())
$$;
create or replace function public._eh_plataforma() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.plataforma_admins p where p.user_id = (select auth.uid()))
$$;
create or replace function public._novo_token() returns text
language sql volatile as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;
create or replace function public._hash_token(t text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(t, ''), 'utf8')), 'hex') $$;
create or replace function public._audit_acao(p_emp uuid, p_acao text, p_k text, p_id text, p_depois jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ip text;
begin
  begin
    v_ip := nullif(btrim(split_part(coalesce((current_setting('request.headers', true))::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then v_ip := null;
  end;
  insert into public.audit_log (empresa_id, user_id, acao, k, reg_id, depois, ip)
  values (coalesce(p_emp, '00000000-0000-0000-0000-000000000000'::uuid), (select auth.uid()), p_acao, p_k, p_id, p_depois, v_ip);
end $$;
revoke all on function public._email_logado() from public, anon, authenticated;
revoke all on function public._eh_plataforma() from public, anon, authenticated;
revoke all on function public._novo_token() from public, anon, authenticated;
revoke all on function public._hash_token(text) from public, anon, authenticated;
revoke all on function public._audit_acao(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- 4) Criar convite de USUÁRIO (administrador da empresa) — devolve o código do link, uma única vez ------
create or replace function public.criar_convite(p_empresa uuid, p_email text, p_papel text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_token text; v_id uuid;
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'só o administrador da empresa convida' using errcode = '42501'; end if;
  if p_papel not in ('admin', 'usuario', 'parceiro') then raise exception 'papel inválido'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'e-mail inválido'; end if;
  if exists (select 1 from public.membros m join auth.users u on u.id = m.user_id
              where m.empresa_id = p_empresa and lower(u.email) = v_email) then
    raise exception 'essa pessoa já tem acesso a esta empresa';
  end if;
  update public.convites set status = 'cancelado'                                   -- um convite pendente por pessoa e empresa
   where empresa_id = p_empresa and email = v_email and status = 'pendente';
  v_token := public._novo_token();
  insert into public.convites (empresa_id, email, papel, token_hash, criado_por)
  values (p_empresa, v_email, p_papel, public._hash_token(v_token), (select auth.uid())) returning id into v_id;
  perform public._audit_acao(p_empresa, 'insert', 'convite', v_id::text, jsonb_build_object('email', v_email, 'papel', p_papel));
  return v_token;
end $$;

-- 5) Criar convite de EMPRESA NOVA (só administrador da plataforma) -------------------------------------
create or replace function public.criar_convite_empresa(p_email text, p_empresa_nome text, p_vende boolean, p_produz boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_nome text := btrim(coalesce(p_empresa_nome, '')); v_token text; v_id uuid;
begin
  if not public._eh_plataforma() then raise exception 'só o administrador da plataforma cria empresas' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'e-mail inválido'; end if;
  if length(v_nome) < 2 or length(v_nome) > 120 then raise exception 'nome da empresa inválido (2 a 120 letras)'; end if;
  if not coalesce(p_vende, true) and not coalesce(p_produz, false) then raise exception 'a empresa precisa vender ao cliente final, produzir, ou os dois'; end if;
  update public.convites set status = 'cancelado'
   where empresa_id is null and email = v_email and empresa_nome = v_nome and status = 'pendente';
  v_token := public._novo_token();
  insert into public.convites (empresa_id, email, papel, empresa_nome, vende, produz, token_hash, criado_por)
  values (null, v_email, 'admin', v_nome, coalesce(p_vende, true), coalesce(p_produz, false), public._hash_token(v_token), (select auth.uid()))
  returning id into v_id;
  perform public._audit_acao(null, 'insert', 'convite', v_id::text, jsonb_build_object('email', v_email, 'empresa', v_nome, 'tipo', 'empresa_nova'));
  return v_token;
end $$;

-- 6) Cancelar ------------------------------------------------------------------------------------------
create or replace function public.cancelar_convite(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites;
begin
  select * into c from public.convites where id = p_id for update;
  if not found then raise exception 'convite não encontrado'; end if;
  if not ((c.empresa_id is not null and public.papel_em(c.empresa_id) = 'admin') or (c.empresa_id is null and public._eh_plataforma())) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if c.status <> 'pendente' then raise exception 'este convite não está pendente'; end if;
  update public.convites set status = 'cancelado' where id = p_id;
  perform public._audit_acao(c.empresa_id, 'update', 'convite', p_id::text, jsonb_build_object('status', 'cancelado'));
end $$;

-- 7) Listas para a tela de administração -------------------------------------------------------
create or replace function public.listar_convites(p_empresa uuid default null)
returns table (id uuid, email text, papel text, empresa_nome text, status text, estado text, expira_em timestamptz, criado_em timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_empresa is null then
    if not public._eh_plataforma() then raise exception 'sem permissão' using errcode = '42501'; end if;
  elsif public.papel_em(p_empresa) is distinct from 'admin' then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select c.id, c.email, c.papel, c.empresa_nome, c.status,
           case c.status when 'aceito' then 'usado' when 'cancelado' then 'cancelado'
                else case when c.expira_em < now() then 'expirado' else 'valido' end end,
           c.expira_em, c.criado_em
      from public.convites c
     where (p_empresa is null and c.empresa_nome is not null)          -- convites de empresa nova, inclusive os já aceitos
        or (p_empresa is not null and c.empresa_id = p_empresa)
     order by c.criado_em desc limit 200;
end $$;

create or replace function public.listar_membros(p_empresa uuid)
returns table (user_id uuid, email text, papel text, desde timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select m.user_id, lower(u.email)::text, m.papel, m.criado_em
      from public.membros m join auth.users u on u.id = m.user_id
     where m.empresa_id = p_empresa order by m.criado_em;
end $$;

-- 8) Quem recebeu o link vê para onde foi convidado (sem login; e-mail mascarado) ----------------------
create or replace function public.convite_info(p_token text)
returns table (valido boolean, email_mascarado text, empresa_nome text, papel text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites; v_nome text;
begin
  select * into c from public.convites where token_hash = public._hash_token(p_token);
  if not found or c.status <> 'pendente' or c.expira_em < now() then
    return query select false, null::text, null::text, null::text; return;
  end if;
  select coalesce(c.empresa_nome, e.nome) into v_nome from (select 1) x left join public.empresas e on e.id = c.empresa_id;
  return query select true, left(split_part(c.email, '@', 1), 2) || '***@' || split_part(c.email, '@', 2), v_nome, c.papel;
end $$;

-- 9) Aceitar (já logado, com o MESMO e-mail do convite) ------------------------------------------------
create or replace function public.aceitar_convite(p_token text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites; v_emp uuid;
begin
  if (select auth.uid()) is null then raise exception 'entre na sua conta para aceitar o convite' using errcode = '42501'; end if;
  select * into c from public.convites where token_hash = public._hash_token(p_token) for update;
  if not found or c.status <> 'pendente' or c.expira_em < now() then raise exception 'convite inválido ou expirado'; end if;
  if public._email_logado() is distinct from c.email then raise exception 'este convite é para outro e-mail'; end if;
  if c.empresa_id is null then
    insert into public.empresas (nome, vende_cliente_final, produz)
    values (btrim(c.empresa_nome), coalesce(c.vende, true), coalesce(c.produz, false)) returning id into v_emp;
  else
    v_emp := c.empresa_id;
  end if;
  insert into public.membros (user_id, empresa_id, papel) values ((select auth.uid()), v_emp, c.papel)
  on conflict (user_id, empresa_id) do nothing;
  update public.convites set status = 'aceito', aceito_em = now(), aceito_por = (select auth.uid()), empresa_id = v_emp where id = c.id;
  perform public._audit_acao(v_emp, 'update', 'convite', c.id::text, jsonb_build_object('status', 'aceito', 'papel', c.papel));
  return v_emp;
end $$;

-- 10) Papéis e remoção de pessoas (só admin da empresa) -----------------------------------------------
create or replace function public.alterar_papel(p_empresa uuid, p_user uuid, p_papel text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'só o administrador altera papéis' using errcode = '42501'; end if;
  if p_papel not in ('admin', 'usuario', 'parceiro') then raise exception 'papel inválido'; end if;
  update public.membros set papel = p_papel where empresa_id = p_empresa and user_id = p_user;
  if not found then raise exception 'pessoa não encontrada nesta empresa'; end if;
  perform public._audit_acao(p_empresa, 'update', 'membro', p_user::text, jsonb_build_object('papel', p_papel));
end $$;

create or replace function public.remover_membro(p_empresa uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'só o administrador remove pessoas' using errcode = '42501'; end if;
  delete from public.membros where empresa_id = p_empresa and user_id = p_user;
  if not found then raise exception 'pessoa não encontrada nesta empresa'; end if;
  perform public._audit_acao(p_empresa, 'delete', 'membro', p_user::text, null);
end $$;

-- 11) Nunca deixar uma empresa sem administrador ------------------------------------------------------------
create or replace function public.proteger_ultimo_admin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.papel = 'admin' and (tg_op = 'DELETE' or new.papel <> 'admin') then
    if exists (select 1 from public.empresas e where e.id = old.empresa_id)                      -- empresa sendo apagada: libera
       and not exists (select 1 from public.membros m where m.empresa_id = old.empresa_id and m.papel = 'admin' and m.user_id <> old.user_id) then
      raise exception 'a empresa precisa de pelo menos um administrador';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.proteger_ultimo_admin() from public, anon, authenticated;
drop trigger if exists membros_ultimo_admin on public.membros;
create trigger membros_ultimo_admin before update or delete on public.membros
  for each row execute function public.proteger_ultimo_admin();

-- 12) Cadastro só com convite (gatilho na tabela de usuários do Supabase) --------------------------------------
create or replace function public.so_com_convite() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.convites c
              where c.email = lower(btrim(new.email)) and c.status = 'pendente' and c.expira_em > now()) then
    return new;
  end if;
  raise exception 'Cadastro somente com convite.';
end $$;
revoke all on function public.so_com_convite() from public, anon, authenticated;
drop trigger if exists so_com_convite on auth.users;
create trigger so_com_convite before insert on auth.users
  for each row execute function public.so_com_convite();

-- 13) Permissões das funções (anônimo só enxerga o aviso do convite) --------------------------------------------
revoke all on function public.criar_convite(uuid, text, text) from public, anon;
revoke all on function public.criar_convite_empresa(text, text, boolean, boolean) from public, anon;
revoke all on function public.cancelar_convite(uuid) from public, anon;
revoke all on function public.listar_convites(uuid) from public, anon;
revoke all on function public.listar_membros(uuid) from public, anon;
revoke all on function public.aceitar_convite(text) from public, anon;
revoke all on function public.alterar_papel(uuid, uuid, text) from public, anon;
revoke all on function public.remover_membro(uuid, uuid) from public, anon;
revoke all on function public.convite_info(text) from public;
grant execute on function public.criar_convite(uuid, text, text) to authenticated;
grant execute on function public.criar_convite_empresa(text, text, boolean, boolean) to authenticated;
grant execute on function public.cancelar_convite(uuid) to authenticated;
grant execute on function public.listar_convites(uuid) to authenticated;
grant execute on function public.listar_membros(uuid) to authenticated;
grant execute on function public.aceitar_convite(text) to authenticated;
grant execute on function public.alterar_papel(uuid, uuid, text) to authenticated;
grant execute on function public.remover_membro(uuid, uuid) to authenticated;
grant execute on function public.convite_info(text) to anon, authenticated;

-- Conferência: administradores da plataforma (deve ter 1) e gatilhos ativos
select (select count(*) from public.plataforma_admins) as admins_da_plataforma,
       (select count(*) from pg_trigger where tgname in ('so_com_convite', 'membros_ultimo_admin') and not tgisinternal) as gatilhos;

-- ======================================================================
-- 0008_origem_parceiro.sql
-- ======================================================================
-- Alinhavo — empresa do parceiro e origem dos documentos (cole inteiro no SQL Editor e clique em Run; roda de novo sem quebrar)
-- Depende de 0005 (parceiro) e 0007 (convites).
-- 1) Todo parceiro tem o NOME DA EMPRESA dele no vínculo (ex.: "Durant Alfaiataria"), informado ao convidar.
-- 2) O dono da produção pergunta "de quem é cada documento?" e o banco responde só com o nome do parceiro (nunca e-mail, nunca dado do cliente).

alter table public.membros  add column if not exists nome_parceiro text;
alter table public.convites add column if not exists nome_parceiro text;
alter table public.membros  drop constraint if exists membros_nome_parceiro_check;
alter table public.membros  add constraint membros_nome_parceiro_check check (nome_parceiro is null or length(btrim(nome_parceiro)) between 2 and 120);
alter table public.convites drop constraint if exists convites_nome_parceiro_check;
alter table public.convites add constraint convites_nome_parceiro_check check (nome_parceiro is null or length(btrim(nome_parceiro)) between 2 and 120);

-- Convite de usuário: parceiro precisa informar a empresa dele ---------------------------------------------------
drop function if exists public.criar_convite(uuid, text, text);
create or replace function public.criar_convite(p_empresa uuid, p_email text, p_papel text, p_nome_parceiro text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_token text; v_id uuid;
        v_nome text := nullif(btrim(coalesce(p_nome_parceiro, '')), '');
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'só o administrador da empresa convida' using errcode = '42501'; end if;
  if p_papel not in ('admin', 'usuario', 'parceiro') then raise exception 'papel inválido'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'e-mail inválido'; end if;
  if p_papel = 'parceiro' then
    if v_nome is null then raise exception 'informe o nome da empresa do parceiro'; end if;
    if length(v_nome) < 2 or length(v_nome) > 120 then raise exception 'nome da empresa do parceiro inválido (2 a 120 letras)'; end if;
  else
    v_nome := null;
  end if;
  if exists (select 1 from public.membros m join auth.users u on u.id = m.user_id
              where m.empresa_id = p_empresa and lower(u.email) = v_email) then
    raise exception 'essa pessoa já tem acesso a esta empresa';
  end if;
  update public.convites set status = 'cancelado'
   where empresa_id = p_empresa and email = v_email and status = 'pendente';
  v_token := public._novo_token();
  insert into public.convites (empresa_id, email, papel, nome_parceiro, token_hash, criado_por)
  values (p_empresa, v_email, p_papel, v_nome, public._hash_token(v_token), (select auth.uid())) returning id into v_id;
  perform public._audit_acao(p_empresa, 'insert', 'convite', v_id::text, jsonb_build_object('email', v_email, 'papel', p_papel, 'parceiro', v_nome));
  return v_token;
end $$;
revoke all on function public.criar_convite(uuid, text, text, text) from public, anon;
grant execute on function public.criar_convite(uuid, text, text, text) to authenticated;

-- Aceitar: leva o nome do parceiro para o vínculo -----------------------------------------------------------------
create or replace function public.aceitar_convite(p_token text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.convites; v_emp uuid;
begin
  if (select auth.uid()) is null then raise exception 'entre na sua conta para aceitar o convite' using errcode = '42501'; end if;
  select * into c from public.convites where token_hash = public._hash_token(p_token) for update;
  if not found or c.status <> 'pendente' or c.expira_em < now() then raise exception 'convite inválido ou expirado'; end if;
  if public._email_logado() is distinct from c.email then raise exception 'este convite é para outro e-mail'; end if;
  if c.empresa_id is null then
    insert into public.empresas (nome, vende_cliente_final, produz)
    values (btrim(c.empresa_nome), coalesce(c.vende, true), coalesce(c.produz, false)) returning id into v_emp;
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

-- Lista de pessoas: agora com o nome da empresa do parceiro --------------------------------------------------------
drop function if exists public.listar_membros(uuid);
create or replace function public.listar_membros(p_empresa uuid)
returns table (user_id uuid, email text, papel text, desde timestamptz, nome_parceiro text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select m.user_id, lower(u.email)::text, m.papel, m.criado_em, m.nome_parceiro
      from public.membros m join auth.users u on u.id = m.user_id
     where m.empresa_id = p_empresa order by m.criado_em;
end $$;
revoke all on function public.listar_membros(uuid) from public, anon;
grant execute on function public.listar_membros(uuid) to authenticated;

-- Corrigir/definir o nome da empresa de um parceiro que já existe -------------------------------------------------
create or replace function public.definir_nome_parceiro(p_empresa uuid, p_user uuid, p_nome text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
begin
  if public.papel_em(p_empresa) is distinct from 'admin' then raise exception 'só o administrador altera isto' using errcode = '42501'; end if;
  if v_nome is null or length(v_nome) < 2 or length(v_nome) > 120 then raise exception 'nome da empresa inválido (2 a 120 letras)'; end if;
  update public.membros set nome_parceiro = v_nome where empresa_id = p_empresa and user_id = p_user and papel = 'parceiro';
  if not found then raise exception 'essa pessoa não é parceira desta empresa'; end if;
  perform public._audit_acao(p_empresa, 'update', 'membro', p_user::text, jsonb_build_object('parceiro', v_nome));
end $$;
revoke all on function public.definir_nome_parceiro(uuid, uuid, text) from public, anon;
grant execute on function public.definir_nome_parceiro(uuid, uuid, text) to authenticated;

-- De quem é cada documento? (equipe da empresa; devolve só id do documento e nome da empresa do parceiro) ---------
create or replace function public.listar_origens(p_empresa uuid)
returns table (id text, nome text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.papel_em(p_empresa) is null or public.papel_em(p_empresa) = 'parceiro' then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select r.id, coalesce(m.nome_parceiro, split_part(lower(u.email), '@', 1))::text
      from public.reg r
      join public.membros m on m.empresa_id = r.empresa_id and m.user_id = r.criado_por and m.papel = 'parceiro'
      join auth.users u on u.id = r.criado_por
     where r.empresa_id = p_empresa and r.k = any (public.kinds_parceiro());
end $$;
revoke all on function public.listar_origens(uuid) from public, anon;
grant execute on function public.listar_origens(uuid) to authenticated;

-- Conferência: deve listar as 5 funções
select count(*) as funcoes from pg_proc where proname in ('criar_convite', 'aceitar_convite', 'listar_membros', 'definir_nome_parceiro', 'listar_origens');

-- ======================================================================
-- 0009_andamento_parceiro.sql
-- ======================================================================
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

-- ======================================================================
-- CONFERÊNCIA FINAL
-- ======================================================================
select 'funções do app' as item, case when count(*) >= 8 then 'ok' else 'FALTA' end as resultado, count(*)::text as detalhe
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('reservar_numeros','criar_convite','aceitar_convite','listar_membros','definir_nome_parceiro','listar_origens','andamento_parceiro','papel_em','kinds_parceiro')
union all
select 'tabela audit_log', case when to_regclass('public.audit_log') is not null then 'ok' else 'FALTA' end, ''
union all
select 'tabela convites', case when to_regclass('public.convites') is not null then 'ok' else 'FALTA' end, ''
union all
select 'tabela contadores', case when to_regclass('public.contadores') is not null then 'ok' else 'FALTA' end, ''
union all
select 'registros do app (reg)', 'ok', count(*)::text from public.reg
union all
select 'administradores', case when count(*) >= 1 then 'ok' else 'FALTA' end, count(*)::text from public.membros where papel = 'admin';
commit;
