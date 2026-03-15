
ALTER TABLE public.wjia_command_shortcuts 
  DROP COLUMN IF EXISTS stop_on_human_reply,
  ADD COLUMN human_reply_pause_minutes integer DEFAULT 0;

COMMENT ON COLUMN public.wjia_command_shortcuts.human_reply_pause_minutes IS '0 = não pausar, >0 = pausar follow-up por N minutos após resposta humana';
