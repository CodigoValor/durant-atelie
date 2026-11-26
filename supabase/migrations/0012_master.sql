-- 0012 — Usuário master: acesso a todos os sistemas (Ateliê, Fábrica, Loja, Cliente de loja).
-- Os sistemas de cada pessoa vêm das empresas em que ela é membro (flags da empresa). O master é
-- só um marcador (usuarios_master) que mostra a etiqueta "Master" e permite entrar como admin em
-- qualquer empresa de cliente — por enquanto o vínculo é feito por convite/seed, nunca automático.

create table if not exists public.usuarios_master (
  user_id uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.usuarios_master enable row level security;
revoke all on public.usuarios_master from anon, authenticated;

create or replace function public.sou_master() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.usuarios_master where user_id = auth.uid());
$$;
revoke all on function public.sou_master() from public, anon;
grant execute on function public.sou_master() to authenticated;

-- Sistemas disponíveis para quem está logado, um por empresa/perfil.
create or replace function public.meus_sistemas() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(s order by o), '[]'::jsonb) from (
    select jsonb_build_object('sistema', 'atelie',  'empresa_id', e.id, 'empresa', e.nome) s, 1 o
      from public.membros m join public.empresas e on e.id = m.empresa_id
      where m.user_id = auth.uid() and e.vende_cliente_final and not e.somente_tecidos
    union all
    select jsonb_build_object('sistema', 'fabrica', 'empresa_id', e.id, 'empresa', e.nome), 2
      from public.membros m join public.empresas e on e.id = m.empresa_id
      where m.user_id = auth.uid() and e.produz
    union all
    select jsonb_build_object('sistema', 'loja',    'empresa_id', e.id, 'empresa', e.nome), 3
      from public.membros m join public.empresas e on e.id = m.empresa_id
      where m.user_id = auth.uid() and e.fornece_tecido
    union all
    select jsonb_build_object('sistema', 'cliente', 'empresa_id', e.id, 'empresa', e.nome), 4
      from public.membros m join public.empresas e on e.id = m.empresa_id
      where m.user_id = auth.uid() and not e.fornece_tecido
  ) t;
$$;
revoke all on function public.meus_sistemas() from public, anon;
grant execute on function public.meus_sistemas() to authenticated;
