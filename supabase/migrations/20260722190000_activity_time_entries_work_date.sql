-- Particiona o cronômetro por DIA (fonte da verdade do "tempo de hoje").
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).
--
-- PROBLEMA: cada atividade tinha UMA linha acumuladora vitalícia — active_seconds
-- crescia somando todos os dias, e started_at ficava congelado no 1º dia. Toda
-- agregação "de hoje" (painel Time, dayTotals, RPC do telão) somava esse total
-- histórico como se fosse do dia. Resultado real observado: Alexandre marcou
-- ~12h50 ativo + 07h40 ocioso (>20h) num único dia porque reabriu atividades de
-- 15–20/07 e cada uma trouxe o acumulado inteiro pro "hoje".
--
-- SOLUÇÃO: coluna work_date. A partir daqui há UMA linha por atividade POR DIA
-- (o código passa a filtrar activity_id + user_id + work_date na retomada).
-- "Tempo de hoje" = fatia do dia; "tempo total da atividade" = SUM das fatias.
--
-- Backfill: linhas antigas multi-dia ficam lançadas no dia em que COMEÇARAM
-- (started_at). É aproximação do passado — não dá pra reconstruir o por-dia de um
-- contador único. Daqui pra frente fica correto.
--
-- Data = calendário de Brasília (America/Sao_Paulo), pra casar com o "início do
-- dia" que o cliente calcula em horário local.
--
-- Rollback: alter table public.activity_time_entries drop column work_date;
--           (aditiva; nenhuma coluna/linha existente é alterada de forma destrutiva)

alter table public.activity_time_entries
  add column if not exists work_date date;

-- Backfill idempotente: só preenche o que ainda está nulo.
update public.activity_time_entries
  set work_date = (started_at at time zone 'America/Sao_Paulo')::date
  where work_date is null;

alter table public.activity_time_entries
  alter column work_date set default ((now() at time zone 'America/Sao_Paulo')::date);

alter table public.activity_time_entries
  alter column work_date set not null;

comment on column public.activity_time_entries.work_date is
  'Dia (calendário Brasília) a que este tempo pertence. Uma linha por atividade por dia; agregações diárias/semanais/mensais filtram/agrupam por aqui.';

-- Agregação por dia do membro (painel Time, refreshDayBase) e janelas dos RPCs.
create index if not exists idx_ate_user_work_date
  on public.activity_time_entries(user_id, work_date);
