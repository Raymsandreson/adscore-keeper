ALTER TABLE public.wjia_command_shortcuts 
ADD COLUMN IF NOT EXISTS zapsign_mode text NOT NULL DEFAULT 'final_document';