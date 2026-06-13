#!/usr/bin/env bash
# Lista tabelas vivas no Cloud e no Externo, agrupadas por prefixo.
# Uso: bash list-tables.sh [filtro_opcional]
# Ex:  bash list-tables.sh whatsapp
set -euo pipefail

FILTER="${1:-}"

CLOUD_URL="https://gliigkupoebmlbwyvijp.supabase.co"
CLOUD_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_ANON_KEY:-}}"

EXT_URL="${EXTERNAL_SUPABASE_URL:-}"
EXT_KEY="${EXTERNAL_SUPABASE_SERVICE_ROLE_KEY:-}"

dump() {
  local name="$1" url="$2" key="$3"
  echo "=== $name ==="
  if [ -z "$key" ] || [ -z "$url" ]; then
    echo "(sem credenciais — defina as envs)"
    return
  fi
  # PostgREST não lista tabelas; usamos RPC se existir, senão pg_meta via /rest/v1/?
  # Caminho confiável: edge function run-external-migration com SELECT.
  curl -s -X POST "$url/functions/v1/run-external-migration" \
    -H "Authorization: Bearer $key" \
    -H "Content-Type: application/json" \
    -d "{\"sql\":\"select tablename from pg_tables where schemaname='public' ${FILTER:+and tablename ilike '%${FILTER}%'} order by tablename\"}" \
    | jq -r '.rows[]?.tablename // .data[]?.tablename // empty' 2>/dev/null \
    || echo "(falhou — rode SQL manual via supabase--read_query)"
  echo
}

dump "CLOUD"   "$CLOUD_URL" "$CLOUD_KEY"
dump "EXTERNO" "$EXT_URL"   "$EXT_KEY"

echo "Dica: para colunas, use supabase--read_query (Cloud) ou run-external-migration (Externo)."
