-- =============================================================================
-- A RÉGUA GANHA O STF, O CÍVEL GANHA LIQUIDAÇÃO, E O RÓTULO DIZ O TRIBUNAL CERTO
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Pedido do usuário (27/08/2026), sobre a Conferência do caso 81.1 ALADIA:
--   1. "depois da decisão do TST pode ainda o processo ser remetido para o STF
--      se houver recurso — aí tem a fase de remetido para o STF";
--   2. "remetido à instância superior deveria ser remetido ao TST/STJ" — o
--      rótulo genérico não diz para ONDE o processo subiu;
--   3. "decisão do TST na vdd deveria ser acórdão TST" — e "STJ" não existe na
--      cadeia trabalhista (Vara → TRT → TST → STF; o STJ é do cível).
--
-- O QUE NÃO ERA BUG: "Remessa à instância superior aparecer depois da Decisão
-- TST" na trilha. A régua já tem remessa (14) ANTES da decisão (15) — a trilha
-- da Conferência ordena por DATA DETECTADA, e neste processo o Escavador datou
-- a remessa em 21/05 e a decisão em 19/05. Isso é sintoma de DETECÇÃO (a tela
-- passa a alertar datas fora de ordem — mudança no front, não aqui).
--
-- O QUE MUDA AQUI:
--   1. Board trabalhista em uso (0bcd8be6): rótulos "Remetido ao TST" e
--      "Acórdão do TST"; marcos novos remessa_stf e decisao_stf entre o RE e o
--      trânsito. Trânsito 18 -> 20.
--   2. Boards cíveis (Justiça Comum 91778d9c, Requerimento de Seguro 26a46944):
--      rótulos "Remetido ao STJ" e "Decisão do STJ (REsp)"; remessa_stf e
--      decisao_stf antes do trânsito; e o marco 'liquidacao' entre o trânsito e
--      a execução — o cível pulava direto do trânsito para a execução, e a
--      liquidação (art. 509 CPC) é fase própria quando a sentença é ilíquida.
--   3. pop_processo_regua passa a devolver atravessa_fases: o front precisa
--      distinguir FASE (linha do trem) de ESTADO (badge) e hoje não tem como.
--
-- O QUE NÃO MUDA (de propósito):
--   - transito_julgado segue FASE, não estado. "Pode ocorrer a qualquer
--     momento" já é resolvido pelos degraus eventual=true: se ninguém recorre,
--     nenhum degrau recursal entra no denominador e o trânsito vem logo após a
--     sentença. Virar estado quebraria a fase automática (nunca chegaria à fase
--     de Certificação/Encerramento, que tem checklist real) e o estágio
--     financeiro (CONDENACAO firme; atributo COM/SEM trânsito da carteira).
--   - Boards previdenciários: a cadeia deles é TNU/STJ e o RE é raríssimo;
--     ganharão STF/liquidação quando houver caso real (rótulo atual já cita a
--     TNU). Board trabalhista legado (b436c043) não é mais o POP em uso.
--   - Os marcos novos nascem SEM sinais de detecção (pop_marco_sinais): não há
--     código TPU/texto calibrado para "remessa ao STF" nesta base. Entram na
--     régua como degraus manuais/futuros — inventar sinal seria pior que a
--     lacuna visível (mesma decisão da perícia em 08/08/2026).
--
-- REVERSÃO:
--   delete from pop_marcos where chave in ('remessa_stf','decisao_stf')
--     and board_id in ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15',
--       '91778d9c-d60e-461a-a763-839410166f00','26a46944-abb8-4807-9a9e-0c7ed75cf881');
--   delete from pop_marcos where chave = 'liquidacao'
--     and board_id in ('91778d9c-…','26a46944-…');
--   -- devolver os rótulos e as ordens antigas (ver valores neste arquivo) e
--   -- recriar pop_processo_regua pela definição de 20260812191000.
--   select public.refresh_process_pop_marcos();
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rótulos por tribunal — o degrau diz para ONDE o processo foi
-- ---------------------------------------------------------------------------
update public.pop_marcos set
  rotulo    = 'Remetido ao TST',
  descricao = 'Subida do RR/AIRR ao TST. A chegada na instância, não o julgamento.'
where board_id = '0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'::uuid
  and chave = 'remessa_superior';

update public.pop_marcos set
  rotulo    = 'Acórdão do TST',
  descricao = 'Acórdão ou decisão monocrática do TST no RR/AIRR. Na cadeia trabalhista não há STJ: Vara -> TRT -> TST -> STF.'
where board_id = '0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'::uuid
  and chave = 'decisao_superior';

update public.pop_marcos set
  rotulo    = 'Remetido ao STJ',
  descricao = 'Subida do REsp ao STJ. A chegada na instância, não o julgamento.'
where board_id in ('91778d9c-d60e-461a-a763-839410166f00'::uuid,
                   '26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid)
  and chave = 'remessa_superior';

update public.pop_marcos set
  rotulo    = 'Decisão do STJ (REsp)',
  descricao = 'Acórdão ou decisão monocrática do STJ. O STF ganhou degraus próprios (remessa_stf/decisao_stf).'
where board_id in ('91778d9c-d60e-461a-a763-839410166f00'::uuid,
                   '26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid)
  and chave = 'decisao_superior';

-- ---------------------------------------------------------------------------
-- 2. STF na régua: remessa_stf + decisao_stf imediatamente antes do trânsito
--
-- Feito por board, com a ordem do trânsito lida na hora (os boards numeram
-- diferente). Idempotente: se remessa_stf já existe no board, nada acontece.
-- A unique (board_id, ordem) é deferrable initially deferred — os empurrões
-- convivem dentro da transação.
-- ---------------------------------------------------------------------------
do $$
declare
  b record;
  t smallint;
begin
  for b in
    select * from (values
      ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'::uuid, 'm_recurso_extraordinario'),
      ('91778d9c-d60e-461a-a763-839410166f00'::uuid, null),
      ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, null)
    ) as v(board_id, stage_stf)
  loop
    if exists (select 1 from public.pop_marcos
                where board_id = b.board_id and chave = 'remessa_stf') then
      continue;
    end if;

    select ordem into t from public.pop_marcos
     where board_id = b.board_id and chave = 'transito_julgado';
    if t is null then
      continue; -- board sem trânsito na régua: nada a inserir
    end if;

    update public.pop_marcos
       set ordem = ordem + 2
     where board_id = b.board_id and ordem >= t;

    insert into public.pop_marcos
      (board_id, chave, rotulo, ordem, stage_id, terminal, eventual, atravessa_fases,
       estagio_financeiro_sugerido, descricao)
    values
      (b.board_id, 'remessa_stf', 'Remetido ao STF', t, b.stage_stf,
       false, true, false, null,
       'Subida do RE ao STF, se admitido. Degrau eventual — a maioria dos processos nunca chega aqui.'),
      (b.board_id, 'decisao_stf', 'Decisão do STF', t + 1, b.stage_stf,
       false, true, false, 'CONDENACAO',
       'Acórdão ou decisão monocrática do STF no RE. Último degrau antes do trânsito.')
    on conflict (board_id, chave) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Liquidação no cível: entre o trânsito e a execução
--
-- O trabalhista já tem 'liquidacao' (ordem logo após o trânsito). O cível
-- pulava do trânsito direto para 'execucao_iniciada'. Herda o stage da
-- execução do próprio board — liquidação é o começo do pós-trânsito.
-- ---------------------------------------------------------------------------
do $$
declare
  b uuid;
  t smallint;
  st text;
begin
  foreach b in array array['91778d9c-d60e-461a-a763-839410166f00'::uuid,
                           '26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid]
  loop
    if exists (select 1 from public.pop_marcos
                where board_id = b and chave = 'liquidacao') then
      continue;
    end if;

    select ordem into t from public.pop_marcos
     where board_id = b and chave = 'transito_julgado';
    if t is null then
      continue;
    end if;

    select stage_id into st from public.pop_marcos
     where board_id = b and chave = 'execucao_iniciada';

    update public.pop_marcos
       set ordem = ordem + 1
     where board_id = b and ordem > t;

    insert into public.pop_marcos
      (board_id, chave, rotulo, ordem, stage_id, terminal, eventual, atravessa_fases,
       estagio_financeiro_sugerido, descricao)
    values
      (b, 'liquidacao', 'Liquidação', t + 1, st, false, true, false, null,
       'Liquidação de sentença (art. 509 CPC). Eventual: sentença líquida não passa por aqui.')
    on conflict (board_id, chave) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. pop_processo_regua devolve atravessa_fases
--
-- O front unificou a linha do trem (fases) com os badges de estado (acordo,
-- suspensão, inadimplência…) num componente só — e a RPC era o único lugar que
-- sabia a diferença sem entregá-la. Mudança de assinatura exige drop+create.
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
    m.eventual, m.terminal, m.atravessa_fases, m.estado, m.data_detectada, m.fonte,
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
  'Regua de marcos do processo com estado por marco, atravessa_fases e percentual. Percentual null = nenhum marco detectado; a ficha cai no calculo por passos.';

-- ---------------------------------------------------------------------------
-- 5. Rematerializa: process_pop_marcos guarda cópia de ordem e rótulo
-- ---------------------------------------------------------------------------
select public.refresh_process_pop_marcos();
