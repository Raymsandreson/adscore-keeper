-- Status do POP ganha DATA editável (importante pro ranking contar no mês certo,
-- inclusive retroativo). "Resultado" vira "Status" nos rótulos do front (aqui só o
-- dado). O ranking passa a contar o status esperado pela DATA do status
-- (effective_date), não pela hora do registro.
--
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

alter table public.leads add column if not exists pop_result_date date;
alter table public.lead_pop_result_history add column if not exists effective_date date;

-- log passa a receber a DATA do status (default = hoje SP). Substitui a 5-arg.
create or replace function public.log_pop_result_change(
  p_user_id  uuid,
  p_lead_id  uuid,
  p_board_id uuid,
  p_from     text,
  p_to       text,
  p_date     date default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lead_id is null or p_to is null then return; end if;
  if p_from is not distinct from p_to then return; end if;
  insert into public.lead_pop_result_history
    (lead_id, board_id, from_result, to_result, changed_by, changed_at, effective_date)
  values
    (p_lead_id, p_board_id, p_from, p_to, p_user_id, now(),
     coalesce(p_date, (now() at time zone 'America/Sao_Paulo')::date));
exception when others then
  raise warning '[log_pop_result_change] falhou: %', sqlerrm;
end;
$$;

drop function if exists public.log_pop_result_change(uuid, uuid, uuid, text, text);
grant execute on function public.log_pop_result_change(uuid, uuid, uuid, text, text, date) to anon, authenticated;

-- Ranking: conta o status esperado pela DATA do status (effective_date), no mês.
do $mig$
declare d text;
begin
  select pg_get_functiondef('public.tv_atividades_ranking(timestamptz,uuid,text,text)'::regprocedure) into d;
  d := replace(d,
    'where h.changed_at >= date_trunc(''month'', now())',
    'where coalesce(h.effective_date, (h.changed_at at time zone ''America/Sao_Paulo'')::date) >= date_trunc(''month'', (now() at time zone ''America/Sao_Paulo''))::date');
  execute d;
end $mig$;
