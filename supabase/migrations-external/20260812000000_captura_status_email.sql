-- =============================================================================
-- O painel do sino passa a mostrar também a captura por E-MAIL, dizendo de qual
-- caixa vem — que é o que se quer saber ao olhar.
--
-- AS DUAS CAIXAS, identificadas pelos remetentes dos últimos e-mails:
--   inbox#4  2.619 e-mails  trt16, trt3, tjsp, tjpe, tjpa, tjse, trf1, cnj
--            → push dos tribunais, o judicial
--   inbox#3    100 e-mails  inss.gov.br, trabalho.gov.br, mppi.mp.br
--            → o ADMINISTRATIVO: INSS, MPT e relatório de acidente
--
-- O rótulo genérico "inbox#3/#4" não diz nada para quem olha o sino; a descrição
-- carrega a origem real.
--
-- "concluído" aqui = e-mail já lido pelo sync-email-push (email_push_processados).
-- Hoje dá 0 de 2.719 porque o gatilho nunca rodou — os crons foram ligados em
-- 20260811235900 e o primeiro ciclo ainda não passou. É esse número que vai
-- mostrar se o push funcionou.
-- =============================================================================
create or replace view public.vw_jm_captura_status as
with esc as (
  select count(*) as total, count(*) filter (where status='SUCESSO') as concluidos,
    count(*) filter (where status='A_ENVIAR') as na_fila,
    count(*) filter (where status in ('ENVIANDO','PENDENTE')) as em_andamento,
    count(*) filter (where status in ('ERRO','BLOQUEADO_SALDO')) as com_erro,
    min(criado_em) as iniciou_em, max(concluido_em) as ultimo_concluido,
    coalesce(sum(creditos),0) as creditos
  from public.jm_esc_solicitacoes
),
dj as (
  select (select count(*) from public.jm_processos
           where processo_cnj ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$') as total,
         (select count(distinct processo_cnj) from public.jm_movimentos
           where captured_at > now() - interval '7 days') as concluidos,
         (select count(*) from public.jm_datajud_req where processed=false) as em_andamento,
         (select max(captured_at) from public.jm_movimentos) as ultimo_concluido
),
em as (
  select count(*) as total,
    count(*) filter (where p.message_id is not null) as concluidos,
    count(*) filter (where p.message_id is null and e.process_number is not null) as na_fila,
    max(e.received_at) as ultimo
  from public.processual_emails e
  left join public.email_push_processados p on p.message_id = e.gmail_message_id
  where e.deleted_at is null
)
select 'escavador'::text as fonte, 'Documentos e estado do processo'::text as descricao,
  esc.total, esc.concluidos, esc.na_fila, esc.em_andamento, esc.com_erro,
  case when esc.total>0 then round(100.0*esc.concluidos/esc.total)::int else 0 end as pct,
  esc.iniciou_em, esc.ultimo_concluido,
  (esc.creditos/100.0)::numeric(10,2) as gasto_reais,
  (esc.na_fila*0.20)::numeric(10,2) as falta_gastar_reais
from esc
union all
select 'datajud', 'Movimentações e código do movimento',
  dj.total, dj.concluidos, greatest(dj.total-dj.concluidos,0), dj.em_andamento, 0,
  case when dj.total>0 then round(100.0*dj.concluidos/dj.total)::int else 0 end,
  null::timestamptz, dj.ultimo_concluido, 0::numeric(10,2), 0::numeric(10,2)
from dj
union all
select 'email', 'inbox#4 tribunais · inbox#3 INSS e MPT',
  em.total, em.concluidos, em.na_fila, 0, 0,
  case when em.total>0 then round(100.0*em.concluidos/em.total)::int else 0 end,
  null::timestamptz, em.ultimo, 0::numeric(10,2), 0::numeric(10,2)
from em;
