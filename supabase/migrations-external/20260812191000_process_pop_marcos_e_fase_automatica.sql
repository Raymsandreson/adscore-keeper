-- =============================================================================
-- A RÉGUA DE MARCOS CHEGA NA FICHA — e a fase do POP passa a andar sozinha
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- DECISÕES DO USUÁRIO (12/08/2026), literais:
--   "atualizar o pop automaticamente com base nas movimentações e documentos
--    extraídos delas"
--   "o percentual do processo atualizar só pelos marcos mesmo, não depender de
--    marcar os passos, pq isso pode ser falho e os marcos são pelas atualizações
--    automáticas do email e escavador"
--
-- E as três escolhas feitas na conversa:
--   1. % = marcos PREVISTOS DESTE processo. Marco eventual (perícia, execução,
--      RE) só entra no denominador se aconteceu. Mesma lógica das 12 estações
--      que já existe em src/lib/processStations.ts.
--   2. A fase automática MANDA, mas só AVANÇA. Nunca puxa um processo para trás
--      — sinal errado não desfaz trabalho de assessor.
--   3. O "% médio de fluxo do POP" das metas por time NÃO muda: continua
--      medindo passo marcado. São medidas diferentes e passam a ter nomes
--      diferentes na tela — fluxo mede TRABALHO da equipe, régua mede ANDAMENTO
--      do processo.
--
-- POR QUE MATERIALIZAR EM TABELA. vw_pop_marcos_regua custa ~300ms para
-- calcular a base inteira e não aceita filtro por processo com empurrão de
-- predicado (a agregação é global). Ficha abre com leitura por process_id
-- indexada; o recálculo é do cron da captura, junto de quem já traz as
-- movimentações.
--
-- O QUE NÃO MUDA: nenhum passo de checklist é marcado por aqui. A régua e o
-- checklist passam a ser coisas independentes — que é o pedido. "Atualizar
-- passos com IA" continua existindo para quem quiser marcar o passo a passo.
--
-- REVERSÃO (nesta ordem):
--   drop function if exists public.aplicar_fase_por_marco(uuid);
--   drop function if exists public.pop_processo_regua(uuid);
--   drop function if exists public.refresh_process_pop_marcos(uuid);
--   drop table if exists public.process_pop_fase_log;
--   drop table if exists public.process_pop_marcos;
--   update public.lead_processes set workflow_stage_id = null
--    where workflow_stage_origem = 'marco';        -- devolve o estado de hoje:
--                                                  -- 0 processos posicionados
--   alter table public.lead_processes
--     drop column workflow_stage_origem, drop column workflow_stage_marco,
--     drop column workflow_stage_em;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Onde o marco detectado fica gravado
-- ---------------------------------------------------------------------------
create table if not exists public.process_pop_marcos (
  process_id           uuid    not null references public.lead_processes(id) on delete cascade,
  board_id             uuid    not null,
  marco_chave          text    not null,
  ordem                smallint not null,
  rotulo               text    not null,
  stage_id             text,
  data_detectada       date    not null,
  -- 'movimento' | 'documento' | 'escavador_texto' | 'escavador_grau'
  fonte                text    not null,
  tem_prova_documental boolean not null default false,
  atualizado_em        timestamptz not null default now(),
  primary key (process_id, marco_chave)
);

create index if not exists idx_process_pop_marcos_processo
  on public.process_pop_marcos (process_id, ordem desc);

alter table public.process_pop_marcos enable row level security;
drop policy if exists process_pop_marcos_all on public.process_pop_marcos;
-- Sessão do Externo é anônima (signInAnonymously): policy por auth.uid()
-- devolveria zero linha em silêncio.
create policy process_pop_marcos_all on public.process_pop_marcos
  for all to authenticated using (true) with check (true);

comment on table public.process_pop_marcos is
  'Marcos detectados por processo, materializados de vw_pop_marcos_regua. Recalculado pelo cron da captura.';

-- ---------------------------------------------------------------------------
-- 2. Quem escreveu a fase, e por quê
-- ---------------------------------------------------------------------------
alter table public.lead_processes add column if not exists workflow_stage_origem text;
alter table public.lead_processes add column if not exists workflow_stage_marco  text;
alter table public.lead_processes add column if not exists workflow_stage_em     timestamptz;

comment on column public.lead_processes.workflow_stage_origem is
  'marco = escrita pela regua automatica; manual = alguem moveu na ficha. Manual so e ultrapassado por marco MAIS ADIANTADO.';

create table if not exists public.process_pop_fase_log (
  id             uuid primary key default gen_random_uuid(),
  process_id     uuid not null references public.lead_processes(id) on delete cascade,
  de_stage       text,
  para_stage     text not null,
  marco_chave    text,
  data_marco     date,
  fonte          text,
  criado_em      timestamptz not null default now()
);

create index if not exists idx_process_pop_fase_log_processo
  on public.process_pop_fase_log (process_id, criado_em desc);

alter table public.process_pop_fase_log enable row level security;
drop policy if exists process_pop_fase_log_all on public.process_pop_fase_log;
create policy process_pop_fase_log_all on public.process_pop_fase_log
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. Recalcular a régua
--
-- p_process_id null = base inteira. Com id = só aquele processo, para o botão
-- "atualizar agora" da ficha não pagar o custo da base toda.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_process_pop_marcos(p_process_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_linhas integer;
begin
  with alvo as (
    select lp.id as process_id,
           lp.workflow_id::uuid as board_id,
           regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g') as cnj_num
    from public.lead_processes lp
    where lp.deleted_at is null
      and lp.workflow_id is not null
      and length(regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g')) >= 15
      and (p_process_id is null or lp.id = p_process_id)
  ),
  novos as (
    select a.process_id, r.board_id, r.marco_chave, r.ordem, r.rotulo, r.stage_id,
           r.data_detectada, r.fonte_deteccao, r.tem_prova_documental
    from alvo a
    join public.vw_pop_marcos_regua r
      on r.cnj_num = a.cnj_num and r.board_id = a.board_id
  ),
  apagados as (
    delete from public.process_pop_marcos m
    using alvo a
    where m.process_id = a.process_id
    returning 1
  )
  insert into public.process_pop_marcos
    (process_id, board_id, marco_chave, ordem, rotulo, stage_id,
     data_detectada, fonte, tem_prova_documental, atualizado_em)
  select process_id, board_id, marco_chave, ordem, rotulo, stage_id,
         data_detectada, fonte_deteccao, tem_prova_documental, now()
  from novos
  on conflict (process_id, marco_chave) do update
    set ordem = excluded.ordem,
        rotulo = excluded.rotulo,
        stage_id = excluded.stage_id,
        data_detectada = excluded.data_detectada,
        fonte = excluded.fonte,
        tem_prova_documental = excluded.tem_prova_documental,
        atualizado_em = now();

  get diagnostics v_linhas = row_count;
  return v_linhas;
end $$;

grant execute on function public.refresh_process_pop_marcos(uuid) to authenticated, anon, service_role;

comment on function public.refresh_process_pop_marcos(uuid) is
  'Materializa vw_pop_marcos_regua em process_pop_marcos. Sem argumento, recalcula a base inteira.';

-- ---------------------------------------------------------------------------
-- 4. A régua de um processo, do jeito que a ficha precisa ler
--
-- Devolve TODA a régua prevista — não só o que foi detectado — porque a ficha
-- desenha a linha inteira e pinta o que já passou.
--
-- Três estados por marco:
--   atingido  = detectado por alguma fonte
--   presumido = não detectado, mas obrigatório e anterior ao marco atual.
--               Existe por causa da janela de 20 movimentações do Escavador:
--               processo que está no TST passou pela sentença mesmo que a
--               sentença não esteja mais na janela. Sem isso o percentual
--               oscilaria para baixo conforme a movimentação velha sai.
--   pendente  = o resto
--
-- Marco com atravessa_fases (acordo, suspensão) fica de fora do cálculo: é
-- estado, não posição — regra fechada em 08/08/2026.
-- ---------------------------------------------------------------------------
create or replace function public.pop_processo_regua(p_process_id uuid)
returns table (
  marco_chave     text,
  rotulo          text,
  ordem           smallint,
  stage_id        text,
  stage_nome      text,
  eventual        boolean,
  terminal        boolean,
  estado          text,     -- atingido | presumido | pendente
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
             when not r.eventual and not r.atravessa_fases
              and r.ordem < coalesce((select ordem from atual), 0) then 'presumido'
             else 'pendente'
           end as estado,
           (r.ordem = (select ordem from atual) and h.marco_chave is not null) as atual
    from regua r left join hits h on h.marco_chave = r.chave
  ),
  conta as (
    -- Previsto = obrigatório, ou eventual que aconteceu. Estado nunca conta.
    select
      count(*) filter (
        where not atravessa_fases and (not eventual or estado = 'atingido')
      )::integer as previstos,
      count(*) filter (
        where not atravessa_fases and (not eventual or estado = 'atingido')
          and estado in ('atingido','presumido')
      )::integer as cumpridos,
      bool_or(estado = 'atingido' and terminal) as encerrado
    from marcado
  )
  select
    m.chave, m.rotulo, m.ordem, m.stage_id,
    (select stage_nome from stages st where st.stage_id = m.stage_id) as stage_nome,
    m.eventual, m.terminal, m.estado, m.data_detectada, m.fonte,
    coalesce(m.tem_prova_documental, false),
    coalesce(m.atual, false),
    case
      when c.encerrado                 then 100::numeric
      when c.previstos = 0             then null
      else round(c.cumpridos * 100.0 / c.previstos, 0)
    end as percentual,
    c.previstos, c.cumpridos
  from marcado m cross join conta c
  order by m.ordem;
$$;

grant execute on function public.pop_processo_regua(uuid) to authenticated, anon, service_role;

comment on function public.pop_processo_regua(uuid) is
  'Regua de marcos do processo com estado por marco e percentual de andamento. Percentual null = nenhum marco detectado; a ficha cai no calculo por passos.';

-- ---------------------------------------------------------------------------
-- 5. A fase anda sozinha
--
-- Só avança: compara a POSIÇÃO da fase do marco com a posição da fase atual nas
-- stages do board. Fase manual mais adiantada que o marco fica de pé.
--
-- Por que não escreve lead_stage_history: aquele histórico é por LEAD, e um
-- lead pode ter vários processos em fases diferentes — a última linha de um
-- processo passaria por cima da do outro. A auditoria da régua vive em
-- process_pop_fase_log.
-- ---------------------------------------------------------------------------
-- `#variable_conflict use_column` e os apelidos curtos (pid/de/para/chave) não
-- são estilo: os nomes das colunas de RETORNO (process_id, de_stage, ...) são
-- variáveis PL/pgSQL dentro do corpo e colidiam com as colunas homônimas das
-- CTEs — "column reference process_id is ambiguous" no primeiro tick.
create or replace function public.aplicar_fase_por_marco(p_process_id uuid default null)
returns table (process_id uuid, de_stage text, para_stage text, marco_chave text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with alvo as (
    select lp.id, lp.workflow_id::uuid as board_id, lp.workflow_stage_id
    from public.lead_processes lp
    where lp.deleted_at is null
      and lp.workflow_id is not null
      and (p_process_id is null or lp.id = p_process_id)
  ),
  pos as (
    select a.id as pid, s->>'id' as stage_id, ord
    from alvo a
    join public.kanban_boards b on b.id = a.board_id,
         lateral jsonb_array_elements(coalesce(b.stages,'[]'::jsonb)) with ordinality t(s, ord)
  ),
  marco_atual as (
    select distinct on (m.process_id)
           m.process_id as pid, m.marco_chave as chave, m.stage_id, m.data_detectada, m.fonte
    from public.process_pop_marcos m
    join public.pop_marcos pm
      on pm.board_id = m.board_id and pm.chave = m.marco_chave
    join alvo a on a.id = m.process_id
    where not pm.atravessa_fases and m.stage_id is not null
    order by m.process_id, m.ordem desc, m.data_detectada desc
  ),
  mudanca as (
    select a.id as pid, a.workflow_stage_id as de, ma.stage_id as para,
           ma.chave, ma.data_detectada, ma.fonte
    from alvo a
    join marco_atual ma on ma.pid = a.id
    left join pos atual on atual.pid = a.id and atual.stage_id = a.workflow_stage_id
    join pos destino    on destino.pid = a.id and destino.stage_id = ma.stage_id
    where a.workflow_stage_id is distinct from ma.stage_id
      and destino.ord > coalesce(atual.ord, 0)   -- só avança
  ),
  gravado as (
    update public.lead_processes lp
       set workflow_stage_id     = m.para,
           workflow_stage_origem = 'marco',
           workflow_stage_marco  = m.chave,
           workflow_stage_em     = now()
      from mudanca m
     where lp.id = m.pid
    returning lp.id as pid, m.de, m.para, m.chave, m.data_detectada, m.fonte
  ),
  logado as (
    insert into public.process_pop_fase_log
      (process_id, de_stage, para_stage, marco_chave, data_marco, fonte)
    select g.pid, g.de, g.para, g.chave, g.data_detectada, g.fonte
    from gravado g
    returning process_id as pid, de_stage as de, para_stage as para, marco_chave as chave
  )
  select l.pid, l.de, l.para, l.chave from logado l;
end $$;

grant execute on function public.aplicar_fase_por_marco(uuid) to authenticated, anon, service_role;

comment on function public.aplicar_fase_por_marco(uuid) is
  'Move a fase do POP para a fase do marco mais adiantado. So avanca; fase manual mais adiantada fica de pe.';

-- ---------------------------------------------------------------------------
-- 6. O tick: recalcular e reposicionar, nesta ordem
--
-- Roda DENTRO do banco, chamado por pg_cron sem HTTP. Isso não é detalhe: os
-- crons que passam por net.http_post não leem a resposta, e um 404 de URL
-- errada ficou duas semanas invisível nesta base (jul/2026). Função SQL local
-- falha no log do pg_cron, que é consultável em cron.job_run_details.
--
-- Cadência: 30 min, atrás dos crons de captura (jm-datajud-rotina */30 e
-- jm-esc-rotina */20). Marco novo aparece na ficha em até meia hora depois de
-- a movimentação entrar.
-- ---------------------------------------------------------------------------
create or replace function public.pop_marcos_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marcos integer;
  v_fases  integer;
begin
  v_marcos := public.refresh_process_pop_marcos();
  select count(*) into v_fases from public.aplicar_fase_por_marco();
  return jsonb_build_object('marcos', v_marcos, 'fases_movidas', v_fases, 'em', now());
end $$;

grant execute on function public.pop_marcos_tick() to authenticated, anon, service_role;

comment on function public.pop_marcos_tick() is
  'Recalcula os marcos de todos os processos e reposiciona as fases. Chamado pelo cron pop-marcos-tick.';

select cron.unschedule('pop-marcos-tick')
 where exists (select 1 from cron.job where jobname = 'pop-marcos-tick');

select cron.schedule('pop-marcos-tick', '15,45 * * * *', $cron$ select public.pop_marcos_tick(); $cron$);
