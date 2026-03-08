
-- Table to store report configuration
CREATE TABLE public.whatsapp_report_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  report_name TEXT NOT NULL DEFAULT 'Relatório Padrão',
  -- Which instances SEND the report
  sender_instance_ids UUID[] NOT NULL DEFAULT '{}',
  -- Which instances to REPORT ON (empty = all)
  target_instance_ids UUID[] NOT NULL DEFAULT '{}',
  -- Which phones receive the report (empty = owner_phones of target instances)
  recipient_phones TEXT[] NOT NULL DEFAULT '{}',
  -- Schedule: cron expressions
  schedule_times TEXT[] NOT NULL DEFAULT ARRAY['00:00', '12:00'],
  -- Metrics to include
  include_messages_inbound BOOLEAN NOT NULL DEFAULT true,
  include_messages_outbound BOOLEAN NOT NULL DEFAULT true,
  include_conversations BOOLEAN NOT NULL DEFAULT true,
  include_unread BOOLEAN NOT NULL DEFAULT true,
  include_calls BOOLEAN NOT NULL DEFAULT true,
  include_new_leads BOOLEAN NOT NULL DEFAULT true,
  include_closed_leads BOOLEAN NOT NULL DEFAULT true,
  include_new_contacts BOOLEAN NOT NULL DEFAULT true,
  include_response_time BOOLEAN NOT NULL DEFAULT true,
  include_ai_replies BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_report_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage report config"
  ON public.whatsapp_report_config
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
