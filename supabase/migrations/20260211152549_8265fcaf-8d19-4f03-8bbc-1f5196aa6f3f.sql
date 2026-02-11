
-- Create lead_activities table
CREATE TABLE public.lead_activities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  lead_name TEXT,
  title TEXT NOT NULL,
  description TEXT,
  activity_type TEXT NOT NULL DEFAULT 'tarefa',
  status TEXT NOT NULL DEFAULT 'pendente',
  priority TEXT DEFAULT 'normal',
  assigned_to UUID,
  assigned_to_name TEXT,
  deadline DATE,
  notification_date DATE,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  completed_by_name TEXT,
  notes TEXT,
  what_was_done TEXT,
  next_steps TEXT,
  current_status_notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view activities"
  ON public.lead_activities FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create activities"
  ON public.lead_activities FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update activities"
  ON public.lead_activities FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete activities"
  ON public.lead_activities FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_lead_activities_updated_at
  BEFORE UPDATE ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
