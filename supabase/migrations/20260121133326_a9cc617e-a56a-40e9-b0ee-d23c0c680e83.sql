-- Create kanban_boards table for customizable boards
CREATE TABLE public.kanban_boards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  color TEXT DEFAULT '#3b82f6',
  icon TEXT DEFAULT 'layout-grid',
  is_default BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  ad_account_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add board_id to leads table
ALTER TABLE public.leads 
ADD COLUMN board_id UUID REFERENCES public.kanban_boards(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX idx_leads_board_id ON public.leads(board_id);
CREATE INDEX idx_kanban_boards_ad_account ON public.kanban_boards(ad_account_id);

-- Enable RLS
ALTER TABLE public.kanban_boards ENABLE ROW LEVEL SECURITY;

-- RLS policies for kanban_boards
CREATE POLICY "Anyone can read kanban_boards" 
ON public.kanban_boards 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert kanban_boards" 
ON public.kanban_boards 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update kanban_boards" 
ON public.kanban_boards 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete kanban_boards" 
ON public.kanban_boards 
FOR DELETE 
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_kanban_boards_updated_at
BEFORE UPDATE ON public.kanban_boards
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default boards based on current workflow
INSERT INTO public.kanban_boards (name, description, stages, color, icon, is_default, display_order) VALUES
(
  'Prospecção Outbound',
  'Leads captados via comentários em redes sociais',
  '[
    {"id": "comment", "name": "Comentário", "color": "#3b82f6"},
    {"id": "dm", "name": "DM", "color": "#8b5cf6"},
    {"id": "whatsapp", "name": "WhatsApp", "color": "#22c55e"},
    {"id": "scheduled", "name": "Visita Agendada", "color": "#f97316"},
    {"id": "visited", "name": "Visitou", "color": "#eab308"},
    {"id": "closed", "name": "Fechado", "color": "#10b981"},
    {"id": "post_visit", "name": "Pós-Visita", "color": "#06b6d4"},
    {"id": "post_closing", "name": "Pós-Fechamento", "color": "#14b8a6"}
  ]'::jsonb,
  '#8b5cf6',
  'instagram',
  false,
  1
),
(
  'Leads Inbound',
  'Leads de formulários e cliques WhatsApp',
  '[
    {"id": "new", "name": "Novo", "color": "#3b82f6"},
    {"id": "contacted", "name": "Contatado", "color": "#8b5cf6"},
    {"id": "qualified", "name": "Qualificado", "color": "#22c55e"},
    {"id": "scheduled", "name": "Visita Agendada", "color": "#f97316"},
    {"id": "visited", "name": "Visitou", "color": "#eab308"},
    {"id": "closed", "name": "Fechado", "color": "#10b981"},
    {"id": "not_qualified", "name": "Não Qualificado", "color": "#ef4444"},
    {"id": "post_visit", "name": "Pós-Visita", "color": "#06b6d4"},
    {"id": "post_closing", "name": "Pós-Fechamento", "color": "#14b8a6"}
  ]'::jsonb,
  '#3b82f6',
  'inbox',
  true,
  0
);