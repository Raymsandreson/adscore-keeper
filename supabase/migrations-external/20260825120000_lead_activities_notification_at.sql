-- Hora na Notificação da atividade (lead_activities.notification_at).
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).
--
-- PROBLEMA: `notification_date` é DATE (migration 20260211152549) — só o dia.
-- O campo "🔔 Notificação" do formulário nunca teve hora, e o único lugar que
-- já oferecia hora (ConfirmDialogDateFields, um `datetime-local`) mandava o
-- instante para a coluna DATE, que truncava em silêncio. Medido em 25/08/2026:
-- 22.247 das 39.523 atividades têm notification_date preenchido; nenhuma tem
-- hora, porque a coluna não sabe guardar hora.
--
-- SOLUÇÃO: coluna nova em vez de ALTER TYPE na existente. `notification_date`
-- é lida como string `yyyy-MM-dd` em pelo menos três caminhos
-- (`.eq('notification_date', dateOnly)` do ConfirmDialogDateFields, o regex do
-- autoApply e o `slice(0,10)` de `diaDaAtividade`) e ainda alimenta a agenda, o
-- Google Calendar e o BulkReassign. Trocar o tipo reescreveria as 39.523 linhas
-- e mexeria em todos esses leitores de uma vez. Com a coluna nova, nada que
-- existe muda de comportamento: o front continua gravando a parte da data em
-- `notification_date` e passa a gravar o instante completo aqui.
--
-- timestamptz para casar com `meeting_at` e `callback_at` — o front grava ISO
-- (`toISOString()`) e lê com `parseISO`, então precisa do instante com fuso.
--
-- Convenção: NULL ou 00:00 = sem hora definida. As 22.247 linhas antigas ficam
-- NULL e a mensagem ao cliente segue dizendo "até o final do dia".
--
-- Sem índice de propósito: nenhuma query filtra nem ordena por esta coluna no
-- servidor (a ordenação do minicalendário é feita no cliente). Mesmo critério
-- do callback_at. Se nascer um job de lembrete varrendo avisos vencidos, o
-- índice entra junto com ele — parcial, sobre as não concluídas.
--
-- ADD COLUMN de timestamptz anulável não reescreve a tabela (Postgres 11+):
-- as 39.523 linhas existentes ficam NULL, sem lock longo. 0 linhas alteradas.
--
-- Rollback: alter table public.lead_activities drop column notification_at;

alter table public.lead_activities
  add column if not exists notification_at timestamptz;

comment on column public.lead_activities.notification_at is
  'Instante do aviso (data + hora). notification_date segue existindo com a parte da data — todos os leitores antigos usam ela. NULL ou 00:00 = sem hora definida.';
