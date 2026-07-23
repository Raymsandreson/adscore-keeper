-- Registra, POR PESSOA, a marcação/desmarcação de um SUB-ITEM do checklist do
-- passo (o docChecklist — ex.: cada documento dentro de "juntar documentos").
--
-- Contexto: a marcação de PASSO (item de topo) já era logada por
-- log_checklist_step -> action_type 'checklist_item_checked'. Os sub-itens
-- (docChecklist) só viviam no JSON de lead_checklist_instances e NÃO tinham
-- registro por pessoa — logo não entravam no ranking do telão. Esta função
-- cria esse registro, espelhando log_checklist_step.
--
-- Dois action_type novos, porque o telão conta LÍQUIDO (marcações - desmarcações)
-- por decisão do negócio ("não ignorar desmarcação"):
--   'checklist_doc_item_checked'    -> marcou um sub-item
--   'checklist_doc_item_unchecked'  -> desmarcou um sub-item
--
-- retroactive: igual ao passo, marcar pergunta "foi agora ou já tinha
-- acontecido antes?" (askStepTiming no front). Retroativo fica no histórico
-- mas não conta como progresso da semana. Desmarcar é sempre "agora"
-- (retroactive = false), pois desfazer não tem sentido retroativo.
--
-- security definer: a sessão do Externo é anônima; a função roda como owner e
-- só grava número/label — nenhuma PII sai daqui.
--
-- Rollback: drop function public.log_checklist_doc_item(uuid, uuid, text, boolean, boolean);

create or replace function public.log_checklist_doc_item(
  p_user_id uuid,
  p_instance_id uuid,
  p_doc_label text,
  p_checked boolean,
  p_retroactive boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then return; end if;
  insert into public.user_activity_log (user_id, action_type, entity_type, entity_id, metadata, created_at)
  values (
    p_user_id,
    case when p_checked then 'checklist_doc_item_checked' else 'checklist_doc_item_unchecked' end,
    'workflow', p_instance_id,
    jsonb_build_object(
      'item_label', coalesce(p_doc_label, 'Item de checklist'),
      -- desmarcação nunca é retroativa; só a marcação pergunta.
      'retroactive', coalesce(p_checked, true) and coalesce(p_retroactive, false)
    ),
    now());
exception when others then
  raise warning '[log_checklist_doc_item] falhou: %', sqlerrm;
end;
$$;

grant execute on function public.log_checklist_doc_item(uuid, uuid, text, boolean, boolean) to anon, authenticated;
