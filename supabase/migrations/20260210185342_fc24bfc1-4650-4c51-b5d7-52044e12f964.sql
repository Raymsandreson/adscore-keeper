
-- Templates de checklist reutilizáveis
CREATE TABLE public.checklist_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_mandatory BOOLEAN NOT NULL DEFAULT false,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vínculo entre template e etapa(s) de board(s)
CREATE TABLE public.checklist_stage_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  checklist_template_id UUID NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(checklist_template_id, board_id, stage_id)
);

-- Instância de checklist para um lead específico
CREATE TABLE public.lead_checklist_instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  checklist_template_id UUID NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  is_readonly BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_checklist_stage_links_board_stage ON public.checklist_stage_links(board_id, stage_id);
CREATE INDEX idx_lead_checklist_instances_lead ON public.lead_checklist_instances(lead_id);
CREATE INDEX idx_lead_checklist_instances_lead_stage ON public.lead_checklist_instances(lead_id, board_id, stage_id);

-- RLS
ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_stage_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_checklist_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage checklist templates" ON public.checklist_templates FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can manage checklist stage links" ON public.checklist_stage_links FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can manage lead checklist instances" ON public.lead_checklist_instances FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_checklist_templates_updated_at BEFORE UPDATE ON public.checklist_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_lead_checklist_instances_updated_at BEFORE UPDATE ON public.lead_checklist_instances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
