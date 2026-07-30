-- Vínculo mensagem do chat interno -> atividade criada a partir dela.
-- Permite marcar no Chat da Equipe que aquelas mensagens viraram atividade e
-- dar um atalho pra abrir a atividade direto da conversa.
--
-- Banco: Externo (kmedldlepwiityjsdahz) — mesmo lugar de team_messages e lead_activities.
-- Rollback: DROP TABLE public.team_message_activities;

CREATE TABLE IF NOT EXISTS public.team_message_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.team_messages(id) ON DELETE CASCADE,
  conversation_id uuid,
  activity_id uuid NOT NULL REFERENCES public.lead_activities(id) ON DELETE CASCADE,
  activity_title text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, activity_id)
);

-- Consulta principal: "estas mensagens da conversa viraram atividade?"
CREATE INDEX IF NOT EXISTS idx_team_message_activities_message
  ON public.team_message_activities (message_id);
CREATE INDEX IF NOT EXISTS idx_team_message_activities_conversation
  ON public.team_message_activities (conversation_id);
-- Caminho inverso (atividade -> mensagens de origem), usado em auditoria.
CREATE INDEX IF NOT EXISTS idx_team_message_activities_activity
  ON public.team_message_activities (activity_id);

ALTER TABLE public.team_message_activities ENABLE ROW LEVEL SECURITY;

-- A sessão do Externo é anônima (signInAnonymously): as policies abrem para
-- `authenticated`, não para auth.uid() = created_by — senão o cliente não lê nada.
DROP POLICY IF EXISTS team_message_activities_select ON public.team_message_activities;
CREATE POLICY team_message_activities_select
  ON public.team_message_activities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS team_message_activities_insert ON public.team_message_activities;
CREATE POLICY team_message_activities_insert
  ON public.team_message_activities FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS team_message_activities_delete ON public.team_message_activities;
CREATE POLICY team_message_activities_delete
  ON public.team_message_activities FOR DELETE TO authenticated USING (true);
