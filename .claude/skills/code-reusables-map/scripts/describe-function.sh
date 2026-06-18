#!/usr/bin/env bash
# Uso: ./describe-function.sh <nome-da-funcao>
# Mostra o cabeçalho de uma edge function (Railway ou Supabase) pra você LER antes de reutilizar.
# Substitui o palpite por leitura real do código.
set -e
NAME="${1:?nome da função obrigatório (ex: send-whatsapp)}"

show() {
  local path="$1"
  if [ -f "$path" ]; then
    echo "===== $path ====="
    head -60 "$path"
    echo
    echo "--- (linhas $(wc -l < "$path") total) ---"
    echo
  fi
}

# Railway
show "railway-server/src/functions/$NAME.ts"
# Supabase
show "supabase/functions/$NAME/index.ts"

# Nada encontrado? sugere similares
if [ ! -f "railway-server/src/functions/$NAME.ts" ] && [ ! -f "supabase/functions/$NAME/index.ts" ]; then
  echo "(função '$NAME' não existe — similares:)"
  ls railway-server/src/functions/ supabase/functions/ 2>/dev/null | grep -i "${NAME%-*}" | sort -u | head -10
fi
