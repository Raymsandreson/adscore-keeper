-- #8: RPC para logar "passo dado" (item de checklist marcado) por pessoa.
-- security definer contorna a RLS user_id=auth.uid() da user_activity_log,
-- necessário porque a sessão do Externo é anônima (auth.uid() != assessor).
-- O frontend (useChecklists.updateInstanceItem) passa o user_id real (auth do
-- Cloud, = profiles.user_id) só para os itens recém-marcados.
create or replace function public.log_checklist_step(
  p_user_id uuid,
  p_instance_id uuid,
  p_item_label text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then return; end if;
  insert into public.user_activity_log (user_id, action_type, entity_type, entity_id, metadata, created_at)
  values (p_user_id, 'checklist_item_checked', 'workflow', p_instance_id,
          jsonb_build_object('item_label', coalesce(p_item_label,'Passo')), now());
exception when others then
  raise warning '[log_checklist_step] falhou: %', sqlerrm;
end;
$$;

grant execute on function public.log_checklist_step(uuid, uuid, text) to anon, authenticated;
