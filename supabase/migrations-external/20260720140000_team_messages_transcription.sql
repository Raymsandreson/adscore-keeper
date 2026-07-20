-- Transcrição de áudio no chat direto/grupo (team_messages), para paridade com o
-- chat de entidade (team_chat_messages, que já tem a coluna). O texto é gerado no
-- envio (ElevenLabs Scribe v2 → fallback Gemini, via Railway) e exibido abaixo do
-- player. Coluna nullable → ADD COLUMN é metadata-only (PG11+), não reescreve linhas.

ALTER TABLE public.team_messages
  ADD COLUMN IF NOT EXISTS transcription text;
