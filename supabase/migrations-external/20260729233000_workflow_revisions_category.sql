-- Categoria da alteração do POP: por que o gerente mexeu no processo.
--   automacao  → passou a ser automático o que era manual (mover fase, definir status)
--   eliminacao → removeu passo/objetivo/fase/status que não agrega mais
--   otimizacao → refinou o que já existia (script, ordem, status possíveis/esperado)
-- A IA (Railway: suggest-revision-reason) sugere categoria + motivo a partir do
-- diff; o gerente confirma ou troca antes de salvar.
-- Aplicado no Externo (kmedldlepwiityjsdahz) via MCP em 2026-07-29.

ALTER TABLE public.workflow_revisions
  ADD COLUMN IF NOT EXISTS change_category text;

ALTER TABLE public.workflow_revisions
  DROP CONSTRAINT IF EXISTS workflow_revisions_change_category_check;
ALTER TABLE public.workflow_revisions
  ADD CONSTRAINT workflow_revisions_change_category_check
  CHECK (change_category IS NULL OR change_category IN ('automacao', 'eliminacao', 'otimizacao'));

-- Recria a RPC com p_change_category no fim (DEFAULT NULL mantém compatível com
-- chamadas de 7 argumentos). A assinatura antiga é removida para o PostgREST não
-- ficar com duas candidatas ambíguas.
DROP FUNCTION IF EXISTS public.create_workflow_revision(uuid, jsonb, text, jsonb, text, uuid, text);

CREATE OR REPLACE FUNCTION public.create_workflow_revision(
  p_board_id uuid,
  p_snapshot jsonb,
  p_change_reason text DEFAULT NULL,
  p_change_summary jsonb DEFAULT NULL,
  p_origin text DEFAULT 'manual',
  p_changed_by uuid DEFAULT NULL,
  p_changed_by_name text DEFAULT NULL,
  p_change_category text DEFAULT NULL
)
RETURNS public.workflow_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last public.workflow_revisions;
  v_new public.workflow_revisions;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('workflow_revisions:' || p_board_id::text));

  SELECT * INTO v_last
  FROM workflow_revisions
  WHERE board_id = p_board_id
  ORDER BY revision_number DESC
  LIMIT 1;

  IF v_last.id IS NOT NULL AND v_last.snapshot = p_snapshot THEN
    RETURN v_last;
  END IF;

  INSERT INTO workflow_revisions (
    board_id, revision_number, snapshot, change_reason, change_category,
    change_summary, origin, changed_by, changed_by_name
  ) VALUES (
    p_board_id,
    COALESCE(v_last.revision_number, 0) + 1,
    p_snapshot,
    NULLIF(TRIM(p_change_reason), ''),
    NULLIF(TRIM(p_change_category), ''),
    p_change_summary,
    COALESCE(p_origin, 'manual'),
    p_changed_by,
    p_changed_by_name
  )
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_workflow_revision(uuid, jsonb, text, jsonb, text, uuid, text, text) TO authenticated;
