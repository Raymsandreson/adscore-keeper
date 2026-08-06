-- Pendências do CLIENTE (Supabase Externo).
--
-- Problema que resolve: o que o escritório combina com o cliente no WhatsApp
-- ("vou avaliar vocês no Google", "vou gravar o depoimento", "te mando o
-- documento amanhã") não tinha registro em lugar nenhum — morria no áudio da
-- conversa. `lead_activities` é atividade do ASSESSOR (entra em cronômetro,
-- banco de horas e ranking do telão), então não serve: pendência de cliente
-- ficaria eternamente aberta no nome de um assessor. `lead_followups` é log do
-- escritório (id, lead_id, followup_date, followup_type, notes, outcome) — não
-- tem dono, prazo nem estado de cobrança.
--
-- Rollback: DROP TABLE public.lead_client_commitments;

CREATE TABLE IF NOT EXISTS public.lead_client_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Conversa sem lead (captação) também precisa controlar pendência, por isso
  -- lead_id é opcional e phone+instance_name servem de chave alternativa.
  lead_id uuid,
  process_id uuid,
  contact_id uuid,
  phone text,
  instance_name text,

  title text NOT NULL,
  kind text NOT NULL DEFAULT 'outro',
  status text NOT NULL DEFAULT 'combinado',

  due_date date,
  promised_at timestamptz NOT NULL DEFAULT now(),

  -- Mensagem em que o cliente prometeu ("Vou fazer sim") — vira atalho na conversa
  source_message_id text,
  source_message_text text,

  notes text,
  last_reminded_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,

  done_at timestamptz,
  done_by uuid,
  done_by_name text,

  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lcc_kind_chk CHECK (kind IN (
    'avaliacao_google','depoimento','documento','comparecimento','pagamento','outro'
  )),
  CONSTRAINT lcc_status_chk CHECK (status IN (
    'combinado','cobrado','feito','desistiu'
  )),
  CONSTRAINT lcc_alvo_chk CHECK (lead_id IS NOT NULL OR phone IS NOT NULL)
);

-- A conversa filtra por lead OU por telefone+instância, e sempre pelos abertos.
CREATE INDEX IF NOT EXISTS lcc_lead_abertas_idx
  ON public.lead_client_commitments (lead_id)
  WHERE status IN ('combinado','cobrado');

CREATE INDEX IF NOT EXISTS lcc_phone_abertas_idx
  ON public.lead_client_commitments (phone, instance_name)
  WHERE status IN ('combinado','cobrado');

-- Fase 2 (cobrança automática) varre vencidas.
CREATE INDEX IF NOT EXISTS lcc_due_abertas_idx
  ON public.lead_client_commitments (due_date)
  WHERE status IN ('combinado','cobrado');

-- Selo "virou pendência" na bolha da mensagem
CREATE INDEX IF NOT EXISTS lcc_source_message_idx
  ON public.lead_client_commitments (source_message_id)
  WHERE source_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS lcc_set_updated_at ON public.lead_client_commitments;
CREATE TRIGGER lcc_set_updated_at
  BEFORE UPDATE ON public.lead_client_commitments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.lead_client_commitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lcc_authenticated_all ON public.lead_client_commitments;
CREATE POLICY lcc_authenticated_all ON public.lead_client_commitments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Barra da conversa atualiza sozinha quando outro assessor marca "Feito".
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_client_commitments;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
