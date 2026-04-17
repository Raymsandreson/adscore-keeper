-- Fase 2b: Remove o filtro temporal do corpo da RPC get_conversation_summaries.
--
-- Motivacao: conversas antigas (>30 dias sem mensagem nova) estavam
-- sumindo da sidebar do cliente mesmo existindo em public.conversations.
-- O filtro temporal fazia sentido enquanto a RPC escaneava whatsapp_messages
-- em tempo real (limitava volume). Agora que le da tabela materializada
-- com indice (instance_name, last_message_at DESC), nao ha ganho em cortar
-- por janela -- e perdemos dados visiveis.
--
-- Compatibilidade: o parametro p_days_back e MANTIDO na assinatura pra
-- preservar 100% de compatibilidade com qualquer caller (cliente web,
-- scripts, futuras integracoes que ja passam esse arg). Mas ele e
-- IGNORADO no corpo: a funcao retorna TODAS as conversas da instancia,
-- independente de quanto tempo faz desde a ultima mensagem.
--
-- Se no futuro precisar reintroduzir o filtro (ex: otimizacao de volume
-- por conta de instancias gigantes), reativar em nivel de cliente
-- (paginacao) em vez de no corpo da RPC.
--
-- Rollback: apply_migration com o corpo da migration anterior
-- (switch_rpc_to_conversations_table) que tinha o filtro.

CREATE OR REPLACE FUNCTION public.get_conversation_summaries(
  p_instance_names text[],
  p_days_back integer DEFAULT 30
)
RETURNS TABLE(
  phone text,
  contact_name text,
  contact_id text,
  lead_id text,
  last_message_text text,
  last_message_at timestamptz,
  last_direction text,
  instance_name text,
  unread_count bigint,
  message_count bigint
)
LANGUAGE sql
STABLE
AS $$
  -- p_days_back nao e usado: a funcao retorna todas as conversas
  -- da instancia, ordenadas pela mais recente primeiro.
  SELECT
    c.phone,
    COALESCE(NULLIF(c.contact_name, ''), ct.full_name, '')::text AS contact_name,
    COALESCE(c.contact_id::text, '')                             AS contact_id,
    COALESCE(c.lead_id::text,    '')                             AS lead_id,
    c.last_message_text,
    c.last_message_at,
    c.last_direction,
    c.instance_name,
    c.unread_count::bigint                                       AS unread_count,
    c.message_count::bigint                                      AS message_count
  FROM public.conversations c
  LEFT JOIN public.contacts ct ON ct.id = c.contact_id
  WHERE c.instance_name = ANY(p_instance_names)
  ORDER BY c.last_message_at DESC;
$$;
