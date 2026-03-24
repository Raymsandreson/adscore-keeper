ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS reply_with_audio boolean NOT NULL DEFAULT false;
ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS reply_voice_id text DEFAULT NULL;
ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS respond_in_groups boolean NOT NULL DEFAULT false;