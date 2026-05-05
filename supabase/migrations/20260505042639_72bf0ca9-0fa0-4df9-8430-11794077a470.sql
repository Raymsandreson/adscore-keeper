-- Defaults por funil
CREATE TABLE IF NOT EXISTS public.funnel_zapsign_defaults (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id UUID NOT NULL UNIQUE,
  zapsign_template_token TEXT,
  signer_role TEXT DEFAULT 'Cliente',
  signer_auth_mode TEXT DEFAULT 'assinaturaTela',
  auto_create_lead BOOLEAN NOT NULL DEFAULT true,
  auto_create_group BOOLEAN NOT NULL DEFAULT true,
  attach_chat_docs BOOLEAN NOT NULL DEFAULT true,
  default_message_template TEXT,
  drive_folder_id TEXT,
  notify_on_signature BOOLEAN NOT NULL DEFAULT true,
  send_signed_pdf BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.funnel_zapsign_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view funnel zapsign defaults"
  ON public.funnel_zapsign_defaults FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert funnel zapsign defaults"
  ON public.funnel_zapsign_defaults FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update funnel zapsign defaults"
  ON public.funnel_zapsign_defaults FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated can delete funnel zapsign defaults"
  ON public.funnel_zapsign_defaults FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_funnel_zapsign_defaults_updated_at
  BEFORE UPDATE ON public.funnel_zapsign_defaults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Progresso de geração em tempo real
CREATE TABLE IF NOT EXISTS public.zapsign_generation_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL,
  doc_token TEXT,
  phone TEXT,
  instance_name TEXT,
  board_id UUID,
  lead_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  step_label TEXT,
  pct INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zapsign_gen_progress_request ON public.zapsign_generation_progress(request_id);
CREATE INDEX IF NOT EXISTS idx_zapsign_gen_progress_created_by ON public.zapsign_generation_progress(created_by);

ALTER TABLE public.zapsign_generation_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view zapsign progress"
  ON public.zapsign_generation_progress FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert zapsign progress"
  ON public.zapsign_generation_progress FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update zapsign progress"
  ON public.zapsign_generation_progress FOR UPDATE TO authenticated USING (true);

CREATE TRIGGER update_zapsign_generation_progress_updated_at
  BEFORE UPDATE ON public.zapsign_generation_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.zapsign_generation_progress;
ALTER TABLE public.zapsign_generation_progress REPLICA IDENTITY FULL;