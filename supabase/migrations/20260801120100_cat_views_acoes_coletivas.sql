-- Views analíticas sobre public.cat_acidentes, desenhadas para a tese de ação coletiva/ACP:
--   1. Frequência e constância  -> mv_cat_padrao_empresa
--   2. Mesma causa raiz         -> mv_cat_padrao_empresa (chave = dinâmica do acidente)
--   3. Inércia do empregador    -> vw_cat_inercia_empregador
--   4. Dano moral coletivo      -> vw_cat_ranking_empresa / vw_cat_obitos_empresa
--   5. Risco setorial (quando o réu não é uma empresa só) -> vw_cat_cluster_setorial
--
-- A view base é MATERIALIZADA: a agregação varre a tabela inteira (ordem de milhões de
-- linhas) e seria cara para consulta interativa. Atualizar com:
--   refresh materialized view concurrently public.mv_cat_padrao_empresa;
-- após cada importação de competência.

-- ---------------------------------------------------------------------------
-- BASE: um grupo por (empregador × dinâmica do acidente) com 2+ ocorrências.
-- "Mesma dinâmica" = mesmo agente causador + mesma parte do corpo + mesma natureza da lesão.
-- Corte em 2 (não 3) para não perder o caso que vira 3 na próxima competência;
-- o filtro de 3+ fica nas views de cima, que é onde a tese exige.
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_cat_padrao_empresa cascade;

create materialized view public.mv_cat_padrao_empresa as
select
  c.cnpj_cei_empregador,
  c.cnpj_raiz,
  c.agente_causador,
  c.parte_corpo_atingida,
  c.natureza_lesao,
  max(c.cnae_codigo)                                        as cnae_codigo,
  max(c.cnae_descricao)                                     as cnae_descricao,
  max(c.municipio_empregador_nome)                          as municipio_empregador,
  max(c.uf_municipio_empregador)                            as uf_empregador,
  count(*)                                                  as qtd_acidentes,
  count(*) filter (where c.indica_obito)                    as qtd_obitos,
  count(*) filter (where c.tipo_acidente = 'Típico')        as qtd_tipicos,
  count(*) filter (where c.tipo_acidente = 'Doença')        as qtd_doencas,
  count(distinct c.cbo_codigo)                              as qtd_cbos_distintos,
  count(distinct c.cid10_codigo)                            as qtd_cids_distintos,
  min(c.data_acidente)                                      as primeiro_acidente,
  max(c.data_acidente)                                      as ultimo_acidente,
  (max(c.data_acidente) - min(c.data_acidente))             as janela_dias,
  array_agg(distinct c.cid10_codigo) filter (where c.cid10_codigo is not null) as cids,
  array_agg(distinct c.cbo_codigo)   filter (where c.cbo_codigo   is not null) as cbos
from public.cat_acidentes c
where c.cnpj_cei_empregador is not null
  and c.cnpj_cei_empregador <> ''
  and c.data_acidente is not null
  -- sem os três campos da dinâmica não dá para afirmar "mesmo padrão".
  -- O importador converte '{ñ class}'/'Ignorado' em NULL; sem este filtro,
  -- todos os não classificados de uma empresa virariam um falso padrão gigante.
  and c.agente_causador      is not null
  and c.parte_corpo_atingida is not null
  and c.natureza_lesao       is not null
group by 1, 2, 3, 4, 5
having count(*) >= 2;

comment on materialized view public.mv_cat_padrao_empresa is
  'Empregador x dinâmica do acidente com 2+ ocorrências. Base das views de ação coletiva. Refresh após cada importação.';

-- concurrently exige índice único
create unique index mv_cat_padrao_empresa_uidx
  on public.mv_cat_padrao_empresa (cnpj_cei_empregador, agente_causador, parte_corpo_atingida, natureza_lesao);
create index mv_cat_padrao_empresa_qtd_idx  on public.mv_cat_padrao_empresa (qtd_acidentes desc);
create index mv_cat_padrao_empresa_raiz_idx on public.mv_cat_padrao_empresa (cnpj_raiz);
create index mv_cat_padrao_empresa_cnae_idx on public.mv_cat_padrao_empresa (cnae_codigo);

-- ---------------------------------------------------------------------------
-- 1) NEXO CAUSAL EPIDEMIOLÓGICO
-- 3+ acidentes de dinâmica idêntica. `concentrado` marca o caso mais forte:
-- repetição em janela curta afasta com folga a tese de culpa exclusiva da vítima.
-- ---------------------------------------------------------------------------
create or replace view public.vw_cat_nexo_epidemiologico as
select
  p.*,
  round(p.qtd_acidentes::numeric / greatest(p.janela_dias, 1) * 365, 2) as acidentes_por_ano,
  (p.janela_dias <= 365)                                               as concentrado_12m,
  case
    when p.qtd_obitos > 0                             then 'crítico'
    when p.qtd_acidentes >= 10                        then 'muito forte'
    when p.qtd_acidentes >= 5                         then 'forte'
    when p.qtd_acidentes >= 3 and p.janela_dias <= 365 then 'forte'
    else 'moderado'
  end                                                                  as forca_indicio
from public.mv_cat_padrao_empresa p
where p.qtd_acidentes >= 3;

comment on view public.vw_cat_nexo_epidemiologico is
  'Empregadores com 3+ acidentes de dinâmica idêntica. Ponto de partida da triagem de ação coletiva.';

-- ---------------------------------------------------------------------------
-- 2) INÉRCIA DO EMPREGADOR  — a view juridicamente mais forte.
-- Conta os acidentes que ocorreram DEPOIS de a empresa já ter tido o primeiro
-- (e o segundo) do mesmo padrão, com folga de tempo para agir.
-- `acidentes_apos_180d_do_1o` > 0 é a prova de que nada mudou após o alerta.
-- ---------------------------------------------------------------------------
create or replace view public.vw_cat_inercia_empregador as
with base as (
  select
    c.cnpj_cei_empregador,
    c.agente_causador,
    c.parte_corpo_atingida,
    c.natureza_lesao,
    c.data_acidente,
    c.indica_obito,
    min(c.data_acidente) over w  as primeiro_acidente,
    row_number()        over (partition by c.cnpj_cei_empregador, c.agente_causador,
                                           c.parte_corpo_atingida, c.natureza_lesao
                              order by c.data_acidente) as ordem
  from public.cat_acidentes c
  where c.cnpj_cei_empregador is not null
    and c.cnpj_cei_empregador <> ''
    and c.data_acidente is not null
    and c.agente_causador      is not null
    and c.parte_corpo_atingida is not null
    and c.natureza_lesao       is not null
  window w as (partition by c.cnpj_cei_empregador, c.agente_causador,
                            c.parte_corpo_atingida, c.natureza_lesao)
)
select
  b.cnpj_cei_empregador,
  b.agente_causador,
  b.parte_corpo_atingida,
  b.natureza_lesao,
  b.primeiro_acidente,
  count(*)                                                                as qtd_total,
  count(*) filter (where b.ordem > 1)                                     as qtd_apos_o_primeiro,
  count(*) filter (where b.data_acidente > b.primeiro_acidente + 90)      as acidentes_apos_90d_do_1o,
  count(*) filter (where b.data_acidente > b.primeiro_acidente + 180)     as acidentes_apos_180d_do_1o,
  count(*) filter (where b.data_acidente > b.primeiro_acidente + 365)     as acidentes_apos_1ano_do_1o,
  count(*) filter (where b.ordem > 2)                                     as qtd_apos_o_segundo,
  count(*) filter (where b.indica_obito and b.ordem > 1)                  as obitos_apos_o_primeiro,
  max(b.data_acidente)                                                    as ultimo_acidente,
  (max(b.data_acidente) - b.primeiro_acidente)                            as janela_dias
from base b
group by b.cnpj_cei_empregador, b.agente_causador, b.parte_corpo_atingida,
         b.natureza_lesao, b.primeiro_acidente
having count(*) filter (where b.data_acidente > b.primeiro_acidente + 180) > 0;

comment on view public.vw_cat_inercia_empregador is
  'Padrões em que houve novo acidente idêntico mais de 180 dias após o primeiro — prova de que o empregador teve tempo e não adotou medida. Coluna acidentes_apos_180d_do_1o é a que sustenta a tese de conduta ilícita continuada.';

-- ---------------------------------------------------------------------------
-- 3) RANKING GERAL POR EMPREGADOR — visão de carteira, para priorizar alvos.
-- ---------------------------------------------------------------------------
create or replace view public.vw_cat_ranking_empresa as
select
  c.cnpj_cei_empregador,
  c.cnpj_raiz,
  max(c.cnae_codigo)                                     as cnae_codigo,
  max(c.cnae_descricao)                                  as cnae_descricao,
  max(c.municipio_empregador_nome)                       as municipio,
  max(c.uf_municipio_empregador)                         as uf,
  count(*)                                               as total_cats,
  count(*) filter (where c.indica_obito)                 as obitos,
  count(*) filter (where c.tipo_acidente = 'Típico')     as tipicos,
  count(*) filter (where c.tipo_acidente = 'Trajeto')    as trajeto,
  count(*) filter (where c.tipo_acidente = 'Doença')     as doencas,
  count(distinct c.agente_causador)                      as agentes_distintos,
  count(distinct c.cid10_codigo)                         as cids_distintos,
  min(c.data_acidente)                                   as primeiro_acidente,
  max(c.data_acidente)                                   as ultimo_acidente,
  (select count(*) from public.mv_cat_padrao_empresa m
    where m.cnpj_cei_empregador = c.cnpj_cei_empregador
      and m.qtd_acidentes >= 3)                          as padroes_reiterados
from public.cat_acidentes c
where c.cnpj_cei_empregador is not null
  and c.cnpj_cei_empregador <> ''
group by c.cnpj_cei_empregador, c.cnpj_raiz;

comment on view public.vw_cat_ranking_empresa is
  'Uma linha por CNPJ/CEI com totais, óbitos e quantos padrões reiterados (3+) a empresa acumula.';

-- ---------------------------------------------------------------------------
-- 4) ÓBITOS POR EMPREGADOR — recorte de maior gravidade.
-- ---------------------------------------------------------------------------
create or replace view public.vw_cat_obitos_empresa as
select
  c.cnpj_cei_empregador,
  max(c.cnae_descricao)             as cnae_descricao,
  max(c.municipio_empregador_nome)  as municipio,
  max(c.uf_municipio_empregador)    as uf,
  count(*)                          as obitos,
  min(c.data_acidente)              as primeiro_obito,
  max(c.data_acidente)              as ultimo_obito,
  array_agg(distinct c.agente_causador) as agentes_causadores
from public.cat_acidentes c
where c.indica_obito
  and c.cnpj_cei_empregador is not null
  and c.cnpj_cei_empregador <> ''
group by c.cnpj_cei_empregador;

-- ---------------------------------------------------------------------------
-- 5) CLUSTER SETORIAL — para ACP contra setor/sindicato patronal, quando o
-- risco é do ramo e do território, não de uma empresa isolada.
-- ---------------------------------------------------------------------------
create or replace view public.vw_cat_cluster_setorial as
select
  c.cnae_codigo,
  max(c.cnae_descricao)                     as cnae_descricao,
  c.uf_municipio_empregador                 as uf,
  c.municipio_empregador_nome               as municipio,
  c.agente_causador,
  c.parte_corpo_atingida,
  count(*)                                  as qtd_acidentes,
  count(distinct c.cnpj_cei_empregador)     as qtd_empresas,
  count(*) filter (where c.indica_obito)    as obitos,
  min(c.data_acidente)                      as primeiro_acidente,
  max(c.data_acidente)                      as ultimo_acidente
from public.cat_acidentes c
where c.cnae_codigo is not null and c.cnae_codigo <> '0000'
group by c.cnae_codigo, c.uf_municipio_empregador, c.municipio_empregador_nome,
         c.agente_causador, c.parte_corpo_atingida
having count(*) >= 5 and count(distinct c.cnpj_cei_empregador) >= 3;

comment on view public.vw_cat_cluster_setorial is
  'Mesma dinâmica repetida em 3+ empresas do mesmo CNAE e município — base para ACP setorial.';

-- ---------------------------------------------------------------------------
-- 6) PONTE COM O CRM — CATs da base analítica cujo empregador já aparece
-- em cat_leads. Mostra onde já temos cliente/contato dentro de um padrão.
-- ---------------------------------------------------------------------------
create or replace view public.vw_cat_padrao_com_lead as
select
  p.cnpj_cei_empregador,
  p.agente_causador,
  p.parte_corpo_atingida,
  p.natureza_lesao,
  p.qtd_acidentes,
  p.qtd_obitos,
  p.primeiro_acidente,
  p.ultimo_acidente,
  count(l.id)                                     as leads_na_base,
  count(l.id) filter (where l.lead_id is not null) as leads_ja_no_crm
from public.mv_cat_padrao_empresa p
left join public.cat_leads l
  on l.cnpj_cei_empregador = p.cnpj_cei_empregador
where p.qtd_acidentes >= 3
group by p.cnpj_cei_empregador, p.agente_causador, p.parte_corpo_atingida,
         p.natureza_lesao, p.qtd_acidentes, p.qtd_obitos,
         p.primeiro_acidente, p.ultimo_acidente;

comment on view public.vw_cat_padrao_com_lead is
  'Cruza padrões reiterados com cat_leads: mostra em quais empresas com padrão já temos contato/lead.';
