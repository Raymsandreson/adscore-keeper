-- Reunião como pausa justificada: tempo em reunião não pode virar "ocioso".
-- Mesma mecânica de almoço/intervalo (activity_id null + break_type preenchido);
-- estimated_minutes na linha guarda a duração prevista da reunião.

alter table public.activity_time_entries
  drop constraint if exists activity_time_entries_break_type_check;

alter table public.activity_time_entries
  add constraint activity_time_entries_break_type_check
  check (break_type in ('almoco','intervalo','compensacao','cafe','lanche','descanso','reuniao'));

comment on column public.activity_time_entries.break_type is
  'Pausa justificada: almoco | intervalo | compensacao (banco de horas) | cafe | lanche | descanso | reuniao.';
