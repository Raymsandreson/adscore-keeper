-- =============================================================================
-- Percentual do processo = posição do marco atual na régua, não "marcos
-- cumpridos ÷ previstos"
--
-- Decisão do usuário (02/09/2026): "todos os marcos são obrigatórios, então
-- são 24; se fizeram 10 dos 24, então 41%". Um marco que não se aplica ao caso
-- (perícia, saneamento sem ato apartado) conta como superado quando o
-- processo já passou dele — nunca some do denominador.
--
-- Por que a conta antiga enganava (medido nos 1.290 do POP trabalhista em
-- 02/09/2026): 184 processos mostravam 80% ou mais sem ter transitado em
-- julgado, porque só contavam "marcos previstos" (obrigatório + eventual que
-- aconteceu). O dinheiro está depois do trânsito; 80% dizia "quase lá" para
-- quem ainda ia começar a execução. Média cai de 44,1% para 37,0%; 804 caem,
-- 31 sobem.
--
-- Nova conta, por POP:
--   posicionais = marcos do POP que não são de estado (atravessa_fases = false)
--   posição     = quantos posicionais têm ordem <= ordem do marco atual
--   percentual  = 100 se um marco terminal foi atingido;
--                 null se nenhum marco foi detectado (a ficha cai nos passos);
--                 senão round(posição * 100 / total)
--   estado      = atingido (detectado) | presumido (posicional ANTERIOR ao
--                 atual, eventual ou não — "passou por aqui") | pendente
--
-- As colunas `previstos`/`cumpridos` continuam existindo para não quebrar quem
-- lê a RPC, mas passam a significar TOTAL de posicionais e POSIÇÃO atual —
-- a ficha mostra "marco 12 de 27". Assinatura e colunas de retorno idênticas
-- (create or replace).
--
-- Rollback: reaplicar a função de
--   20260812191000_process_pop_marcos_e_fase_automatica.sql (seção 4).
-- =============================================================================

create or replace function public.pop_processo_regua(p_process_id uuid)
returns table (
  marco_chave     text,
  rotulo          text,
  ordem           smallint,
  stage_id        text,
  stage_nome      text,
  eventual        boolean,
  terminal        boolean,
  atravessa_fases boolean,
  estado          text,
  data_detectada  date,
  fonte           text,
  tem_prova_documental boolean,
  atual           boolean,
  percentual      numeric,
  previstos       integer,
  cumpridos       integer
)
language sql
stable
security definer
set search_path = public
as $$
  with proc as (
    select lp.id, lp.workflow_id::uuid as board_id
    from public.lead_processes lp
    where lp.id = p_process_id and lp.deleted_at is null and lp.workflow_id is not null
  ),
  stages as (
    select s->>'id' as stage_id, s->>'name' as stage_nome, ord
    from proc
    join public.kanban_boards b on b.id = proc.board_id,
         lateral jsonb_array_elements(coalesce(b.stages,'[]'::jsonb)) with ordinality t(s, ord)
  ),
  regua as (
    select pm.chave, pm.rotulo, pm.ordem, pm.stage_id, pm.eventual, pm.terminal, pm.atravessa_fases
    from proc join public.pop_marcos pm on pm.board_id = proc.board_id
  ),
  hits as (
    select h.marco_chave, h.data_detectada, h.fonte, h.tem_prova_documental
    from public.process_pop_marcos h where h.process_id = p_process_id
  ),
  atual as (
    select r.ordem
    from regua r join hits h on h.marco_chave = r.chave
    where not r.atravessa_fases
    order by r.ordem desc limit 1
  ),
  marcado as (
    select r.*, h.data_detectada, h.fonte, h.tem_prova_documental,
           case
             when h.marco_chave is not null then 'atingido'
             -- Posicional anterior ao marco atual: o processo passou por aqui,
             -- tenha o ato aparecido ou não (perícia que não houve, saneamento
             -- sem despacho apartado). É "superado", não "faltando".
             when not r.atravessa_fases
              and r.ordem < coalesce((select ordem from atual), 0) then 'presumido'
             else 'pendente'
           end as estado,
           (r.ordem = (select ordem from atual) and h.marco_chave is not null) as atual
    from regua r left join hits h on h.marco_chave = r.chave
  ),
  conta as (
    select
      count(*) filter (where not atravessa_fases)::integer as total,
      count(*) filter (
        where not atravessa_fases and ordem <= coalesce((select ordem from atual), -1)
      )::integer as posicao,
      bool_or(estado = 'atingido' and terminal) as encerrado
    from marcado
  )
  select
    m.chave, m.rotulo, m.ordem, m.stage_id,
    (select stage_nome from stages st where st.stage_id = m.stage_id) as stage_nome,
    m.eventual, m.terminal, m.atravessa_fases, m.estado, m.data_detectada, m.fonte,
    coalesce(m.tem_prova_documental, false),
    coalesce(m.atual, false),
    case
      when c.encerrado                        then 100::numeric
      when (select ordem from atual) is null  then null
      when c.total = 0                        then null
      else round(c.posicao * 100.0 / c.total, 0)
    end as percentual,
    c.total   as previstos,
    c.posicao as cumpridos
  from marcado m cross join conta c
  order by m.ordem;
$$;

comment on function public.pop_processo_regua(uuid) is
  'Régua de marcos do processo. Desde 02/09/2026 o percentual é a POSIÇÃO do marco atual entre os marcos posicionais do POP (previstos = total, cumpridos = posição); terminal atingido = 100; null = nenhum marco detectado (a ficha cai nos passos).';
