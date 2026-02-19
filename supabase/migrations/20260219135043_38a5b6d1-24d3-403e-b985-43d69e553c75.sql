-- Allow admins to DELETE other users' timeblock settings
CREATE POLICY "Admins can delete all timeblock settings"
ON public.user_timeblock_settings
FOR DELETE
USING (is_admin(auth.uid()));