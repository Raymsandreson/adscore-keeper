ALTER TABLE public.funnel_zapsign_defaults
  ADD COLUMN IF NOT EXISTS notify_team_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS notify_group_jids text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS notify_phone_numbers text[] NOT NULL DEFAULT '{}'::text[];