-- Vínculo mensagem do WhatsApp -> atividade criada a partir dela.
-- Mesmo desenho de team_message_activities (chat interno): marca a bolha com
-- "Virou atividade" e dá o atalho pra abrir a ficha no painel lateral.
--
-- Banco: Externo (kmedldlepwiityjsdahz) — mesmo lugar de whatsapp_messages e lead_activities.
-- Rollback: DROP TABLE public.whatsapp_message_activities;

CREATE TABLE IF NOT EXISTS public.whatsapp_message_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  phone text,
  instance_name text,
  activity_id uuid NOT NULL REFERENCES public.lead_activities(id) ON DELETE CASCADE,
  activity_title text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, activity_id)
);

-- Consulta principal: "as mensagens desta conversa viraram atividade?"
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_activities_phone
  ON public.whatsapp_message_activities (phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_activities_message
  ON public.whatsapp_message_activities (message_id);
-- Caminho inverso (atividade -> mensagens de origem), usado em auditoria.
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_activities_activity
  ON public.whatsapp_message_activities (activity_id);

ALTER TABLE public.whatsapp_message_activities ENABLE ROW LEVEL SECURITY;

-- A sessão do Externo é anônima (signInAnonymously): as policies abrem para
-- `authenticated`, não para auth.uid() = created_by — senão o cliente não lê nada.
DROP POLICY IF EXISTS whatsapp_message_activities_select ON public.whatsapp_message_activities;
CREATE POLICY whatsapp_message_activities_select
  ON public.whatsapp_message_activities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS whatsapp_message_activities_insert ON public.whatsapp_message_activities;
CREATE POLICY whatsapp_message_activities_insert
  ON public.whatsapp_message_activities FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS whatsapp_message_activities_delete ON public.whatsapp_message_activities;
CREATE POLICY whatsapp_message_activities_delete
  ON public.whatsapp_message_activities FOR DELETE TO authenticated USING (true);
