-- Pendências do cliente passam a ser DETECTADAS PELA IA na conversa.
--
-- O desenho anterior (05/08) era manual: o assessor escolhia um tipo numa lista
-- fechada e digitava. Errado — o combinado nasce no meio do áudio do WhatsApp e
-- ninguém vai parar pra cadastrar. Quem lê a conversa e registra é a IA.
--
-- Mudanças:
--  1. `kind` deixa de ser lista fechada — a IA descreve com as palavras da
--     conversa ("mandar a carteira de trabalho", "gravar o vídeo"), e o CHECK
--     taxativo só atrapalharia.
--  2. `origin` separa o que veio da IA do que foi digitado à mão.
--  3. `descartada` entra em status: o assessor diz "não era pendência" e a IA
--     não pode ressuscitar aquilo na próxima varredura.
--  4. Índice único impede a IA de duplicar a mesma pendência a cada análise.
--  5. `lead_client_commitment_scans` guarda até onde a conversa já foi lida —
--     sem isso toda abertura de conversa gastaria uma chamada de IA.
--
-- Rollback:
--   DROP TABLE public.lead_client_commitment_scans;
--   DROP INDEX public.lcc_dedup_idx;
--   ALTER TABLE public.lead_client_commitments
--     DROP COLUMN origin, DROP COLUMN ai_confidence, DROP COLUMN dismissed_at;

-- 1. tipo livre
ALTER TABLE public.lead_client_commitments DROP CONSTRAINT IF EXISTS lcc_kind_chk;

-- 2. origem
ALTER TABLE public.lead_client_commitments
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS ai_confidence numeric,
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

ALTER TABLE public.lead_client_commitments DROP CONSTRAINT IF EXISTS lcc_origin_chk;
ALTER TABLE public.lead_client_commitments
  ADD CONSTRAINT lcc_origin_chk CHECK (origin IN ('ia', 'manual'));

-- 3. status ganha 'descartada'
ALTER TABLE public.lead_client_commitments DROP CONSTRAINT IF EXISTS lcc_status_chk;
ALTER TABLE public.lead_client_commitments
  ADD CONSTRAINT lcc_status_chk CHECK (status IN (
    'combinado','cobrado','feito','desistiu','descartada'
  ));

-- 4. a mesma pendência não pode nascer duas vezes na mesma conversa.
--    Chave: alvo (lead, ou telefone+instância quando ainda não há lead) + título.
CREATE UNIQUE INDEX IF NOT EXISTS lcc_dedup_idx
  ON public.lead_client_commitments (
    coalesce(lead_id::text, phone || '|' || coalesce(instance_name, '')),
    lower(btrim(title))
  );

-- 5. controle de varredura: até onde a IA já leu esta conversa
CREATE TABLE IF NOT EXISTS public.lead_client_commitment_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  instance_name text NOT NULL DEFAULT '',
  lead_id uuid,
  -- created_at da última mensagem que entrou na análise
  last_message_at timestamptz,
  last_scanned_at timestamptz NOT NULL DEFAULT now(),
  messages_analyzed integer NOT NULL DEFAULT 0,
  found_count integer NOT NULL DEFAULT 0,
  model text,
  last_error text
);

CREATE UNIQUE INDEX IF NOT EXISTS lccs_conversa_idx
  ON public.lead_client_commitment_scans (phone, instance_name);

ALTER TABLE public.lead_client_commitment_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lccs_authenticated_all ON public.lead_client_commitment_scans;
CREATE POLICY lccs_authenticated_all ON public.lead_client_commitment_scans
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
