-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NÃO no Cloud
-- ============================================================================
-- Adiciona data + hora da reunião em lead_activities.
--
-- Motivo: as colunas `deadline` e `notification_date` são do tipo DATE (só data),
-- e o Postgres descarta a hora ao gravar. Para o tipo de atividade "reuniao"
-- precisamos guardar o horário exato do encontro, então usamos uma coluna
-- TIMESTAMPTZ dedicada. Prazo/Notificação continuam como estão.
--
-- Rollback: ALTER TABLE public.lead_activities DROP COLUMN meeting_at;
-- ============================================================================

ALTER TABLE public.lead_activities
  ADD COLUMN IF NOT EXISTS meeting_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.lead_activities.meeting_at IS
  'Data e hora da reunião (usado quando activity_type = ''reuniao''). NULL para os demais tipos.';
