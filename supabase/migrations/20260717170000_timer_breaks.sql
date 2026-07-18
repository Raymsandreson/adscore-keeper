-- Pausas justificadas no cronômetro: almoço, intervalo (com justificativa)
-- e compensação de banco de horas. Linhas de pausa têm activity_id null e
-- break_type preenchido — relatórios separam de "ocioso".

alter table public.activity_time_entries
  add column if not exists break_type text
    check (break_type in ('almoco','intervalo','compensacao')),
  add column if not exists break_note text;

comment on column public.activity_time_entries.break_type is
  'Pausa justificada: almoco | intervalo | compensacao (banco de horas).';
comment on column public.activity_time_entries.break_note is
  'Justificativa da pausa (obrigatória para intervalo).';
