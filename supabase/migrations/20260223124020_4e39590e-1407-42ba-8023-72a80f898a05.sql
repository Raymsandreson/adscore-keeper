
-- Add board_id column to lead_custom_fields to link custom fields to specific kanban boards (funnels)
ALTER TABLE public.lead_custom_fields 
ADD COLUMN board_id UUID REFERENCES public.kanban_boards(id) ON DELETE CASCADE;

-- Create index for efficient queries by board
CREATE INDEX idx_lead_custom_fields_board_id ON public.lead_custom_fields(board_id);
