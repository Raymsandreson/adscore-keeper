-- =============================================================================
-- DESTRAVA o jm_indices_tick e REMOVE o pipeline paralelo criado por engano.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- CONTEXTO — erro meu, registrado para não se repetir (15/08/2026): eu construí
-- `jm_selic_sync_*` (migration 20260815230000) para buscar a SELIC no Bacen SEM
-- antes procurar o que já existia. Já existia: `jm_indices_tick()`, no cron
-- `jm_indices_diario` (30 7 * * *), e ELE É MELHOR — busca SELIC (SGS 4390) e
-- IPCA (SGS 7478) e atualiza os DOIS índices (SELIC por soma, TCM por produto),
-- validado contra as tabelas oficiais.
--
-- Pior: o pipeline paralelo QUEBROU o original. O tick começa com
-- `if exists (select 1 from jm_indices where referencia = mês corrente) then
-- return 'ja_atualizado'`. Como o meu criou a safra 08/2026 só com SELIC, o
-- tick passou a sair por 'ja_atualizado' e a TCM de agosto nunca seria criada.
--
-- POR QUE A TABELA ESTAVA PARADA EM JUL/2026 (a causa raiz de tudo): o tick
-- disparou as buscas em 01/08 07:30 e foi processar num tick seguinte. Só que
-- `net._http_response` expira em ~6h, e a guarda de re-disparo era
--
--     and (x2.id is null or x2.status_code = 200)
--
-- Depois da expiração, `x2.id is null` fica verdadeiro para sempre → o
-- `not exists` nunca libera → nunca re-dispara → v_selic/v_ipca nunca chegam.
-- DEADLOCK PERMANENTE, silencioso, desde 01/08. É exatamente a armadilha que a
-- skill marcos-pop-e-captura já avisava ("resposta perdida trava a fila para
-- sempre") — e que ninguém tinha ligado a esta função.
--
-- A CORREÇÃO, cirúrgica: "sem resposta" só bloqueia por 2 horas.
--
--     and (x2.status_code = 200
--          or (x2.id is null and h2.created_at > now() - interval '2 hours'))
--
-- Pedido recente sem resposta ainda pode chegar; pedido velho sem resposta é
-- resposta expirada e precisa de um novo.
--
-- FEITO JUNTO, fora desta migration (dados):
--   delete from jm_indices where referencia='2026-08-01' and indice='SELIC_SIMPLES_JT';
--   -- 380 linhas, a safra parcial que o pipeline paralelo tinha criado
--   select cron.unschedule('jm_selic_sync_disparar');
--   select cron.unschedule('jm_selic_sync_aplicar');
--
-- VERIFICADO depois de aplicar: tick devolveu 'aguardando_bacen_202607' (ou
-- seja, re-disparou — antes ficava mudo), as duas respostas voltaram 200
-- (SELIC jul 1,22% e IPCA jul 0,06%), e o tick seguinte devolveu
-- 'atualizado_para_2026-08'. Safra 08/2026 completa: SELIC 380 competências e
-- TCM 743. O coeficiente de 2020-01 ficou 1,6283 — exatamente o 1,6161 da safra
-- de julho + 1,22%, batendo com o cálculo independente feito pela série inteira
-- do Bacen. Carteira: 475 processos, nominal R$ 20.292.233,25 intacto,
-- atualizado R$ 26.236.887,71, nenhuma parte sem correção, os dois índices em
-- ago/2026.
--
-- O QUE FICA DA TENTATIVA ANTERIOR: só o fix da RPC em 20260815220000 (a CTE
-- `indice_vigente`), que é necessário de qualquer jeito — `jm_indices` guarda
-- uma safra por referência, e sem eleger a mais recente o join duplicaria a
-- carteira inteira a cada mês novo. Esse bug agora está exposto de verdade:
-- existem duas safras de cada índice.
--
-- REVERSÃO: re-executar a definição anterior de jm_indices_tick (git:
-- migration 20260815230000 não a continha; a versão original está no histórico
-- do banco). Reverter NÃO é recomendado: volta o deadlock.
-- =============================================================================

drop function if exists public.jm_selic_sync_aplicar();
drop function if exists public.jm_selic_sync_disparar();
drop function if exists public.jm_selic_coeficientes(bigint, date);
drop table if exists public.jm_indices_sync;

create or replace function public.jm_indices_tick()
 returns text
 language plpgsql
as $function$
declare
  v_ref date := date_trunc('month', current_date)::date;
  v_prev date;
  v_t date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_selic numeric; v_ipca numeric;
begin
  if exists (select 1 from jm_indices where referencia = v_ref) then
    return 'ja_atualizado';
  end if;
  select max(referencia) into v_prev from jm_indices;

  select (e->>'valor')::numeric into v_selic
  from jm_http_req h
  join net._http_response x on x.id=h.request_id and x.status_code=200
  cross join lateral jsonb_array_elements(x.content::jsonb) e
  where h.tag = 'idx_selic_'||to_char(v_t,'YYYYMM')
    and to_date(e->>'data','DD/MM/YYYY') = v_t
  limit 1;

  select (e->>'valor')::numeric into v_ipca
  from jm_http_req h
  join net._http_response x on x.id=h.request_id and x.status_code=200
  cross join lateral jsonb_array_elements(x.content::jsonb) e
  where h.tag = 'idx_ipca_'||to_char(v_t,'YYYYMM')
    and to_date(e->>'data','DD/MM/YYYY') = v_t
  limit 1;

  if v_selic is null or v_ipca is null then
    -- Só não redispara se já há resposta 200, ou se há pedido SEM resposta de
    -- menos de 2h (esse ainda pode chegar). Pedido velho sem resposta = expirou
    -- em net._http_response e precisa de um novo — sem esta janela o tick trava
    -- para sempre, que foi o que aconteceu em 01/08/2026.
    insert into jm_http_req (request_id, tag)
    select net.http_get('https://api.bcb.gov.br/dados/serie/bcdata.sgs.4390/dados?formato=json&dataInicial=01/'||to_char(v_t,'MM/YYYY')||'&dataFinal='||to_char((v_t + interval '1 month' - interval '1 day')::date,'DD/MM/YYYY'),
      timeout_milliseconds := 15000), 'idx_selic_'||to_char(v_t,'YYYYMM')
    where not exists (select 1 from jm_http_req h2
      left join net._http_response x2 on x2.id=h2.request_id
      where h2.tag='idx_selic_'||to_char(v_t,'YYYYMM')
        and (x2.status_code = 200
             or (x2.id is null and h2.created_at > now() - interval '2 hours')));
    insert into jm_http_req (request_id, tag)
    select net.http_get('https://api.bcb.gov.br/dados/serie/bcdata.sgs.7478/dados?formato=json&dataInicial=01/'||to_char(v_t,'MM/YYYY')||'&dataFinal='||to_char((v_t + interval '1 month' - interval '1 day')::date,'DD/MM/YYYY'),
      timeout_milliseconds := 15000), 'idx_ipca_'||to_char(v_t,'YYYYMM')
    where not exists (select 1 from jm_http_req h2
      left join net._http_response x2 on x2.id=h2.request_id
      where h2.tag='idx_ipca_'||to_char(v_t,'YYYYMM')
        and (x2.status_code = 200
             or (x2.id is null and h2.created_at > now() - interval '2 hours')));
    return 'aguardando_bacen_'||to_char(v_t,'YYYYMM');
  end if;

  -- SELIC simples: soma | TCM: produto — validado contra tabelas oficiais (dif 0,000000)
  insert into jm_indices (indice, ano, mes, competencia, coeficiente, referencia)
  select indice, ano, mes, competencia,
    case when indice='SELIC_SIMPLES_JT' then coeficiente + v_selic/100.0
         else coeficiente * (1 + v_ipca/100.0) end,
    v_ref
  from jm_indices where referencia = v_prev
  union all
  select 'SELIC_SIMPLES_JT', extract(year from v_ref)::int, extract(month from v_ref)::int, v_ref, 1.0, v_ref
  union all
  select 'TCM_ESTADUAL', extract(year from v_ref)::int, extract(month from v_ref)::int, v_ref, 1.0, v_ref;

  return 'atualizado_para_'||to_char(v_ref,'YYYY-MM');
end $function$;

comment on function public.jm_indices_tick() is
  'Atualiza jm_indices (SELIC_SIMPLES_JT e TCM_ESTADUAL) com Bacen SGS 4390/7478. Roda no cron jm_indices_diario. A janela de 2h no redisparo evita o deadlock de resposta expirada em net._http_response.';
