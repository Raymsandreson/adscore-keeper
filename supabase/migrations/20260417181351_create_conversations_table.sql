-- Fase 1: Cria tabela conversations como visao derivada de whatsapp_messages,
-- mantida por trigger. Substitui o DISTINCT ON em tempo real da RPC
-- get_conversation_summaries (que fica intocada nesta fase).
--
-- LIMITACOES CONHECIDAS:
--   * Trigger reage a INSERT em whatsapp_messages e UPDATE OF read_at.
--     NAO reage a UPDATE de instance_name ou phone -- se esses campos
--     forem alterados em uma mensagem existente (edge case, ninguem faz
--     em uso normal), a linha em conversations nao acompanha e fica
--     apontando pro par (instance_name, phone) antigo. Risco aceito.
--
--   * unread_count conta TODAS as mensagens inbound nao lidas da conversa,
--     sem filtro temporal. E diferente da funcao antiga
--     get_conversation_summaries que na pratica tambem nao filtrava
--     unread por janela (a CTE unread da funcao antiga nao tinha filtro
--     de created_at), entao o comportamento aqui reproduz o efetivo.
--     Se a UI futuramente quiser "unread dos ultimos N dias", calcular
--     no cliente ou criar coluna separada.
--
-- Estrategia pra evitar race:
--   1. LOCK TABLE whatsapp_messages IN SHARE ROW EXCLUSIVE MODE
--      -> bloqueia INSERT/UPDATE/DELETE concorrentes durante a migration
--   2. Cria tabela, funcoes, triggers
--   3. Roda backfill com o lock ainda ativo
--   4. COMMIT libera o lock; triggers ativam pra novos inserts
-- Custo: ~30-60s de bloqueio em webhooks (webhooks fazem retry).
--
-- Permissoes:
--   * Clientes (anon/authenticated) so tem GRANT SELECT.
--   * Escritas: REVOKED. So acontecem via trigger.
--   * Trigger roda SECURITY DEFINER (owner postgres) com search_path
--     travado em public. Bypassa RLS da conversations no lado escrita.
--
-- Rollback: DROP TABLE public.conversations CASCADE;
-- (remove tabela, triggers, funcoes -- whatsapp_messages fica intacto)

-- ============================================================
-- 1. Lock whatsapp_messages contra writes concorrentes
-- ============================================================
LOCK TABLE public.whatsapp_messages IN SHARE ROW EXCLUSIVE MODE;

-- ============================================================
-- 2. Cria tabela conversations
-- ============================================================
CREATE TABLE public.conversations (
  instance_name     text        NOT NULL,
  phone             text        NOT NULL,
  last_message_id   uuid,
  last_message_text text,
  last_message_at   timestamptz NOT NULL,
  last_direction    text,
  contact_name      text,
  contact_id        uuid,
  lead_id           uuid,
  unread_count      int         NOT NULL DEFAULT 0,
  message_count     int         NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, phone)
);

COMMENT ON TABLE public.conversations IS
  'Visao derivada de whatsapp_messages. Mantida por trigger. NUNCA escrever direto.';

-- ============================================================
-- 3. Indices
-- ============================================================
CREATE INDEX idx_conversations_instance_last
  ON public.conversations (instance_name, last_message_at DESC);

CREATE INDEX idx_conversations_instance_unread
  ON public.conversations (instance_name) WHERE unread_count > 0;

-- ============================================================
-- 4. RLS: clientes so leem; anon limitado a 7 dias
-- ============================================================
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_authenticated_select
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY conversations_anon_select_recent
  ON public.conversations
  FOR SELECT
  TO anon
  USING (last_message_at > now() - interval '7 days');

-- Escrita direta bloqueada mesmo se alguem contornar RLS:
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.conversations
  FROM anon, authenticated;

-- ============================================================
-- 5. Funcao do trigger de INSERT em whatsapp_messages
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_conversation_from_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $upsert$
BEGIN
  -- Mensagens sem instance_name nao entram na tabela (PK exige NOT NULL).
  IF NEW.instance_name IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.conversations AS c (
    instance_name, phone,
    last_message_id, last_message_text, last_message_at, last_direction,
    contact_name, contact_id, lead_id,
    unread_count, message_count, updated_at
  )
  VALUES (
    NEW.instance_name, NEW.phone,
    NEW.id, NEW.message_text, NEW.created_at, NEW.direction,
    NEW.contact_name, NEW.contact_id, NEW.lead_id,
    CASE WHEN NEW.direction = 'inbound' AND NEW.read_at IS NULL THEN 1 ELSE 0 END,
    1,
    now()
  )
  ON CONFLICT (instance_name, phone) DO UPDATE SET
    -- Campos "last_*": so sobrescreve se a mensagem nova e mais recente.
    -- Mensagens fora-de-ordem (webhook atrasado) nao pisam nas atuais.
    last_message_id   = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at
                             THEN EXCLUDED.last_message_id
                             ELSE c.last_message_id END,
    last_message_text = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at
                             THEN EXCLUDED.last_message_text
                             ELSE c.last_message_text END,
    last_message_at   = GREATEST(EXCLUDED.last_message_at, c.last_message_at),
    last_direction    = CASE WHEN EXCLUDED.last_message_at >= c.last_message_at
                             THEN EXCLUDED.last_direction
                             ELSE c.last_direction END,
    -- Identificadores de contato/lead: COALESCE mantem existente se NEW for null/vazio.
    contact_name      = COALESCE(NULLIF(EXCLUDED.contact_name, ''), c.contact_name),
    contact_id        = COALESCE(EXCLUDED.contact_id, c.contact_id),
    lead_id           = COALESCE(EXCLUDED.lead_id, c.lead_id),
    -- Contadores: incrementa pelo delta da mensagem atual.
    unread_count      = c.unread_count + EXCLUDED.unread_count,
    message_count     = c.message_count + 1,
    updated_at        = now();

  RETURN NULL;
END;
$upsert$;

-- ============================================================
-- 6. Funcao do trigger de UPDATE (marcacao como lida)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_conversation_on_read()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $read$
BEGIN
  -- So decrementa quando read_at transiciona de NULL -> valor e direction=inbound.
  IF OLD.read_at IS NULL
     AND NEW.read_at IS NOT NULL
     AND NEW.direction = 'inbound'
     AND NEW.instance_name IS NOT NULL
  THEN
    UPDATE public.conversations
       SET unread_count = GREATEST(unread_count - 1, 0),
           updated_at   = now()
     WHERE instance_name = NEW.instance_name
       AND phone         = NEW.phone;
  END IF;

  RETURN NULL;
END;
$read$;

-- ============================================================
-- 7. Attach triggers
-- ============================================================
CREATE TRIGGER trg_whatsapp_messages_upsert_conversation
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.upsert_conversation_from_message();

CREATE TRIGGER trg_whatsapp_messages_update_read
  AFTER UPDATE OF read_at ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_conversation_on_read();

-- ============================================================
-- 8. Backfill
-- ============================================================
INSERT INTO public.conversations (
  instance_name, phone,
  last_message_id, last_message_text, last_message_at, last_direction,
  contact_name, contact_id, lead_id,
  unread_count, message_count,
  created_at, updated_at
)
SELECT
  latest.instance_name,
  latest.phone,
  latest.last_message_id,
  latest.last_message_text,
  latest.last_message_at,
  latest.last_direction,
  latest.contact_name,
  latest.contact_id,
  latest.lead_id,
  counts.unread_count,
  counts.message_count,
  now(),
  now()
FROM (
  SELECT DISTINCT ON (m.instance_name, m.phone)
    m.instance_name,
    m.phone,
    m.id            AS last_message_id,
    m.message_text  AS last_message_text,
    m.created_at    AS last_message_at,
    m.direction     AS last_direction,
    m.contact_name,
    m.contact_id,
    m.lead_id
  FROM public.whatsapp_messages m
  WHERE m.instance_name IS NOT NULL
  ORDER BY m.instance_name, m.phone, m.created_at DESC
) latest
JOIN (
  SELECT
    m.instance_name,
    m.phone,
    COUNT(*) FILTER (WHERE m.direction = 'inbound' AND m.read_at IS NULL)::int AS unread_count,
    COUNT(*)::int                                                              AS message_count
  FROM public.whatsapp_messages m
  WHERE m.instance_name IS NOT NULL
  GROUP BY m.instance_name, m.phone
) counts USING (instance_name, phone)
ON CONFLICT (instance_name, phone) DO NOTHING;
