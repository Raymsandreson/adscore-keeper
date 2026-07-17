-- Amplia os tipos de pausa: café, lanche e descanso (pausas rápidas com
-- previsão de retorno guardada em estimated_minutes). Mantém almoço/intervalo/
-- compensação. estimated_minutes na linha de pausa = previsão de retorno.

alter table public.activity_time_entries
  drop constraint if exists activity_time_entries_break_type_check;

alter table public.activity_time_entries
  add constraint activity_time_entries_break_type_check
  check (break_type in ('almoco','intervalo','compensacao','cafe','lanche','descanso'));
