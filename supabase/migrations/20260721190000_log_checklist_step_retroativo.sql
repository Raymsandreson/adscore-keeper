-- Passo retroativo: diferenciar passo dado HOJE de passo que já tinha
-- acontecido antes e só está sendo registrado agora. O flag vai no metadata
-- do log; o ranking do telão passa a ignorar retroativos (migration irmã
-- 20260721191000), porque registro de passo antigo não mede progresso atual.
--
-- A 3-arg é dropada (não renomeada pra _legacy) porque manter as duas com o
-- mesmo nome criaria overload ambíguo no PostgREST: chamada com 3 args
-- nomeados casaria tanto com a 3-arg quanto com a 4-arg via default.
-- Frontend já publicado (3 args nomeados) continua funcionando na 4-arg
-- com p_retroactive = false, que reproduz o comportamento antigo.
--
-- Rollback: drop da 4-arg + re-rodar 20260718130000_rpc_log_checklist_step.sql.

drop function if exists public.log_checklist_step(uuid, uuid, text);

create or replace function public.log_checklist_step(
  p_user_id uuid,
  p_instance_id uuid,
  p_item_label text,
  p_retroactive boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then return; end if;
  insert into public.user_activity_log (user_id, action_type, entity_type, entity_id, metadata, created_at)
  values (p_user_id, 'checklist_item_checked', 'workflow', p_instance_id,
          jsonb_build_object(
            'item_label', coalesce(p_item_label, 'Passo'),
            'retroactive', coalesce(p_retroactive, false)
          ),
          now());
exception when others then
  raise warning '[log_checklist_step] falhou: %', sqlerrm;
end;
$$;

grant execute on function public.log_checklist_step(uuid, uuid, text, boolean) to anon, authenticated;
