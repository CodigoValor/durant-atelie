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
-- O dump deve preservar concessões de schema exigidas pelos papéis do Data API.
grant usage on schema public, auth to anon, authenticated;
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

# Carga sintética adicional para o ensaio de capacidade e integridade.
"${origem[@]}" -q <<'SQL'
insert into public.reg (empresa_id, id, k, i, n, j)
select e.id, 'lote-' || k.tipo || '-' || g.n, k.tipo, g.n::text, g.n,
       jsonb_build_object('numero', g.n, 'tipo', k.tipo, 'sintetico', true)::text
from public.empresas e cross join (values ('clientes'), ('pedidos')) k(tipo)
cross join generate_series(2, 501) g(n);
insert into public.tec_lojas (empresa_id,nome)
select id,'Fornecedor sintético' from public.empresas;
insert into public.tec_vendedores (empresa_id,loja_id,nome)
select empresa_id,id,'Vendedor sintético' from public.tec_lojas;
insert into public.tec_destinos (empresa_id,nome)
select id,'Destino sintético' from public.empresas;
insert into public.tec_catalogo (empresa_id,loja_id,referencia)
select empresa_id,id,'REF-' || g.n from public.tec_lojas cross join generate_series(1,3) as g(n);
insert into public.tec_pedidos (empresa_id,loja_id,texto_original)
select empresa_id,id,'Pedido de ensaio ' || g.n from public.tec_lojas cross join generate_series(1,100) as g(n);
insert into public.tec_pedido_itens (empresa_id,pedido_id,catalogo_id,referencia,metragem,destino_id)
select p.empresa_id,p.id,c.id,c.referencia,1.5,d.id from public.tec_pedidos p
join public.tec_catalogo c on c.empresa_id=p.empresa_id and c.loja_id=p.loja_id
join public.tec_destinos d on d.empresa_id=p.empresa_id;
insert into public.tec_mensagens (empresa_id,pedido_id,direcao,corpo)
select empresa_id,id,'saida','Mensagem de ensaio' from public.tec_pedidos;
insert into public.contadores (empresa_id,nome,ultimo)
select id,'pedido',501 from public.empresas;
insert into public.plataforma_admins (user_id)
values ('55000000-0000-0000-0000-000000000001');
insert into public.pessoas (user_id,cpf,nome)
values ('55000000-0000-0000-0000-000000000005','00000000000','Pessoa sintética');
insert into public.tec_loja_clientes (loja_empresa_id,cliente_empresa_id,user_id,tipo,nome,documento)
values ('55000000-0000-0000-0000-000000000004','55000000-0000-0000-0000-000000000002',
        '55000000-0000-0000-0000-000000000001','pf','Cliente sintético','52998224725');
insert into public.convites (empresa_id,email,papel,token_hash)
select id,'novo-' || id::text || '@example.test','usuario',sha256(convert_to(id::text,'utf8'))::text from public.empresas;
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

# Compara o conteúdo de cada tabela, além das verificações de RLS por papel.
verificadas=("${nomes[@]}" auth.users)
for tabela in "${verificadas[@]}"; do
  consulta="select count(*) || ':' || encode(sha256(convert_to(coalesce(string_agg(row_data, '' order by row_data),''),'UTF8')),'hex') from (select row_to_json(t)::text row_data from $tabela t) linhas"
  assinatura=$("${origem[@]}" -Atc "$consulta")
  if [[ "$assinatura" != "$("${destino[@]}" -Atc "$consulta")" ||
        "$assinatura" != "$("${operacional[@]}" -Atc "$consulta")" ]]; then
    echo "Conteúdo divergente após restauração em $tabela" >&2
    exit 1
  fi
  echo "$tabela: $assinatura"
done

for banco in origem recuperacao operacional; do
  "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -q -d "$banco" -f "$root/tools/verificar-isolamento-recuperacao.sql"
  echo "Registros, vínculos, auditoria e isolamento verificados em $banco"
done
echo "Restaurações sintéticas nos dois formatos aprovadas em $((SECONDS - started)) s"
