-- Comando remoto da gestão sobre o cronômetro do membro.
-- Reaproveita activity_timer_alerts (já tem realtime + listener no cliente):
--   command null        → chamado "por que você está ocioso?" (comportamento antigo)
--   command 'pause'     → o cliente do membro salva a sessão atual e cai no ocioso
--   command 'end_shift' → o cliente encerra o expediente (ponto de saída)
-- A linha fica como log de auditoria: quem mandou (from_user_id/from_name), pra
-- quem (to_user_id), o quê (command) e quando (created_at).

alter table public.activity_timer_alerts
  add column if not exists command text;

do $$
begin
  alter table public.activity_timer_alerts
    add constraint ata_command_chk
    check (command is null or command in ('pause', 'end_shift'));
exception
  when duplicate_object then null;
end $$;

comment on column public.activity_timer_alerts.command is
  'Comando remoto do cronômetro: null = só alerta; pause = deixar ocioso; end_shift = encerrar expediente.';
