-- Protocolos administrativos INSS por dia — dashboard + telão.
--
-- CONTEXTO IMPORTANTE (levantado em 03/08/2026, antes de escrever isto):
-- não existe captura de protocolo no ato. TODO registro de protocolo entra no
-- sistema por e-mail (gmail-inss-sync parseia o corpo e grava protocol_date).
-- Consequência: "quantos protocolamos hoje" NÃO é respondível com este dado.
-- O que dá pra medir são duas coisas diferentes, e a função devolve as duas
-- separadas de propósito — juntar as duas num número só seria mentira:
--
--   registrados : comprovantes que CHEGARAM no dia (created_at). Tem movimento
--                 diário real, mas inclui protocolos feitos semanas atrás.
--   protocolados: linhas cuja DATA DE PROTOCOLO é o dia (protocol_date). É a
--                 produção verdadeira, mas só se completa semanas depois —
--                 medido em 03/08: 92% dos registros entram depois da data do
--                 protocolo, atraso médio de 13,8 dias (p90 = 35). Por isso
--                 "protocolados hoje" costuma ser 0 e sobe retroativamente.
--
-- `lag_mediano_dias` existe pra tornar esse atraso visível na tela em vez de
-- deixar quem olha achar que a equipe parou de protocolar.
--
-- Limitação conhecida: um registro pode nascer sem protocol_date (e-mail de
-- status puro) e ganhar a data num e-mail posterior. Não há coluna que registre
-- QUANDO protocol_date foi preenchido, então esse caso conta em "registrados"
-- no dia em que a linha nasceu, não no dia em que o protocolo foi descoberto.
--
-- security definer: a política atual de inss_admin_processes é `true` pra
-- public, então tecnicamente daria pra ler direto do cliente. Não fazemos isso
-- porque a tabela tem CPF e nome de segurado, e o telão fica numa TV de sala
-- aberta. Esta função devolve exclusivamente contagens — nenhuma linha crua
-- sai daqui. Também sobrevive caso a RLS dessa tabela seja fechada depois.
--
-- Fuso: tudo em America/Sao_Paulo. Sem isso o "hoje" do telão viraria às 21h.

create or replace function public.tv_protocolos_dia(p_dias int default 14)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
with
params as (
  select
    (now() at time zone 'America/Sao_Paulo')::date as hoje,
    greatest(least(coalesce(p_dias, 14), 90), 1)   as dias
),
base as (
  -- Só linhas que representam um protocolo de fato.
  select
    (p.created_at at time zone 'America/Sao_Paulo')::date as dia_registro,
    p.protocol_date                                       as dia_protocolo
  from inss_admin_processes p
  where p.deleted_at is null
    and p.protocol_date is not null
),
dias as (
  select generate_series(p.hoje - (p.dias - 1), p.hoje, interval '1 day')::date as dia
  from params p
),
serie as (
  select
    d.dia,
    (select count(*) from base b where b.dia_registro  = d.dia)::int as registrados,
    (select count(*) from base b where b.dia_protocolo = d.dia)::int as protocolados
  from dias d
  order by d.dia
),
-- Semana corrente (segunda a hoje) e mês corrente, em SP.
janelas as (
  select
    (select count(*) from base b, params p where b.dia_registro  = p.hoje)::int             as hoje_reg,
    (select count(*) from base b, params p where b.dia_protocolo = p.hoje)::int             as hoje_prot,
    (select count(*) from base b, params p where b.dia_registro  = p.hoje - 1)::int         as ontem_reg,
    (select count(*) from base b, params p where b.dia_protocolo = p.hoje - 1)::int         as ontem_prot,
    (select count(*) from base b, params p
      where b.dia_registro >= date_trunc('week', p.hoje)::date and b.dia_registro <= p.hoje)::int  as semana_reg,
    (select count(*) from base b, params p
      where b.dia_protocolo >= date_trunc('week', p.hoje)::date and b.dia_protocolo <= p.hoje)::int as semana_prot,
    (select count(*) from base b, params p
      where b.dia_registro >= date_trunc('month', p.hoje)::date and b.dia_registro <= p.hoje)::int  as mes_reg,
    (select count(*) from base b, params p
      where b.dia_protocolo >= date_trunc('month', p.hoje)::date and b.dia_protocolo <= p.hoje)::int as mes_prot
),
-- Atraso típico entre protocolar e o comprovante aparecer aqui. Só os últimos
-- 60 dias: o histórico antigo carrega backfill e distorceria a mediana.
lag as (
  select percentile_disc(0.5) within group (
           order by greatest(b.dia_registro - b.dia_protocolo, 0)
         )::int as mediano
  from base b, params p
  where b.dia_protocolo >= p.hoje - 60
),
sync as (
  select max(last_run_at) as ultimo from inss_sync_state
)
select jsonb_build_object(
  'gerado_em', now(),
  'hoje',   jsonb_build_object('registrados', j.hoje_reg,   'protocolados', j.hoje_prot),
  'ontem',  jsonb_build_object('registrados', j.ontem_reg,  'protocolados', j.ontem_prot),
  'semana', jsonb_build_object('registrados', j.semana_reg, 'protocolados', j.semana_prot),
  'mes',    jsonb_build_object('registrados', j.mes_reg,    'protocolados', j.mes_prot),
  'serie',  coalesce((
    select jsonb_agg(jsonb_build_object(
             'dia', s.dia, 'registrados', s.registrados, 'protocolados', s.protocolados
           ) order by s.dia)
    from serie s
  ), '[]'::jsonb),
  'lag_mediano_dias', coalesce((select mediano from lag), 0),
  'ultimo_sync', (select ultimo from sync)
)
from janelas j;
$$;

comment on function public.tv_protocolos_dia(int) is
  'Protocolos administrativos INSS agregados por dia (America/Sao_Paulo). Devolve "registrados" (chegada do comprovante) e "protocolados" (data do protocolo) separados — ver comentário da migration. Só contagens, nunca PII.';

grant execute on function public.tv_protocolos_dia(int) to anon, authenticated;
