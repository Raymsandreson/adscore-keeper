-- A leitura da conversa passa a devolver também o RESUMO DO CONTEXTO e o que
-- o cliente JÁ RESOLVEU.
--
-- Motivo: abrir a conversa e ver só "o que falta" não conta a história. Quem
-- pega o caso no meio precisa saber onde está o processo, o que o escritório
-- já fez e o que o cliente já entregou — hoje isso exige rolar meses de áudio.
--
-- Rollback:
--   ALTER TABLE public.lead_client_commitment_scans
--     DROP COLUMN summary, DROP COLUMN summary_updated_at;

ALTER TABLE public.lead_client_commitment_scans
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summary_updated_at timestamptz;

-- O resumo é lido junto com as pendências na abertura da conversa.
ALTER TABLE public.lead_client_commitment_scans REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_client_commitment_scans;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
