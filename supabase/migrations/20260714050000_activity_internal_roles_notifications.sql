-- Atividade interna (de equipe) — Fase 2: papéis (Responsável/Observador),
-- grupo de atribuição (uma atividade por responsável), feedback e notificações.
-- Tabelas vivem no Supabase EXTERNO (kmedldlepwiityjsdahz); este arquivo é o
-- registro no repo. Guard de existência torna o script inofensivo em bancos
-- onde lead_activities não existe.
--
-- observer_ids/observer_names → observadores (criador é o observador natural;
--   pode haver mais). Recebem popup com o feedback e podem abrir a atividade.
-- assignment_group_id → liga as N cópias criadas quando há N responsáveis.
-- feedback → "Feedback da atv" preenchido pelo responsável na própria atividade.
-- rescheduled_to → data quando a atividade for reagendada.
-- activity_notifications → backbone dos popups (atribuição, feedback, status,
--   reagendamento e @menções). recipient_id usa UUID do Externo (mesmo espaço
--   de assigned_to).
--
-- Rollback:
--   ALTER TABLE public.lead_activities
--     DROP COLUMN IF EXISTS observer_ids,
--     DROP COLUMN IF EXISTS observer_names,
--     DROP COLUMN IF EXISTS assignment_group_id,
--     DROP COLUMN IF EXISTS feedback,
--     DROP COLUMN IF EXISTS rescheduled_to;
--   DROP INDEX IF EXISTS idx_lead_activities_assignment_group;
--   DROP INDEX IF EXISTS idx_lead_activities_observer_ids;
--   DROP INDEX IF EXISTS idx_lead_activities_assigned_to_ids;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.activity_notifications;
--   DROP TABLE IF EXISTS public.activity_notifications;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lead_activities'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.lead_activities
    ADD COLUMN IF NOT EXISTS observer_ids        uuid[],
    ADD COLUMN IF NOT EXISTS observer_names      text[],
    ADD COLUMN IF NOT EXISTS assignment_group_id uuid,
    ADD COLUMN IF NOT EXISTS feedback            text,
    ADD COLUMN IF NOT EXISTS rescheduled_to      date;
END $$;

-- Índices de filtro (tabela com ~30k linhas — CREATE INDEX direto é instantâneo).
CREATE INDEX IF NOT EXISTS idx_lead_activities_assignment_group
  ON public.lead_activities (assignment_group_id)
  WHERE assignment_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_activities_observer_ids
  ON public.lead_activities USING gin (observer_ids);
-- Cobre o filtro por co-assessor (assigned_to_ids.ov) já em produção.
CREATE INDEX IF NOT EXISTS idx_lead_activities_assigned_to_ids
  ON public.lead_activities USING gin (assigned_to_ids);

-- Notificações de atividade (popups de observador, atribuição e @menções).
CREATE TABLE IF NOT EXISTS public.activity_notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id    uuid REFERENCES public.lead_activities(id) ON DELETE CASCADE,
  recipient_id   uuid NOT NULL,          -- UUID do Externo (mesmo espaço de assigned_to)
  recipient_name text,
  type           text NOT NULL,          -- 'assigned' | 'feedback' | 'status' | 'rescheduled' | 'mention'
  title          text,
  body           text,
  actor_id       uuid,
  actor_name     text,
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_notifications_recipient
  ON public.activity_notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_notifications_unread
  ON public.activity_notifications (recipient_id) WHERE read_at IS NULL;

ALTER TABLE public.activity_notifications ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de lead_activities: equipe autenticada (o app usa sessão
-- autenticada no Externo). Sem acesso anônimo/público.
DROP POLICY IF EXISTS activity_notifications_select ON public.activity_notifications;
CREATE POLICY activity_notifications_select
  ON public.activity_notifications FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS activity_notifications_insert ON public.activity_notifications;
CREATE POLICY activity_notifications_insert
  ON public.activity_notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- UPDATE só para marcar como lida (read_at) — restringe ao próprio destinatário
-- não dá: recipient_id é UUID do Externo e auth.uid() é o uid da sessão. Segue o
-- padrão das demais tabelas internas (authenticated, uid não nulo).
DROP POLICY IF EXISTS activity_notifications_update ON public.activity_notifications;
CREATE POLICY activity_notifications_update
  ON public.activity_notifications FOR UPDATE
  TO authenticated USING (auth.uid() IS NOT NULL);

-- Realtime (popups): adiciona à publicação se ainda não estiver.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'activity_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_notifications;
  END IF;
END $$;

-- Uma atividade por responsável: o dedupe de pendentes passa a considerar o
-- assigned_to (antes: lead+título+tipo — bloquearia a 2ª cópia do grupo).
-- COALESCE mantém o dedupe também para atividades sem responsável.
-- Rollback: recriar o índice sem a coluna COALESCE(assigned_to, ...).
DROP INDEX IF EXISTS lead_activities_dedup_pending_idx;
CREATE UNIQUE INDEX IF NOT EXISTS lead_activities_dedup_pending_idx
  ON public.lead_activities (
    lead_id,
    lower(btrim(title)),
    activity_type,
    COALESCE(assigned_to, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'pendente' AND deleted_at IS NULL AND lead_id IS NOT NULL;
