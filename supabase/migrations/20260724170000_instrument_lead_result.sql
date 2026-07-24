-- Instrumentação do "Resultado do Lead" (leads.lead_status) — passo 1 do KPI
-- "resultado esperado por POP". Hoje quem/quando um resultado é atingido NÃO é
-- gravado de forma confiável: lead_status_history parou em jun/2026 e
-- lead_status_changed_at estava preenchido em ~8% dos fechados. Sem isso, o
-- ranking do resultado esperado mostraria número errado. A partir daqui os
-- números passam a valer deste mês em diante (não há retroativo confiável).
--
-- (A) Trigger universal: carimba lead_status_changed_at = now() sempre que o
--     resultado muda — cobre TODOS os caminhos (dialog, webhook, bulk).
-- (B) RPC log_lead_result_change: grava a mudança em lead_status_history com o
--     AUTOR REAL (o app edita o Externo como anônimo, então auth.uid() não é o
--     assessor — o frontend passa o user_id do Cloud, igual a log_checklist_step).
--     changed_by = user_id do Cloud; o ranking mapeia via auth_uuid_mapping.
--
-- Rollback: drop do trigger + da função de trigger + da RPC.
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

-- (A) ---------------------------------------------------------------
create or replace function public.stamp_lead_status_changed_at()
returns trigger
language plpgsql
as $$
begin
  if NEW.lead_status is distinct from OLD.lead_status then
    NEW.lead_status_changed_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_stamp_lead_status_changed_at on public.leads;
create trigger trg_stamp_lead_status_changed_at
  before update of lead_status on public.leads
  for each row execute function public.stamp_lead_status_changed_at();

-- (B) ---------------------------------------------------------------
create or replace function public.log_lead_result_change(
  p_user_id uuid,
  p_lead_id uuid,
  p_from text,
  p_to text,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lead_id is null or p_to is null then return; end if;
  if p_from is not distinct from p_to then return; end if; -- no-op não vira histórico
  insert into public.lead_status_history
    (lead_id, from_status, to_status, changed_by, changed_by_type, reason, changed_at)
  values
    (p_lead_id, p_from, p_to, p_user_id, 'manual', p_reason, now());
exception when others then
  raise warning '[log_lead_result_change] falhou: %', sqlerrm;
end;
$$;

grant execute on function public.log_lead_result_change(uuid, uuid, text, text, text) to anon, authenticated;
