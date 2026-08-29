# A régua dos estágios da carteira — decidida pelo Raym em 27/08/2026

Fonte da verdade para classificar cada parte da carteira. Substitui o `case`
atual de `pop_carteira_marcos`, que carimba `A_RECEBER` em qualquer processo
com marco de acordo, sem perguntar se existe data.

Vocabulário: skill `whatsjud-fluxo-vocabulario` (v4). Aqui está só como cada
estágio é **derivado do dado**, não o que ele significa.

---

## A régua, nas palavras do Raym

> "o status pago é melhor pegar do lançamentos honorários. só pega os valores
> de processos sem trânsito em julgado ainda, não pega os valores dos que estão
> sem sentença pq a projeção é baseada na média que você vai fazer dos pagos e
> das condenações e a receber... enfim os que têm decisão de mérito ou acordo.
> aí é pq já pegamos a decisão e colocamos os respectivos valores ganhos na
> tabela de lançamentos, mas de agora em diante é você mesmo lendo as decisões
> que vai preencher automaticamente e fazer as projeções com base nos dados de
> valores por parentesco que já tenho decisão ou acordo"

Traduzindo em três regras:

1. **PAGO vem de `jm_lancamentos`** (categoria `Honorários`, o caixa que
   entrou), não de `jm_pagamentos` nem do `status_pagamento` da planilha.
   Cobertura medida: `jm_lancamentos` alcança **88 CNJs** da carteira contra
   **39** de `jm_pagamentos` — mais que o dobro.
2. **Só tem valor real quem tem decisão de mérito ou acordo.** Quem está
   `SEM DECISÃO` não entra com valor: entra com **projeção**.
3. **A projeção é calculada, não digitada** — média por parentesco sobre a base
   de quem já tem decisão. De agora em diante quem lê as decisões e preenche é
   o sistema.

---

## A coluna que já responde isso

`jm_partes.decisao_merito` — existia e ninguém estava usando na régua:

| decisao_merito | partes | tem valor real? |
| --- | ---: | --- |
| SEM DECISÃO | 232 | não — projeta |
| ACORDO ANTES DA SENTENÇA | 106 | sim |
| EMBARGOS 2º GRAU | 61 | sim |
| EMBARGOS 1º GRAU | 51 | sim |
| SENTENÇA | 65 | sim |
| ACÓRDÃO 2º GRAU | 28 | sim |
| DECISÃO TST / ACÓRDÃO TST / DECISÃO STJ | 73 | sim |
| (vazio) | 19 | não — projeta |

O corte é `decisao_merito NOT IN ('', 'SEM DECISÃO')`. **Trânsito em julgado não
entra na régua** — basta ter decisão de mérito ou acordo, transitado ou não.

---

## A Tab. Aux. já fazia isso, à mão

O `PROJETADO` da planilha não é valor de processo: é **uma tabela de médias por
parentesco**, aplicada em bloco. Um único valor se repete em quase todas as
partes de cada parentesco:

| Parentesco | Valor congelado na planilha | Média real hoje | Distância |
| --- | ---: | ---: | ---: |
| IRMÃO | 65.470,00 | 65.323,87 | 0,2% |
| FILHO | 274.376,98 | 276.960,40 | 0,9% |
| PAIS | 175.571,11 | 175.276,03 | 0,2% |
| CÔNJUGE | 718.058,60 | 788.713,25 | 9,0% |
| ENTEADO | 226.424,07 | 226.424,08 | 0,0% |

É a média, congelada na data em que alguém a calculou. O pedido do Raym é que
ela passe a ser recalculada sozinha a cada decisão nova.

---

## O problema da média (levantado em 27/08, decisão pendente)

A distribuição é muito assimétrica: poucos casos gigantes puxam a média para
longe do caso típico. Base = partes com decisão de mérito ou acordo.

| Parentesco | A projetar | Base | Pela média | Pela mediana | Razão |
| --- | ---: | ---: | ---: | ---: | ---: |
| CÔNJUGE | 32 | 49 | 25.828.987,20 | 14.257.619,52 | 1,8x |
| FILHO | 80 | 129 | 23.069.816,00 | 16.347.842,40 | 1,4x |
| PAIS | 45 | 89 | 7.976.192,85 | 4.372.139,70 | 1,8x |
| IRMÃO | 91 | 136 | 5.944.667,82 | 2.451.596,42 | 2,4x |
| VÍTIMA | 8 | 14 | 7.472.727,52 | 1.924.745,20 | 3,9x |
| ENTEADO | 5 | 4 | 1.132.120,40 | 390.162,35 | 2,9x |

| Cenário | Projetado |
| --- | ---: |
| hoje (Tab. Aux., média congelada) | 59.677.802,03 |
| recalculado pela **média** | 71.424.511,79 (+19,7%) |
| recalculado pela **mediana** | 39.744.105,59 (−33,4%) |

**R$ 31,68 milhões separam os dois critérios.** O caso extremo é VÍTIMA: média
R$ 769.251,36 contra mediana R$ 117.180,80, com base de 14 partes.

Recomendação técnica: **mediana**, ou média aparada (descartando o maior e o
menor de cada parentesco). Projeção não é para acertar o caso raro, é para não
mentir sobre o caso típico — e a mediana é o que a gestora aceita defender num
relatório. Decisão é do Raym.

---

## Buracos de cadastro que a régua expõe

- **ESPOSA** (1 parte a projetar) não tem base própria: a única parte ESPOSA
  com decisão tem valor 0. Deve ser normalizado para CÔNJUGE.
- **7 partes com `SENTENÇA` marcadas `PROJETADO`** (R$ 2.128.464,04) — a
  planilha se contradiz. Com a régua nova elas passam a ter valor real.
- **ENTEADO projeta 5 partes com base de 4** — base pequena demais para
  sustentar média. Vale agrupar com FILHO ou marcar a projeção como frágil.

---

## O que falta para implementar

1. Confirmar média × mediana (acima).
2. Migration na RPC `pop_carteira_marcos` — DDL em produção.
3. A leitura automática das decisões preenchendo `jm_valores` / `jm_partes`
   (hoje é manual, feita pela equipe e lançada na planilha).
4. Recalcular a tabela de médias por parentesco a cada decisão nova, em vez do
   valor congelado.
