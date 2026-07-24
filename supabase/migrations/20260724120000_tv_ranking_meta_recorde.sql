-- Telão /tv/atividades — "Modo Corrida": a LINHA DE CHEGADA vira META = RECORDE.
--
-- Antes: a chegada 🏁 era o líder do momento (maxP no front) — quem lidera já
-- estava colado na bandeira, sem alvo fixo. Agora a chegada é o RECORDE
-- individual de PASSOS (o 1º critério) do escopo de time selecionado, na
-- granularidade do período aberto no telão:
--   dia    → maior nº de passos que UMA pessoa já fez num único dia
--   semana → … numa única semana        mes → … num único mês
-- "Cultura de superação de recordes": correr pra bater a própria marca histórica.
-- Só PASSOS define a chegada; concluídas/atrasadas/etc. seguem só como desempate.
--
-- Estratégia byte-safe (mesma das migrations anteriores desta função): lê a
-- definição VIGENTE da 3-arg via pg_get_functiondef, reconstrói como 4-arg
-- adicionando `p_granularidade` (default 'dia') + as CTEs de `meta`, e substitui
-- a 3-arg (drop no fim). Fica UMA função só, evitando a ambiguidade de overload
-- (param com default só pode vir depois de outro com default; e manter a 3-arg
-- junto de uma 4-arg com default tornaria a chamada de 3 args ambígua).
--
-- Compatibilidade: chamadas de 3 args (performance-coach, TeamBroadcastDialog)
-- passam a resolver nesta 4-arg usando o default 'dia' e recebem `ranking`/
-- `resumo` IDÊNTICOS — só ganham uma chave `meta` extra, que elas ignoram. O
-- corpo é superset do antigo. O recorde considera só períodos ANTERIORES ao
-- atual (`created_at < p_since`) — o período corrente é quem corre pra superá-lo.
-- Respeita o mesmo filtro de time/grupo e a mesma agregação por nome (com
-- espaço, sem dígitos) do ranking, pra a meta ser comparável.
--
-- Escala: `checklist_item_checked` tem índice em action_type e created_at; o
-- histórico é pequeno. Se o log crescer muito, avaliar índice parcial.
--
-- Rollback: como a 4-arg é superset da 3-arg, reverter só o front (git) já basta
-- na prática. Rollback de banco, se preciso: drop da 4-arg + recriar a 3-arg a
-- partir do git (migração 20260722191000 + cadeia anterior).
--
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

do $$
declare
  d text;
  meta_ctes text;
begin
  select pg_get_functiondef('public.tv_atividades_ranking(timestamptz,uuid,text)'::regprocedure) into d;

  -- Assinatura → adiciona p_granularidade com default (obrigatório: vem depois
  -- de params já defaultados). 'dia' = granularidade diária.
  d := replace(d,
    'p_grupo text DEFAULT NULL::text)',
    'p_grupo text DEFAULT NULL::text, p_granularidade text DEFAULT ''dia''::text)');

  -- CTEs da meta: injetadas entre o fim do WITH (fecha `resumo`) e o SELECT final.
  -- `gestores` já está no escopo (1ª CTE) — reusada pro filtro gerencial.
  meta_ctes :=
$m$),
meta_by_user as (
  select coalesce(m.ext_uuid, ual.user_id) as ext_user,
         date_trunc(
           case p_granularidade when 'semana' then 'week'
                                when 'mes' then 'month'
                                when 'mês' then 'month'
                                else 'day' end,
           (ual.created_at at time zone 'America/Sao_Paulo')
         ) as bucket,
         count(*)::int as passos
  from user_activity_log ual
  left join auth_uuid_mapping m on m.cloud_uuid = ual.user_id
  where ual.action_type = 'checklist_item_checked'
    and ual.created_at < p_since
    and coalesce(ual.metadata->>'retroactive', 'false') <> 'true'
  group by 1, 2
),
meta_filtered as (
  select mu.*
  from meta_by_user mu
  where (p_team_id is null
     or mu.ext_user in (select tm.user_id from team_members tm where tm.team_id = p_team_id))
    and (p_grupo is distinct from 'gerencial'
     or mu.ext_user in (select gs.ext_user from gestores gs))
),
meta_named as (
  select btrim(coalesce(g.nome, pr.full_name)) as nome, mf.bucket, mf.passos
  from meta_filtered mf
  left join profiles pr on pr.user_id = mf.ext_user
  left join gestores g on p_grupo = 'gerencial' and g.ext_user = mf.ext_user
),
meta_by_name as (
  select nome, bucket, sum(passos)::int as passos
  from meta_named
  where nome ~ '\s' and nome !~ '[0-9]'
  group by nome, bucket
),
meta as (
  select coalesce(max(passos), 0)::int as passos from meta_by_name
)
select jsonb_build_object($m$;

  d := replace(d, E')\nselect jsonb_build_object(', meta_ctes);

  -- Adiciona `meta` ao payload de saída.
  d := replace(d,
    '''gerado_em'', now()',
    '''meta'', (select passos from meta),' || E'\n  ' || '''gerado_em'', now()');

  execute d;

  -- Substitui a 3-arg pela nova 4-arg (superset). Sem dependências (só a app
  -- chamava). A partir daqui existe UMA função só — chamadas de 3 args caem nela.
  drop function if exists public.tv_atividades_ranking(timestamptz, uuid, text);
end $$;

grant execute on function public.tv_atividades_ranking(timestamptz, uuid, text, text) to anon, authenticated;
