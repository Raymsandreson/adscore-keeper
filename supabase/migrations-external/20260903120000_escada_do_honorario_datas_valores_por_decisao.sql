-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- A ESCADA DO HONORARIO: data + valor + estado de cada degrau
--
-- Pedido do Raym (03/09/2026), sobre o Modelo_Antecipacao_Chimera_v7:
--   "so o que interessa e o honorario recebido e as datas da sentenca,
--    acordao 2g, acordao TST, pagamento. Pq ai que tem os percentuais de
--    liberacao em cima do honorario esperado. So que teria tambem que ter o
--    valor em cada uma dessas decisoes e se passou por todas mesmo... pode ser
--    que tenha feito um acordo antes."
--
-- O QUE A PLANILHA TEM HOJE (aba "Casos reais", 32 linhas)
--   Tres datas por processo — PROTOCOLO (G), 1a ENTRADA (H), ULTIMA ENTRADA (I)
--   — e UM rotulo de texto na coluna AG ("EMBARGOS 2o GRAU", "ACORDAO TST",
--   "SEM DECISAO"). Com isso NAO da para aplicar a escada do Simulador
--   (Protocolo 10% / Sentenca 5% / Acordao 2G 10% / Superior 5% / Final 10%):
--   falta a data de cada degrau e o honorario reestimado em cada um.
--
--   Pior: o rotulo esta velho. Caso 107 (0000417-95.2022.5.08.0110) esta como
--   "A RECEBER / EMBARGOS 2o GRAU"; o banco mostra ACORDO_HOMOLOGADO em
--   27/03/2025 e o honorario de R$ 414.492,99 caindo em 02/04/2025 — seis dias
--   depois. Ele nao passou pelo TST: fez acordo depois do acordao do TRT.
--
-- AS DUAS FONTES E POR QUE NENHUMA SOZINHA RESOLVE
--   jm_decisoes + jm_valores  -> tem o VALOR por decisao e por parte, mas so
--                                ate onde alguem leu a peca. Curada, atrasada.
--   vw_jm_marcos              -> tem a DATA de todo ato decisorio, atualizada
--                                pelo Escavador. Nao tem valor nenhum.
--
--   Medido nos 32 casos da planilha em 03/09/2026: 27 tem pelo menos um degrau
--   decisorio posterior a ultima decisao lida — 65 degraus sem valor no total.
--   Exemplo: 0000075-06.2023.5.19.0058 tem acordao 2G em 21/01/2025 e acordo
--   homologado em 02/07/2025 nos marcos; a ultima peca lida e de 22/02/2024.
--
-- A REGRA QUE ESTA VIEW APLICA (skill conserto-estrutural-nao-pontual)
--   Degrau sem valor NAO e escondido nem preenchido por estimativa. Ele aparece
--   como ATINGIDO_SEM_VALOR, com a data e o marco que o denunciam, para entrar
--   na esteira de conserto que ja existe: conferencia -> anexar a peca ->
--   jm_ler_documento -> jm_corrigir_valores_da_leitura. A view e detector, nao
--   filtro.
--
-- O QUE ELA DELIBERADAMENTE NAO FAZ
--   1. Nao calcula "honorario esperado naquela data". O valor por decisao aqui
--      e NOMINAL (dano moral + estetico + base x meses, como consta da peca).
--      Virar CJCM exige a data-base da correcao, que nao esta gravada em lugar
--      nenhum do banco — ver docs/sistema/metodologia-atualizacao.md secao 0.
--      Multiplicar por coeficiente aqui repetiria o erro de 19/08/2026, que
--      inventou R$ 260 mil numa tela.
--   2. Nao guarda os percentuais de liberacao (10/5/10/5/10). Aquilo e clausula
--      do fundo, nao fato do processo. A view entrega os fatos em que o
--      percentual se apoia.
--
-- Granularidade: PROCESSO. A carteira e (processo x cliente) — o honorario
-- contratual e sucumbencial vem somado das partes. Para rateio por cliente use
-- jm_partes / vw_jm_visao_processo.
--
-- REVERSAO:
--   drop view if exists public.vw_jm_escada_honorario_resumo;
--   drop view if exists public.vw_jm_escada_honorario;
-- Nenhuma tabela e alterada; nenhuma linha e escrita. Aditiva e reversivel em
-- um comando.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. vw_jm_escada_honorario — formato longo: uma linha por (processo, degrau)
-- ---------------------------------------------------------------------------
create or replace view public.vw_jm_escada_honorario as
with
-- Valor nominal declarado em cada decisao, somando as partes.
dec_valor as (
  select d.processo_cnj,
         d.dec_id,
         d.data_decisao,
         d.tipo_evento,
         d.instancia,
         (select coalesce(sum(coalesce(v.dano_moral,0)
                            + coalesce(v.dano_estetico,0)
                            + coalesce(v.base_calculo,0) * coalesce(v.meses_pensionamento,0)), 0)
            from public.jm_valores v where v.dec_id = d.dec_id) as condenacao_nominal,
         (select count(*) from public.jm_valores v where v.dec_id = d.dec_id) as partes_com_valor
  from public.jm_decisoes d
),
-- Primeira decisao lida de cada degrau (a que fixa o valor daquele degrau).
dec_degrau as (
  select processo_cnj, degrau, data_decisao, dec_id, condenacao_nominal, partes_com_valor, rotulo
  from (
    select dv.*,
           case
             when dv.tipo_evento = 'SENTENÇA'   and dv.instancia = '1º GRAU'                    then 'SENTENCA'
             when dv.tipo_evento = 'ACÓRDÃO'    and dv.instancia in ('2º GRAU','A REVISAR')     then 'ACORDAO_2G'
             when dv.tipo_evento in ('ACÓRDÃO','DECISÃO') and dv.instancia in ('TST','STJ','STF') then 'SUPERIOR'
             when dv.tipo_evento = 'HOMOLOGAÇÃO DE ACORDO'                                      then 'ACORDO'
           end as degrau,
           dv.tipo_evento || ' / ' || coalesce(dv.instancia,'?') as rotulo,
           row_number() over (
             partition by dv.processo_cnj,
               case
                 when dv.tipo_evento = 'SENTENÇA'   and dv.instancia = '1º GRAU'                    then 'SENTENCA'
                 when dv.tipo_evento = 'ACÓRDÃO'    and dv.instancia in ('2º GRAU','A REVISAR')     then 'ACORDAO_2G'
                 when dv.tipo_evento in ('ACÓRDÃO','DECISÃO') and dv.instancia in ('TST','STJ','STF') then 'SUPERIOR'
                 when dv.tipo_evento = 'HOMOLOGAÇÃO DE ACORDO'                                      then 'ACORDO'
               end
             order by dv.data_decisao, dv.dec_id
           ) as rn
    from dec_valor dv
  ) x
  where x.degrau is not null and x.rn = 1
),
-- Mesmos degraus vistos pelo fluxo de movimentacoes (Escavador). Tem a data de
-- tudo, inclusive do que ninguem leu ainda. ACORDAO_* e 2o grau nesta
-- taxonomia; instancia superior tem prefixo DECISAO_SUPERIOR_*.
marco_degrau as (
  select processo_cnj, degrau, min(data_hora)::date as data_marco,
         (array_agg(marco order by data_hora))[1] as marco
  from (
    select m.processo_cnj, m.marco, m.data_hora,
           case
             when m.marco like 'SENTENCA%'         then 'SENTENCA'
             when m.marco like 'ACORDAO%'          then 'ACORDAO_2G'
             when m.marco like 'DECISAO_SUPERIOR%' then 'SUPERIOR'
             when m.marco in ('ACORDO_HOMOLOGADO','ACORDO_EM_EXECUCAO') then 'ACORDO'
           end as degrau
    from public.vw_jm_marcos m
  ) y
  where degrau is not null
  group by processo_cnj, degrau
),
-- Honorario que efetivamente entrou no caixa. status = REALIZADO separa o que
-- caiu do que esta so agendado; pessoa = HC/HS separa contratual de
-- sucumbencial. Conferido contra a coluna P da planilha: bate ao centavo em
-- 26 dos 32 casos; os 6 restantes divergem porque a planilha e um retrato de
-- data anterior.
pagamento as (
  select processo_cnj,
         min(data)        filter (where status = 'REALIZADO') as primeiro_recebimento,
         max(data)        filter (where status = 'REALIZADO') as ultimo_recebimento,
         sum(valor_caixa) filter (where status = 'REALIZADO') as honorario_recebido
  from public.jm_lancamentos
  where tipo = 'ENTRADA' and categoria ilike 'honor%'
  group by processo_cnj
),
-- O processo ja acabou? Se acabou e o degrau nao aconteceu, ele foi PULADO
-- (tipicamente por acordo), nao esta pendente.
encerrado as (
  select processo_cnj,
         bool_or(marco in ('TRANSITO_JULGADO','ARQUIVAMENTO_DEFINITIVO',
                           'ACORDO_HOMOLOGADO','ACORDO_EM_EXECUCAO','EXTINCAO_EXECUCAO')) as fim,
         min(data_hora) filter (where marco in ('ACORDO_HOMOLOGADO','ACORDO_EM_EXECUCAO'))::date as data_acordo
  from public.vw_jm_marcos
  group by processo_cnj
),
degraus(degrau, ordem, titulo) as (
  values ('PROTOCOLO'::text, 1::smallint, 'Protocolo'::text),
         ('SENTENCA',   2::smallint, 'Sentença'),
         ('ACORDAO_2G', 3::smallint, 'Acórdão 2º grau'),
         ('SUPERIOR',   4::smallint, 'Acórdão / decisão superior (TST, STJ, STF)'),
         ('ACORDO',     5::smallint, 'Acordo homologado'),
         ('PAGAMENTO',  6::smallint, 'Honorário no caixa')
)
select
  p.processo_cnj,
  p.caso,
  g.degrau,
  g.ordem,
  g.titulo,

  -- DATA: a decisao lida manda; sem ela, vale a data do marco.
  case g.degrau
    when 'PROTOCOLO' then p.data_protocolo
    when 'PAGAMENTO' then pg.primeiro_recebimento
    else coalesce(dd.data_decisao, md.data_marco)
  end as data,

  -- VALOR: nominal da peca (condenacao) nos degraus de decisao; caixa no
  -- degrau de pagamento. Nunca estimado.
  case g.degrau
    when 'PAGAMENTO' then pg.honorario_recebido
    when 'PROTOCOLO' then null
    else dd.condenacao_nominal
  end as valor_nominal,

  case g.degrau
    when 'PROTOCOLO' then 'jm_processos.data_protocolo'
    when 'PAGAMENTO' then 'jm_lancamentos (ENTRADA/honor%/REALIZADO)'
    when 'ACORDO'    then coalesce(dd.dec_id, md.marco)
    else coalesce(dd.dec_id, md.marco)
  end as fonte,

  dd.dec_id,
  dd.partes_com_valor,
  coalesce(dd.rotulo, md.marco) as rotulo_original,

  -- ESTADO — a resposta a "passou por todas mesmo?"
  --   ATINGIDO_COM_VALOR .. aconteceu e a peca foi lida: da para reestimar
  --   ATINGIDO_SEM_VALOR .. aconteceu mas ninguem leu a peca -> esteira
  --   PULADO ............. nao aconteceu e o processo ja encerrou (acordo antes)
  --   PENDENTE ........... ainda pode acontecer
  case
    when g.degrau = 'PROTOCOLO' then
      case when p.data_protocolo is not null then 'ATINGIDO_COM_VALOR' else 'PENDENTE' end
    when g.degrau = 'PAGAMENTO' then
      case when pg.honorario_recebido is not null then 'ATINGIDO_COM_VALOR' else 'PENDENTE' end
    when dd.data_decisao is not null and coalesce(dd.partes_com_valor,0) > 0 then 'ATINGIDO_COM_VALOR'
    when dd.data_decisao is not null then 'ATINGIDO_SEM_VALOR'
    when md.data_marco   is not null then 'ATINGIDO_SEM_VALOR'
    when coalesce(e.fim, false)      then 'PULADO'
    else 'PENDENTE'
  end as estado,

  -- Por que o degrau ficou sem valor / foi pulado — texto para a tela e para a
  -- fila de conferencia.
  case
    when g.degrau in ('PROTOCOLO','PAGAMENTO') then null
    when dd.data_decisao is null and md.data_marco is not null then
      'Ato registrado nas movimentações (' || md.marco || ') sem peça lida. Anexar a peça e rodar jm_ler_documento.'
    when dd.data_decisao is not null and coalesce(dd.partes_com_valor,0) = 0 then
      'Decisão ' || dd.dec_id || ' cadastrada sem linha em jm_valores. Rodar jm_corrigir_valores_da_leitura.'
    when dd.data_decisao is null and md.data_marco is null and coalesce(e.fim,false) then
      case when e.data_acordo is not null
           then 'Processo encerrou por acordo em ' || e.data_acordo || ' sem passar por este degrau.'
           else 'Processo encerrou sem passar por este degrau.' end
  end as pendencia
from public.jm_processos p
cross join degraus g
left join dec_degrau  dd on dd.processo_cnj = p.processo_cnj and dd.degrau = g.degrau
left join marco_degrau md on md.processo_cnj = p.processo_cnj and md.degrau = g.degrau
left join pagamento   pg on pg.processo_cnj = p.processo_cnj
left join encerrado    e on  e.processo_cnj = p.processo_cnj;

comment on view public.vw_jm_escada_honorario is
  'Escada do honorário em formato longo: para cada processo, um degrau por marco financeiro (protocolo, sentença, acórdão 2G, superior, acordo, pagamento) com data, valor NOMINAL da peça e estado. ATINGIDO_SEM_VALOR é detector: o ato existe nas movimentações mas ninguém leu a peça — o degrau vai para a esteira de conserto, não é escondido nem estimado.';

-- ---------------------------------------------------------------------------
-- 2. vw_jm_escada_honorario_resumo — uma linha por processo
-- ---------------------------------------------------------------------------
create or replace view public.vw_jm_escada_honorario_resumo as
with esc as (
  select processo_cnj,
         max(data)   filter (where degrau = 'PROTOCOLO')  as dt_protocolo,
         max(data)   filter (where degrau = 'SENTENCA')   as dt_sentenca,
         max(valor_nominal) filter (where degrau = 'SENTENCA')   as cond_sentenca,
         max(estado) filter (where degrau = 'SENTENCA')   as st_sentenca,
         max(data)   filter (where degrau = 'ACORDAO_2G') as dt_acordao_2g,
         max(valor_nominal) filter (where degrau = 'ACORDAO_2G') as cond_acordao_2g,
         max(estado) filter (where degrau = 'ACORDAO_2G') as st_acordao_2g,
         max(data)   filter (where degrau = 'SUPERIOR')   as dt_superior,
         max(valor_nominal) filter (where degrau = 'SUPERIOR')   as cond_superior,
         max(estado) filter (where degrau = 'SUPERIOR')   as st_superior,
         max(data)   filter (where degrau = 'ACORDO')     as dt_acordo,
         max(estado) filter (where degrau = 'ACORDO')     as st_acordo,
         max(data)   filter (where degrau = 'PAGAMENTO')  as dt_primeiro_recebimento,
         count(*) filter (where estado = 'ATINGIDO_SEM_VALOR') as degraus_sem_valor,
         count(*) filter (where estado = 'PULADO')             as degraus_pulados
  from public.vw_jm_escada_honorario
  group by processo_cnj
),
esperado as (
  select processo_cnj,
         sum(coalesce(hc_vista,0) + coalesce(hc_parcelado,0)) as honorario_contratual,
         sum(coalesce(hs,0))                                  as honorario_sucumbencial,
         count(*)                                             as partes
  from public.jm_partes
  group by processo_cnj
),
caixa as (
  select processo_cnj,
         sum(valor_caixa) filter (where status = 'REALIZADO')                    as honorario_recebido,
         sum(valor_caixa) filter (where status = 'REALIZADO' and pessoa = 'HC')  as recebido_contratual,
         sum(valor_caixa) filter (where status = 'REALIZADO' and pessoa = 'HS')  as recebido_sucumbencial,
         sum(valor_caixa) filter (where status = 'A_RECEBER')                    as honorario_agendado,
         max(data)        filter (where status = 'REALIZADO')                    as ultimo_recebimento,
         max(data)        filter (where status = 'A_RECEBER')                    as ultima_parcela_prevista
  from public.jm_lancamentos
  where tipo = 'ENTRADA' and categoria ilike 'honor%'
  group by processo_cnj
)
select
  p.processo_cnj, p.caso, e.partes,
  esc.dt_protocolo, esc.dt_sentenca, esc.cond_sentenca, esc.st_sentenca,
  esc.dt_acordao_2g, esc.cond_acordao_2g, esc.st_acordao_2g,
  esc.dt_superior, esc.cond_superior, esc.st_superior,
  esc.dt_acordo, esc.st_acordo,
  r.tipo_resolucao, r.momento_acordo,
  e.honorario_contratual, e.honorario_sucumbencial,
  coalesce(e.honorario_contratual,0) + coalesce(e.honorario_sucumbencial,0) as honorario_fixado,
  c.honorario_recebido, c.recebido_contratual, c.recebido_sucumbencial,
  esc.dt_primeiro_recebimento, c.ultimo_recebimento,
  c.honorario_agendado, c.ultima_parcela_prevista,
  round(100 * c.honorario_recebido
        / nullif(coalesce(e.honorario_contratual,0) + coalesce(e.honorario_sucumbencial,0), 0), 1) as pct_do_fixado,
  round(100 * c.recebido_contratual / nullif(e.honorario_contratual, 0), 1) as pct_do_contratual,
  esc.degraus_sem_valor,
  esc.degraus_pulados,
  -- A escada e confiavel neste processo? So quando todo degrau atingido tem
  -- valor lido. Caso contrario a reestimativa apoia num numero velho.
  (esc.degraus_sem_valor = 0) as escada_completa
from public.jm_processos p
left join esc      on esc.processo_cnj = p.processo_cnj
left join esperado e on   e.processo_cnj = p.processo_cnj
left join caixa    c on   c.processo_cnj = p.processo_cnj
left join public.vw_jm_resolucao r on r.processo_cnj = p.processo_cnj;

comment on view public.vw_jm_escada_honorario_resumo is
  'Uma linha por processo: datas e valores de cada degrau da escada, honorário fixado x recebido (contratual e sucumbencial separados), % liberado e quantos degraus estão sem valor lido. escada_completa = false significa que a reestimativa do honorário naquele processo apoia em peça não lida.';

grant select on public.vw_jm_escada_honorario        to anon, authenticated, service_role;
grant select on public.vw_jm_escada_honorario_resumo to anon, authenticated, service_role;
