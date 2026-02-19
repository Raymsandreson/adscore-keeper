
-- Create global activity types table (shared across all users)
CREATE TABLE IF NOT EXISTS public.activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'bg-blue-500',
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_types ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view global types
CREATE POLICY "activity_types_select" ON public.activity_types
  FOR SELECT TO authenticated USING (true);

-- Only admins can manage types
CREATE POLICY "activity_types_insert" ON public.activity_types
  FOR INSERT TO authenticated WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "activity_types_update" ON public.activity_types
  FOR UPDATE TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "activity_types_delete" ON public.activity_types
  FOR DELETE TO authenticated USING (is_admin(auth.uid()));

-- Seed default types
INSERT INTO public.activity_types (key, label, color, display_order) VALUES
  ('tarefa', 'Tarefa', 'bg-blue-500', 0),
  ('audiencia', 'Audiência', 'bg-green-500', 1),
  ('prazo', 'Prazo', 'bg-yellow-500', 2),
  ('acompanhamento', 'Acompanhamento', 'bg-purple-500', 3),
  ('reuniao', 'Reunião', 'bg-pink-500', 4),
  ('diligencia', 'Diligência', 'bg-orange-500', 5)
ON CONFLICT (key) DO NOTHING;

-- Remove label and color from user_timeblock_settings (now controlled globally)
ALTER TABLE public.user_timeblock_settings
  DROP COLUMN IF EXISTS label,
  DROP COLUMN IF EXISTS color;
