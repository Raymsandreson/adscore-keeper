#!/usr/bin/env bash
#
# Roda SQL no Supabase Externo pela Management API.
#
# POR QUE EXISTE: mesma razão do `fn.sh` — o projeto é fixo no código, então
# liberar este script no allowlist não abre acesso a outro banco nem a outro
# host. Mudar o destino exige editar este arquivo.
#
# O token sai do `.env.diag`, que é gitignored (`.env.*`). Nunca é impresso.
#
# Uso:
#   scripts/db.sh "select count(*) from leads where deleted_at is null"
#   scripts/db.sh "$(cat consulta.sql)"
#
# ATENÇÃO: a Management API executa DDL e DML. Antes de escrita em produção,
# vale a regra do CLAUDE.md — mostrar o SQL, quantas linhas mudam, e ter
# rollback. Este script remove o atrito, não a conferência.
set -euo pipefail

PROJETO='kmedldlepwiityjsdahz'   # Externo
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ $# -lt 1 ]; then
  echo 'uso: scripts/db.sh "<sql>"' >&2
  exit 2
fi

if [ ! -f "$RAIZ/.env.diag" ]; then
  echo "erro: $RAIZ/.env.diag não existe (é onde mora o SUPABASE_PAT)" >&2
  exit 1
fi
set -a; . "$RAIZ/.env.diag"; set +a
if [ -z "${SUPABASE_PAT:-}" ]; then
  echo 'erro: SUPABASE_PAT vazio no .env.diag' >&2
  exit 1
fi

# O JSON é montado em Python: aspas, acento e quebra de linha no SQL passam
# intactos, o que `printf` e concatenação de shell não garantem.
python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$1" \
  | curl -sS --max-time "${DB_TIMEOUT:-300}" \
      -X POST "https://api.supabase.com/v1/projects/$PROJETO/database/query" \
      -H "Authorization: Bearer $SUPABASE_PAT" \
      -H 'Content-Type: application/json' \
      --data-binary @-
