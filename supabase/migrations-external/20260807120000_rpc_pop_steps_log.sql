-- Régua "onde você está" no POP: leitura dos passos já marcados de um conjunto
-- de instâncias (objetivos) do fluxo, pra mostrar na barra de progresso o que
-- foi marcado HOJE e o que veio de outro dia.
--
-- Por que RPC e não select direto: a policy de SELECT de user_activity_log é
-- "user_id = auth.uid() or is_admin(auth.uid())" e a sessão do app no Externo é
-- ANÔNIMA (signInAnonymously) — o select direto volta 0 linhas em silêncio.
-- Mesmo padrão das RPCs do telão (tv_ranking_detalhe).
--
-- Só leitura: nenhuma escrita, nenhum dado sensível de cliente (o metadata do
-- log guarda apenas o rótulo do passo do POP).

create or replace function public.pop_steps_log(
  p_instance_ids uuid[],
  p_days integer default 45
)
returns table (
  instance_id uuid,
  item_label text,
  retroactive boolean,
  marked_by uuid,
  marked_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    l.entity_id                                              as instance_id,
    coalesce(l.metadata->>'item_label', 'Passo')             as item_label,
    coalesce((l.metadata->>'retroactive')::boolean, false)   as retroactive,
    l.user_id                                                as marked_by,
    l.created_at                                             as marked_at
  from public.user_activity_log l
  where l.action_type = 'checklist_item_checked'
    and l.entity_type = 'workflow'
    and l.entity_id = any(p_instance_ids)
    and l.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 45), 1))
  order by l.created_at desc
  limit 300;
$function$;

grant execute on function public.pop_steps_log(uuid[], integer) to anon, authenticated;
