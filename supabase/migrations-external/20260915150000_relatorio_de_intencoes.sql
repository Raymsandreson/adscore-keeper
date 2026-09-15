-- =============================================================================
-- Relatório de intenções: o que os clientes pedem, e o que o Dom fez (15/09/2026)
--
-- O painel já filtrava por intenção, mas só dentro da FILA CARREGADA — contava
-- o que está pendente agora, não o que aconteceu. Não dava para responder
-- "reclamação aumentou esta semana?" nem "quantos falaram em desistir no mês?".
--
-- A fonte é `dom_decisoes`, que guarda TODA decisão do agente — inclusive o
-- silêncio. Quem olha só a fila vê o que sobrou; quem olha as decisões vê o que
-- entrou. As duas perguntas são diferentes e as duas importam.
--
-- POR QUE AGREGAR NO BANCO
--
-- Hoje são 1.292 linhas, e com o Dom ligado entram ~200 por dia. Baixar tudo
-- para somar no navegador funciona neste mês e fica ruim no terceiro. A conta
-- sai no Postgres, que já tem os dados e devolve uma linha por intenção.
--
-- SEGURANÇA: as duas funções são SECURITY INVOKER (o padrão) de propósito — a
-- RLS de `dom_decisoes` continua valendo, e a policy `dom_decisoes_rw` já dá
-- leitura a `authenticated`. Nada aqui amplia acesso; só evita trazer linha
-- crua para a tela. E nenhuma das duas devolve `pergunta` ou `motivo`, que
-- carregam texto escrito pelo cliente: relatório é contagem, não conversa.
-- =============================================================================

-- Uma linha por intenção, com o desfecho de cada uma.
create or replace function public.dom_intencoes_resumo(p_dias integer default 7)
returns table (
  intencao        text,
  total           bigint,
  respondeu       bigint,
  precisou_gente  bigint,
  calou           bigint,
  pulou           bigint,
  virou_fila      bigint,
  grupos          bigint,
  ultima          timestamptz
)
language sql
stable
as $$
  select
    coalesce(d.intencao, '(sem classificação)') as intencao,
    count(*)                                            as total,
    count(*) filter (where d.decisao = 'respondeu')      as respondeu,
    count(*) filter (where d.decisao = 'humano')         as precisou_gente,
    count(*) filter (where d.decisao = 'silencio')       as calou,
    count(*) filter (where d.decisao = 'pulou')          as pulou,
    count(*) filter (where d.pendente_id is not null)    as virou_fila,
    count(distinct d.group_jid)                          as grupos,
    max(d.criado_em)                                     as ultima
  from public.dom_decisoes d
  where d.criado_em > now() - make_interval(days => greatest(p_dias, 1))
  group by 1
  order by 2 desc;
$$;

-- Série diária por FAMÍLIA (a letra), não por código: um gráfico com 23 linhas
-- não se lê. Quem quer o código tem o resumo acima.
create or replace function public.dom_intencoes_por_dia(p_dias integer default 30)
returns table (
  dia      date,
  familia  text,
  total    bigint
)
language sql
stable
as $$
  select
    (d.criado_em at time zone 'America/Fortaleza')::date as dia,
    case
      when d.intencao is null           then 'sem classificação'
      when d.intencao = 'COBRANCA'      then 'cobrança'
      when left(d.intencao, 1) = 'A'    then 'perguntou algo'
      when left(d.intencao, 1) = 'B'    then 'desabafo'
      when left(d.intencao, 1) = 'C'    then 'entregou algo'
      when left(d.intencao, 1) = 'D'    then 'não pede resposta'
      when left(d.intencao, 1) = 'E'    then 'precisa de gente'
      else 'outra'
    end                                                  as familia,
    count(*)                                             as total
  from public.dom_decisoes d
  where d.criado_em > now() - make_interval(days => greatest(p_dias, 1))
  group by 1, 2
  order by 1, 2;
$$;

-- O dia sai no fuso de Teresina, não em UTC: com a conta em UTC, tudo que a
-- equipe atende depois das 21h entra no dia seguinte e o gráfico mente sobre
-- qual dia foi movimentado.

comment on function public.dom_intencoes_resumo(integer) is
  'Relatório do atendente virtual: uma linha por intenção com total e desfecho, nos últimos N dias.';
comment on function public.dom_intencoes_por_dia(integer) is
  'Relatório do atendente virtual: série diária por família de intenção, no fuso de Teresina.';

grant execute on function public.dom_intencoes_resumo(integer)  to authenticated;
grant execute on function public.dom_intencoes_por_dia(integer) to authenticated;

-- ROLLBACK
--   drop function if exists public.dom_intencoes_resumo(integer);
--   drop function if exists public.dom_intencoes_por_dia(integer);
