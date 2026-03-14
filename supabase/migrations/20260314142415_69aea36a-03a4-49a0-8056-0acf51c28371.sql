
-- Command shortcuts/templates for @wjia
CREATE TABLE public.wjia_command_shortcuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shortcut_name TEXT NOT NULL,
  description TEXT,
  template_token TEXT,
  template_name TEXT,
  prompt_instructions TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Active data collection sessions
CREATE TABLE public.wjia_collection_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  contact_id UUID,
  lead_id UUID,
  template_token TEXT NOT NULL,
  template_name TEXT,
  required_fields JSONB DEFAULT '[]'::jsonb,
  collected_data JSONB DEFAULT '{}'::jsonb,
  missing_fields JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'collecting' CHECK (status IN ('collecting', 'ready', 'generated', 'signed', 'expired', 'cancelled')),
  doc_token TEXT,
  sign_url TEXT,
  triggered_by TEXT,
  prompt_instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Follow-up rules for pending documents
CREATE TABLE public.wjia_followup_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  trigger_status TEXT DEFAULT 'generated',
  steps JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Follow-up execution log
CREATE TABLE public.wjia_followup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.wjia_collection_sessions(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES public.wjia_followup_rules(id) ON DELETE SET NULL,
  step_index INTEGER DEFAULT 0,
  action_type TEXT NOT NULL,
  action_result TEXT,
  executed_at TIMESTAMPTZ DEFAULT now(),
  next_execution_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_wjia_sessions_phone_status ON public.wjia_collection_sessions(phone, instance_name, status);
CREATE INDEX idx_wjia_sessions_status ON public.wjia_collection_sessions(status);
CREATE INDEX idx_wjia_followup_log_session ON public.wjia_followup_log(session_id);

-- RLS
ALTER TABLE public.wjia_command_shortcuts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wjia_collection_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wjia_followup_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wjia_followup_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage shortcuts" ON public.wjia_command_shortcuts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage sessions" ON public.wjia_collection_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage followup rules" ON public.wjia_followup_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can view followup logs" ON public.wjia_followup_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access shortcuts" ON public.wjia_command_shortcuts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access sessions" ON public.wjia_collection_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access followup rules" ON public.wjia_followup_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access followup log" ON public.wjia_followup_log FOR ALL TO service_role USING (true) WITH CHECK (true);
