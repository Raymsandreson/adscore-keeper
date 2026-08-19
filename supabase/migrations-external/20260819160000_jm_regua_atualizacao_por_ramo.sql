-- =============================================================================
-- RÉGUA DE ATUALIZAÇÃO POR RAMO. Banco alvo: EXTERNO kmedldlepwiityjsdahz.
--
-- O PROBLEMA: a carteira tinha UM índice só, `SELIC_SIMPLES_JT` (soma simples
-- da SELIC). Isso corresponde ao regime da ADC 58 DEPOIS do ajuizamento, e só.
-- Aplicá-lo a tudo erra em duas frentes, medidas nesta base:
--   - 70 processos são de justiça COMUM (segmento 8 e 4 do CNJ), que nunca
--     seguiu a SELIC simples;
--   - desde 30/08/2024 vale a Lei 14.905/2024 (correção por IPCA, juros pela
--     taxa legal SELIC−IPCA com PISO ZERO), que o índice antigo ignora.
--
-- A REGRA É POR MÊS, NÃO POR CRÉDITO. Um crédito de 2022 corre sob ADC 58 até
-- ago/2024 e sob a Lei 14.905 daí em diante. Escolher UMA regra pela data do
-- crédito erraria os dois trechos. Por isso o fator é construído percorrendo
-- mês a mês e aplicando a regra vigente em CADA mês:
--
--   TRABALHISTA  mês <= 2024-08  -> SELIC simples somada (ADC 58)
--                mês >= 2024-09  -> correção IPCA (produto) + juros max(0, SELIC−IPCA)
--   COMUM        mês <= 2024-08  -> correção IPCA (produto) + juros 1% a.m. simples
--                mês >= 2024-09  -> idêntico ao trabalhista
--
--   fator = Π(1 + correção do mês) × (1 + Σ juros do mês)
--
-- Corrige-se o principal e só então incidem os juros sobre o corrigido — é como
-- as tabelas oficiais montam a conta.
--
-- CORTE MENSAL, e por que: a lei entrou em 30/08/2024, dois dias antes do fim do
-- mês. O corte aqui é em setembro. É a mesma simplificação das tabelas práticas
-- mensais; o pro-rata desses dois dias fica de fora e está registrado como
-- pendência em docs/sistema/metodologia-atualizacao.md.
--
-- DE ONDE VÊM AS TAXAS MENSAIS: não há série mensal crua gravada, mas ela se
-- recupera exatamente dos coeficientes acumulados que o `jm_indices_tick()` já
-- mantém, porque um é soma e o outro é produto:
--     SELIC(m) = coef_SELIC(m) − coef_SELIC(m+1)
--     IPCA(m)  = coef_TCM(m) / coef_TCM(m+1) − 1
-- CONFERIDO (19/08/2026) contra os valores que a migration 20260816000000
-- registrou como verificados no Bacen: SELIC jul/2026 = 1,22% e IPCA jul/2026 =
-- 0,06%. A derivação devolve exatamente esses dois números.
--
-- SAFRA: grava com a mesma `referencia` da safra vigente de SELIC/TCM, então os
-- índices novos versionam junto com os antigos e nada é sobrescrito.
--
-- NÃO REMOVE `SELIC_SIMPLES_JT`: ele continua sendo gravado pelo tick e as telas
-- que ainda o usam seguem funcionando. A migração de quem lê é passo separado.
--
-- REVERSÃO:
--   delete from public.jm_indices where indice in ('REGUA_TRABALHISTA','REGUA_COMUM');
--   drop function if exists public.jm_regua_por_ramo(date);
-- =============================================================================

create or replace function public.jm_regua_por_ramo(p_referencia date default null)
returns table (indice text, competencia date, coeficiente numeric, referencia date)
language sql
stable
as $$
  with ref as (
    select coalesce(date_trunc('month', p_referencia)::date,
                    (select max(i.referencia) from public.jm_indices i)) as r
  ),
  -- Taxas mensais reconstruídas dos coeficientes acumulados (ver cabeçalho).
  selic as (
    select i.competencia c,
           i.coeficiente - lead(i.coeficiente) over (order by i.competencia) as taxa
    from public.jm_indices i, ref
    where i.indice = 'SELIC_SIMPLES_JT' and i.referencia = ref.r
  ),
  ipca as (
    select i.competencia c,
           i.coeficiente / nullif(lead(i.coeficiente) over (order by i.competencia), 0) - 1 as taxa
    from public.jm_indices i, ref
    where i.indice = 'TCM_ESTADUAL' and i.referencia = ref.r
  ),
  mes as (
    select s.c, s.taxa as selic, p.taxa as ipca
    from selic s join ipca p on p.c = s.c
    where s.taxa is not null and p.taxa is not null
  ),
  -- A regra vigente em cada mês, para os dois ramos.
  regra as (
    select c,
      case when c >= date '2024-09-01' then ipca else 0 end            as corr_trab,
      case when c >= date '2024-09-01' then greatest(selic - ipca, 0)
           else selic end                                              as juros_trab,
      ipca                                                             as corr_comum,
      case when c >= date '2024-09-01' then greatest(selic - ipca, 0)
           else 0.01 end                                               as juros_comum
    from mes
  ),
  -- Para cada competência, acumula do mês dela até o fim da série.
  -- Correção é PRODUTO (composta), juros são SOMA (simples) — como nas tabelas.
  acum as (
    select c,
      exp(sum(ln(1 + corr_trab)) over (order by c desc rows between unbounded preceding and current row)) as f_corr_trab,
      sum(juros_trab)            over (order by c desc rows between unbounded preceding and current row)  as f_juros_trab,
      exp(sum(ln(1 + corr_comum)) over (order by c desc rows between unbounded preceding and current row)) as f_corr_comum,
      sum(juros_comum)           over (order by c desc rows between unbounded preceding and current row)  as f_juros_comum
    from regra
  )
  select 'REGUA_TRABALHISTA'::text, a.c, round(a.f_corr_trab * (1 + a.f_juros_trab), 10), ref.r from acum a, ref
  union all
  select 'REGUA_COMUM'::text,       a.c, round(a.f_corr_comum * (1 + a.f_juros_comum), 10), ref.r from acum a, ref
  union all
  -- Competência igual à referência vale 1,0: o mês corrente não corrige, mesma
  -- regra da tabela única do TST que o índice antigo já seguia.
  select r2.indice, ref.r, 1.0, ref.r
  from ref, (values ('REGUA_TRABALHISTA'),('REGUA_COMUM')) as r2(indice);
$$;

comment on function public.jm_regua_por_ramo(date) is
  'Coeficientes de atualização por ramo, montados mês a mês com a regra vigente '
  'em cada mês (ADC 58 até ago/2024, Lei 14.905/2024 daí em diante). Trabalhista '
  'e comum divergem só até ago/2024. Ver docs/sistema/metodologia-atualizacao.md.';

-- Grava a safra corrente. Idempotente: a chave única (indice, competencia,
-- referencia) faz a segunda execução no mesmo mês não duplicar nada.
insert into public.jm_indices (indice, ano, mes, competencia, coeficiente, referencia)
select indice, extract(year from competencia)::int, extract(month from competencia)::int,
       competencia, coeficiente, referencia
from public.jm_regua_por_ramo()
on conflict (indice, competencia, referencia) do update set coeficiente = excluded.coeficiente;
