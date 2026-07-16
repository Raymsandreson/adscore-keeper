-- Enriquece o chat de entidade (team_chat_messages) para paridade com o chat
-- direto/grupo: áudio (com transcrição), anexos, mensagem urgente.
-- Menção de lead/contato/atividade continua inline no content ([type:id:name]),
-- sem coluna nova. Todas as colunas são nullable/têm default → ADD COLUMN é
-- metadata-only (PG11+), sem reescrever linhas.

ALTER TABLE public.team_chat_messages
  ADD COLUMN IF NOT EXISTS message_type   text    NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS file_url       text,
  ADD COLUMN IF NOT EXISTS file_name      text,
  ADD COLUMN IF NOT EXISTS file_type      text,
  ADD COLUMN IF NOT EXISTS file_size      bigint,
  ADD COLUMN IF NOT EXISTS audio_duration integer,
  ADD COLUMN IF NOT EXISTS transcription  text,
  ADD COLUMN IF NOT EXISTS is_urgent      boolean NOT NULL DEFAULT false;
