
-- Table to track call events in progress (offer -> accept -> terminate)
CREATE TABLE public.call_events_pending (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  call_id TEXT NOT NULL,
  instance_name TEXT,
  phone TEXT NOT NULL,
  contact_name TEXT,
  event_type TEXT NOT NULL,
  from_me BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for quick lookup by call_id
CREATE INDEX idx_call_events_pending_call_id ON public.call_events_pending(call_id);

-- Auto-cleanup old pending events (older than 1 hour)
CREATE INDEX idx_call_events_pending_created ON public.call_events_pending(created_at);

-- RLS
ALTER TABLE public.call_events_pending ENABLE ROW LEVEL SECURITY;

-- Service role only (used by edge function)
CREATE POLICY "Service role full access" ON public.call_events_pending
  FOR ALL USING (true) WITH CHECK (true);

-- Also clean up the duplicate call records that were created
DELETE FROM public.call_records 
WHERE tags @> ARRAY['whatsapp'] 
AND duration_seconds = 0
AND notes LIKE '%Status: offer%';

DELETE FROM public.call_records 
WHERE tags @> ARRAY['whatsapp'] 
AND duration_seconds = 0
AND notes LIKE '%Status: accept%';
