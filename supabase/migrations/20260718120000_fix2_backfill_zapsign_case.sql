-- Fix 2 — Backfill do vínculo caso ↔ procuração na criação do caso.
--
-- Contexto: a procuração (zapsign_documents) costuma ser assinada ANTES do
-- legal_case existir. O Fix 1 (webhook) só consegue vincular quando o caso já
-- existe no momento da assinatura. Este gatilho fecha o outro lado: quando um
-- legal_case nasce para um lead, carimba o legal_case_id nas procurações
-- daquele lead que ainda estão sem caso.
--
-- Seguro: só grava onde legal_case_id é NULL; envolto em EXCEPTION pra nunca
-- bloquear a criação do caso se algo falhar.

create or replace function public.backfill_zapsign_case_on_legal_case_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is not null then
    update public.zapsign_documents z
       set legal_case_id = new.id,
           updated_at = now()
     where z.lead_id = new.lead_id
       and z.legal_case_id is null;
  end if;
  return new;
exception when others then
  raise warning '[fix2] backfill_zapsign_case falhou para caso %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_backfill_zapsign_case on public.legal_cases;
create trigger trg_backfill_zapsign_case
  after insert on public.legal_cases
  for each row
  execute function public.backfill_zapsign_case_on_legal_case_insert();
