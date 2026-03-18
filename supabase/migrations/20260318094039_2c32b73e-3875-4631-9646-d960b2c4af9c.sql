ALTER TABLE public.wjia_command_shortcuts
  ADD COLUMN IF NOT EXISTS assistant_type text NOT NULL DEFAULT 'document',
  ADD COLUMN IF NOT EXISTS base_prompt text,
  ADD COLUMN IF NOT EXISTS model text DEFAULT 'google/gemini-2.5-flash',
  ADD COLUMN IF NOT EXISTS temperature numeric DEFAULT 0.7,
  ADD COLUMN IF NOT EXISTS response_delay_seconds integer DEFAULT 2,
  ADD COLUMN IF NOT EXISTS split_messages boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_delay_seconds integer DEFAULT 3;

COMMENT ON COLUMN public.wjia_command_shortcuts.assistant_type IS 'document = gera documentos ZapSign, assistant = assistente conversacional, hybrid = ambos';
COMMENT ON COLUMN public.wjia_command_shortcuts.base_prompt IS 'Prompt base do assistente (persona, regras gerais)';
COMMENT ON COLUMN public.wjia_command_shortcuts.model IS 'Modelo de IA a usar';