#!/usr/bin/env bash
# Verifica se os deploys (Frontend Lovable + Railway) bateram com o commit local.
# Uso: bash scripts/check-deploys.sh [railway_url]
#   ou: RAILWAY_URL=https://seu-app.up.railway.app bash scripts/check-deploys.sh

set -u

FRONTEND_URL="${FRONTEND_URL:-https://adscore-keeper.lovable.app}"
RAILWAY_URL="${1:-${RAILWAY_URL:-}}"

# Cores
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; B='\033[0;34m'; N='\033[0m'

# Commit local
LOCAL_SHA=$(git rev-parse --short=12 HEAD 2>/dev/null || echo "unknown")
echo -e "${B}HEAD local:${N} $LOCAL_SHA"
echo ""

# Tempfiles para paralelismo
TMP_FE=$(mktemp); TMP_RW=$(mktemp)
trap 'rm -f "$TMP_FE" "$TMP_RW"' EXIT

# Frontend: pega meta build-sha do HTML publicado
(
  curl -fsSL --max-time 10 "$FRONTEND_URL/" 2>/dev/null \
    | grep -oE '<meta name="build-sha" content="[^"]*"' \
    | sed -E 's/.*content="([^"]*)".*/\1/' \
    > "$TMP_FE" || true
) &

# Railway: pega .commit do /health
if [ -n "$RAILWAY_URL" ]; then
  (
    curl -fsSL --max-time 10 "$RAILWAY_URL/health" 2>/dev/null \
      | grep -oE '"commit":"[^"]*"' \
      | sed -E 's/.*"commit":"([^"]*)".*/\1/' \
      > "$TMP_RW" || true
  ) &
fi

wait

FE_SHA=$(cat "$TMP_FE")
RW_SHA=$(cat "$TMP_RW" 2>/dev/null || echo "")

# Render
print_row() {
  local label="$1" remote="$2"
  if [ -z "$remote" ]; then
    echo -e "${R}✗${N} $label  ${R}(sem resposta)${N}"
  elif [ "$remote" = "$LOCAL_SHA" ]; then
    echo -e "${G}✓${N} $label  $remote ${G}(igual ao HEAD local)${N}"
  elif [ "$remote" = "unknown" ]; then
    echo -e "${Y}?${N} $label  unknown ${Y}(env var ausente no servidor)${N}"
  else
    echo -e "${Y}≠${N} $label  $remote ${Y}(diferente do HEAD: $LOCAL_SHA)${N}"
  fi
}

print_row "Frontend ($FRONTEND_URL)" "$FE_SHA"
if [ -n "$RAILWAY_URL" ]; then
  print_row "Railway  ($RAILWAY_URL)" "$RW_SHA"
else
  echo -e "${Y}—${N} Railway   (passe a URL: bash $0 https://seu-app.up.railway.app)"
fi
