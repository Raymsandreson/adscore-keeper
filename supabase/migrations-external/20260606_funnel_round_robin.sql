-- Round-robin por funil para distribuir leads do WhatsApp Cloud (cloud_gerencia).
--
-- Substitui o pool antigo baseado em whatsapp_cloud_routing_rules.eligible_user_ids:
-- agora o pool é configurado por funil (kanban_boards) em funnel_round_robin_members.
-- Lead novo → busca board_id → pick_funnel_assignee(board_id) → grava em
-- leads.assigned_to + whatsapp_cloud_assignees.
--
-- Banco: EXTERNO (kmedldlepwiityjsdahz). NÃO aplicar no Cloud.
-- Já aplicada em 2026-06-06 via edge run-external-migration. Arquivo é histórico.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assignment_source text;

CREATE INDEX IF NOT EXISTS idx_leads_assigned_to
  ON public.leads(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_board_assigned
  ON public.leads(board_id, assigned_to) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.funnel_round_robin_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  last_assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(board_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_frrm_board_active
  ON public.funnel_round_robin_members(board_id, is_active, position);

ALTER TABLE public.funnel_round_robin_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read frrm" ON public.funnel_round_robin_members;
CREATE POLICY "read frrm" ON public.funnel_round_robin_members FOR SELECT USING (true);
DROP POLICY IF EXISTS "write frrm" ON public.funnel_round_robin_members;
CREATE POLICY "write frrm" ON public.funnel_round_robin_members FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.lead_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_user_id uuid,
  to_user_id uuid,
  reassigned_by uuid,
  reason text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_reassignments_lead
  ON public.lead_reassignments(lead_id, created_at DESC);

ALTER TABLE public.lead_reassignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read reassignments" ON public.lead_reassignments;
CREATE POLICY "read reassignments" ON public.lead_reassignments FOR SELECT USING (true);
DROP POLICY IF EXISTS "write reassignments" ON public.lead_reassignments;
CREATE POLICY "write reassignments" ON public.lead_reassignments FOR ALL USING (true) WITH CHECK (true);

-- Round-robin atômico: pega o membro ativo com last_assigned_at mais antigo,
-- usa FOR UPDATE SKIP LOCKED para serializar concorrentes e atualiza o timestamp.
CREATE OR REPLACE FUNCTION public.pick_funnel_assignee(p_board_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_user uuid;
BEGIN
  SELECT user_id INTO v_user
  FROM public.funnel_round_robin_members
  WHERE board_id = p_board_id AND is_active = true
  ORDER BY COALESCE(last_assigned_at, 'epoch'::timestamptz) ASC, position ASC, user_id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_user IS NULL THEN RETURN NULL; END IF;

  UPDATE public.funnel_round_robin_members
  SET last_assigned_at = now(), updated_at = now()
  WHERE board_id = p_board_id AND user_id = v_user;

  RETURN v_user;
END;
$fn$;
