CREATE TABLE IF NOT EXISTS public.lead_group_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL CHECK (action IN ('link', 'unlink')),
  group_jid TEXT,
  group_name TEXT,
  lead_id UUID,
  lead_name TEXT,
  user_id UUID,
  user_name TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'error', 'duplicate_skipped')),
  error_message TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_group_audit_created_at ON public.lead_group_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_group_audit_group_jid ON public.lead_group_audit_log (group_jid);
CREATE INDEX IF NOT EXISTS idx_lead_group_audit_lead_id ON public.lead_group_audit_log (lead_id);

ALTER TABLE public.lead_group_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit log"
  ON public.lead_group_audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can insert audit entries"
  ON public.lead_group_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);