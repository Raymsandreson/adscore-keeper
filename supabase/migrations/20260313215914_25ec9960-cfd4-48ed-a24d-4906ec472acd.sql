CREATE TABLE public.whatsapp_notification_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active boolean DEFAULT true,
  name text NOT NULL DEFAULT 'Notificações Gerais',
  instance_name text,
  recipient_phones text[] DEFAULT '{}',
  -- Notification types
  notify_overdue_tasks boolean DEFAULT true,
  notify_goal_progress boolean DEFAULT true,
  notify_daily_summary boolean DEFAULT true,
  notify_weekly_summary boolean DEFAULT false,
  notify_session_reminder boolean DEFAULT false,
  -- Schedule
  schedule_times text[] DEFAULT ARRAY['08:00', '18:00'],
  schedule_days integer[] DEFAULT ARRAY[1,2,3,4,5],
  -- Thresholds
  overdue_threshold_hours integer DEFAULT 24,
  goal_alert_percent integer DEFAULT 50,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.whatsapp_notification_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage notification config"
  ON public.whatsapp_notification_config
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);