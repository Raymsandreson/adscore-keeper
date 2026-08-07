-- Cadeia de continuidade entre atividades ("Concluir + proxima").
--
-- Problema (07/08/2026): o botao "Concluir + proxima" conclui a atividade atual
-- e cria a proxima COPIANDO os campos do formulario, mas sem gravar de onde ela
-- veio. Resultado: quem abre a atividade nova nao tem como saber que ela e o
-- desdobramento de outra, e quem abre a concluida nao chega na continuacao. A
-- ideia de "isso ainda nao acabou, falta a proxima etapa" existia so na cabeca
-- de quem clicou.
--
-- Duas colunas, de proposito distinto:
--   parent_activity_id  -> a atividade IMEDIATAMENTE anterior (quem me gerou).
--                          Serve pra dizer "voltar" e pra reconstruir a ordem.
--   chain_root_id       -> a PRIMEIRA atividade da cadeia (a raiz).
--                          Serve pra buscar a sequencia inteira em UMA query,
--                          em vez de subir de pai em pai (N+1 na ficha).
--
-- A raiz nao aponta pra ela mesma: fica com as duas colunas NULL e e achada
-- pelo `id = raiz`. Assim da pra saber quem e raiz sem comparar id = chain_root_id.
--
-- Nao ha backfill: cadeias anteriores a esta migration nao deixaram rastro no
-- banco (nao existia coluna nenhuma). Da migration em diante toda conclusao com
-- proxima grava o vinculo.
--
-- FK com ON DELETE SET NULL: a exclusao no app e soft (deleted_at), entao isso
-- so dispara em delete fisico. Mesmo assim, perder o pai nao apaga a cadeia —
-- chain_root_id continua de pe e a ficha segue listando a sequencia.
--
-- Indices CONCURRENTLY (tabela com ~35k linhas, em producao) e parciais: hoje
-- as duas colunas sao NULL em 100% das linhas, entao o indice nasce minusculo e
-- so cresce junto com as cadeias reais.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_lead_activities_chain_root;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_lead_activities_parent;
--   ALTER TABLE public.lead_activities
--     DROP CONSTRAINT IF EXISTS lead_activities_parent_activity_id_fkey;
--   ALTER TABLE public.lead_activities
--     DROP COLUMN IF EXISTS parent_activity_id,
--     DROP COLUMN IF EXISTS chain_root_id;
--   (aditivo e reversivel em <1min — nenhuma coluna existente e tocada)

ALTER TABLE public.lead_activities
  ADD COLUMN IF NOT EXISTS parent_activity_id uuid,
  ADD COLUMN IF NOT EXISTS chain_root_id      uuid;

COMMENT ON COLUMN public.lead_activities.parent_activity_id IS
  'Atividade imediatamente anterior na cadeia de continuidade (quem gerou esta ao ser concluida). NULL = nao veio de desdobramento.';
COMMENT ON COLUMN public.lead_activities.chain_root_id IS
  'Primeira atividade da cadeia de continuidade. NULL na propria raiz. Permite buscar a sequencia inteira em uma query.';

-- FK idempotente: pg_constraint em vez de IF NOT EXISTS (ADD CONSTRAINT nao aceita).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'lead_activities_parent_activity_id_fkey'
       AND conrelid = 'public.lead_activities'::regclass
  ) THEN
    ALTER TABLE public.lead_activities
      ADD CONSTRAINT lead_activities_parent_activity_id_fkey
      FOREIGN KEY (parent_activity_id)
      REFERENCES public.lead_activities(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Query da aba Historico: WHERE chain_root_id = <raiz> ORDER BY created_at.
-- Indice composto cobre filtro + ordenacao sem sort em disco.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_activities_chain_root
    ON public.lead_activities (chain_root_id, created_at)
 WHERE chain_root_id IS NOT NULL;

-- Usado pra achar o filho direto de uma atividade (seta "proxima") sem varrer a cadeia.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_activities_parent
    ON public.lead_activities (parent_activity_id)
 WHERE parent_activity_id IS NOT NULL;
