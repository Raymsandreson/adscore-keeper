ALTER TABLE public.board_group_settings 
ADD COLUMN IF NOT EXISTS auto_close_lead_on_sign BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_create_group_on_sign BOOLEAN DEFAULT false;