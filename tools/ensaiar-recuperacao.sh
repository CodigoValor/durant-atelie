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
-- Identidades sintéticas pré-existentes ao gatilho de cadastro por convite.
insert into auth.users values
  ('55000000-0000-0000-0000-000000000001', 'restore@example.test'),
  ('55000000-0000-0000-0000-000000000003', 'segundo@example.test'),
  ('55000000-0000-0000-0000-000000000005', 'equipe@example.test');
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

"$PG_BIN/createdb" --template=origem operacional
operacional=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -d operacional)

"${origem[@]}" -q <<'SQL'
insert into public.empresas (id, nome) values
  ('55000000-0000-0000-0000-000000000002', 'Empresa sintética A'),
  ('55000000-0000-0000-0000-000000000004', 'Empresa sintética B');
insert into public.membros (user_id, empresa_id, papel) values
  ('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000002', 'admin'),
  ('55000000-0000-0000-0000-000000000003', '55000000-0000-0000-0000-000000000004', 'admin'),
  ('55000000-0000-0000-0000-000000000005', '55000000-0000-0000-0000-000000000002', 'usuario');
insert into public.reg (empresa_id, id, k, i, n, j) values
  ('55000000-0000-0000-0000-000000000002', 'recuperacao-1', 'clientes', '1', 1, '{"origem":"A"}'),
  ('55000000-0000-0000-0000-000000000004', 'recuperacao-1', 'clientes', '1', 1, '{"origem":"B"}');
SQL

"$PG_BIN/pg_dump" --schema=auth --schema=public --format=custom --file="$work/backup.dump" origem
export ALINHAVO_DRILL_PASSPHRASE
ALINHAVO_DRILL_PASSPHRASE=$(openssl rand -hex 32)
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -in "$work/backup.dump" -out "$work/backup.enc" -pass env:ALINHAVO_DRILL_PASSPHRASE
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$work/backup.enc" -out "$work/restore.dump" -pass env:ALINHAVO_DRILL_PASSPHRASE
cmp "$work/backup.dump" "$work/restore.dump"
# A base recém-criada usa o esquema public padrão. O dump contém sua definição.
"${destino[@]}" -q -c 'drop schema public'
"$PG_BIN/pg_restore" --exit-on-error --single-transaction -d recuperacao "$work/restore.dump"

# Reutiliza a seleção do workflow operacional, sem executá-lo ou ler suas credenciais.
mapfile -t tabelas < <(grep -oE -- '--table=public\.[a-z_][a-z0-9_]*' "$root/.github/workflows/backup.yml")
if (( ${#tabelas[@]} == 0 )); then
  echo 'Nenhuma tabela localizada no workflow de backup' >&2
  exit 1
fi
"$PG_BIN/pg_dump" --data-only --no-owner --no-privileges "${tabelas[@]}" origem |
  gzip -9 > "$work/operacional.sql.gz"
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -in "$work/operacional.sql.gz" -out "$work/operacional.enc" -pass env:ALINHAVO_DRILL_PASSPHRASE
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$work/operacional.enc" -out "$work/operacional-restaurado.sql.gz" -pass env:ALINHAVO_DRILL_PASSPHRASE
unset ALINHAVO_DRILL_PASSPHRASE
cmp "$work/operacional.sql.gz" "$work/operacional-restaurado.sql.gz"

nomes=("${tabelas[@]#--table=}")
{
  for tabela in "${nomes[@]}"; do printf 'alter table %s disable trigger user;\n' "$tabela"; done
  (IFS=,; printf 'truncate %s restart identity;\n' "${nomes[*]}")
  gzip -dc "$work/operacional-restaurado.sql.gz"
  for tabela in "${nomes[@]}"; do printf 'alter table %s enable trigger user;\n' "$tabela"; done
} | "${operacional[@]}" -q --single-transaction -f -

for banco in origem recuperacao operacional; do
  "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -q -d "$banco" -f "$root/tools/verificar-isolamento-recuperacao.sql"
  echo "Registros, vínculos, auditoria e isolamento verificados em $banco"
done
echo "Restaurações sintéticas nos dois formatos aprovadas em $((SECONDS - started)) s"
