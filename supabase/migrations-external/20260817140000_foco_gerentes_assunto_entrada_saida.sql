-- =============================================================================
-- FOCO DOS GERENTES v2 — o foco passa a ser lido pelo ASSUNTO/CONTEXTO da
-- atividade (não só pelo tipo) e o resultado passa a ter as DUAS pontas:
-- quantos processos ENTRARAM e quantos SAÍRAM.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Pedido do usuário (17/08/2026): "olhe o foco pelo assunto da atv e pelo
-- contexto da atv também, não só pelo tipo, pq o tipo pode estar errado. E mais
-- do que isso pelo resultado, que é o tanto de processos que realmente entraram
-- e saíram. Pq o que não entra não sai, e se não sai não conseguimos colocar
-- mais para entrar."
--
-- 1) O TIPO ENGANA — medido em 17/08/2026 na carteira da gerente processual
--    (60 dias, 261 atividades concluídas):
--      só pelo tipo ................ 139 no foco = 53%
--      pelo tipo OU pelo assunto ... 226 no foco = 87%
--    As 87 que o tipo perdia estavam com tipo "Tarefa" genérico e assunto
--    inequivocamente processual: "Prestar esclarecimentos sobre minuta de
--    acordo", "Manifestar descumprimento dos pagamentos", "VERIFICAR SENTENÇA",
--    "Cobrar manifestação da juíza após o prazo". Texto vence tipo.
--    O texto lido é assunto + descrição + o que foi feito + próximo passo +
--    processo/caso vinculado, sem acento e sem caixa (unaccent + lower).
--
-- 2) ENTRADA E SAÍDA — a fonte de entrada é o marco `peticao_inicial`, mesma
--    natureza da saída (movimentação real do tribunal), o que deixa as duas
--    pontas comparáveis. As alternativas foram medidas e descartadas:
--      lead_processes.created_at ..... 1019 de 1864 nos últimos 60 dias — é
--                                      data de cadastro/importação, não de
--                                      entrada; inflaria a conta.
--      lead_processes.data_distribuicao  preenchida em só 171 de 1864.
--    Carteira da gerente processual em 60 dias: 45 entraram, 20 saíram.
--
-- Rollback: os comandos no fim do arquivo (comentados) devolvem a v1 inteira.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Configuração ganha palavras do assunto e piso de saída
-- ---------------------------------------------------------------------------
ALTER TABLE public.manager_focus_targets
  -- Palavras que, achadas no assunto/contexto, marcam a atividade como da área.
  -- Sem acento e minúsculas — a comparação normaliza os dois lados.
  ADD COLUMN IF NOT EXISTS focus_keywords text[] NOT NULL DEFAULT '{}',
  -- Piso de % da carteira que precisa sair no período (o de vendas usa o piso
  -- de esforço; o processual é cobrado também por este).
  ADD COLUMN IF NOT EXISTS min_exit_percent integer
    CHECK (min_exit_percent IS NULL OR min_exit_percent BETWEEN 0 AND 100);

-- ---------------------------------------------------------------------------
-- 2. Situação de cada gerente — agora com texto, entrada e saída
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manager_focus_status(
  p_since timestamptz DEFAULT date_trunc('month', now()),
  p_until timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
with gestores as (
  select
    g.cloud_uuid,
    max(g.nome) as nome,
    coalesce(
      (array_agg(m.ext_uuid) filter (where m.ext_uuid is not null))[1],
      g.cloud_uuid
    ) as ext_uuid,
    array_remove(array_agg(distinct g.team_id), null) as team_ids,
    array_remove(array_agg(distinct g.team_name), null) as team_names
  from (
    select manager_user_id as cloud_uuid, manager_name as nome, team_id, team_name
    from team_managers where manager_user_id is not null
    union all
    select manager_user_id, manager_name, null::uuid, null::text
    from org_sectors where manager_user_id is not null
  ) g
  left join auth_uuid_mapping m on m.cloud_uuid = g.cloud_uuid
  group by g.cloud_uuid
),
cfg as (select * from manager_focus_targets),
-- Uma linha por atividade concluída do gerente, já dizendo por que ela conta
-- (tipo, texto, ou nenhum dos dois).
acts_raw as (
  select
    ge.cloud_uuid,
    la.id,
    la.activity_type,
    coalesce(at.label, la.activity_type) as label,
    (la.activity_type = any(coalesce(c.activity_type_keys, '{}'::text[]))) as por_tipo,
    (
      coalesce(array_length(c.focus_keywords, 1), 0) > 0
      and exists (
        select 1 from unnest(c.focus_keywords) k
        where k <> ''
          and unaccent(lower(
                coalesce(la.title, '') || ' ' ||
                coalesce(la.description, '') || ' ' ||
                coalesce(la.what_was_done, '') || ' ' ||
                coalesce(la.next_steps, '') || ' ' ||
                coalesce(la.current_status_notes, '') || ' ' ||
                coalesce(la.process_title, '') || ' ' ||
                coalesce(la.case_title, '')
              )) like '%' || unaccent(lower(k)) || '%'
      )
    ) as por_texto
  from gestores ge
  left join cfg c on c.manager_user_id = ge.cloud_uuid
  join lead_activities la
    on la.assigned_to = ge.ext_uuid
   and la.deleted_at is null
   and la.status = 'concluida'
   and la.completed_at >= p_since
   and la.completed_at < p_until
  left join activity_types at on at.key = la.activity_type
),
acts_g as (
  select cloud_uuid, activity_type, label, (por_tipo or por_texto) as no_foco,
    count(*)::int as n,
    count(*) filter (where por_texto and not por_tipo)::int as por_texto_n
  from acts_raw
  group by cloud_uuid, activity_type, label, (por_tipo or por_texto)
),
acts_tot as (
  select cloud_uuid,
    sum(n)::int as concluidas,
    sum(n) filter (where no_foco)::int as no_foco,
    -- Quantas o TIPO teria perdido e o texto recuperou — mostra o tamanho do
    -- erro de tipagem sem precisar auditar atividade por atividade.
    sum(por_texto_n)::int as resgatadas_pelo_texto
  from acts_g group by cloud_uuid
),
acts_fora as (
  select cloud_uuid, jsonb_agg(x order by (x->>'n')::int desc) as fora
  from (
    select cloud_uuid,
      jsonb_build_object('tipo', activity_type, 'label', label, 'n', n) as x,
      row_number() over (partition by cloud_uuid order by n desc) as rn
    from acts_g where not no_foco
  ) s
  where rn <= 8
  group by cloud_uuid
),
acts_dentro as (
  select cloud_uuid, jsonb_agg(
    jsonb_build_object('tipo', activity_type, 'label', label, 'n', n) order by n desc
  ) as dentro
  from acts_g where no_foco group by cloud_uuid
),
carteira as (
  select ge.cloud_uuid, count(distinct pa.process_id)::int as processos
  from gestores ge
  join vw_process_assignment pa on pa.team_id = any(ge.team_ids)
  join lead_processes lp on lp.id = pa.process_id and lp.deleted_at is null
  group by ge.cloud_uuid
),
-- As duas pontas do funil da carteira, na mesma fonte (marco do tribunal).
fluxo as (
  select
    ge.cloud_uuid,
    count(distinct pm.process_id) filter (where pm.tipo_movimentacao = 'peticao_inicial')::int as entradas,
    count(distinct pm.process_id) filter (
      where pm.tipo_movimentacao in ('acordo', 'cumprimento_sentenca', 'precatorio_rpv', 'pagamento')
    )::int as saidas,
    count(distinct pm.process_id) filter (where pm.tipo_movimentacao = 'acordo')::int as por_acordo,
    count(distinct pm.process_id) filter (
      where pm.tipo_movimentacao in ('cumprimento_sentenca', 'precatorio_rpv', 'pagamento')
    )::int as por_execucao
  from gestores ge
  join vw_process_assignment pa on pa.team_id = any(ge.team_ids)
  join process_movements_validos pm on pm.process_id = pa.process_id
  where pm.tipo_movimentacao in ('peticao_inicial', 'acordo', 'cumprimento_sentenca', 'precatorio_rpv', 'pagamento')
    and pm.data_movimentacao >= p_since
    and pm.data_movimentacao < p_until
  group by ge.cloud_uuid
)
select coalesce(jsonb_agg(linha order by linha->>'nome'), '[]'::jsonb)
from (
  select jsonb_build_object(
    'manager_user_id', ge.cloud_uuid,
    'nome', ge.nome,
    'times', to_jsonb(ge.team_names),
    'configurado', (
      c.manager_user_id is not null
      and (array_length(c.activity_type_keys, 1) > 0 or array_length(c.focus_keywords, 1) > 0)
    ),
    'focus_label', c.focus_label,
    'min_percent', c.min_percent,
    -- A própria configuração volta junto: é o que preenche o formulário de
    -- edição sem uma segunda consulta.
    'activity_type_keys', to_jsonb(coalesce(c.activity_type_keys, '{}'::text[])),
    'focus_keywords', to_jsonb(coalesce(c.focus_keywords, '{}'::text[])),
    'concluidas', coalesce(t.concluidas, 0),
    'no_foco', coalesce(t.no_foco, 0),
    'resgatadas_pelo_texto', coalesce(t.resgatadas_pelo_texto, 0),
    'pct', case when c.manager_user_id is null or coalesce(t.concluidas, 0) = 0 then null
                else round(100.0 * coalesce(t.no_foco, 0) / t.concluidas)::int end,
    'atingiu', case
      when c.manager_user_id is null or coalesce(t.concluidas, 0) = 0 then null
      else (100.0 * coalesce(t.no_foco, 0) / t.concluidas) >= c.min_percent
    end,
    'fora', coalesce(f.fora, '[]'::jsonb),
    'dentro', coalesce(d.dentro, '[]'::jsonb),
    'track_process_exits', coalesce(c.track_process_exits, false),
    'exit_target', c.exit_target,
    'min_exit_percent', c.min_exit_percent,
    'processos_carteira', coalesce(cart.processos, 0),
    'entradas', coalesce(fl.entradas, 0),
    'saidas', coalesce(fl.saidas, 0),
    'saidas_por_acordo', coalesce(fl.por_acordo, 0),
    'saidas_por_execucao', coalesce(fl.por_execucao, 0),
    -- Quanto da carteira saiu no período (é o piso do gerente processual).
    'pct_saida_carteira', case when coalesce(cart.processos, 0) = 0 then null
      else round(100.0 * coalesce(fl.saidas, 0) / cart.processos)::int end,
    -- Vazão: saiu / entrou. Abaixo de 100% a fila cresce — "o que não sai
    -- impede de colocar mais para entrar".
    'vazao_pct', case when coalesce(fl.entradas, 0) = 0 then null
      else round(100.0 * coalesce(fl.saidas, 0) / fl.entradas)::int end,
    'atingiu_saida', case
      when c.min_exit_percent is null or coalesce(cart.processos, 0) = 0 then null
      else (100.0 * coalesce(fl.saidas, 0) / cart.processos) >= c.min_exit_percent
    end
  ) as linha
  from gestores ge
  left join cfg c on c.manager_user_id = ge.cloud_uuid
  left join acts_tot t on t.cloud_uuid = ge.cloud_uuid
  left join acts_fora f on f.cloud_uuid = ge.cloud_uuid
  left join acts_dentro d on d.cloud_uuid = ge.cloud_uuid
  left join carteira cart on cart.cloud_uuid = ge.cloud_uuid
  left join fluxo fl on fl.cloud_uuid = ge.cloud_uuid
) q;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Prévia da configuração — quanto mudaria ANTES de salvar
-- ---------------------------------------------------------------------------
-- Sem isso, escolher palavra-chave é às cegas: só depois de salvar é que se
-- veria o efeito na porcentagem.
CREATE OR REPLACE FUNCTION public.manager_focus_preview(
  p_manager_user_id uuid,
  p_types text[] DEFAULT '{}',
  p_keywords text[] DEFAULT '{}',
  p_since timestamptz DEFAULT (now() - interval '60 days')
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with ext as (
    select coalesce(
      (select m.ext_uuid from auth_uuid_mapping m where m.cloud_uuid = p_manager_user_id limit 1),
      p_manager_user_id
    ) as ext_uuid
  ),
  base as (
    select
      (la.activity_type = any(coalesce(p_types, '{}'::text[]))) as por_tipo,
      (
        coalesce(array_length(p_keywords, 1), 0) > 0
        and exists (
          select 1 from unnest(p_keywords) k
          where k <> ''
            and unaccent(lower(
                  coalesce(la.title, '') || ' ' ||
                  coalesce(la.description, '') || ' ' ||
                  coalesce(la.what_was_done, '') || ' ' ||
                  coalesce(la.next_steps, '') || ' ' ||
                  coalesce(la.current_status_notes, '') || ' ' ||
                  coalesce(la.process_title, '') || ' ' ||
                  coalesce(la.case_title, '')
                )) like '%' || unaccent(lower(k)) || '%'
        )
      ) as por_texto
    from lead_activities la
    cross join ext
    where la.assigned_to = ext.ext_uuid
      and la.deleted_at is null
      and la.status = 'concluida'
      and la.completed_at >= p_since
  )
  select jsonb_build_object(
    'concluidas', count(*)::int,
    'no_foco', count(*) filter (where por_tipo or por_texto)::int,
    'so_por_tipo', count(*) filter (where por_tipo)::int,
    'resgatadas_pelo_texto', count(*) filter (where por_texto and not por_tipo)::int,
    'pct', case when count(*) = 0 then null
                else round(100.0 * count(*) filter (where por_tipo or por_texto) / count(*))::int end
  )
  from base;
$function$;

GRANT EXECUTE ON FUNCTION public.manager_focus_preview(uuid, text[], text[], timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK — volta à v1 (foco só por tipo, sem entrada)
-- ---------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.manager_focus_preview(uuid, text[], text[], timestamptz);
-- ALTER TABLE public.manager_focus_targets
--   DROP COLUMN IF EXISTS focus_keywords,
--   DROP COLUMN IF EXISTS min_exit_percent;
-- e reaplicar a manager_focus_status da migration 20260817120000.
