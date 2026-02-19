-- Allow admins to read and write timeblock settings of any user
CREATE POLICY "Admins can view all timeblock settings"
  ON public.user_timeblock_settings
  FOR SELECT
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can upsert all timeblock settings"
  ON public.user_timeblock_settings
  FOR INSERT
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update all timeblock settings"
  ON public.user_timeblock_settings
  FOR UPDATE
  USING (public.is_admin(auth.uid()));
