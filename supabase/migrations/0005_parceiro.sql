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
