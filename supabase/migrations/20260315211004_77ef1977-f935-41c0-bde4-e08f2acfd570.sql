-- Table to track which processes are being monitored for movement notifications
CREATE TABLE public.process_movement_monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id UUID NOT NULL REFERENCES public.lead_processes(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_movement_date TIMESTAMPTZ,
  last_movement_count INTEGER DEFAULT 0,
  last_checked_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  notify_via_audio BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(process_id, phone)
);

ALTER TABLE public.process_movement_monitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage monitors"
  ON public.process_movement_monitors
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Log of sent notifications
CREATE TABLE public.process_movement_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID NOT NULL REFERENCES public.process_movement_monitors(id) ON DELETE CASCADE,
  process_id UUID NOT NULL REFERENCES public.lead_processes(id) ON DELETE CASCADE,
  movement_summary TEXT NOT NULL,
  notification_type TEXT DEFAULT 'text',
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent',
  error_message TEXT
);

ALTER TABLE public.process_movement_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view notifications"
  ON public.process_movement_notifications
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_monitors_updated_at
  BEFORE UPDATE ON public.process_movement_monitors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();