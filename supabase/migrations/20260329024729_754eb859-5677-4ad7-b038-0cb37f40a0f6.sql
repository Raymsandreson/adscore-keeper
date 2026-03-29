ALTER TABLE public.wjia_command_shortcuts
  ADD COLUMN IF NOT EXISTS send_window_start_hour integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS send_window_end_hour integer NOT NULL DEFAULT 20;