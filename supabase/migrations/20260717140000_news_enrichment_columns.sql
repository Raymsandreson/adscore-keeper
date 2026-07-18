-- Enriquecimento de notícias (página /noticias):
-- news_enriched_at  → quando a edge enrich-news-leads processou o lead (NULL = pendente)
-- news_foreign      → IA classificou o evento como fora do Brasil (arquivado junto via deleted_at)
-- Rollback: DROP INDEX IF EXISTS idx_leads_news_enrich_pending;
--           ALTER TABLE public.leads DROP COLUMN IF EXISTS news_enriched_at, DROP COLUMN IF EXISTS news_foreign;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS news_enriched_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS news_foreign boolean;

-- Índice parcial só da fila pendente (hoje ~2,6k linhas; tende a zero após backlog)
CREATE INDEX IF NOT EXISTS idx_leads_news_enrich_pending
  ON public.leads (board_id, status, created_at DESC)
  WHERE news_enriched_at IS NULL AND deleted_at IS NULL;
