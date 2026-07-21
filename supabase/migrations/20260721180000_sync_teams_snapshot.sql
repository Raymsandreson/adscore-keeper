-- Espelho dos times Cloud → Externo.
--
-- Problema: a aba Times (Configurações) salva teams/team_members no CLOUD,
-- mas o telão /tv/atividades e a RPC tv_atividades_ranking leem a cópia do
-- EXTERNO — que estava congelada desde 29/04 (nomes antigos, membros faltando).
--
-- Esta RPC recebe o snapshot atual do Cloud e reconstrói a cópia do Externo.
-- É chamada pelo TeamsManager toda vez que a aba Times carrega (fetchTeams),
-- então qualquer rename/inclusão/remoção se propaga na próxima abertura da aba.
--
-- Namespaces de UUID: team_members.user_id no Cloud é auth do Cloud; no
-- Externo, o ranking casa por auth do Externo. O mapeamento usa
-- auth_uuid_mapping (cloud_uuid → ext_uuid); sem linha no mapa, mantém o
-- uuid do Cloud (casos em que os dois são iguais).
--
-- board_id NÃO é sincronizado: no Externo ele tem FK pra kanban_boards local
-- e o telão não usa. Mantém o valor existente em updates, null em inserts.

create or replace function public.sync_teams_snapshot(p_teams jsonb, p_members jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Payload vazio nunca é um estado legítimo (sempre existem times no Cloud);
  -- abortar evita que uma chamada com erro apague a cópia inteira.
  if p_teams is null or jsonb_array_length(p_teams) = 0 then
    raise exception 'sync_teams_snapshot: payload de times vazio';
  end if;

  insert into teams (id, name, description, color)
  select
    (t->>'id')::uuid,
    t->>'name',
    t->>'description',
    coalesce(t->>'color', '#3b82f6')
  from jsonb_array_elements(p_teams) t
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    color = excluded.color,
    updated_at = now();

  delete from teams
  where id not in (select (t->>'id')::uuid from jsonb_array_elements(p_teams) t);

  delete from team_members;

  insert into team_members (team_id, user_id)
  select distinct
    (m->>'team_id')::uuid,
    coalesce(map.ext_uuid, (m->>'user_id')::uuid)
  from jsonb_array_elements(p_members) m
  left join auth_uuid_mapping map on map.cloud_uuid = (m->>'user_id')::uuid
  where (m->>'team_id')::uuid in (select (t->>'id')::uuid from jsonb_array_elements(p_teams) t);
end;
$$;

-- Sessão do app no Externo é anônima (signInAnonymously) = role authenticated.
grant execute on function public.sync_teams_snapshot(jsonb, jsonb) to authenticated;
