ALTER TABLE public.wjia_command_shortcuts 
  ADD COLUMN notify_on_signature boolean NOT NULL DEFAULT true,
  ADD COLUMN send_signed_pdf boolean NOT NULL DEFAULT true;