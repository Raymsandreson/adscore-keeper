ALTER TABLE public.wjia_command_shortcuts 
ADD COLUMN IF NOT EXISTS skip_confirmation BOOLEAN NOT NULL DEFAULT true;