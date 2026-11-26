#!/usr/bin/env bash
set -euo pipefail

# Este ensaio cria seu próprio servidor sem rede e usa somente dados sintéticos.
: "${PG_BIN:?Informe o diretório bin de uma instalação PostgreSQL 17}"
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d)
mkdir "$work/socket"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT
export PGHOST="$work/socket" PGPORT=5432 PGUSER=postgres
unset PGHOSTADDR PGDATABASE PGSERVICE PGSERVICEFILE PGPASSWORD PGOPTIONS
started=$SECONDS

"$PG_BIN/initdb" -D "$work/data" --username=postgres --auth=trust --no-locale --encoding=UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$work/data" -l "$work/postgres.log" \
  -o "-c listen_addresses='' -k $PGHOST" -w start >/dev/null || {
  cat "$work/postgres.log" >&2
  exit 1
}
"$PG_BIN/createdb" origem
"$PG_BIN/createdb" recuperacao
origem=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -d origem)
destino=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -d recuperacao)

"${origem[@]}" -q <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.sub', true), '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant usage on schema auth to anon, authenticated;
-- Pessoa sintética pré-existente ao gatilho de cadastro por convite.
insert into auth.users values ('55000000-0000-0000-0000-000000000001', 'restore@example.test');
SQL

for migration in "$root"/supabase/migrations/*.sql; do
  case $(basename "$migration") in
    0002_*) continue ;; # o bootstrap operacional de administrador não integra a fixture
  esac
  "${origem[@]}" -q -f "$migration" >> "$work/migrations.log" 2>&1 || {
    tail -25 "$work/migrations.log" >&2
    exit 1
  }
done

"${origem[@]}" -q <<'SQL'
insert into public.empresas (id, nome) values ('55000000-0000-0000-0000-000000000002', 'Empresa sintética');
insert into public.membros (user_id, empresa_id, papel)
  values ('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000002', 'admin');
insert into public.reg (empresa_id, id, k, i, n, j)
  values ('55000000-0000-0000-0000-000000000002', 'recuperacao-1', 'clientes', '1', 1, '{}');
SQL

"$PG_BIN/pg_dump" --schema=auth --schema=public --format=custom --file="$work/backup.dump" origem
export ALINHAVO_DRILL_PASSPHRASE
ALINHAVO_DRILL_PASSPHRASE=$(openssl rand -hex 32)
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -in "$work/backup.dump" -out "$work/backup.enc" -pass env:ALINHAVO_DRILL_PASSPHRASE
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$work/backup.enc" -out "$work/restore.dump" -pass env:ALINHAVO_DRILL_PASSPHRASE
unset ALINHAVO_DRILL_PASSPHRASE
cmp "$work/backup.dump" "$work/restore.dump"
"$PG_BIN/pg_restore" --exit-on-error --single-transaction -d recuperacao "$work/restore.dump"

"${destino[@]}" -q <<'SQL'
do $$
begin
  if (select count(*) from public.reg where id = 'recuperacao-1') <> 1
     or (select count(*) from public.audit_log where reg_id = 'recuperacao-1') <> 1
     or (select count(*) from auth.users where email = 'restore@example.test') <> 1
     or (select count(*) from public.membros where user_id = '55000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'faltam dados, vínculo ou trilha de auditoria';
  end if;
  if has_table_privilege('anon', 'public.reg', 'select')
     or not (select relrowsecurity from pg_class where oid = 'public.reg'::regclass) then
    raise exception 'a restauração degradou o controle de acesso';
  end if;
end $$;
SQL
echo "Restauração sintética aprovada em $((SECONDS - started)) s"
