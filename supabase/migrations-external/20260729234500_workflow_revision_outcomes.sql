-- Impacto de cada revisão do POP no RESULTADO ESPERADO.
--
-- Ideia: cada revisão vigora de created_at até a revisão seguinte. Dentro dessa
-- janela, conta quantos leads do board chegaram a um resultado e quantos desses
-- caíram no "resultado esperado" DAQUELA revisão (snapshot.resultadoEsperadoIds
-- — a meta que estava em vigor na época, não a de hoje). A taxa da janela vs a
-- taxa da janela anterior mostra se a mudança do gerente foi positiva.
--
-- Correlação, não causalidade: amostra pequena e fatores externos (época do ano,
-- time, mix de leads) afetam o número. Por isso a RPC devolve total_results —
-- o front deve exigir amostra mínima antes de dar veredito.
--
-- Fonte dos resultados: lead_pop_result_history (board_id, changed_at, to_result),
-- já indexada em (board_id, changed_at).
-- Aplicado no Externo (kmedldlepwiityjsdahz) via MCP em 2026-07-29.

CREATE OR REPLACE FUNCTION public.workflow_revision_outcomes(p_board_id uuid)
RETURNS TABLE (
  revision_number integer,
  created_at timestamptz,
  window_end timestamptz,
  changed_by_name text,
  change_category text,
  change_reason text,
  total_results integer,
  expected_results integer,
  expected_rate numeric,
  prev_expected_rate numeric,
  delta numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH revs AS (
    SELECT
      r.revision_number,
      r.created_at,
      r.changed_by_name,
      r.change_category,
      r.change_reason,
      COALESCE(r.snapshot->'resultadoEsperadoIds', '[]'::jsonb) AS esperados,
      LEAD(r.created_at) OVER (ORDER BY r.revision_number) AS next_at
    FROM workflow_revisions r
    WHERE r.board_id = p_board_id
  ),
  counted AS (
    SELECT
      v.*,
      (
        SELECT count(*)
        FROM lead_pop_result_history h
        WHERE h.board_id = p_board_id
          AND h.changed_at >= v.created_at
          AND (v.next_at IS NULL OR h.changed_at < v.next_at)
          AND h.to_result IS NOT NULL
      ) AS total_results,
      (
        SELECT count(*)
        FROM lead_pop_result_history h
        WHERE h.board_id = p_board_id
          AND h.changed_at >= v.created_at
          AND (v.next_at IS NULL OR h.changed_at < v.next_at)
          AND h.to_result IN (SELECT jsonb_array_elements_text(v.esperados))
      ) AS expected_results
    FROM revs v
  ),
  rated AS (
    SELECT
      c.*,
      CASE WHEN c.total_results > 0
        THEN ROUND(100.0 * c.expected_results / c.total_results, 1)
      END AS expected_rate
    FROM counted c
  )
  SELECT
    revision_number,
    created_at,
    next_at AS window_end,
    changed_by_name,
    change_category,
    change_reason,
    total_results::integer,
    expected_results::integer,
    expected_rate,
    LAG(expected_rate) OVER (ORDER BY revision_number) AS prev_expected_rate,
    expected_rate - LAG(expected_rate) OVER (ORDER BY revision_number) AS delta
  FROM rated
  ORDER BY revision_number DESC;
$$;

GRANT EXECUTE ON FUNCTION public.workflow_revision_outcomes(uuid) TO authenticated;
