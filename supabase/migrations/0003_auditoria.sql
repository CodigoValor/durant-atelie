-- Durant Ateliê — log de auditoria imutável (cole inteiro no SQL Editor e clique em Run)
-- Registra, no servidor, TODA criação / alteração / exclusão de documento (tabela reg):
-- quem (usuário real do login), quando (hora do servidor), de onde (IP) e o que mudou (antes e depois).
-- Ninguém consegue editar nem apagar o log pela API; só administradores da empresa conseguem ler.
-- Não registra: backups internos do app (k='bkp') e o marcador de sistema (k='sys'), por serem ruído.

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

  if v_k in ('bkp', 'sys') then return null; end if;

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
