
CREATE TABLE public.activity_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Modelo padrão',
  template_content TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.activity_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage templates"
ON public.activity_message_templates
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
