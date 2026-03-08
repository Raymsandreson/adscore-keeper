
-- AI Agents table: stores agent configurations
CREATE TABLE public.whatsapp_ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'lovable_ai',
  model TEXT NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  base_prompt TEXT NOT NULL DEFAULT '',
  temperature INTEGER NOT NULL DEFAULT 50,
  max_tokens INTEGER NOT NULL DEFAULT 2000,
  sign_messages BOOLEAN NOT NULL DEFAULT true,
  read_messages BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  uazapi_agent_id TEXT,
  uazapi_config JSONB DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-conversation agent assignment
CREATE TABLE public.whatsapp_conversation_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  agent_id UUID REFERENCES public.whatsapp_ai_agents(id) ON DELETE CASCADE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  activated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(phone, instance_name)
);

-- Enable RLS
ALTER TABLE public.whatsapp_ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversation_agents ENABLE ROW LEVEL SECURITY;

-- RLS policies for agents table
CREATE POLICY "Authenticated users can read agents" ON public.whatsapp_ai_agents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert agents" ON public.whatsapp_ai_agents
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update agents" ON public.whatsapp_ai_agents
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete agents" ON public.whatsapp_ai_agents
  FOR DELETE TO authenticated USING (true);

-- RLS policies for conversation agents table
CREATE POLICY "Authenticated users can read conversation agents" ON public.whatsapp_conversation_agents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert conversation agents" ON public.whatsapp_conversation_agents
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update conversation agents" ON public.whatsapp_conversation_agents
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete conversation agents" ON public.whatsapp_conversation_agents
  FOR DELETE TO authenticated USING (true);
