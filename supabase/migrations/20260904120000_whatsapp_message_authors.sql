-- Autoria das mensagens enviadas pelo WhatsApp — quem da equipe falou com o cliente.
--
-- Motivação (evidência desta sessão):
--   * `whatsapp_messages` não tem NENHUMA coluna de autor (só phone, direction,
--     instance_name, metadata, action_source…). A única pista hoje é o prefixo
--     `*Nome:*` que o envio identificado cola no TEXTO — e áudio/mídia saem sem
--     prefixo nenhum (`/send/media` só aceita `caption`, e áudio nem isso).
--     Resultado: nas conversas de grupo ninguém sabe quem gravou o áudio.
--
-- Por que TABELA SEPARADA e não coluna em `whatsapp_messages`:
--   Duas rotas gravam a MESMA mensagem enviada e disputam a linha por
--   `external_message_id` (unique):
--     1. a edge `send-whatsapp` (quem sabe o autor), com upsert
--        `ignoreDuplicates: true` — ou seja, desiste se já existir;
--     2. o webhook da UazAPI (que NÃO sabe o autor), que insere e trata 23505
--        como "duplicate_race" e ignora.
--   Medido no dia 04/09/2026: 3.544 de 3.628 outbound das últimas 48h (97,7%)
--   têm `metadata.EventType`, isto é, a linha que a tela mostra foi gravada
--   pelo WEBHOOK. Autoria como coluna dessa linha seria perdida em ~98% dos
--   envios, dependendo de quem ganha a corrida. Chaveada por
--   `external_message_id` numa tabela própria, não há corrida: cada lado grava
--   o que sabe.
--
-- Privacidade/LGPD: guarda id e nome de QUEM DA EQUIPE enviou + o id externo da
-- mensagem. Nenhum conteúdo de mensagem, nenhum dado do cliente.
--
-- Escrita: só service_role (a edge send-whatsapp, que valida o JWT do usuário
-- contra o Supabase Cloud antes de gravar — autoria não é declarada pelo
-- client, é derivada de quem autenticou). Leitura: usuário autenticado, mesmo
-- critério de `whatsapp_messages`.
--
-- Rollback (<1min, nada existente é alterado):
--   DROP TABLE public.whatsapp_message_authors;

CREATE TABLE IF NOT EXISTS public.whatsapp_message_authors (
  -- Id da mensagem no WhatsApp (o mesmo `external_message_id` das duas rotas).
  external_message_id text PRIMARY KEY,
  phone text,
  instance_name text,
  -- user_id do Supabase CLOUD (gliigkupoebmlbwyvijp) — o mesmo espaço de ids de
  -- `profiles`/`user_roles` que o front já carrega para o @menção.
  sent_by_user_id uuid,
  -- Nome no momento do envio. Redundante de propósito: o histórico não pode
  -- mudar se a pessoa sair da equipe ou trocar o nome no perfil.
  sent_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A tela busca a autoria da página de mensagens que acabou de carregar
-- (conversa = phone + instance_name, mais recentes primeiro).
CREATE INDEX IF NOT EXISTS idx_wa_message_authors_conversa
  ON public.whatsapp_message_authors (phone, instance_name, created_at DESC);

ALTER TABLE public.whatsapp_message_authors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view message authors" ON public.whatsapp_message_authors;
CREATE POLICY "Authenticated users can view message authors"
  ON public.whatsapp_message_authors
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
