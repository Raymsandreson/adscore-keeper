
-- Table for knowledge documents linked to agents
CREATE TABLE public.agent_knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.whatsapp_ai_agents(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  extracted_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, ready, error
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by agent
CREATE INDEX idx_agent_knowledge_agent_id ON public.agent_knowledge_documents(agent_id);

-- RLS
ALTER TABLE public.agent_knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage knowledge docs"
ON public.agent_knowledge_documents
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Storage bucket for knowledge documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('agent-knowledge', 'agent-knowledge', true);

-- Storage RLS policies
CREATE POLICY "Authenticated users can upload knowledge docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'agent-knowledge');

CREATE POLICY "Anyone can read knowledge docs"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'agent-knowledge');

CREATE POLICY "Authenticated users can delete knowledge docs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'agent-knowledge');
