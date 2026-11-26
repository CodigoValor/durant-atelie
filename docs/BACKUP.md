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

## Ensaiar recuperação em ambiente descartável

Execute `PG_BIN=/caminho/postgresql/17/bin bash tools/ensaiar-recuperacao.sh` como usuário sem privilégios de sistema. O comando cria um PostgreSQL descartável sem acesso de rede, aplica as migrações e recupera duas empresas sintéticas. A CI também executa o ensaio. O banco compartilhado de homologação recebe somente dados sintéticos.

O arquivo operacional contém dados das tabelas de aplicação. Um destino vazio precisa do esquema da versão de origem e de identidades previamente preparadas com os mesmos UUIDs referenciados pelos vínculos. Criar usuários com o mesmo e-mail não preserva automaticamente esses UUIDs. A recuperação das identidades gerenciadas ainda precisa de um procedimento validado no Supabase.

O ensaio restaura SQL de dados em uma transação do banco descartável. Suspende os gatilhos de aplicação apenas nas tabelas restauradas, mantém a verificação de chaves estrangeiras e reabilita os gatilhos. Confira totais, relações, política multiempresa e nova auditoria após restauração. Para uma recuperação real, vincule o plano ao artefato, ao commit e ao ambiente corretos e obtenha autorização específica antes de qualquer operação em produção.

## Limites e próximos passos

- Cobre os dados do sistema; não cobre usuários de login nem configurações do painel do Supabase/Vercel (estão descritos no README e nas migrations).
- Para backup nativo com restauração em um clique (e ponto no tempo), assinar o Supabase Pro.
