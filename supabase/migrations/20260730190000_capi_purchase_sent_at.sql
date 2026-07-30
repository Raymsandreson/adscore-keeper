-- Carimbo de idempotência do disparo de conversão (Meta CAPI Purchase).
-- Usado pelo sync-funnel-status-from-sheet (Railway): garante que o Purchase
-- de um lead é enviado no máximo 1x, e permite retry (reenviar só quem não tem
-- carimbo). Independente de lead_status/became_client_date de propósito — mudar
-- status vai-e-volta na planilha NÃO pode re-cobrar o Meta.
--
-- Aplicar no Supabase EXTERNO (kmedldlepwiityjsdahz).
-- Rollback: ALTER TABLE public.leads DROP COLUMN IF EXISTS capi_purchase_sent_at;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS capi_purchase_sent_at timestamptz;
