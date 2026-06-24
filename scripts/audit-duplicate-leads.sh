#!/usr/bin/env bash
# Rotina de auditoria de leads duplicados por telefone (Supabase Externo).
#
# Uso:
#   EXTERNAL_DB_URL=postgres://... ./scripts/audit-duplicate-leads.sh            # resumo + top 30
#   EXTERNAL_DB_URL=postgres://... ./scripts/audit-duplicate-leads.sh <phone>    # drilldown de um número
#   EXTERNAL_DB_URL=postgres://... ./scripts/audit-duplicate-leads.sh --csv > dups.csv
#
# Normaliza o telefone para apenas dígitos. Ignora leads soft-deletados.

set -euo pipefail
: "${EXTERNAL_DB_URL:?defina EXTERNAL_DB_URL}"

PHONE_FILTER="${1:-}"

if [[ "$PHONE_FILTER" == "--csv" ]]; then
  psql "$EXTERNAL_DB_URL" -A -F"," --pset=footer=off <<'SQL'
WITH norm AS (
  SELECT id, lead_name, lead_phone, board_id, status, source, created_by, created_at,
         regexp_replace(coalesce(lead_phone,''), '\D', '', 'g') AS phone_digits
  FROM leads WHERE deleted_at IS NULL
)
SELECT phone_digits, qtd, boards, fontes, criadores, primeiro, ultimo
FROM (
  SELECT phone_digits,
         COUNT(*) AS qtd,
         COUNT(DISTINCT board_id) AS boards,
         COUNT(DISTINCT source) AS fontes,
         COUNT(DISTINCT created_by) AS criadores,
         MIN(created_at)::date AS primeiro,
         MAX(created_at)::date AS ultimo
  FROM norm WHERE phone_digits <> ''
  GROUP BY phone_digits HAVING COUNT(*) > 1
) g ORDER BY qtd DESC;
SQL
  exit 0
fi

if [[ -n "$PHONE_FILTER" ]]; then
  echo "== Leads com telefone normalizado = $PHONE_FILTER =="
  PGOPTIONS="-c statement_timeout=30s" psql "$EXTERNAL_DB_URL" -v phone="$PHONE_FILTER" <<'SQL'
SELECT id, lead_name, lead_phone, board_id, status, lead_status, source, created_by, created_at
FROM leads
WHERE deleted_at IS NULL
  AND regexp_replace(coalesce(lead_phone,''),'\D','','g') = :'phone'
ORDER BY created_at;
SQL
  exit 0
fi

echo "== Resumo geral =="
psql "$EXTERNAL_DB_URL" <<'SQL'
WITH norm AS (
  SELECT regexp_replace(coalesce(lead_phone,''),'\D','','g') AS phone_digits,
         (deleted_at IS NULL) AS ativo
  FROM leads
)
SELECT
  COUNT(*) FILTER (WHERE ativo) AS total_ativos,
  COUNT(*) FILTER (WHERE ativo AND phone_digits = '') AS sem_telefone,
  COUNT(DISTINCT phone_digits) FILTER (WHERE ativo AND phone_digits <> '') AS telefones_unicos
FROM norm;
SQL

echo
echo "== Agregado de duplicidade =="
psql "$EXTERNAL_DB_URL" <<'SQL'
WITH norm AS (
  SELECT regexp_replace(coalesce(lead_phone,''),'\D','','g') AS phone_digits
  FROM leads WHERE deleted_at IS NULL
), grp AS (
  SELECT phone_digits, COUNT(*) AS qtd
  FROM norm WHERE phone_digits <> ''
  GROUP BY phone_digits HAVING COUNT(*) > 1
)
SELECT
  COUNT(*)              AS telefones_duplicados,
  SUM(qtd)              AS leads_envolvidos,
  SUM(qtd - 1)          AS excedentes_removiveis,
  MAX(qtd)              AS pior_caso,
  ROUND(AVG(qtd)::numeric, 2) AS media_por_grupo
FROM grp;
SQL

echo
echo "== Buckets (quantos telefones têm N duplicatas) =="
psql "$EXTERNAL_DB_URL" <<'SQL'
WITH norm AS (
  SELECT regexp_replace(coalesce(lead_phone,''),'\D','','g') AS phone_digits
  FROM leads WHERE deleted_at IS NULL
), grp AS (
  SELECT phone_digits, COUNT(*) AS qtd
  FROM norm WHERE phone_digits <> ''
  GROUP BY phone_digits
)
SELECT
  CASE
    WHEN qtd = 1 THEN '1 (sem dup)'
    WHEN qtd = 2 THEN '2'
    WHEN qtd = 3 THEN '3'
    WHEN qtd BETWEEN 4 AND 5 THEN '4-5'
    WHEN qtd BETWEEN 6 AND 10 THEN '6-10'
    WHEN qtd BETWEEN 11 AND 50 THEN '11-50'
    ELSE '50+'
  END AS faixa,
  COUNT(*) AS telefones
FROM grp GROUP BY 1
ORDER BY MIN(qtd);
SQL

echo
echo "== Top 30 telefones duplicados =="
psql "$EXTERNAL_DB_URL" <<'SQL'
WITH norm AS (
  SELECT id, board_id, source, created_by, created_at,
         regexp_replace(coalesce(lead_phone,''),'\D','','g') AS phone_digits,
         CASE
           WHEN length(regexp_replace(coalesce(lead_phone,''),'\D','','g')) < 10 THEN 'telefone_invalido'
           WHEN regexp_replace(coalesce(lead_phone,''),'\D','','g') LIKE '120363%' THEN 'jid_de_grupo_whatsapp'
           ELSE 'telefone_real'
         END AS tipo
  FROM leads WHERE deleted_at IS NULL
)
SELECT phone_digits,
       tipo,
       COUNT(*) AS qtd,
       COUNT(DISTINCT board_id) AS boards,
       COUNT(DISTINCT source)   AS fontes,
       COUNT(DISTINCT created_by) AS criadores,
       MIN(created_at)::date AS primeiro,
       MAX(created_at)::date AS ultimo
FROM norm WHERE phone_digits <> ''
GROUP BY phone_digits, tipo
HAVING COUNT(*) > 1
ORDER BY qtd DESC
LIMIT 30;
SQL

echo
echo "== Classificação das causas (heurística) =="
psql "$EXTERNAL_DB_URL" <<'SQL'
WITH norm AS (
  SELECT regexp_replace(coalesce(lead_phone,''),'\D','','g') AS phone_digits
  FROM leads WHERE deleted_at IS NULL
), grp AS (
  SELECT phone_digits, COUNT(*) AS qtd FROM norm
  WHERE phone_digits <> '' GROUP BY phone_digits HAVING COUNT(*) > 1
)
SELECT
  CASE
    WHEN length(phone_digits) < 10 THEN 'telefone_invalido (lixo)'
    WHEN phone_digits LIKE '120363%' THEN 'jid_de_grupo_whatsapp'
    ELSE 'telefone_real_repetido'
  END AS causa,
  COUNT(*) AS telefones,
  SUM(qtd) AS leads_envolvidos,
  SUM(qtd - 1) AS excedentes
FROM grp
GROUP BY 1
ORDER BY excedentes DESC;
SQL

echo
echo "Para detalhar um número específico:"
echo "  ./scripts/audit-duplicate-leads.sh 5586955901271"
echo "Para exportar CSV completo:"
echo "  ./scripts/audit-duplicate-leads.sh --csv > /tmp/dups.csv"
