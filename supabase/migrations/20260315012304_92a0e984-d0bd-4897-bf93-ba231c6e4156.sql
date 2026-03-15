ALTER TABLE public.zapsign_documents 
  ADD COLUMN notify_on_signature boolean NOT NULL DEFAULT true,
  ADD COLUMN send_signed_pdf boolean NOT NULL DEFAULT true;