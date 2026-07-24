-- "Resultado do POP" — campo por-POP no lead, SEPARADO do "Resultado do Lead"
-- global (lead_status), pra não tocar no fluxo comercial (Fechado→cliente/CAPI).
-- Cada POP define seus resultados possíveis + o esperado em
-- kanban_boards.settings.{resultados, resultado_esperado_id}. Aqui guardamos qual
-- resultado o lead tem e o histórico (quem/quando) pra o ranking contar o
-- esperado no mês, por pessoa.
--
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

-- Valor atual do resultado do POP no lead (id do resultado em settings.resultados).
alter table public.leads add column if not exists pop_result_id text;

-- Histórico do resultado do POP (quem/quando) — base confiável do ranking.
create table if not exists public.lead_pop_result_history (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null,
  board_id    uuid,
  from_result text,
  to_result   text,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index if not exists idx_lead_pop_result_history_to_changed
  on public.lead_pop_result_history (to_result, changed_at);
create index if not exists idx_lead_pop_result_history_board
  on public.lead_pop_result_history (board_id, changed_at);

alter table public.lead_pop_result_history enable row level security;
drop policy if exists lpr_read on public.lead_pop_result_history;
create policy lpr_read on public.lead_pop_result_history for select using (true);
-- Escrita só via RPC security definer (sem policy de insert = insert direto bloqueado).

-- Log da mudança de resultado do POP. O app edita o Externo como anônimo, então o
-- autor real (user do Cloud) vem do frontend — mesmo padrão de log_checklist_step
-- e log_lead_result_change.
create or replace function public.log_pop_result_change(
  p_user_id  uuid,
  p_lead_id  uuid,
  p_board_id uuid,
  p_from     text,
  p_to       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lead_id is null or p_to is null then return; end if;
  if p_from is not distinct from p_to then return; end if;
  insert into public.lead_pop_result_history (lead_id, board_id, from_result, to_result, changed_by, changed_at)
  values (p_lead_id, p_board_id, p_from, p_to, p_user_id, now());
exception when others then
  raise warning '[log_pop_result_change] falhou: %', sqlerrm;
end;
$$;

grant execute on function public.log_pop_result_change(uuid, uuid, uuid, text, text) to anon, authenticated;
