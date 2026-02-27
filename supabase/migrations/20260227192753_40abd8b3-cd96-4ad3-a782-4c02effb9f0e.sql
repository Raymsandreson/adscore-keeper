
CREATE TABLE public.whatsapp_conversation_shares (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  shared_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_with UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identify_sender BOOLEAN NOT NULL DEFAULT true,
  can_reshare BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(phone, instance_name, shared_with)
);

ALTER TABLE public.whatsapp_conversation_shares ENABLE ROW LEVEL SECURITY;

-- Sharer can manage their shares
CREATE POLICY "Sharer can manage own shares"
ON public.whatsapp_conversation_shares
FOR ALL
TO authenticated
USING (shared_by = auth.uid())
WITH CHECK (shared_by = auth.uid());

-- Shared-with user can view shares targeting them
CREATE POLICY "Shared user can view their shares"
ON public.whatsapp_conversation_shares
FOR SELECT
TO authenticated
USING (shared_with = auth.uid());

-- Users who can reshare can also insert new shares for same conversation
CREATE POLICY "Reshare allowed users can create shares"
ON public.whatsapp_conversation_shares
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.whatsapp_conversation_shares s
    WHERE s.phone = phone
      AND s.instance_name = instance_name
      AND s.shared_with = auth.uid()
      AND s.can_reshare = true
  )
);
