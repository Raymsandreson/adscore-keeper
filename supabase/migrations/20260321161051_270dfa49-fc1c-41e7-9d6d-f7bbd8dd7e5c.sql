ALTER TABLE public.wjia_collection_sessions
DROP CONSTRAINT IF EXISTS wjia_collection_sessions_status_check;

ALTER TABLE public.wjia_collection_sessions
ADD CONSTRAINT wjia_collection_sessions_status_check
CHECK (
  status = ANY (
    ARRAY[
      'collecting'::text,
      'collecting_docs'::text,
      'processing_docs'::text,
      'ready'::text,
      'generated'::text,
      'signed'::text,
      'expired'::text,
      'cancelled'::text
    ]
  )
);