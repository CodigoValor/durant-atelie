# Backup automático (produção)

Todo dia às 03:00 (Brasília) o GitHub Actions copia os dados do sistema (documentos, empresas, vínculos e log de auditoria),
**criptografa** e guarda por **90 dias** como "artefato" do GitHub (fica em Actions, nunca dentro do código do repositório).
Arquivo: `.github/workflows/backup.yml`. Se falhar, o GitHub avisa por e-mail.

## Configuração (uma vez só)

No GitHub: repositório > **Settings > Secrets and variables > Actions > New repository secret**. Crie dois segredos:

| Nome | Valor |
|---|---|
| `DB_URL_PRODUCAO` | No Supabase de **produção**: botão **Connect** > aba **Session pooler** > copie a "connection string" e troque `[YOUR-PASSWORD]` pela senha do banco. (Use o Session pooler, não a "Direct connection": o GitHub só alcança IPv4.) |
| `BACKUP_PASSPHRASE` | Uma frase longa que você inventa (mínimo 16 caracteres). **Guarde também no gerenciador de senhas**: sem ela o backup não abre. |

Nunca cole esses valores no chat nem no código.

Primeiro teste: aba **Actions** > **Backup diário do banco (produção)** > **Run workflow**. Ao terminar, o resumo mostra quantos documentos
estavam no banco e quantos foram para o backup (os dois números devem ser iguais ou muito próximos).

## Baixar um backup

Actions > execução desejada > no fim da página, **Artifacts** > baixe `durant-backup-...`. Dentro vem `durant-backup-AAAA-MM-DD.sql.gz.enc`.

## Abrir o backup

```bash
export BACKUP_PASSPHRASE='a sua frase'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in durant-backup-2026-11-26.sql.gz.enc -pass env:BACKUP_PASSPHRASE | gunzip > backup.sql
```

## Restaurar (ensaie primeiro na HOMOLOGAÇÃO)

O arquivo contém só os **dados** (as tabelas já precisam existir: rode as migrations `0001` a `0003` num banco novo).
Usuários de login (Authentication) não fazem parte do backup: num projeto novo, crie o usuário de novo e rode o `0002_primeiro_admin.sql`.

```bash
# 1) limpar as tabelas de destino (no SQL Editor do projeto de destino)
truncate public.reg, public.audit_log restart identity;   -- não mexa em empresas/membros se já estiverem corretos

# 2) carregar (terminal; URL = string do Session pooler do projeto de destino)
( echo "set session_replication_role = replica;"; cat backup.sql ) | psql "$URL" -v ON_ERROR_STOP=1

# 3) ajustar o contador do log de auditoria
select setval(pg_get_serial_sequence('public.audit_log','id'), coalesce(max(id),1)) from public.audit_log;
```

Observações:
- `truncate` de `audit_log` é bloqueado de propósito (log imutável). Em um banco de ensaio, recrie a tabela (rode a migration `0003` num banco novo) em vez de truncar.
- Se `empresas`/`membros` já existirem no destino, o carregamento delas dará erro de chave duplicada: nesse caso carregue só a tabela `reg` (extraia o bloco `COPY public.reg` do arquivo).
- **Faça o ensaio de restauração na homologação uma vez**, para saber que funciona antes de precisar.

## Limites e próximos passos

- Cobre os dados do sistema; não cobre usuários de login nem configurações do painel do Supabase/Vercel (estão descritos no README e nas migrations).
- Para backup nativo com restauração em um clique (e ponto no tempo), assinar o Supabase Pro.
