-- Histórico de revisões de POP/Funil (estilo "lei consolidada" do Planalto).
-- Cada revisão = foto completa do fluxo + quem/quando/motivo + diff resumido.
-- Escrita SÓ via RPC (SECURITY DEFINER) — sem policy de INSERT/UPDATE/DELETE,
-- o log é imutável para o cliente.
-- Aplicado no Externo (kmedldlepwiityjsdahz) via MCP em 2026-07-29.

CREATE TABLE IF NOT EXISTS public.workflow_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL,
  revision_number integer NOT NULL,
  snapshot jsonb NOT NULL,
  change_reason text,
  change_summary jsonb,
  origin text NOT NULL DEFAULT 'manual', -- manual | ia | baseline | restore
  changed_by uuid,
  changed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_workflow_revisions_board
  ON public.workflow_revisions (board_id, revision_number DESC);

ALTER TABLE public.workflow_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_revisions_select ON public.workflow_revisions;
CREATE POLICY workflow_revisions_select ON public.workflow_revisions
  FOR SELECT TO authenticated USING (true);

-- Cria uma revisão numerando atomicamente por board. Se o snapshot for
-- idêntico ao da última revisão, não cria nada (retorna a existente).
CREATE OR REPLACE FUNCTION public.create_workflow_revision(
  p_board_id uuid,
  p_snapshot jsonb,
  p_change_reason text DEFAULT NULL,
  p_change_summary jsonb DEFAULT NULL,
  p_origin text DEFAULT 'manual',
  p_changed_by uuid DEFAULT NULL,
  p_changed_by_name text DEFAULT NULL
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
  -- Serializa criações concorrentes no mesmo board (numeração sem corrida)
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
    board_id, revision_number, snapshot, change_reason, change_summary,
    origin, changed_by, changed_by_name
  ) VALUES (
    p_board_id,
    COALESCE(v_last.revision_number, 0) + 1,
    p_snapshot,
    NULLIF(TRIM(p_change_reason), ''),
    p_change_summary,
    COALESCE(p_origin, 'manual'),
    p_changed_by,
    p_changed_by_name
  )
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_workflow_revision(uuid, jsonb, text, jsonb, text, uuid, text) TO authenticated;

-- Notifica TODOS os membros ativos (org_user_status) sobre a revisão, com o
-- resumo real do que mudou + motivo. Substitui notify_workflow_change (que
-- só atingia quem tinha lead no board e mandava texto genérico); a antiga
-- permanece no banco como legacy.
CREATE OR REPLACE FUNCTION public.notify_workflow_revision(
  p_board_id uuid,
  p_title text,
  p_summary text,
  p_reason text DEFAULT NULL,
  p_changed_by uuid DEFAULT NULL,
  p_changed_by_name text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row record;
  v_desc text;
  v_count integer := 0;
BEGIN
  v_desc := COALESCE(p_summary, '');
  IF NULLIF(TRIM(p_reason), '') IS NOT NULL THEN
    v_desc := v_desc || E'\n\nMotivo: ' || TRIM(p_reason);
  END IF;
  IF p_changed_by_name IS NOT NULL THEN
    v_desc := v_desc || E'\nAlterado por: ' || p_changed_by_name;
  END IF;

  FOR v_row IN
    SELECT ous.user_id, ous.name
    FROM org_user_status ous
    WHERE ous.active = true
      AND ous.user_id IS NOT NULL
      AND ous.user_id <> COALESCE(p_changed_by, '00000000-0000-0000-0000-000000000000'::uuid)
      -- exclui o autor também pelo mapeamento ext<->cloud
      AND ous.user_id NOT IN (
        SELECT m.ext_uuid FROM auth_uuid_mapping m WHERE m.cloud_uuid = p_changed_by
        UNION
        SELECT m.cloud_uuid FROM auth_uuid_mapping m WHERE m.ext_uuid = p_changed_by
      )
  LOOP
    INSERT INTO lead_activities (
      title, description, activity_type, status, priority,
      assigned_to, assigned_to_name, created_by, deadline
    ) VALUES (
      p_title, v_desc, 'notificacao', 'pendente', 'normal',
      v_row.user_id, v_row.name, p_changed_by, CURRENT_DATE
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_workflow_revision(uuid, text, text, text, uuid, text) TO authenticated;
