
ALTER TABLE public.wjia_command_shortcuts
  ADD COLUMN IF NOT EXISTS max_repeat_cycles integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS min_call_delay_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS max_consecutive_call_failures integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_call_attempts integer NOT NULL DEFAULT 2;
