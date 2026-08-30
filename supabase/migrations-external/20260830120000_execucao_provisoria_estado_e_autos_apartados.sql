-- =============================================================================
-- EXECUÇÃO PROVISÓRIA: ESTADO NA RÉGUA + AUTOS APARTADOS VINCULADOS
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Pedido do usuário (30/08/2026), sobre a régua do POP trabalhista:
--   "a execução provisória pode ser a qualquer momento depois da sentença
--    desde que não tenha efeito suspensivo — como encaixar isso nos marcos";
--   e, na sequência: "ela corre em autos apartados, com rito próprio, mas
--    afeta o principal (e vice-versa: às vezes suspende o principal, às vezes
--    já libera o dinheiro ou vira acordo dentro da provisória)".
--
-- -----------------------------------------------------------------------------
-- DECISÃO 1 — EXECUÇÃO PROVISÓRIA É ESTADO, NÃO FASE
-- -----------------------------------------------------------------------------
-- Regra da casa: "marco pela etimologia da palavra não pode ser um estado".
-- Provisória não é um degrau entre outros dois — ela CONVIVE com o recurso que
-- está correndo lá em cima. Vira badge (atravessa_fases = true), como acordo,
-- suspensão e inadimplência. Fase nenhuma se move por causa dela.
--
-- Consequência boa e deliberada: principal suspenso + provisória correndo deixa
-- de parecer processo parado. São dois badges contando a mesma história.
--
-- -----------------------------------------------------------------------------
-- DECISÃO 2 — TRÂNSITO EM JULGADO DEIXA DE SER PRESUMÍVEL
-- -----------------------------------------------------------------------------
-- MEDIDO EM 30/08/2026 no POP trabalhista (0bcd8be6), com a regra final:
--   126 processos com marco de EXECUÇÃO detectado; 56 com trânsito, **70 sem**
--   (39 por `execucao_iniciada`, 32 por `alvara_expedido`);
--   **122 processos** têm marco atual adiante do trânsito SEM trânsito
--   detectado — são os que hoje exibem "Trânsito em julgado (presumido)".
-- Como o marco atual é o de maior ordem e todo obrigatório anterior a ele vira
-- "presumido", esses 122 carimbavam um trânsito que ninguém provou. Nos 70 da
-- execução ele nem ocorreu; nos outros 52 (arquivamento/acordo adiante) falta
-- capturar a certidão — nos dois casos "falta" é a verdade, "presumido" não.
--
-- O "presumido" foi criado para movimentação que saiu da janela de 20 do
-- `lead_processes.movimentacoes`, não para etapa que juridicamente não
-- aconteceu. A coluna `presumivel` separa as duas coisas: só o trânsito nasce
-- com false. Todos os outros obrigatórios seguem presumíveis como hoje.
--
-- Efeito no percentual: cai um degrau nesses 83 — correto, eles não transitaram.
--
-- -----------------------------------------------------------------------------
-- DECISÃO 3 — VINCULAR OS AUTOS APARTADOS, NUNCA FUNDIR
-- -----------------------------------------------------------------------------
-- Medições que sustentam a escolha (30/08/2026):
--   - `processos_relacionados` (campo do Escavador) está preenchido em **1 de
--     1290** fichas do POP: não dá para depender dele;
--   - `classe` existe em **94 de 1290**, mas quando existe é determinística
--     ("Cumprimento Provisório de Sentença" — 3 fichas hoje);
--   - texto não detecta: "provisóri" aparece em **3** linhas de jm_movimentos e
--     **4** de process_updates na base inteira. Detecção por texto aqui seria
--     promessa vazia;
--   - os 3 apartados existentes têm **0 linhas** em jm_valores/jm_decisoes/
--     jm_pagamentos: o dinheiro NÃO está duplicado. O que estava errado é a
--     CONTAGEM de processos e a FASE (o apartado 0001308-57.2025.5.22.0002
--     entra na carteira como processo de 2025 em "Ajuizamento" enquanto o
--     principal 0000319-90.2021.5.22.0002 carrega os 8 valores e o trânsito).
--
-- Por isso: apartado continua sendo ficha própria (CNJ próprio = captura
-- própria; push, DataJud e Escavador consultam por CNJ). O que entra é o
-- VÍNCULO explícito mãe/filho, confirmado por gente — nunca automático.
-- `vw_pop_vinculos_sugeridos` só SUGERE (mesmo lead + mesma unidade judiciária
-- J.TR.OOOO do CNJ, mãe mais antiga): ensaiada em 30/08/2026 devolve **2 pares
-- de confiança alta** (a classe diz "Cumprimento Provisório") e **95 de
-- confiança média** para revisão. Vínculo errado misturaria dois processos de
-- verdade, então a view é detector, não filtro — nada se vincula sozinho.
--
-- ROLLOUT SEM SUSTO: no dia da aplicação nenhum vínculo existe, então a
-- carteira sai IDÊNTICA (a exclusão do apartado só age sobre linha vinculada).
-- O que muda de imediato é só o badge e o fim da presunção do trânsito.
--
-- -----------------------------------------------------------------------------
-- O QUE NÃO MUDA (de propósito)
-- -----------------------------------------------------------------------------
--   - A ordem das estações e o trânsito como FASE obrigatória (decisão de
--     27/08/2026, mantida): provisória vira badge justamente para não mexer nisso.
--   - Os marcos do FILHO não entram na linha do trem da MÃE. Importar as
--     estações do apartado moveria a fase e o percentual do principal — é
--     exatamente a armadilha "estado virando fase" que custou 61 processos em
--     julho. O filho aparece pelo badge (que abre a ficha dele) e pelo bloco
--     "Autos apartados" da ficha, com a régua dele intacta.
--   - Boards cíveis e previdenciários: o marco não é criado neles nesta rodada.
--     O cumprimento provisório do art. 520 do CPC existe, mas os 3 apartados
--     reais desta base estão todos no POP trabalhista. Entram quando houver
--     caso — mesma política dos degraus do STF em 27/08.
--   - Nenhuma linha de valor, decisão ou pagamento é tocada.
--
-- -----------------------------------------------------------------------------
-- REVERSÃO (nesta ordem)
-- -----------------------------------------------------------------------------
--   drop view if exists public.vw_pop_vinculos_sugeridos;
--   delete from public.pop_marcos
--    where chave = 'execucao_provisoria'
--      and board_id = '0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'::uuid;
--   alter table public.pop_marcos drop column presumivel;
--   alter table public.process_pop_marcos drop column origem_cnj;
--   alter table public.lead_processes drop column processo_principal_id,
--                                     drop column vinculo_tipo;
--   -- reaplicar as definições anteriores, na íntegra:
--   --   refresh_process_pop_marcos + pop_processo_regua ->
--   --     20260827130000_stf_liquidacao_e_rotulos_por_tribunal.sql
--   --     (refresh: 20260812191000_process_pop_marcos_e_fase_automatica.sql)
--   --   pop_carteira_marcos -> 20260819180000_pop_carteira_marcos_valor_tab_aux.sql
--   select public.refresh_process_pop_marcos();
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas novas — todas aditivas e nullable/default, nada destrutivo
-- ---------------------------------------------------------------------------
alter table public.pop_marcos
  add column if not exists presumivel boolean not null default true;

comment on column public.pop_marcos.presumivel is
  'Marco obrigatório anterior ao atual pode ser dado como cumprido sem prova? '
  'true = sim (movimentacao velha saiu da janela de 20). false = so com deteccao '
  'propria: e o caso do transito em julgado, que na execucao provisoria ainda '
  'nao ocorreu.';

update public.pop_marcos
   set presumivel = false, updated_at = now()
 where chave = 'transito_julgado' and presumivel;

alter table public.process_pop_marcos
  add column if not exists origem_cnj text;

comment on column public.process_pop_marcos.origem_cnj is
  'CNJ dos autos APARTADOS que originaram este marco. Null = o fato aconteceu '
  'nos proprios autos. E o que impede confundir penhora no apartado com penhora '
  'no principal.';

alter table public.lead_processes
  add column if not exists processo_principal_id uuid
    references public.lead_processes(id) on delete set null,
  add column if not exists vinculo_tipo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lead_processes_vinculo_tipo_check') then
    alter table public.lead_processes
      add constraint lead_processes_vinculo_tipo_check
      check (vinculo_tipo is null or vinculo_tipo in
             ('execucao_provisoria','carta_sentenca','incidente','conexo'));
  end if;
end $$;

-- Vínculo só existe aos pares: tipo sem mãe (ou mãe sem tipo) é linha meio
-- preenchida que ninguém sabe ler depois.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lead_processes_vinculo_par_check') then
    alter table public.lead_processes
      add constraint lead_processes_vinculo_par_check
      check ((processo_principal_id is null) = (vinculo_tipo is null));
  end if;
end $$;

create index if not exists idx_lead_processes_principal
  on public.lead_processes (processo_principal_id)
  where processo_principal_id is not null;

comment on column public.lead_processes.processo_principal_id is
  'Autos PRINCIPAIS deste processo, quando esta ficha e um apartado (execucao '
  'provisoria, carta de sentenca, incidente). Preenchido por confirmacao humana '
  '— vw_pop_vinculos_sugeridos apenas sugere.';

-- ---------------------------------------------------------------------------
-- 2. O marco-estado no POP trabalhista em uso
--
-- ordem 30: a faixa dos estados (acordo 28, suspensão 29, inadimplência 32,
-- recuperação 33, sem bens 34) tem 30 e 31 livres. stage_id null porque estado
-- não move fase. EM_EXECUCAO pelo vocabulário v4: execução recém-aberta já é
-- EM_EXECUCAO, o gatilho é ir buscar à força, não o dinheiro aparecer.
-- ---------------------------------------------------------------------------
insert into public.pop_marcos
  (board_id, chave, rotulo, ordem, stage_id, terminal, eventual, atravessa_fases,
   presumivel, estagio_financeiro_sugerido, descricao)
values
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'::uuid, 'execucao_provisoria',
   'Execução provisória', 30, null, false, true, true, true, 'EM_EXECUCAO',
   'Execucao que corre sem transito em julgado (art. 899 da CLT: recurso so tem '
   'efeito devolutivo). Estado, nao fase — convive com o recurso em curso. '
   'Detectado de duas portas: execucao nos proprios autos sem transito, ou '
   'autos apartados vinculados como execucao provisoria/carta de sentenca.')
on conflict (board_id, chave) do nothing;

-- ---------------------------------------------------------------------------
-- 3. A detecção — derivada dentro do refresh, nunca digitada
--
-- POR QUE AQUI E NÃO NUMA VIEW: `refresh_process_pop_marcos` APAGA e reinsere
-- os marcos do lote na mesma instrução. Uma view que lesse `process_pop_marcos`
-- enxergaria o estado ANTERIOR ao delete e o estado derivado ficaria sempre um
-- tick atrasado. Derivar de `novos` (o lote recém-calculado) é exato.
--
-- As duas portas:
--   A. mesmos autos  — marco DE EXECUÇÃO detectado e NENHUM `transito_julgado`.
--      "De execução" = ordem >= a de `execucao_iniciada`, E não-estado, E
--      não-terminal (ver `marcos_de_execucao` abaixo). Derivar da régua, e não
--      de uma lista de chaves, mantém a regra válida em qualquer board.
--   B. autos apartados — filho vinculado com vinculo_tipo de execução. A data é
--      a da execução do filho e, na falta dela, a do primeiro marco do filho
--      (o apartado nasce para executar).
--
-- O badge some sozinho quando o trânsito é capturado: deixou de ser provisória.
-- Nenhuma flag manual para limpar depois.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_process_pop_marcos(p_process_id uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_linhas integer;
begin
  with alvo as (
    select lp.id as process_id,
           lp.workflow_id::uuid as board_id,
           regexp_replace(coalesce(lp.process_number, ''), '[^0-9]', '', 'g') as cnj_num
    from public.lead_processes lp
    where lp.deleted_at is null
      and lp.workflow_id is not null
      and (
        length(regexp_replace(coalesce(lp.process_number, ''), '[^0-9]', '', 'g')) >= 15
        or coalesce(lp.protocolo_administrativo, '') <> ''
        -- quem ja tem marco entra pelo marco: sem isso o DELETE nao o alcanca
        -- e o marco de uma fonte que sumiu nunca mais sai.
        or exists (select 1 from public.process_pop_marcos m where m.process_id = lp.id)
      )
      and (
        p_process_id is null
        or lp.id = p_process_id
        -- refrescar o filho tem que refrescar a MAE: o badge dela depende dele.
        or lp.id = (select f.processo_principal_id from public.lead_processes f
                     where f.id = p_process_id)
        or lp.processo_principal_id = p_process_id
      )
  ),
  candidatos as (
    select a.process_id, r.board_id, r.marco_chave, r.ordem, r.rotulo, r.stage_id,
           r.data_detectada, r.fonte_deteccao, r.tem_prova_documental, 1 as prioridade
    from alvo a
    join public.vw_pop_marcos_regua r
      on r.cnj_num = a.cnj_num and r.board_id = a.board_id
    where length(a.cnj_num) >= 15
    union all
    select e.process_id, e.board_id, e.marco_chave, e.ordem, e.rotulo, e.stage_id,
           e.data_detectada, e.fonte_deteccao, false, 2
    from public.vw_pop_marcos_email e
    join alvo a on a.process_id = e.process_id
  ),
  novos as (
    select distinct on (process_id, marco_chave)
           process_id, board_id, marco_chave, ordem, rotulo, stage_id,
           data_detectada, fonte_deteccao, tem_prova_documental
    from candidatos
    order by process_id, marco_chave, prioridade, data_detectada
  ),
  -- Marcos de quem NAO esta no lote vem da tabela; quem esta, vem do lote.
  -- E o que permite refrescar so a mae e ainda enxergar o filho (e vice-versa).
  marcos_conhecidos as (
    select n.process_id, n.board_id, n.marco_chave, n.ordem, n.data_detectada
    from novos n
    union all
    select m.process_id, m.board_id, m.marco_chave, m.ordem, m.data_detectada
    from public.process_pop_marcos m
    where not exists (select 1 from alvo a where a.process_id = m.process_id)
  ),
  -- Os marcos que significam "a máquina de receber começou". Ordem sozinha NÃO
  -- serve, e o ensaio de 30/08/2026 provou: `ordem >= execucao_iniciada` varria
  -- junto arquivamento_definitivo (27, terminal — 68 processos), acordo (28) e
  -- suspensão (29), que são ESTADO e têm a maior ordem da régua. Por isso o
  -- filtro é ordem + não-estado + não-terminal. Liquidação (21) fica de fora:
  -- vem antes da execução.
  marcos_de_execucao as (
    select pm.board_id, pm.chave
    from public.pop_marcos pm
    where not pm.atravessa_fases
      and not pm.terminal
      and pm.ordem >= (
        select ex.ordem from public.pop_marcos ex
        where ex.board_id = pm.board_id and ex.chave = 'execucao_iniciada'
      )
  ),
  -- PORTA A: o que os proprios autos dizem.
  base_mae as (
    select a.process_id, a.board_id,
           coalesce(bool_or(mc.marco_chave = 'transito_julgado'), false) as tem_transito,
           coalesce(bool_or(me.chave is not null), false)                as tem_execucao,
           min(mc.data_detectada) filter (where me.chave is not null)    as execucao_em
    from alvo a
    left join marcos_conhecidos mc on mc.process_id = a.process_id
    left join marcos_de_execucao me
      on me.board_id = mc.board_id and me.chave = mc.marco_chave
    group by a.process_id, a.board_id
  ),
  -- PORTA B: o que os autos apartados dizem.
  filhos as (
    select f.processo_principal_id as mae_id,
           string_agg(distinct f.process_number, ', ' order by f.process_number) as origem_cnj,
           min(coalesce(fx.execucao_em, fx.primeiro_em)) as data_em
    from public.lead_processes f
    left join lateral (
      select min(mc.data_detectada) filter (where me.chave is not null) as execucao_em,
             min(mc.data_detectada)                                     as primeiro_em
      from marcos_conhecidos mc
      left join marcos_de_execucao me
        on me.board_id = mc.board_id and me.chave = mc.marco_chave
      where mc.process_id = f.id
    ) fx on true
    where f.deleted_at is null
      and f.processo_principal_id is not null
      and f.vinculo_tipo in ('execucao_provisoria', 'carta_sentenca')
    group by f.processo_principal_id
  ),
  derivado as (
    select b.process_id, b.board_id,
           'execucao_provisoria'::text as marco_chave,
           pm.ordem, pm.rotulo, pm.stage_id,
           coalesce(b.execucao_em, fl.data_em) as data_detectada,
           case when b.tem_execucao then 'derivado_mesmos_autos'
                else 'derivado_apartado' end   as fonte_deteccao,
           false as tem_prova_documental,
           fl.origem_cnj
    from base_mae b
    join public.pop_marcos pm
      on pm.board_id = b.board_id and pm.chave = 'execucao_provisoria'
    left join filhos fl on fl.mae_id = b.process_id
    where not b.tem_transito
      and (b.tem_execucao or fl.mae_id is not null)
      and coalesce(b.execucao_em, fl.data_em) is not null
  ),
  apagados as (
    delete from public.process_pop_marcos m
    using alvo a
    where m.process_id = a.process_id
    returning 1
  )
  insert into public.process_pop_marcos
    (process_id, board_id, marco_chave, ordem, rotulo, stage_id,
     data_detectada, fonte, tem_prova_documental, origem_cnj, atualizado_em)
  select process_id, board_id, marco_chave, ordem, rotulo, stage_id,
         data_detectada, fonte_deteccao, tem_prova_documental, null, now()
  from novos
  union all
  select process_id, board_id, marco_chave, ordem, rotulo, stage_id,
         data_detectada, fonte_deteccao, tem_prova_documental, origem_cnj, now()
  from derivado
  on conflict (process_id, marco_chave) do update
    set ordem = excluded.ordem,
        rotulo = excluded.rotulo,
        stage_id = excluded.stage_id,
        data_detectada = excluded.data_detectada,
        fonte = excluded.fonte,
        tem_prova_documental = excluded.tem_prova_documental,
        origem_cnj = excluded.origem_cnj,
        atualizado_em = now();

  get diagnostics v_linhas = row_count;
  return v_linhas;
end $function$;

comment on function public.refresh_process_pop_marcos(uuid) is
  'Materializa os marcos do processo a partir das views de deteccao e deriva o '
  'estado execucao_provisoria (execucao sem transito nos proprios autos, ou '
  'autos apartados vinculados). Refrescar um filho refresca a mae junto.';

-- ---------------------------------------------------------------------------
-- 4. pop_processo_regua devolve presumivel e origem_cnj
--
-- `presumido` passa a exigir presumivel = true: o trânsito volta a ser "falta"
-- enquanto a execução provisória corre, em vez de fingir prova.
-- ---------------------------------------------------------------------------
drop function if exists public.pop_processo_regua(uuid);

create function public.pop_processo_regua(p_process_id uuid)
returns table (
  marco_chave     text,
  rotulo          text,
  ordem           smallint,
  stage_id        text,
  stage_nome      text,
  eventual        boolean,
  terminal        boolean,
  atravessa_fases boolean,
  presumivel      boolean,
  estado          text,     -- atingido | presumido | pendente
  data_detectada  date,
  fonte           text,
  origem_cnj      text,
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
    select pm.chave, pm.rotulo, pm.ordem, pm.stage_id, pm.eventual, pm.terminal,
           pm.atravessa_fases, pm.presumivel
    from proc join public.pop_marcos pm on pm.board_id = proc.board_id
  ),
  hits as (
    select h.marco_chave, h.data_detectada, h.fonte, h.tem_prova_documental, h.origem_cnj
    from public.process_pop_marcos h where h.process_id = p_process_id
  ),
  atual as (
    select r.ordem
    from regua r join hits h on h.marco_chave = r.chave
    where not r.atravessa_fases
    order by r.ordem desc limit 1
  ),
  marcado as (
    select r.*, h.data_detectada, h.fonte, h.origem_cnj, h.tem_prova_documental,
           case
             when h.marco_chave is not null then 'atingido'
             when not r.eventual and not r.atravessa_fases and r.presumivel
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
    m.eventual, m.terminal, m.atravessa_fases, m.presumivel, m.estado,
    m.data_detectada, m.fonte, m.origem_cnj,
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
  'Regua de marcos do processo com estado por marco, atravessa_fases, presumivel '
  'e origem_cnj (autos apartados). Percentual null = nenhum marco detectado; a '
  'ficha cai no calculo por passos.';

-- ---------------------------------------------------------------------------
-- 5. A ficha do apartado, para a tela montar o bloco "Autos apartados"
-- ---------------------------------------------------------------------------
create or replace function public.pop_processo_apartados(p_process_id uuid)
returns table (
  process_id      uuid,
  process_number  text,
  titulo          text,
  classe          text,
  vinculo_tipo    text,
  marco_atual     text,
  marco_em        date,
  marcos          integer
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.process_number, f.title, f.classe, f.vinculo_tipo,
         ma.rotulo, ma.data_detectada,
         (select count(*)::integer from public.process_pop_marcos m where m.process_id = f.id)
  from public.lead_processes f
  left join lateral (
    select m.rotulo, m.data_detectada
    from public.process_pop_marcos m
    join public.pop_marcos pm on pm.board_id = m.board_id and pm.chave = m.marco_chave
    where m.process_id = f.id and not pm.atravessa_fases
    order by m.ordem desc, m.data_detectada desc
    limit 1
  ) ma on true
  where f.deleted_at is null and f.processo_principal_id = p_process_id
  order by f.process_number;
$$;

grant execute on function public.pop_processo_apartados(uuid) to authenticated, anon, service_role;

comment on function public.pop_processo_apartados(uuid) is
  'Autos apartados vinculados a este processo, com a fase atual de cada um. A '
  'regua do filho NAO entra na linha do trem da mae — moveria a fase dela.';

-- ---------------------------------------------------------------------------
-- 6. Sugestão de vínculo — detector, não filtro
--
-- Mesmo lead + mesma unidade judiciária (J.TR.OOOO, posições 14-20 do CNJ) +
-- sequencial diferente. A mãe é a mais antiga (ano, sequencial). Confiança alta
-- quando a classe diz o que é; média quando é só a coincidência de unidade —
-- e média NUNCA deve ser vinculada sem alguém olhar: dois processos do mesmo
-- cliente na mesma vara podem ser duas ações de verdade.
-- ---------------------------------------------------------------------------
create or replace view public.vw_pop_vinculos_sugeridos as
with p as (
  select lp.id, lp.lead_id, lp.process_number, lp.title, lp.classe, lp.workflow_id,
         lp.processo_principal_id,
         regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g') as cnj_num
  from public.lead_processes lp
  where lp.deleted_at is null
),
q as (
  select p.*,
         substring(cnj_num from 1 for 7)  as sequencial,
         substring(cnj_num from 10 for 4) as ano,
         substring(cnj_num from 14 for 7) as unidade
  from p
  where length(cnj_num) = 20
)
select
  filho.id             as filho_id,
  filho.process_number as filho_cnj,
  filho.title          as filho_titulo,
  filho.classe         as filho_classe,
  filho.workflow_id    as filho_board_id,
  mae.id               as mae_id,
  mae.process_number   as mae_cnj,
  mae.title            as mae_titulo,
  filho.lead_id,
  case when filho.classe ~* 'provis|carta de senten' then 'execucao_provisoria'
       else 'conexo' end as vinculo_sugerido,
  case when filho.classe ~* 'provis|carta de senten' then 'alta'
       else 'media' end  as confianca
from q filho
join q mae
  on mae.lead_id = filho.lead_id
 and mae.id <> filho.id
 and mae.unidade = filho.unidade
 and mae.sequencial <> filho.sequencial
 and (mae.ano, mae.sequencial) < (filho.ano, filho.sequencial)
where filho.processo_principal_id is null;

grant select on public.vw_pop_vinculos_sugeridos to authenticated, anon, service_role;

comment on view public.vw_pop_vinculos_sugeridos is
  'Pares (apartado, principal) CANDIDATOS: mesmo lead, mesma unidade judiciaria, '
  'sequencial diferente, mae mais antiga. Sugestao para humano confirmar — '
  'vincular sozinho misturaria processos distintos.';

-- ---------------------------------------------------------------------------
-- 7. Carteira: o apartado para de contar como processo, e promove a mãe
--
-- Duas correções, uma medida e uma de vocabulário:
--   a) o filho sai de `procs_todos` quando a MAE está no mesmo quadro — hoje
--      ele conta como processo separado e infla o total de processos do POP
--      (o dinheiro nao duplicava: os 3 apartados tem 0 linhas em jm_valores);
--   b) execução, acordo e pagamento do filho promovem o estágio da MAE:
--      execucao_provisoria -> EM_EXECUCAO (v4: execucao aberta ja e EM_EXECUCAO),
--      e o acordo feito DENTRO da provisoria conta como acordo do principal
--      (A_RECEBER), que e o caso real do 0000755-26.2026.5.13.0034.
--
-- Ordem do CASE (do mais certo para o menos): PAGO > A_RECEBER (acordo, do
-- principal ou do apartado) > EM_EXECUCAO (provisoria) > estagio do marco atual
-- > CONDENACAO > PROJETADO.
-- ---------------------------------------------------------------------------
drop function if exists public.pop_carteira_marcos(uuid);

create function public.pop_carteira_marcos(p_board_id uuid)
returns table (
  process_id uuid, lead_id uuid, process_number text, cnj_num text, titulo text,
  cliente text, valor_condenacao numeric, valor_pago numeric,
  marco_chave text, marco_rotulo text, marco_ordem smallint, marco_em date,
  dias_no_marco integer, ajuizamento_em date, idade_dias integer,
  tem_acordo boolean, suspenso boolean, estagio_financeiro text,
  decidido boolean, sucesso boolean, tem_leitura boolean, custo_lead numeric,
  cadastros_do_cnj integer, leads_do_cnj uuid[], lead_nome text, leads_nomes text[],
  jcm_indice text, jcm_termo_inicial date, jcm_termo_estimado boolean,
  jcm_coeficiente numeric, jcm_referencia date,
  valor_origem text, cota_cliente numeric, honorario_parte numeric,
  execucao_provisoria boolean, apartados_cnj text[]
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with procs_todos as (
    select lp.id, lp.lead_id, lp.process_number, lp.title,
           lp.created_at, lp.updated_at,
           regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g') as cnj_num
    from public.lead_processes lp
    where lp.deleted_at is null
      and lp.workflow_id::uuid = p_board_id
      and length(regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g')) >= 15
      -- Apartado nao e processo proprio na carteira: ele e representado pela
      -- mae. So sai quando a mae esta NESTE quadro — senao sumiria da carteira.
      and not exists (
        select 1 from public.lead_processes mae
        where mae.id = lp.processo_principal_id
          and mae.deleted_at is null
          and mae.workflow_id::uuid = p_board_id
      )
  ),
  marcos_da_ficha as (
    select m.process_id, count(*) as qtd, max(m.ordem) as maior_ordem
    from public.process_pop_marcos m
    where m.board_id = p_board_id
    group by m.process_id
  ),
  grupo_do_cnj as (
    select t.cnj_num,
           count(*)::integer as cadastros,
           array_remove(array_agg(distinct t.lead_id), null) as leads,
           array_remove(array_agg(distinct nullif(btrim(l.lead_name), '')), null) as leads_nomes
    from procs_todos t
    left join public.leads l on l.id = t.lead_id
    group by t.cnj_num
  ),
  procs as (
    select distinct on (t.cnj_num)
           t.id, t.lead_id, t.process_number, t.title, t.cnj_num,
           g.cadastros, g.leads, g.leads_nomes
    from procs_todos t
    join grupo_do_cnj g on g.cnj_num = t.cnj_num
    left join marcos_da_ficha mf on mf.process_id = t.id
    order by t.cnj_num,
             (mf.process_id is not null) desc,
             mf.maior_ordem desc nulls last,
             mf.qtd desc nulls last,
             t.updated_at desc nulls last,
             t.created_at desc nulls last,
             t.id
  ),
  indice_vigente as (
    select distinct on (i.indice, i.competencia)
           i.indice, i.competencia, i.coeficiente, i.referencia
    from public.jm_indices i
    order by i.indice, i.competencia, i.referencia desc
  ),
  ordem_sentenca as (
    select pm.ordem from public.pop_marcos pm
    where pm.board_id = p_board_id and pm.chave = 'sentenca' limit 1
  ),
  marco_atual as (
    select distinct on (m.process_id)
           m.process_id, m.marco_chave, m.rotulo, m.ordem, m.data_detectada,
           pm.estagio_financeiro_sugerido
    from public.process_pop_marcos m
    join public.pop_marcos pm on pm.board_id = m.board_id and pm.chave = m.marco_chave
    where m.board_id = p_board_id and not pm.atravessa_fases
    order by m.process_id, m.ordem desc, m.data_detectada desc
  ),
  travessias as (
    select m.process_id,
           bool_or(m.marco_chave = 'acordo_homologado')   as tem_acordo,
           bool_or(m.marco_chave = 'suspensao')           as suspenso,
           bool_or(m.marco_chave = 'execucao_provisoria') as execucao_provisoria
    from public.process_pop_marcos m
    where m.board_id = p_board_id
    group by m.process_id
  ),
  -- O que os autos apartados trazem para a mãe.
  apartados as (
    select f.processo_principal_id as process_id,
           array_remove(array_agg(distinct f.process_number), null) as apartados_cnj,
           bool_or(fx.tem_acordo) as acordo_apartado
    from public.lead_processes f
    left join lateral (
      select bool_or(m.marco_chave = 'acordo_homologado') as tem_acordo
      from public.process_pop_marcos m where m.process_id = f.id
    ) fx on true
    where f.deleted_at is null
      and f.processo_principal_id is not null
      and f.vinculo_tipo in ('execucao_provisoria', 'carta_sentenca')
    group by f.processo_principal_id
  ),
  ajuizamento as (
    select m.process_id, min(m.data_detectada) as ajuizamento_em
    from public.process_pop_marcos m
    where m.board_id = p_board_id and m.marco_chave = 'ajuizamento'
    group by m.process_id
  ),
  -- FONTE 1: a decisão. Valor NOMINAL — corrige.
  valor_decisao as (
    select distinct on (v.processo_cnj, v.cliente)
           regexp_replace(v.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
           v.cliente,
           coalesce(v.dano_moral, 0) + coalesce(v.dano_estetico, 0) as valor,
           coalesce(d.termo_inicial_jcm, d.data_decisao) as termo,
           (d.termo_inicial_jcm is null and d.data_decisao is not null) as termo_estimado
    from public.jm_valores v
    left join public.jm_decisoes d on d.dec_id = v.dec_id
    order by v.processo_cnj, v.cliente, d.data_decisao desc nulls last
  ),
  cnjs_da_decisao as (
    select distinct cnj_num from valor_decisao where valor > 0
  ),
  -- FONTE 2: a Tab. Aux. Valor CJCM — JÁ corrigido, não multiplicar por índice.
  valor_tab_aux as (
    select regexp_replace(pa.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
           pa.cliente,
           pa.condenacao_cjcm as valor,
           pa.termo_inicial_jcm as termo,
           false as termo_estimado,
           pa.cota_parte_cjcm as cota,
           coalesce(pa.hc_vista,0) + coalesce(pa.hc_parcelado,0) + coalesce(pa.hs,0) as honorario
    from public.jm_partes pa
    where pa.condenacao_cjcm is not null
      and regexp_replace(pa.processo_cnj, '[^0-9]', '', 'g') not in (select cnj_num from cnjs_da_decisao)
  ),
  valor_vigente as (
    select cnj_num, cliente, valor, termo, termo_estimado,
           'decisao'::text as origem, null::numeric as cota, null::numeric as honorario
    from valor_decisao
    union all
    select cnj_num, cliente, valor, termo, termo_estimado,
           'tab_aux'::text, cota, honorario
    from valor_tab_aux
  ),
  pago as (
    select regexp_replace(pg.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
           pg.cliente,
           sum(coalesce(pg.valor_pago, 0)) filter (where pg.data_recebida is not null) as total_pago,
           count(*) filter (where pg.data_recebida is not null) as recebidas,
           count(*) filter (where pg.data_recebida is null)     as pendentes
    from public.jm_pagamentos pg
    group by 1, 2
  ),
  por_processo as (
    select p.id, p.lead_id, p.process_number, p.cnj_num, p.title,
           p.cadastros, p.leads, p.leads_nomes,
           case substring(p.cnj_num from 14 for 1)
             when '5' then 'SELIC_SIMPLES_JT'
             when '8' then 'TCM_ESTADUAL'
             else null
           end as indice_do_ramo,
           ma.marco_chave, ma.rotulo, ma.ordem, ma.data_detectada,
           ma.estagio_financeiro_sugerido,
           (coalesce(tv.tem_acordo, false) or coalesce(ap.acordo_apartado, false)) as tem_acordo,
           coalesce(tv.suspenso, false)            as suspenso,
           coalesce(tv.execucao_provisoria, false) as execucao_provisoria,
           ap.apartados_cnj,
           aj.ajuizamento_em,
           (coalesce(tv.tem_acordo, false) or coalesce(ap.acordo_apartado, false)
             or (ma.ordem is not null
                 and ma.ordem >= coalesce((select ordem from ordem_sentenca), 32767))) as decidido,
           exists (select 1 from valor_vigente vv
                    where vv.cnj_num = p.cnj_num and vv.valor > 0) as tem_valor,
           exists (select 1 from public.jm_decisoes d
                    where regexp_replace(d.processo_cnj, '[^0-9]', '', 'g') = p.cnj_num) as tem_leitura
    from procs p
    left join marco_atual ma on ma.process_id = p.id
    left join travessias tv on tv.process_id = p.id
    left join apartados ap on ap.process_id = p.id
    left join ajuizamento aj on aj.process_id = p.id
  )
  select
    pp.id                         as process_id,
    pp.lead_id,
    pp.process_number,
    pp.cnj_num,
    pp.title                      as titulo,
    vv.cliente,
    vv.valor                      as valor_condenacao,
    coalesce(pg.total_pago, 0)    as valor_pago,
    pp.marco_chave,
    pp.rotulo                     as marco_rotulo,
    pp.ordem                      as marco_ordem,
    pp.data_detectada             as marco_em,
    case when pp.data_detectada is not null
         then (current_date - pp.data_detectada) end as dias_no_marco,
    pp.ajuizamento_em,
    case when pp.ajuizamento_em is not null
         then (current_date - pp.ajuizamento_em) end as idade_dias,
    pp.tem_acordo,
    pp.suspenso,
    case
      when coalesce(pg.total_pago, 0) > 0
        or (coalesce(pg.recebidas, 0) > 0 and coalesce(pg.pendentes, 0) = 0) then 'PAGO'
      when pp.tem_acordo                              then 'A_RECEBER'
      when pp.execucao_provisoria                     then 'EM_EXECUCAO'
      when pp.estagio_financeiro_sugerido is not null then pp.estagio_financeiro_sugerido
      when coalesce(vv.valor, 0) > 0                  then 'CONDENACAO'
      else 'PROJETADO'
    end as estagio_financeiro,
    pp.decidido,
    (pp.decidido and (pp.tem_acordo or pp.tem_valor)) as sucesso,
    pp.tem_leitura,
    coalesce(l.cac, l.ad_spend_at_conversion)    as custo_lead,
    pp.cadastros                  as cadastros_do_cnj,
    pp.leads                      as leads_do_cnj,
    nullif(btrim(l.lead_name), '') as lead_nome,
    pp.leads_nomes,
    case when vv.origem = 'tab_aux' then 'TAB_AUX_CJCM'
         when idx.coeficiente is not null then pp.indice_do_ramo end as jcm_indice,
    vv.termo                      as jcm_termo_inicial,
    coalesce(vv.termo_estimado, false) as jcm_termo_estimado,
    case when vv.origem = 'tab_aux' then 1::numeric
         else idx.coeficiente end as jcm_coeficiente,
    case when vv.origem = 'tab_aux' then null::date
         else idx.referencia end  as jcm_referencia,
    vv.origem                     as valor_origem,
    vv.cota                       as cota_cliente,
    vv.honorario                  as honorario_parte,
    pp.execucao_provisoria,
    pp.apartados_cnj
  from por_processo pp
  left join valor_vigente vv on vv.cnj_num = pp.cnj_num
  left join pago pg on pg.cnj_num = pp.cnj_num and pg.cliente = vv.cliente
  left join public.leads l on l.id = pp.lead_id
  left join indice_vigente idx
         on idx.indice = pp.indice_do_ramo
        and idx.competencia = date_trunc('month', vv.termo)::date
  order by pp.ordem desc nulls last, pp.data_detectada desc nulls last, pp.cnj_num, vv.cliente;
$function$;

comment on function public.pop_carteira_marcos(uuid) is
  'Carteira do quadro, uma linha por (processo, parte). Autos apartados nao '
  'contam como processo proprio: sao absorvidos pela mae, que herda o acordo e '
  'o estagio EM_EXECUCAO da execucao provisoria. Valor de jm_valores (nominal, '
  'corrige) e, nos CNJs que ela nao cobre, de jm_partes/Tab. Aux (CJCM, ja '
  'corrigido — coeficiente 1). `valor_origem` diz de onde veio.';

-- ---------------------------------------------------------------------------
-- 8. Rematerializa com as regras novas
-- ---------------------------------------------------------------------------
select public.refresh_process_pop_marcos();
