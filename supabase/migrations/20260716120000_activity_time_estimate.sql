-- Previsão de tempo (estimativa) por atividade para o cronômetro.
-- Usada como gatilho de urgência: avisa ao se aproximar e mostra o
-- excedente (em vermelho) quando o tempo ativo passa da previsão.
-- Fica na tabela do cronômetro (por atividade+membro), não em lead_activities.

alter table public.activity_time_entries
  add column if not exists estimated_minutes integer;

comment on column public.activity_time_entries.estimated_minutes is
  'Previsão de tempo (min) da atividade — gatilho de urgência do cronômetro.';
