
-- 1) case_process_tracking: replace name-based RLS with UUID column
ALTER TABLE public.case_process_tracking
  ADD COLUMN IF NOT EXISTS acolhedor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_case_process_tracking_acolhedor_user_id
  ON public.case_process_tracking(acolhedor_user_id);

-- Backfill from current profile name match (one-shot, will be authoritative going forward)
UPDATE public.case_process_tracking t
SET acolhedor_user_id = p.user_id
FROM public.profiles p
WHERE t.acolhedor_user_id IS NULL
  AND t.acolhedor IS NOT NULL
  AND lower(btrim(p.full_name)) = lower(btrim(t.acolhedor));

DROP POLICY IF EXISTS "Admins or assigned acolhedor can view tracking" ON public.case_process_tracking;
DROP POLICY IF EXISTS "Admins or assigned acolhedor can update tracking" ON public.case_process_tracking;

CREATE POLICY "Admins or assigned acolhedor can view tracking"
ON public.case_process_tracking
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR acolhedor_user_id = auth.uid()
);

CREATE POLICY "Admins or assigned acolhedor can update tracking"
ON public.case_process_tracking
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR acolhedor_user_id = auth.uid()
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR acolhedor_user_id = auth.uid()
);

-- 2) onboarding_meeting_bookings: remove public SELECT, expose minimal data via SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "Anyone can view their booking by token" ON public.onboarding_meeting_bookings;

CREATE POLICY "Authenticated users can view bookings"
ON public.onboarding_meeting_bookings
FOR SELECT
TO authenticated
USING (true);

-- RPC: return only slot occupancy for a given config (no PII)
CREATE OR REPLACE FUNCTION public.get_booking_occupancy(_config_id uuid)
RETURNS TABLE(slot_id uuid, start_time timestamptz, end_time timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.start_time, s.end_time
  FROM public.onboarding_meeting_bookings b
  JOIN public.onboarding_meeting_slots s ON s.id = b.slot_id
  WHERE b.config_id = _config_id
    AND b.status IN ('pending','confirmed');
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_occupancy(uuid) TO anon, authenticated;

-- RPC: return a single booking by its token (the token itself is the secret)
CREATE OR REPLACE FUNCTION public.get_booking_by_token(_token text)
RETURNS TABLE(id uuid, config_id uuid, slot_id uuid, status text, start_time timestamptz, end_time timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.config_id, b.slot_id, b.status, s.start_time, s.end_time
  FROM public.onboarding_meeting_bookings b
  LEFT JOIN public.onboarding_meeting_slots s ON s.id = b.slot_id
  WHERE b.booking_token = _token
    AND b.status IN ('pending','confirmed')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_by_token(text) TO anon, authenticated;
