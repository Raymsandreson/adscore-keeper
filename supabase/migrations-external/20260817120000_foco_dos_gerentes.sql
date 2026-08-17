-- =============================================================================
-- FOCO DOS GERENTES — cada gerente tem uma % mínima na sua área de foco.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Pedido do usuário (17/08/2026): "cada gerente tem q ter uma porcentagem na
-- sua área de foco; o de vendas deve ter pelo menos 80% em vendas; o processual
-- fazer os processos saírem, seja por acordo ou execução".
--
-- Duas leituras, porque as duas frases medem coisas diferentes:
--
--   1) ESFORÇO (vale para todo gerente) — % das atividades concluídas no
--      período cujo tipo está na lista da área de foco. É o "80% em vendas".
--      A lista de tipos é por gerente (activity_type_keys), não global: o
--      cadastro de tipos é texto livre e cada área usa os seus.
--
--   2) RESULTADO (só para quem tem carteira processual) — quantos processos
--      da carteira SAÍRAM no período, separando ACORDO de EXECUÇÃO
--      (cumprimento de sentença, precatório/RPV, pagamento). Foco do gerente
--      processual não é atividade encerrada, é processo que anda para a saída.
--
-- Medido em 17/08/2026 (60 dias, tipos escolhidos à mão para conferência):
--   João Manoel  96 concluídas / 75 no foco = 78%   (abaixo dos 80% pedidos)
--   Luana Barros 261 concluídas / 139 no foco = 53%
--   Carteira da Luana: 922 processos, 29 saídas em 90d (5 acordo, 24 execução)
--
-- Nada é apagado nem alterado nas tabelas existentes: só uma tabela nova de
-- configuração e duas funções de leitura. Rollback = os DROPs no fim do arquivo
-- (comentados).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Configuração por gerente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.manager_focus_targets (
  -- Cloud UUID, a mesma chave de team_managers.manager_user_id.
  manager_user_id uuid PRIMARY KEY,
  manager_name text,
  -- Rótulo da área de foco ("Vendas", "Processual", "Marketing"…). Texto livre
  -- de propósito: setor e time já existem e nenhum dos dois é a área de foco.
  focus_label text NOT NULL,
  -- Piso de esforço na área. 80 = o pedido do gerente de vendas.
  min_percent integer NOT NULL DEFAULT 80 CHECK (min_percent BETWEEN 0 AND 100),
  -- Tipos de atividade que contam como foco (lead_activities.activity_type).
  -- Vazio = ainda não configurado; a tela mostra "sem tipos escolhidos".
  activity_type_keys text[] NOT NULL DEFAULT '{}',
  -- Liga o bloco de saída de processo (acordo/execução) para este gerente.
  track_process_exits boolean NOT NULL DEFAULT false,
  -- Meta de processos que saem no período. NULL = acompanha sem meta.
  exit_target integer CHECK (exit_target IS NULL OR exit_target >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manager_focus_targets ENABLE ROW LEVEL SECURITY;

-- Mesma política das irmãs (team_managers, org_sectors): quem está logado no
-- Externo lê e escreve. Não há dado de cliente aqui — é configuração de gestão.
DROP POLICY IF EXISTS manager_focus_targets_authenticated_all ON public.manager_focus_targets;
CREATE POLICY manager_focus_targets_authenticated_all ON public.manager_focus_targets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.manager_focus_targets_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manager_focus_targets_touch ON public.manager_focus_targets;
CREATE TRIGGER trg_manager_focus_targets_touch
  BEFORE UPDATE ON public.manager_focus_targets
  FOR EACH ROW EXECUTE FUNCTION public.manager_focus_targets_touch();

-- ---------------------------------------------------------------------------
-- 2. Situação de cada gerente no período
-- ---------------------------------------------------------------------------
-- Devolve UMA LINHA POR GERENTE (quem é gestor de time ou de setor), esteja
-- configurado ou não — gerente sem configuração aparece com configurado=false,
-- senão ninguém descobre que falta configurar.
--
-- Os marcos de saída são os mesmos nomes de process_movements.tipo_movimentacao
-- da régua de 12 estações (ver docs/sistema/marcos-processuais-regras.md).
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
    -- assigned_to das atividades é UUID do Externo; a chave de gestor é Cloud.
    coalesce(
      (array_agg(m.ext_uuid) filter (where m.ext_uuid is not null))[1],
      g.cloud_uuid
    ) as ext_uuid,
    array_remove(array_agg(distinct g.team_id), null) as team_ids,
    array_remove(array_agg(distinct g.team_name), null) as team_names
  from (
    select manager_user_id as cloud_uuid, manager_name as nome,
           team_id, team_name
    from team_managers
    where manager_user_id is not null
    union all
    select manager_user_id, manager_name, null::uuid, null::text
    from org_sectors
    where manager_user_id is not null
  ) g
  left join auth_uuid_mapping m on m.cloud_uuid = g.cloud_uuid
  group by g.cloud_uuid
),
cfg as (
  select * from manager_focus_targets
),
-- Atividades concluídas do gerente no período, já rotuladas dentro/fora do foco.
acts as (
  select
    ge.cloud_uuid,
    la.activity_type,
    coalesce(at.label, la.activity_type) as label,
    (la.activity_type = any(coalesce(c.activity_type_keys, '{}'::text[]))) as no_foco,
    count(*)::int as n
  from gestores ge
  left join cfg c on c.manager_user_id = ge.cloud_uuid
  join lead_activities la
    on la.assigned_to = ge.ext_uuid
   and la.deleted_at is null
   and la.status = 'concluida'
   and la.completed_at >= p_since
   and la.completed_at < p_until
  left join activity_types at on at.key = la.activity_type
  group by ge.cloud_uuid, la.activity_type, coalesce(at.label, la.activity_type),
           (la.activity_type = any(coalesce(c.activity_type_keys, '{}'::text[])))
),
acts_tot as (
  select cloud_uuid,
    sum(n)::int as concluidas,
    sum(n) filter (where no_foco)::int as no_foco
  from acts group by cloud_uuid
),
-- Os tipos que mais consomem o gerente FORA da área — é onde o foco vaza.
acts_fora as (
  -- ordenação por (x->>'n')::int: como texto, '9' vem antes de '67'.
  select cloud_uuid, jsonb_agg(x order by (x->>'n')::int desc) as fora
  from (
    select cloud_uuid,
      jsonb_build_object('tipo', activity_type, 'label', label, 'n', n) as x,
      row_number() over (partition by cloud_uuid order by n desc) as rn
    from acts where not no_foco
  ) s
  where rn <= 8
  group by cloud_uuid
),
acts_dentro as (
  select cloud_uuid, jsonb_agg(
    jsonb_build_object('tipo', activity_type, 'label', label, 'n', n) order by n desc
  ) as dentro
  from acts where no_foco group by cloud_uuid
),
-- Carteira processual do gerente: processos dos times que ele gerencia.
-- vw_process_assignment é a MESMA atribuição das Metas Processuais por Time
-- (responsável processual do lead; sem ele, o POP mapeado ao time).
carteira as (
  select ge.cloud_uuid, count(distinct pa.process_id)::int as processos
  from gestores ge
  join vw_process_assignment pa on pa.team_id = any(ge.team_ids)
  group by ge.cloud_uuid
),
saidas as (
  select
    ge.cloud_uuid,
    count(distinct pm.process_id)::int as saidas,
    count(distinct pm.process_id) filter (where pm.tipo_movimentacao = 'acordo')::int as por_acordo,
    count(distinct pm.process_id) filter (
      where pm.tipo_movimentacao in ('cumprimento_sentenca', 'precatorio_rpv', 'pagamento')
    )::int as por_execucao
  from gestores ge
  join vw_process_assignment pa on pa.team_id = any(ge.team_ids)
  join process_movements_validos pm on pm.process_id = pa.process_id
  where pm.tipo_movimentacao in ('acordo', 'cumprimento_sentenca', 'precatorio_rpv', 'pagamento')
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
    'configurado', (c.manager_user_id is not null and array_length(c.activity_type_keys, 1) > 0),
    'focus_label', c.focus_label,
    'min_percent', c.min_percent,
    'concluidas', coalesce(t.concluidas, 0),
    'no_foco', coalesce(t.no_foco, 0),
    -- pct só existe com configuração: sem tipos escolhidos daria 0% e pareceria
    -- gerente disperso, quando é gerente não configurado.
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
    'processos_carteira', coalesce(cart.processos, 0),
    'saidas', coalesce(s.saidas, 0),
    'saidas_por_acordo', coalesce(s.por_acordo, 0),
    'saidas_por_execucao', coalesce(s.por_execucao, 0)
  ) as linha
  from gestores ge
  left join cfg c on c.manager_user_id = ge.cloud_uuid
  left join acts_tot t on t.cloud_uuid = ge.cloud_uuid
  left join acts_fora f on f.cloud_uuid = ge.cloud_uuid
  left join acts_dentro d on d.cloud_uuid = ge.cloud_uuid
  left join carteira cart on cart.cloud_uuid = ge.cloud_uuid
  left join saidas s on s.cloud_uuid = ge.cloud_uuid
) q;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Tipos que o gerente realmente usa — alimenta a escolha da área de foco
-- ---------------------------------------------------------------------------
-- Sem isto, escolher os tipos seria adivinhar numa lista de dezenas de tipos
-- livres. Aqui vem só o que a pessoa concluiu no período, com a contagem.
CREATE OR REPLACE FUNCTION public.manager_focus_activity_types(
  p_manager_user_id uuid,
  p_since timestamptz DEFAULT (now() - interval '90 days')
)
RETURNS TABLE(activity_type text, label text, n integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with ext as (
    select coalesce(
      (select m.ext_uuid from auth_uuid_mapping m where m.cloud_uuid = p_manager_user_id limit 1),
      p_manager_user_id
    ) as ext_uuid
  )
  select la.activity_type,
         coalesce(at.label, la.activity_type) as label,
         count(*)::int as n
  from lead_activities la
  cross join ext
  left join activity_types at on at.key = la.activity_type
  where la.assigned_to = ext.ext_uuid
    and la.deleted_at is null
    and la.status = 'concluida'
    and la.completed_at >= p_since
  group by la.activity_type, coalesce(at.label, la.activity_type)
  order by count(*) desc;
$function$;

GRANT EXECUTE ON FUNCTION public.manager_focus_status(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_focus_activity_types(uuid, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK (< 1 min, sem perda de dado de terceiro — a tabela é só configuração)
-- ---------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.manager_focus_activity_types(uuid, timestamptz);
-- DROP FUNCTION IF EXISTS public.manager_focus_status(timestamptz, timestamptz);
-- DROP TABLE IF EXISTS public.manager_focus_targets;
-- DROP FUNCTION IF EXISTS public.manager_focus_targets_touch();
