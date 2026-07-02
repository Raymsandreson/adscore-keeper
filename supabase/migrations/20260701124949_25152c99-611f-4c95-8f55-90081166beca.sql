-- =============================================================================
-- Histórico e acompanhamento processual (append-only)
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz (onde vive lead_processes)
-- Aplicar via: SUPABASE_PAT=sbp_... node _apply_migration.mjs (ajustar FILE)
--
-- Modelo: cada MARCO processual (Petição Inicial, Sentença, Acordo, Acórdãos,
-- Trânsito em Julgado, Pagamento) vira UMA linha independente.
-- Append-only: sem UPDATE/DELETE via app; status atual = linha mais recente.
-- Idempotente: seguro rodar 2x (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- =============================================================================

-- Enum-like via CHECK para manter os tipos de marco padronizados (auditável).
CREATE TABLE IF NOT EXISTS public.process_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Relação One-to-Many com o processo principal (padrão de process_documents)
  process_id UUID NOT NULL REFERENCES public.lead_processes(id) ON DELETE CASCADE,
  -- Denormalizados por conveniência de query/filtro (mesmo padrão de process_documents)
  case_id    UUID REFERENCES public.legal_cases(id) ON DELETE SET NULL,
  lead_id    UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  numero_cnj TEXT,

  -- Marco identificado no histórico do Escavador
  tipo_movimentacao TEXT NOT NULL CHECK (tipo_movimentacao IN (
    'peticao_inicial',
    'sentenca_1grau',
    'acordo',
    'acordao_2grau',
    'acordao_superior',
    'transito_julgado',
    'pagamento'
  )),
  -- Ordem canônica do marco no ciclo de vida (1..7) para timeline lógica
  -- quando duas datas coincidem. Preenchida pelo parser.
  marco_ordem SMALLINT,

  data_movimentacao TIMESTAMPTZ NOT NULL,

  -- Extraídos do texto da decisão (nullable — nem todo marco tem/expõe)
  valor_indenizacao_fixado NUMERIC,
  link_decisao TEXT,

  -- Contexto bruto do marco para auditoria (trecho do conteúdo, tipo original, etc.)
  descricao TEXT,
  fonte TEXT NOT NULL DEFAULT 'escavador',
  escavador_movimentacao_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Hash de dedup: evita duplicar o MESMO marco em re-sync mantendo append-only.
  -- Preenchido pelo parser = md5(process_id || tipo || data || trecho_conteudo).
  conteudo_hash TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup idempotente por processo+marco+conteúdo (INSERT usa ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS uq_process_movements_dedup
  ON public.process_movements (process_id, tipo_movimentacao, conteudo_hash);

-- Índices de acesso
CREATE INDEX IF NOT EXISTS idx_process_movements_process_id
  ON public.process_movements (process_id);
CREATE INDEX IF NOT EXISTS idx_process_movements_case_id
  ON public.process_movements (case_id);
CREATE INDEX IF NOT EXISTS idx_process_movements_lead_id
  ON public.process_movements (lead_id);
CREATE INDEX IF NOT EXISTS idx_process_movements_numero_cnj
  ON public.process_movements (numero_cnj);
CREATE INDEX IF NOT EXISTS idx_process_movements_tipo
  ON public.process_movements (tipo_movimentacao);
-- "Status atual": movimentação mais recente por processo → índice cobre o ORDER BY.
CREATE INDEX IF NOT EXISTS idx_process_movements_recent
  ON public.process_movements (process_id, data_movimentacao DESC);

-- =============================================================================
-- View de conveniência: status atual = 1 linha por processo (a mais recente).
-- O frontend consulta esta view para o modo "resumido" e a tabela crua para
-- o modo "timeline expandida".
-- =============================================================================
CREATE OR REPLACE VIEW public.lead_process_current_status AS
SELECT DISTINCT ON (pm.process_id)
  pm.process_id,
  pm.id AS movement_id,
  pm.tipo_movimentacao,
  pm.marco_ordem,
  pm.data_movimentacao,
  pm.valor_indenizacao_fixado,
  pm.link_decisao,
  pm.descricao,
  pm.numero_cnj,
  pm.case_id,
  pm.lead_id
FROM public.process_movements pm
ORDER BY pm.process_id, pm.data_movimentacao DESC, pm.created_at DESC;

-- =============================================================================
-- RLS — append-only: só SELECT e INSERT para authenticated.
-- UPDATE/DELETE deliberadamente omitidos (histórico auditável e imutável).
-- =============================================================================
ALTER TABLE public.process_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view process movements" ON public.process_movements;
CREATE POLICY "Authenticated users can view process movements"
  ON public.process_movements FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert process movements" ON public.process_movements;
CREATE POLICY "Authenticated users can insert process movements"
  ON public.process_movements FOR INSERT TO authenticated WITH CHECK (true);

COMMENT ON TABLE public.process_movements IS
  'Histórico append-only de marcos processuais extraídos do Escavador. Uma linha por marco. Status atual = linha com data_movimentacao mais recente (ver view lead_process_current_status).';
