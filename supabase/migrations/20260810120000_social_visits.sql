-- Agenda de visitas com assistentes sociais (Supabase EXTERNO kmedldlepwiityjsdahz).
--
-- Antes disso a visita só existia como texto solto em atividade ("Alinhar as
-- visitas do Renan no Paraná", "Direcionar casos para as ass. sociais"): não dava
-- para ver a semana, nem quem visita quem, nem o que já foi realizado.
--
-- A assistente social é parceira EXTERNA — não tem perfil no sistema. Por isso o
-- vínculo é com `contacts` (28 já cadastradas com profession 'assistente social'),
-- com o nome também gravado em texto: quem ainda não está no cadastro é agendada
-- pelo nome, sem travar a operação, e o card do calendário não depende do join.

CREATE TABLE IF NOT EXISTS public.social_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lead visitado. Sem ON DELETE CASCADE de propósito: lead usa soft delete, e
  -- apagar a agenda junto esconderia visita realizada.
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  -- Snapshot do nome na hora do agendamento — o calendário lista sem join.
  lead_name text,

  -- Assistente social: vínculo quando ela está em contacts, nome sempre.
  social_worker_contact_id uuid REFERENCES public.contacts(id),
  social_worker_name text NOT NULL,
  social_worker_phone text,

  visit_date date NOT NULL,
  visit_time time,

  status text NOT NULL DEFAULT 'agendada'
    CHECK (status IN ('agendada', 'confirmada', 'realizada', 'remarcada', 'cancelada')),

  -- Local da visita. Copiado de leads.visit_* no primeiro agendamento, mas
  -- editável: a família pode receber em outro endereço.
  address text,
  city text,
  state text,

  notes text,

  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE public.social_visits IS 'Visitas agendadas com assistentes sociais parceiras (uma linha por visita, por lead).';
COMMENT ON COLUMN public.social_visits.social_worker_name IS 'Nome da assistente social — preenchido mesmo quando ela não está em contacts.';
COMMENT ON COLUMN public.social_visits.lead_name IS 'Snapshot do nome do lead no agendamento; a fonte da verdade é leads.lead_name via lead_id.';

-- A tela abre sempre por período (semana/mês) e a aba do lead sempre por lead.
CREATE INDEX IF NOT EXISTS idx_social_visits_date
  ON public.social_visits (visit_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_visits_lead
  ON public.social_visits (lead_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_visits_worker
  ON public.social_visits (social_worker_contact_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS social_visits_set_updated_at ON public.social_visits;
CREATE TRIGGER social_visits_set_updated_at
  BEFORE UPDATE ON public.social_visits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: endereço e telefone de família de vítima. Nada de policy TO public.
ALTER TABLE public.social_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_visits_select_auth ON public.social_visits;
CREATE POLICY social_visits_select_auth ON public.social_visits
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS social_visits_insert_auth ON public.social_visits;
CREATE POLICY social_visits_insert_auth ON public.social_visits
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS social_visits_update_auth ON public.social_visits;
CREATE POLICY social_visits_update_auth ON public.social_visits
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS social_visits_delete_auth ON public.social_visits;
CREATE POLICY social_visits_delete_auth ON public.social_visits
  FOR DELETE TO authenticated USING (true);
