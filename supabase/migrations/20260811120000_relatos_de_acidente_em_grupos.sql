-- Relatos de acidente ouvidos em GRUPO de WhatsApp (Supabase Externo).
--
-- Problema que resolve: o caso novo quase nunca chega como "quero contratar
-- advogado". Ele aparece como desabafo no meio de um grupo — "o marido da
-- Cleide caiu do andaime na obra ontem", "meu tio morreu no acidente da BR",
-- "o INSS negou meu afastamento de novo". Ninguém está lendo os grupos com
-- olho de captação, e o relato passa. Aqui a IA lê os grupos MARCADOS e joga
-- o que parece caso numa fila de triagem — quem aprova é gente, não a IA.
--
-- Por que não reaproveitar `lead_client_commitments`: aquilo é promessa de
-- cliente NOSSO em conversa individual. Isto é gente que ainda não é cliente,
-- falando de um terceiro, num grupo. Alvo, dedup e ciclo de vida diferentes.
--
-- Rollback:
--   DROP TABLE public.whatsapp_group_report_scans;
--   DROP TABLE public.whatsapp_group_case_reports;
--   DROP TABLE public.whatsapp_group_watch;

-- ============================================================
-- 1) Grupos marcados para captação
-- ============================================================
-- Varrer TODO grupo sairia caro em IA e encheria a fila de ruído (grupo de
-- caso, grupo interno da equipe). Aqui é opt-in: a equipe liga grupo a grupo.
CREATE TABLE IF NOT EXISTS public.whatsapp_group_watch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  instance_name text NOT NULL,
  -- JID completo ("120363...@g.us"), como vem do /group/list da uazapi.
  group_jid text NOT NULL,
  -- Só os dígitos do JID — é ASSIM que `whatsapp_messages.phone` guarda grupo
  -- (o webhook faz `raw.replace(/\D/g,'')`). Sem esta coluna, todo SELECT de
  -- mensagem do grupo vira conversão de string na mão.
  group_phone text NOT NULL,
  group_name text,

  enabled boolean NOT NULL DEFAULT true,

  -- Quem recebe o push quando cai relato novo deste grupo. Vazio = ninguém é
  -- avisado e o relato só aparece na tela (a fila continua funcionando).
  notify_user_ids uuid[] NOT NULL DEFAULT '{}',

  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (instance_name, group_phone)
);

CREATE INDEX IF NOT EXISTS wgw_ligados_idx
  ON public.whatsapp_group_watch (instance_name, group_phone)
  WHERE enabled;

-- ============================================================
-- 2) A fila de relatos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_group_case_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  instance_name text NOT NULL,
  group_phone text NOT NULL,
  group_jid text,
  group_name text,

  -- Quem falou no grupo. Pode ser a própria vítima ou um vizinho contando.
  reporter_phone text,
  reporter_name text,

  kind text NOT NULL DEFAULT 'outro',

  -- Uma linha do jeito que um assessor contaria: "Marido da Cleide caiu de
  -- andaime em obra da MRV em Contagem, fraturou a coluna".
  headline text NOT NULL,
  -- Trecho literal da mensagem. É o que dá confiança pra quem tria: dá pra
  -- ver se a IA leu certo sem abrir o grupo.
  quote text,
  details text,

  source_message_id text,
  message_at timestamptz,

  -- Campos do acidente, no mesmo vocabulário do extrator de notícia
  -- (`analyze-news-case`), pra que aprovar um relato preencha o mesmo
  -- formulário de caso viável sem tradução no meio.
  victim_name text,
  victim_is_reporter boolean,
  accident_date date,
  city text,
  state text,
  company text,
  damage text,
  dynamics_summary text,

  ai_confidence numeric,

  status text NOT NULL DEFAULT 'novo',
  lead_id uuid,

  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wgcr_kind_chk CHECK (kind IN (
    'acidente_trabalho','acidente_transito','obito','doenca_ocupacional','outro'
  )),
  CONSTRAINT wgcr_status_chk CHECK (status IN (
    'novo','aproveitado','descartado'
  ))
);

-- A tela abre na fila do que ainda não foi triado.
CREATE INDEX IF NOT EXISTS wgcr_novos_idx
  ON public.whatsapp_group_case_reports (created_at DESC)
  WHERE status = 'novo';

CREATE INDEX IF NOT EXISTS wgcr_grupo_idx
  ON public.whatsapp_group_case_reports (instance_name, group_phone, created_at DESC);

-- Mesma mensagem não vira dois relatos, nem que duas varreduras rodem juntas
-- (o cron e alguém clicando "varrer agora"). O dedup por semelhança de texto
-- fica no código; este índice é a trava de baixo nível.
CREATE UNIQUE INDEX IF NOT EXISTS wgcr_mensagem_unica_idx
  ON public.whatsapp_group_case_reports (instance_name, group_phone, source_message_id)
  WHERE source_message_id IS NOT NULL;

-- ============================================================
-- 3) Cache de varredura
-- ============================================================
-- Mesma ideia de `lead_client_commitment_scans`: sem mensagem nova desde a
-- última leitura, o grupo é pulado sem gastar chamada de IA. Rodando de 10 em
-- 10 minutos em dezenas de grupos, isso é a diferença entre caro e barato.
CREATE TABLE IF NOT EXISTS public.whatsapp_group_report_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  instance_name text NOT NULL,
  group_phone text NOT NULL,

  last_message_at timestamptz,
  last_scanned_at timestamptz,
  messages_analyzed integer NOT NULL DEFAULT 0,
  found_count integer NOT NULL DEFAULT 0,
  model text,
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (instance_name, group_phone)
);

-- ============================================================
-- updated_at + RLS + realtime
-- ============================================================
DROP TRIGGER IF EXISTS wgw_set_updated_at ON public.whatsapp_group_watch;
CREATE TRIGGER wgw_set_updated_at
  BEFORE UPDATE ON public.whatsapp_group_watch
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS wgcr_set_updated_at ON public.whatsapp_group_case_reports;
CREATE TRIGGER wgcr_set_updated_at
  BEFORE UPDATE ON public.whatsapp_group_case_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS wgrs_set_updated_at ON public.whatsapp_group_report_scans;
CREATE TRIGGER wgrs_set_updated_at
  BEFORE UPDATE ON public.whatsapp_group_report_scans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_group_watch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_group_case_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_group_report_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wgw_authenticated_all ON public.whatsapp_group_watch;
CREATE POLICY wgw_authenticated_all ON public.whatsapp_group_watch
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS wgcr_authenticated_all ON public.whatsapp_group_case_reports;
CREATE POLICY wgcr_authenticated_all ON public.whatsapp_group_case_reports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS wgrs_authenticated_read ON public.whatsapp_group_report_scans;
CREATE POLICY wgrs_authenticated_read ON public.whatsapp_group_report_scans
  FOR SELECT TO authenticated USING (true);

-- A fila atualiza sozinha quando o cron encontra relato novo com a tela aberta.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_group_case_reports;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
