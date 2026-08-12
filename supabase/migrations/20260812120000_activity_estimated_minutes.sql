-- Previsão de tempo NA ATIVIDADE (não só na sessão de cronômetro).
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).
--
-- PROBLEMA: `activity_time_entries.estimated_minutes` existe desde 20260716, mas
-- é por SESSÃO e só dá pra definir no relógio flutuante, depois que o cronômetro
-- já está rodando. A atividade em si nasce sem previsão nenhuma — não dá pra
-- planejar o dia nem comparar "gastou x previsto" fora do cronômetro.
--
-- SOLUÇÃO: a previsão passa a morar na atividade. O cronômetro herda esse valor
-- ao iniciar (continua podendo ser ajustado na sessão) e o formulário mostra
-- "gasto X de Y previstos".
--
-- Rollback: alter table public.lead_activities drop column estimated_minutes;
--           drop function public.activity_type_time_medians();

alter table public.lead_activities
  add column if not exists estimated_minutes integer;

comment on column public.lead_activities.estimated_minutes is
  'Previsão de tempo (min) para executar a atividade. Herdada pelo cronômetro (activity_time_entries.estimated_minutes) ao iniciar a sessão.';

-- Sugestão de previsão ao CRIAR: mediana real do tipo de atividade, medida no
-- próprio cronômetro. Mediana e não média: a média é puxada por sessão esquecida
-- aberta (há linhas de 8h+ que são esquecimento, não trabalho).
--
-- Janela de 180 dias para o número acompanhar como a equipe trabalha hoje.
-- Sessões < 60s ficam de fora (abrir/fechar atividade não é execução).
create or replace function public.activity_type_time_medians()
returns table (activity_type text, median_minutes integer, samples integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.activity_type,
    greatest(1, round(
      (percentile_cont(0.5) within group (order by e.active_seconds)) / 60.0
    ))::integer as median_minutes,
    count(*)::integer as samples
  from public.activity_time_entries e
  where e.activity_id is not null
    and e.activity_type is not null
    and e.active_seconds > 60
    and e.started_at > now() - interval '180 days'
  group by e.activity_type
  having count(*) >= 5;   -- amostra pequena demais vira chute, não previsão
$$;

comment on function public.activity_type_time_medians() is
  'Mediana de tempo ativo (min) por tipo de atividade nos últimos 180 dias. Alimenta a previsão sugerida ao criar atividade.';

grant execute on function public.activity_type_time_medians() to authenticated, anon;
