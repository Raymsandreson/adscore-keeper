-- Indicações — o contato que alguém compartilha na conversa vira registro rastreável.
--
-- BANCO: Supabase EXTERNO (kmedldlepwiityjsdahz), onde moram whatsapp_messages
-- e contacts. Não aplicar no Cloud.
--
-- Motivação (evidência colhida em 11/09/2026, banco real):
--   * Quando alguém compartilha um contato, a UazAPI manda
--     `metadata->message->messageType = 'ContactMessage'` com o cartão inteiro
--     em `metadata->message->content->vcard`. Nos últimos 2 dias: 68
--     ContactMessage + 4 ContactsArrayMessage. Nos últimos 10 dias: 214
--     recebidos (54 conversas) + 29 enviados.
--   * O webhook (railway-server/src/functions/whatsapp-webhook.ts:1686-1712) só
--     tem branch para image/video/audio/document. O cartão era gravado como
--     `message_type = 'text'` e o telefone indicado ficava enterrado no
--     metadata: `select ... where message_type ilike '%contact%'` devolve ZERO
--     linhas em 1,7 milhão de mensagens.
--   * Nenhuma tabela de indicação existia (information_schema confirmou: só
--     `contact_relationships`, genérica, sem origem nem produto).
--
-- Por que TABELA PRÓPRIA e não coluna em `contacts`:
--   A indicação é um EVENTO (fulano passou o contato de beltrano no dia X, pela
--   instância Y, no contexto Z), não um atributo da pessoa. O mesmo contato
--   pode ser indicado duas vezes por pessoas diferentes — em coluna, a segunda
--   sobrescreveria a primeira e o ranking de quem mais indica nasceria errado.
--
-- Idempotência: `source_message_id` é UNIQUE. O webhook reprocessa a mesma
--   mensagem em corrida com o backfill sem gerar indicação dobrada.
--
-- Privacidade/LGPD: guarda nome e telefone de quem foi indicado — o mesmo dado
--   que `contacts` já guarda, no mesmo banco e na mesma região. Guarda o vCard
--   cru para auditoria e reprocessamento. NÃO guarda o conteúdo da conversa: o
--   contexto que a IA leu vira uma frase curta de justificativa em
--   `ai_reason`, e a mensagem original continua referenciada por id.
--
-- Rollback (<1min, nada existente é alterado):
--   DROP TABLE public.referrals;

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ===== ORIGEM =====
  -- Id da mensagem no WhatsApp. UNIQUE = a trava de idempotência.
  -- Um ContactsArrayMessage traz vários cartões na MESMA mensagem, por isso a
  -- unicidade é (mensagem + telefone indicado), não a mensagem sozinha.
  source_message_id text,
  -- Linha de whatsapp_messages que originou. Sem FK: a limpeza periódica
  -- (cleanup_old_whatsapp_messages) apaga mensagem antiga e a indicação, que é
  -- o registro de valor, não pode ir junto.
  source_message_row_id uuid,
  -- Quando o cartão foi compartilhado (não quando esta linha foi criada —
  -- backfill de 90 dias cria linha nova para evento antigo).
  shared_at timestamptz NOT NULL,
  -- 'inbound' = recebemos o contato (alguém nos indicou alguém).
  -- 'outbound' = nós mandamos o contato de alguém (indicamos a um parceiro).
  direction text NOT NULL DEFAULT 'inbound',

  -- ===== QUEM INDICOU =====
  -- Telefone do chat de onde veio o cartão (só dígitos, com DDI).
  referrer_phone text NOT NULL,
  referrer_name text,
  referrer_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- Cartão compartilhado dentro de grupo: o chat é o grupo, e quem mandou é um
  -- participante. Guardamos os dois para o ranking não creditar o grupo.
  referrer_group_id text,
  referrer_sender_phone text,

  -- ===== QUEM FOI INDICADO =====
  indicated_name text NOT NULL,
  -- Do `waid` do vCard: id real no WhatsApp, já com DDI, sem máscara.
  indicated_phone text NOT NULL,
  indicated_company text,
  indicated_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- Cartão cru, para auditoria e reprocessamento sem depender do metadata.
  raw_vcard text,

  -- ===== DE QUEM É A INDICAÇÃO =====
  instance_name text,
  -- Dono do número (whatsapp_instances.owner_phone) no momento do evento.
  instance_owner_phone text,
  -- Usuário da equipe responsável. Uma instância pode ter mais de um usuário,
  -- por isso o dono não basta. user_id do Supabase CLOUD, mesmo espaço de ids
  -- de profiles — sem FK, são bancos diferentes.
  assigned_user_id uuid,
  assigned_user_name text,

  -- ===== O QUE A INDICAÇÃO É =====
  -- Sugestão da IA a partir do contexto da conversa. É PALPITE: nunca entra em
  -- relatório sem confirmação humana.
  ai_suggested_product text,
  ai_reason text,
  ai_confidence numeric,
  ai_classified_at timestamptz,
  -- Confirmação humana. product_service_id é uuid do Cloud (products_services);
  -- product_name fica desnormalizado para o relatório não depender de join
  -- entre bancos.
  product_service_id uuid,
  product_name text,
  confirmed_by_user_id uuid,
  confirmed_at timestamptz,

  -- ===== ESTEIRA =====
  -- novo        → cartão capturado, ninguém olhou
  -- classificado→ produto confirmado por humano
  -- contatado   → mensagem de apresentação enviada
  -- convertido  → virou lead/cliente
  -- descartado  → não era indicação (cartório, fornecedor, número errado…)
  status text NOT NULL DEFAULT 'novo',
  discard_reason text,

  -- ===== APRESENTAÇÃO =====
  -- Rascunho gerado pela IA; só sai por clique humano.
  outreach_draft text,
  outreach_sent_at timestamptz,
  outreach_message_id text,
  outreach_sent_by_user_id uuid,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotência real: o mesmo cartão da mesma mensagem não entra duas vezes,
-- mas um ContactsArrayMessage com 3 cartões gera 3 linhas.
--
-- NÃO tornar este índice parcial (`WHERE source_message_id IS NOT NULL`). Foi a
-- primeira versão e quebrava tudo: o Postgres só casa `ON CONFLICT (a, b)` com
-- índice parcial se o predicado for repetido na cláusula, e o `upsert` do
-- supabase-js não tem como fazer isso — a captura morria com 42P10 a cada
-- cartão, em silêncio, porque roda fire-and-forget. Verificado no banco em
-- 11/09/2026 antes de subir.
--
-- O predicado também era desnecessário: em índice único, NULL nunca conflita
-- com NULL, então linha sem `source_message_id` continua livre para repetir
-- (conferido: duas linhas sem id entram sem reclamação).
CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_mensagem_indicado
  ON public.referrals (source_message_id, indicated_phone);

-- A tela abre na fila do que ainda não foi tratado, mais recente primeiro.
CREATE INDEX IF NOT EXISTS idx_referrals_status_data
  ON public.referrals (status, shared_at DESC);

-- Ranking "quem mais indicou" e a ficha de um indicador.
CREATE INDEX IF NOT EXISTS idx_referrals_indicador
  ON public.referrals (referrer_phone, shared_at DESC);

-- "Esse contato foi indicado por quem?" na ficha do contato.
CREATE INDEX IF NOT EXISTS idx_referrals_indicado_phone
  ON public.referrals (indicated_phone);

-- Fila por instância/responsável (cada um enxerga a sua).
CREATE INDEX IF NOT EXISTS idx_referrals_instancia
  ON public.referrals (instance_name, status, shared_at DESC);

CREATE OR REPLACE FUNCTION public.referrals_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referrals_updated_at ON public.referrals;
CREATE TRIGGER trg_referrals_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.referrals_touch_updated_at();

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Mesmo critério de `contacts` neste banco (role `authenticated`): quem entrou
-- no sistema vê e trata a fila. O Railway escreve com service_role, que passa
-- por cima da RLS — a captura pelo webhook não depende de policy.
DROP POLICY IF EXISTS "Authenticated can read referrals" ON public.referrals;
CREATE POLICY "Authenticated can read referrals"
  ON public.referrals FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can insert referrals" ON public.referrals;
CREATE POLICY "Authenticated can insert referrals"
  ON public.referrals FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update referrals" ON public.referrals;
CREATE POLICY "Authenticated can update referrals"
  ON public.referrals FOR UPDATE TO authenticated USING (true);

COMMENT ON TABLE public.referrals IS
  'Indicações capturadas de cartões de contato (vCard) compartilhados no WhatsApp. Uma linha por (mensagem, telefone indicado).';
