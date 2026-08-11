-- =============================================================================
-- Painel de acompanhamento da captura, para o sino.
--
-- POR QUE EXISTE: entre 09/07 e 11/08 a captura ficou parada e ninguém viu. Não
-- houve erro nenhum — as funções antigas se auto-desagendavam ao esvaziar a
-- fila, então o sistema simplesmente deixou de trazer dado, em silêncio, por um
-- mês. Fila parada não avisa sozinha; precisa de um lugar onde a ausência
-- apareça.
--
-- O sino é esse lugar: ele já responde "o que chegou de novo nos processos", e
-- "o que ainda NÃO chegou" é a mesma pergunta pelo avesso.
--
-- O GASTO NÃO É ESTIMATIVA. Sai de jm_esc_solicitacoes.creditos, que é o valor
-- que a própria API do Escavador devolve na resposta ("creditos":"20"). 100
-- créditos = R$ 1,00. O "falta gastar" é projeção — fila x R$ 0,20.
--
-- jm_esc_reabrir passa a carimbar criado_em = now() e zerar creditos: sem isso
-- não há como dizer "esta rodada começou às 00:03", porque criado_em só era
-- escrito no insert original da linha, lá em julho.
-- =============================================================================

create or replace function public.jm_esc_reabrir()
returns integer language plpgsql as $function$
declare v_n integer;
begin
  with r as (
    update public.jm_esc_solicitacoes
       set status = 'A_ENVIAR', concluido_em = null, motivo_erro = null,
           criado_em = now(), creditos = null
     where status in ('SUCESSO', 'ERRO', 'BLOQUEADO_SALDO')
    returning 1
  )
  select count(*) into v_n from r;

  insert into public.jm_esc_solicitacoes (processo_cnj, status, criado_em)
  select p.processo_cnj, 'A_ENVIAR', now()
  from public.jm_processos p
  where p.processo_cnj ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'
    and not exists (select 1 from public.jm_esc_solicitacoes s
                     where s.processo_cnj = p.processo_cnj);
  return v_n;
end $function$;

create or replace view public.vw_jm_captura_status as
with esc as (
  select
    count(*)                                                  as total,
    count(*) filter (where status = 'SUCESSO')                as concluidos,
    count(*) filter (where status = 'A_ENVIAR')               as na_fila,
    count(*) filter (where status in ('ENVIANDO','PENDENTE')) as em_andamento,
    count(*) filter (where status in ('ERRO','BLOQUEADO_SALDO')) as com_erro,
    min(criado_em)                                            as iniciou_em,
    max(concluido_em)                                         as ultimo_concluido,
    coalesce(sum(creditos), 0)                                as creditos
  from public.jm_esc_solicitacoes
),
dj as (
  select
    (select count(*) from public.jm_processos
      where processo_cnj ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$')     as total,
    -- "concluído" no DataJud = capturado nos últimos 7 dias, que é o intervalo
    -- do refresh. Sem janela, todo processo já visto contaria como em dia.
    (select count(distinct processo_cnj) from public.jm_movimentos
      where captured_at > now() - interval '7 days')                     as concluidos,
    (select count(*) from public.jm_datajud_req where processed = false) as em_andamento,
    (select max(captured_at) from public.jm_movimentos)                  as ultimo_concluido
)
select
  'escavador'::text as fonte,
  'Documentos e estado do processo'::text as descricao,
  esc.total, esc.concluidos, esc.na_fila, esc.em_andamento, esc.com_erro,
  case when esc.total > 0 then round(100.0 * esc.concluidos / esc.total)::int else 0 end as pct,
  esc.iniciou_em, esc.ultimo_concluido,
  (esc.creditos / 100.0)::numeric(10,2) as gasto_reais,
  (esc.na_fila * 0.20)::numeric(10,2)   as falta_gastar_reais
from esc
union all
select
  'datajud', 'Movimentações e código do movimento',
  dj.total, dj.concluidos, greatest(dj.total - dj.concluidos, 0), dj.em_andamento, 0,
  case when dj.total > 0 then round(100.0 * dj.concluidos / dj.total)::int else 0 end,
  null::timestamptz, dj.ultimo_concluido,
  0::numeric(10,2), 0::numeric(10,2)
from dj;

comment on view public.vw_jm_captura_status is
  'Resumo das duas filas de captura para o sino: quanto foi feito, quanto falta, quando comecou/terminou e quanto custou (creditos vindos da propria API do Escavador).';
