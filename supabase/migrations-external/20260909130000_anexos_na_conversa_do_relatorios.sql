-- Anexos na conversa do Relatórios — a pergunta passa a poder vir com mídia.
--
-- Motivação (evidência): report_messages (criada em
-- 20260902120000_conversas_do_relatorios.sql) só guarda content/queries. A tela
-- /relatorios ganhou anexo (print, foto, PDF) e ditado por voz; sem coluna, o
-- arquivo que sustentou a pergunta desaparecia no F5 e a conversa reaberta
-- ficava com uma pergunta ("o que está errado nesse extrato?") sem o extrato.
--
-- Tabela vive no Supabase EXTERNO (kmedldlepwiityjsdahz) — quem grava é o
-- railway-server (EXTERNAL_SUPABASE_URL, service_role).
--
-- Formato de attachments (mensagem de papel 'user'):
--   [{ url, name, mime, size, kind: 'image'|'pdf'|'audio' }]
-- - url: URL pública do bucket team-chat-media (Cloud), o mesmo do chat interno.
-- - kind 'audio': o áudio DITADO. O texto transcrito vira o próprio content da
--   mensagem; o áudio fica anexado como prova do que foi falado.
-- Mensagem de papel 'assistant' fica sempre com '[]' — a IA não anexa nada.
--
-- Aditivo: coluna nova, com DEFAULT, em tabela que só o service_role lê.
-- Nenhuma leitura ou escrita existente muda de comportamento.
--
-- Rollback (imediato, sem perda de outro dado):
--   ALTER TABLE public.report_messages DROP COLUMN attachments;

ALTER TABLE public.report_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.report_messages.attachments IS
  'Anexos que vieram COM a pergunta: [{url, name, mime, size, kind}]. kind=audio é o ditado (o texto transcrito está em content). Resposta da IA nunca tem anexo.';
