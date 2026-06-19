
DROP POLICY IF EXISTS "Authenticated users can view bookings" ON public.onboarding_meeting_bookings;
DROP POLICY IF EXISTS "Authenticated users can manage bookings" ON public.onboarding_meeting_bookings;

CREATE POLICY "Admins can view bookings"
  ON public.onboarding_meeting_bookings
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update bookings"
  ON public.onboarding_meeting_bookings
  FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete bookings"
  ON public.onboarding_meeting_bookings
  FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
