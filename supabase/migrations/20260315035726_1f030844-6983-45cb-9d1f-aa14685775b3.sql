-- Add document request config to shortcuts
ALTER TABLE public.wjia_command_shortcuts 
ADD COLUMN IF NOT EXISTS request_documents boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS document_types text[] DEFAULT '{}';

-- Add document collection fields to sessions
ALTER TABLE public.wjia_collection_sessions 
ADD COLUMN IF NOT EXISTS request_documents boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS document_types text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS received_documents jsonb DEFAULT '[]';

-- Add collecting_docs to the status check constraint
ALTER TABLE public.wjia_collection_sessions DROP CONSTRAINT IF EXISTS wjia_collection_sessions_status_check;
ALTER TABLE public.wjia_collection_sessions ADD CONSTRAINT wjia_collection_sessions_status_check 
CHECK (status = ANY (ARRAY['collecting'::text, 'collecting_docs'::text, 'ready'::text, 'generated'::text, 'signed'::text, 'expired'::text, 'cancelled'::text]));