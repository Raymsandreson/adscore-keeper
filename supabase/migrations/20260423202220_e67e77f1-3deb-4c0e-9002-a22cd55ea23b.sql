-- 1) Restrict case_process_tracking (contains senha_gov, cpf)
DROP POLICY IF EXISTS "Authenticated users can view tracking" ON public.case_process_tracking;
DROP POLICY IF EXISTS "Authenticated users can insert tracking" ON public.case_process_tracking;
DROP POLICY IF EXISTS "Authenticated users can update tracking" ON public.case_process_tracking;
DROP POLICY IF EXISTS "Authenticated users can delete tracking" ON public.case_process_tracking;

-- Only admins or the assigned acolhedor (matched by full_name) can view/modify
CREATE POLICY "Admins or assigned acolhedor can view tracking"
ON public.case_process_tracking FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND case_process_tracking.acolhedor IS NOT NULL
      AND lower(btrim(p.full_name)) = lower(btrim(case_process_tracking.acolhedor))
  )
);

CREATE POLICY "Admins can insert tracking"
ON public.case_process_tracking FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins or assigned acolhedor can update tracking"
ON public.case_process_tracking FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND case_process_tracking.acolhedor IS NOT NULL
      AND lower(btrim(p.full_name)) = lower(btrim(case_process_tracking.acolhedor))
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND case_process_tracking.acolhedor IS NOT NULL
      AND lower(btrim(p.full_name)) = lower(btrim(case_process_tracking.acolhedor))
  )
);

CREATE POLICY "Admins can delete tracking"
ON public.case_process_tracking FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));


-- 2) Fix broken reshare policy on whatsapp_conversation_shares
DROP POLICY IF EXISTS "Reshare allowed users can create shares" ON public.whatsapp_conversation_shares;

CREATE POLICY "Reshare allowed users can create shares"
ON public.whatsapp_conversation_shares FOR INSERT
TO authenticated
WITH CHECK (
  shared_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.whatsapp_conversation_shares s
    WHERE s.phone = whatsapp_conversation_shares.phone
      AND s.instance_name = whatsapp_conversation_shares.instance_name
      AND s.shared_with = auth.uid()
      AND s.can_reshare = true
  )
);


-- 3) Lock down cat_leads (real CPFs, addresses, medical data)
DROP POLICY IF EXISTS "Anyone can read cat_leads" ON public.cat_leads;
DROP POLICY IF EXISTS "Anyone can insert cat_leads" ON public.cat_leads;
DROP POLICY IF EXISTS "Anyone can update cat_leads" ON public.cat_leads;
DROP POLICY IF EXISTS "Anyone can delete cat_leads" ON public.cat_leads;

CREATE POLICY "Authenticated users can view cat_leads"
ON public.cat_leads FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR assigned_to = auth.uid()
);

CREATE POLICY "Admins can insert cat_leads"
ON public.cat_leads FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins or assigned user can update cat_leads"
ON public.cat_leads FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR assigned_to = auth.uid())
WITH CHECK (public.has_role(auth.uid(), 'admin') OR assigned_to = auth.uid());

CREATE POLICY "Admins can delete cat_leads"
ON public.cat_leads FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));