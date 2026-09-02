-- Conversas do Relatórios — memória do gerador de relatórios por IA.
--
-- Motivação (evidência): a tela /relatorios guardava os turnos só em useState
-- (src/pages/RelatoriosPage.tsx) — um F5 apagava tudo e não existia noção de
-- "conversa". O ai_query_log é auditoria (uma linha por pergunta, sem
-- agrupamento e sem o resultado), então não serve pra reabrir um histórico.
--
-- Estas tabelas vivem no Supabase EXTERNO (kmedldlepwiityjsdahz) — é pra lá que
-- aponta o client do railway-server (EXTERNAL_SUPABASE_URL), que é quem grava.
--
-- Privacidade: cada usuário só vê as próprias conversas. A tela nunca fala com
-- estas tabelas direto — sempre pela função report-conversations, que valida o
-- JWT e filtra por user_id. RLS ligada SEM policy permissiva = anon/authenticated
-- não leem nada; só o service_role (Railway) enxerga.
--
-- Rollback: DROP TABLE public.report_messages; DROP TABLE public.report_conversations;
--           (tabelas novas — nenhum objeto existente é alterado)

CREATE TABLE IF NOT EXISTS public.report_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  user_email text,
  title text NOT NULL DEFAULT 'Nova conversa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.report_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.report_conversations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '',
  -- Consultas que a IA rodou pra montar a resposta:
  -- [{ sql, purpose, columns[], rows[], count, truncated, stored_rows, error }]
  -- As linhas já entram aqui MASCARADAS (CPF/RG/conta) pelo report-query.
  queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine text,
  status text NOT NULL DEFAULT 'ok',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Lista de conversas do usuário (ordenada pela mais recente).
CREATE INDEX IF NOT EXISTS idx_report_conversations_user
  ON public.report_conversations (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Abertura de uma conversa (mensagens em ordem cronológica).
CREATE INDEX IF NOT EXISTS idx_report_messages_conversation
  ON public.report_messages (conversation_id, created_at);

ALTER TABLE public.report_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_messages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.report_conversations IS
  'Conversas da tela Relatórios (IA que consulta o banco). Uma por thread do usuário. Acesso só via função report-conversations (service_role).';
COMMENT ON TABLE public.report_messages IS
  'Mensagens de uma conversa do Relatórios, com as consultas e resultados (já mascarados) que a IA usou.';
