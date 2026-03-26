-- Add role/description to board_group_instances
ALTER TABLE public.board_group_instances ADD COLUMN IF NOT EXISTS role_title text;
ALTER TABLE public.board_group_instances ADD COLUMN IF NOT EXISTS role_description text;

-- Add audio settings to board_group_settings
ALTER TABLE public.board_group_settings ADD COLUMN IF NOT EXISTS send_audio_message boolean DEFAULT false;
ALTER TABLE public.board_group_settings ADD COLUMN IF NOT EXISTS audio_voice_id text;