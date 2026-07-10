-- Multi-assessor por atividade.
-- Tabela alvo: lead_activities, que vive no Supabase EXTERNO (kmedldlepwiityjsdahz).
-- Este arquivo serve de registro; a aplicação real é feita no projeto Externo.
-- O guard abaixo torna o script inofensivo em bancos onde a tabela não existe.
--
-- assigned_to_ids   → todos os assessores (UUIDs do Externo), principal primeiro.
-- assigned_to_names → nomes na mesma ordem.
-- assigned_to / assigned_to_name continuam sendo o assessor PRINCIPAL
-- (filtros, notificações e código legado seguem funcionando sem mudança).
--
-- Rollback:
--   ALTER TABLE public.lead_activities DROP COLUMN IF EXISTS assigned_to_ids;
--   ALTER TABLE public.lead_activities DROP COLUMN IF EXISTS assigned_to_names;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lead_activities'
  ) THEN
    ALTER TABLE public.lead_activities
      ADD COLUMN IF NOT EXISTS assigned_to_ids uuid[],
      ADD COLUMN IF NOT EXISTS assigned_to_names text[];
  END IF;
END $$;
