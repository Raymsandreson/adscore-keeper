
-- Add max unanswered messages config to campaign links
ALTER TABLE public.whatsapp_agent_campaign_links 
ADD COLUMN IF NOT EXISTS max_unanswered_messages integer DEFAULT 0;

COMMENT ON COLUMN public.whatsapp_agent_campaign_links.max_unanswered_messages IS 'Max consecutive outbound messages without inbound reply before marking lead as inviavel. 0 = disabled.';

-- Create agent reply lock table for deduplication
CREATE TABLE IF NOT EXISTS public.agent_reply_locks (
  phone text NOT NULL,
  instance_name text NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 minutes'),
  PRIMARY KEY (phone, instance_name)
);

-- Auto-cleanup expired locks
CREATE OR REPLACE FUNCTION public.cleanup_expired_reply_locks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.agent_reply_locks WHERE expires_at < now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_cleanup_reply_locks
BEFORE INSERT ON public.agent_reply_locks
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_expired_reply_locks();

-- RLS
ALTER TABLE public.agent_reply_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on reply locks"
ON public.agent_reply_locks
FOR ALL
USING (true)
WITH CHECK (true);
