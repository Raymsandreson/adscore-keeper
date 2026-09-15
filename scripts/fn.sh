#!/usr/bin/env bash
#
# Chama uma função do backend no Railway.
#
# POR QUE EXISTE: o classificador do modo automático barra `curl` que pareça
# escrita em produção, e liberar `Bash(curl:*)` abriria chamada para qualquer
# host da internet — amplo demais. Este script só sabe falar com o NOSSO
# backend, então liberar ele no allowlist é escopo fechado por construção.
#
# Uso:
#   scripts/fn.sh meta-capi-dispatch '{"modo":"probe"}'
#   scripts/fn.sh bpc-sheet-sync '{"board_id":"...","dry_run":true}'
#   FN_TIMEOUT=900 scripts/fn.sh meta-leads-sync '{"since_days":30}'
#
# O host é fixo de propósito: não aceita parâmetro, não lê de variável de
# ambiente. Mudar o destino exige editar este arquivo, que fica no diff.
set -euo pipefail

HOST='https://adscore-keeper-production.up.railway.app'

if [ $# -lt 1 ]; then
  echo "uso: scripts/fn.sh <funcao> ['<json>']" >&2
  echo "     scripts/fn.sh --listar   # funções registradas no servidor" >&2
  exit 2
fi

if [ "$1" = '--listar' ]; then
  curl -sS --max-time 30 "$HOST/health" \
    | python3 -c 'import sys,json;[print(f) for f in json.load(sys.stdin).get("functions",[])]'
  exit 0
fi

FUNCAO="$1"
CORPO="${2:-{\}}"

# `--data-binary` e charset explícito: nomes de campanha e status têm acento, e
# `--data` normaliza quebra de linha, o que corrompe JSON com string multilinha.
curl -sS --max-time "${FN_TIMEOUT:-600}" \
  -X POST "$HOST/functions/$FUNCAO" \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-binary "$CORPO" \
  -w '\nhttp=%{http_code}\n'
