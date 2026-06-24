#!/usr/bin/env bash
# Uso: ./find-function.sh <palavra-chave>
# Varre Railway, Supabase edge functions e hooks por nome/conteúdo.
set -e
KW="${1:?palavra-chave obrigatória}"
echo "=== Railway functions ==="
ls railway-server/src/functions/ 2>/dev/null | grep -i "$KW" || echo "(nenhum nome bate)"
echo
echo "=== Supabase edge functions ==="
ls supabase/functions/ 2>/dev/null | grep -i "$KW" || echo "(nenhum nome bate)"
echo
echo "=== Hooks ==="
ls src/hooks/ 2>/dev/null | grep -i "$KW" || echo "(nenhum nome bate)"
echo
echo "=== Conteúdo (edge functions + railway, top 20) ==="
rg -l -i "$KW" railway-server/src/functions/ supabase/functions/ 2>/dev/null | head -20 || echo "(sem matches no conteúdo)"
