# Aba Métricas

`/metricas` (menu **Financeiro → Métricas**). Página:
`src/pages/MetricasPage.tsx`. Backend: `railway-server/src/functions/metricas-painel.ts`.

Uma chamada devolve tudo. Fica no Railway, não no navegador, porque o token da
Meta não pode chegar ao front e `meta_capi_events` tem RLS sem policy.

## O que mostra

| Bloco | Fonte |
|---|---|
| Investido hoje / 7d / 30d | Marketing API, ao vivo (`act_*/insights`, `time_increment=1`) |
| Leads hoje / 7d / 30d | `leads.created_at` |
| Fechamentos hoje / 7d / 30d | `leads.became_client_date` |
| Custo por lead pago (7d) | gasto 7d ÷ leads pagos 7d |
| Fila de conversões | `meta_capi_events` por status |
| Gráfico de 30 dias | barras de leads/fechamentos + linha de investimento |

Lead **pago** = tem `facebook_lead_id` ou `source ilike '%planilha meta ads%'`.

## Regra da tela

Número que não pode ser calculado com honestidade aparece como **"—" com o
motivo do lado**, nunca como zero. É por isso que o CPL de 30 dias vem vazio:
lead pago só existe no CRM desde 28/08/2026, então dividir 30 dias de
investimento por poucos dias de lead daria um custo inventado. Importar o
backlog das planilhas é o que destrava.

## Dia civil: as duas armadilhas (corrigidas em 09/09/2026)

Ambas produziam número errado com cara de métrica, e a tela **se contradizia
sozinha** — o gráfico somava 3.536 leads enquanto o card dizia 3.615.

**1. O dia era UTC.** `toISOString().slice(0,10)` devolve o dia de Greenwich, e o
Brasil é UTC-3: "hoje" começava às 21h de ontem. Medido: o card dizia 130 leads,
e 5 tinham chegado entre 21:01 e 22:24 do dia anterior.

Pior, o insights da Meta já vem no fuso **da conta**, e as duas contas são
`America/Sao_Paulo` (confirmado por `meta-capi-dispatch` `modo: inventario`, que
agora mostra o campo `fuso`). A barra de leads e a linha de gasto do gráfico
estavam deslocadas três horas uma da outra.

**2. "7 dias" tinha oito.** O corte era `diasAtras(7)` com filtro `>=`, o que
inclui as duas pontas. Efeito medido em 09/09/2026:

| | Publicado | Real |
|---|---:|---:|
| Leads em 7 dias | 1.066 | 822 |
| Fechamentos em 7 dias | 63 | 38 |
| Leads de anúncio em 7 dias | 109 | 73 |
| Custo por lead pago | R$ 52,39 | R$ 61,67 |

Fechamento era o pior caso: **+66%**, porque um dia extra pesa muito em volume
baixo.

### Como não volta

`railway-server/src/lib/diasSaoPaulo.ts` (módulo puro, com teste):

- `diaDoInstante(v)` para coluna `timestamptz` — **converte** o fuso;
- `diaDaColuna(v)` para coluna `DATE` — **não converte** (um DATE já é o dia
  civil; passá-lo por fuso jogaria todo fechamento um dia para trás);
- `corteDeDias(n)` para montar janela que **inclui hoje**. Pede-se a janela pelo
  tamanho dela, então o off-by-one deixa de ser escrevível. `corteDeDias(0)`
  lança em vez de devolver data torta.

A borda do fetch também é `-03:00`, não `Z` — com `Z` a busca começava três
horas antes e o card "em 30" contava a mais.
