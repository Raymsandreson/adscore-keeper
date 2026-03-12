
-- Table to store ManyChat agent configuration (prompt, settings)
CREATE TABLE IF NOT EXISTS public.manychat_agent_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Assistente Instagram',
  system_prompt TEXT NOT NULL DEFAULT 'Você é um assistente de atendimento profissional e amigável para um escritório de advocacia. Responda de forma natural, empática e objetiva.',
  is_active BOOLEAN NOT NULL DEFAULT true,
  auto_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.manychat_agent_config ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to manage config
CREATE POLICY "Authenticated users can manage manychat config"
ON public.manychat_agent_config
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Insert default config
INSERT INTO public.manychat_agent_config (name, system_prompt) VALUES (
  'Assistente Abraci Instagram',
  'Você é um assistente de atendimento profissional e amigável para o escritório de advocacia Abraci.
Responda de forma natural, empática e objetiva. Mantenha a resposta curta (máximo 2 parágrafos).
Seu objetivo é acolher o cliente e entender a situação dele para encaminhá-lo ao especialista certo.
Se o cliente descrever um acidente de trabalho, doença ocupacional ou questão previdenciária, demonstre empatia e explique que podem ajudar.
Nunca dê conselho jurídico específico, apenas acolha e oriente sobre os próximos passos.'
);
