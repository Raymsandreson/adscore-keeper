ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS always_add_to_closed_groups boolean NOT NULL DEFAULT false;

UPDATE public.whatsapp_instances
   SET always_add_to_closed_groups = true
 WHERE id IN (
   'b5081249-2702-4392-a091-e7cf55c54608', -- Raym
   '259203a6-d8e7-4638-b700-0a1eb1d29db9'  -- João Manoel- Acolhedor
 );