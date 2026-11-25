-- Durant Ateliê — base multiempresa (cole inteiro no SQL Editor do Supabase e clique em Run)
-- Princípios: nada é aberto ao público (sem acesso anônimo), cada empresa só enxerga os próprios dados,
-- e toda permissão é concedida de forma explícita.

-- 1) Tabelas ---------------------------------------------------------------
create table if not exists public.empresas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  criado_em  timestamptz not null default now()
);

create table if not exists public.membros (
  user_id    uuid not null references auth.users (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  papel      text not null default 'usuario' check (papel in ('admin', 'usuario')),
  criado_em  timestamptz not null default now(),
  primary key (user_id, empresa_id)
);
create index if not exists membros_empresa_idx on public.membros (empresa_id);

-- Documentos do sistema (mesmo formato que o protótipo já usa no Claude: k = tipo, i = código, j = conteúdo em JSON)
create table if not exists public.reg (
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  id            text not null,
  k             text not null,
  i             text,
  n             integer,
  j             text,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, id)
);
create index if not exists reg_empresa_k_idx on public.reg (empresa_id, k);

-- 2) Segurança por linha (RLS) ---------------------------------------------
alter table public.empresas enable row level security;
alter table public.membros  enable row level security;
alter table public.reg      enable row level security;

drop policy if exists empresas_ler on public.empresas;
create policy empresas_ler on public.empresas for select to authenticated
  using (id in (select m.empresa_id from public.membros m where m.user_id = (select auth.uid())));

drop policy if exists membros_ler_proprio on public.membros;
create policy membros_ler_proprio on public.membros for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists reg_ler on public.reg;
create policy reg_ler on public.reg for select to authenticated
  using (empresa_id in (select m.empresa_id from public.membros m where m.user_id = (select auth.uid())));

drop policy if exists reg_inserir on public.reg;
create policy reg_inserir on public.reg for insert to authenticated
  with check (empresa_id in (select m.empresa_id from public.membros m where m.user_id = (select auth.uid())));

drop policy if exists reg_atualizar on public.reg;
create policy reg_atualizar on public.reg for update to authenticated
  using      (empresa_id in (select m.empresa_id from public.membros m where m.user_id = (select auth.uid())))
  with check (empresa_id in (select m.empresa_id from public.membros m where m.user_id = (select auth.uid())));

drop policy if exists reg_apagar on public.reg;
create policy reg_apagar on public.reg for delete to authenticated
  using (empresa_id in (select m.empresa_id from public.membros m where m.user_id = (select auth.uid())));

-- 3) Permissões explícitas (anônimo não recebe nada) -----------------------
revoke all on public.empresas from anon, authenticated;
revoke all on public.membros  from anon, authenticated;
revoke all on public.reg      from anon, authenticated;

grant select on public.empresas to authenticated;
grant select on public.membros  to authenticated;
grant select, insert, update, delete on public.reg to authenticated;

-- 4) Primeira empresa -------------------------------------------------------
insert into public.empresas (nome)
select 'Durant Alfaiataria'
where not exists (select 1 from public.empresas where nome = 'Durant Alfaiataria');

-- Conferência: deve listar 3 tabelas, todas com RLS ligado (true)
select c.relname as tabela, c.relrowsecurity as rls_ligado
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('empresas', 'membros', 'reg')
order by 1;
