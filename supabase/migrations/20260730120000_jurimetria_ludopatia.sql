-- Jurimetria de LUDOPATIA / nulidade de apostas (Lei 14.790/2023 - "Lei das Bets").
--
-- Corpus de decisões coletadas via edge function `search-jurisprudencia`
-- (Escavador v1 /jurisprudencias/busca) e enriquecidas via `extract-jurimetria`.
--
-- Não é dado de cliente, mas seguimos o princípio de segurança do projeto:
-- RLS habilitado; leitura só para usuários autenticados; escrita só service_role.
-- Reversível: DROP das duas views + DROP TABLE.

-- ---------------------------------------------------------------------------
-- Tabela de corpus
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jurimetria_ludopatia (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte                 text NOT NULL DEFAULT 'escavador_v1',
  tipo_documento        text,
  documento_id          text,

  -- metadados da decisão
  tribunal              text,
  orgao_julgador        text,
  relator               text,
  comarca_uf            text,
  classe                text,
  assuntos              text[],
  data_distribuicao     date,
  data_julgamento       date,
  data_publicacao       date,

  -- campos extraídos do texto (extract-jurimetria)
  tema_confirmado       boolean,          -- é mesmo ludopatia/Lei das Bets?
  resultado             text,             -- procedente | parcialmente_procedente | improcedente | extinto_sem_merito | indefinido
  nulidade_apostas      boolean,          -- reconheceu nulidade art. 26, VI
  devolucao_valores     boolean,
  valor_causa           numeric(15,2),
  valor_condenacao      numeric(15,2),
  valor_danos_morais    numeric(15,2),
  valor_devolucao       numeric(15,2),
  tempo_tramitacao_dias integer,          -- distribuicao -> julgamento
  advogados             jsonb DEFAULT '[]'::jsonb,   -- [{nome, oab, polo}]

  -- rastreio
  termo_busca           text,
  ementa                text,
  link                  text,
  raw                   jsonb,
  extraido_em           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT jurimetria_ludopatia_doc_uniq UNIQUE (fonte, tipo_documento, documento_id)
);

-- Índices para os filtros usados pela jurimetria (princípio: filtro sempre com índice)
CREATE INDEX IF NOT EXISTS idx_jml_tribunal        ON public.jurimetria_ludopatia (tribunal);
CREATE INDEX IF NOT EXISTS idx_jml_data_julgamento ON public.jurimetria_ludopatia (data_julgamento);
CREATE INDEX IF NOT EXISTS idx_jml_resultado       ON public.jurimetria_ludopatia (resultado);
CREATE INDEX IF NOT EXISTS idx_jml_advogados_gin   ON public.jurimetria_ludopatia USING gin (advogados);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.jurimetria_ludopatia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jml_select_authenticated" ON public.jurimetria_ludopatia;
CREATE POLICY "jml_select_authenticated"
  ON public.jurimetria_ludopatia
  FOR SELECT
  TO authenticated
  USING (true);

-- Escrita apenas via service_role (edge functions). Sem policy de INSERT/UPDATE
-- para authenticated => bloqueado por padrão. service_role ignora RLS.

-- ---------------------------------------------------------------------------
-- View: resumo por tribunal (o "retrato" da jurimetria)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_jurimetria_ludopatia_resumo AS
SELECT
  COALESCE(tribunal, 'N/D')                                        AS tribunal,
  COUNT(*)                                                         AS total_decisoes,
  COUNT(*) FILTER (WHERE resultado = 'procedente')                AS procedentes,
  COUNT(*) FILTER (WHERE resultado = 'parcialmente_procedente')   AS parciais,
  COUNT(*) FILTER (WHERE resultado = 'improcedente')              AS improcedentes,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE resultado IN ('procedente','parcialmente_procedente'))
    / NULLIF(COUNT(*) FILTER (WHERE resultado IS NOT NULL), 0)
  , 1)                                                             AS taxa_exito_pct,
  COUNT(*) FILTER (WHERE nulidade_apostas IS TRUE)                AS reconheceu_nulidade,
  ROUND(AVG(valor_condenacao)   FILTER (WHERE valor_condenacao   > 0), 2) AS media_condenacao,
  ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY valor_condenacao)
         FILTER (WHERE valor_condenacao > 0))::numeric, 2)        AS mediana_condenacao,
  ROUND(AVG(valor_danos_morais) FILTER (WHERE valor_danos_morais > 0), 2) AS media_danos_morais,
  ROUND(AVG(tempo_tramitacao_dias) FILTER (WHERE tempo_tramitacao_dias > 0), 0) AS media_tramitacao_dias,
  MIN(data_julgamento)                                            AS primeira_decisao,
  MAX(data_julgamento)                                            AS ultima_decisao
FROM public.jurimetria_ludopatia
WHERE tema_confirmado IS NOT FALSE
GROUP BY COALESCE(tribunal, 'N/D')
ORDER BY total_decisoes DESC;

-- ---------------------------------------------------------------------------
-- View: ranking de advogados que mais atuam no tema
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_jurimetria_ludopatia_advogados AS
SELECT
  adv->>'nome'                                                    AS advogado,
  adv->>'oab'                                                     AS oab,
  COUNT(*)                                                        AS total_decisoes,
  COUNT(*) FILTER (WHERE j.resultado IN ('procedente','parcialmente_procedente')) AS decisoes_favoraveis,
  ROUND(AVG(j.valor_condenacao) FILTER (WHERE j.valor_condenacao > 0), 2)         AS media_condenacao
FROM public.jurimetria_ludopatia j
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(j.advogados, '[]'::jsonb)) AS adv
WHERE j.tema_confirmado IS NOT FALSE
  AND COALESCE(adv->>'nome', '') <> ''
GROUP BY adv->>'nome', adv->>'oab'
ORDER BY total_decisoes DESC;

COMMENT ON TABLE  public.jurimetria_ludopatia IS 'Corpus de decisões sobre ludopatia/Lei das Bets (14.790/2023) para jurimetria. Alimentado por edge functions search-jurisprudencia + extract-jurimetria.';
COMMENT ON VIEW   public.vw_jurimetria_ludopatia_resumo IS 'Jurimetria agregada por tribunal: taxa de êxito, médias/medianas de valores, tempo de tramitação.';
COMMENT ON VIEW   public.vw_jurimetria_ludopatia_advogados IS 'Ranking de advogados por volume de atuação no tema ludopatia.';
