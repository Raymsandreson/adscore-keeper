ALTER TABLE public.wjia_command_shortcuts 
ADD COLUMN partial_min_fields text[] DEFAULT '{}'::text[];