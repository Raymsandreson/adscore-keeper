
ALTER TABLE public.group_creation_queue 
ADD COLUMN creation_origin text NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN public.group_creation_queue.creation_origin IS 'Origin of group creation: auto_sign (ZapSign), manual (user button), queue_retry (reprocessed from queue)';
