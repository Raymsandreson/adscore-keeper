# A escada do honorário — datas, valores por decisão e o degrau que foi pulado

Documento nasceu do pedido do Raym em 03/09/2026 sobre o
`Modelo_Antecipacao_Chimera_v7.xlsx`:

> "Só o que interessa é o honorário recebido e as datas da sentença, acórdão 2G,
> acórdão TST, pagamento. Pq aí que tem os percentuais de liberação em cima do
> honorário esperado. Só que teria também que ter o valor em cada uma dessas
> decisões e se passou por todas mesmo... pode ser que tenha feito um acordo
> antes."

Metáfora: a escada é um lance de degraus com um valor pintado em cada um. O fundo
libera dinheiro ao pisar em cada degrau. Hoje a planilha sabe que o processo está
"em algum lugar da escada", mas não sabe **em que degrau**, **quando pisou** nem
**quanto valia o degrau na hora em que pisou** — e não percebe quando alguém
desceu de elevador (acordo) em vez de subir até o topo.

---

## 1. O que a planilha tem, e por que não fecha

Aba **Casos reais**, 32 linhas. Datas: só três — `PROTOCOLO` (G), `1a ENTRADA`
(H), `ULTIMA ENTRADA` (I). Decisão: **um rótulo de texto** na coluna AG
("EMBARGOS 2o GRAU", "ACORDAO TST", "SEM DECISAO").

A aba **Simulador** define a escada que o fundo contratou:

| Marco | % da tranche | % acumulado |
|---|---|---|
| Protocolo | 10% | 10% |
| Sentença | 5% | 15% |
| Acórdão 2ºG | 10% | 25% |
| Acórdão Superior | 5% | 30% |
| Final (recebimento) | 10% | 40% |

E, ao lado de cada marco, uma coluna **`HONORARIO REESTIMADO`** — a escada
recalcula o honorário esperado a cada degrau. Para rodar isso nos 32 casos reais
faltam **a data de cada degrau** e **o honorário reestimado em cada degrau**.
Nenhum dos dois está na aba Casos reais.

### O rótulo da coluna AG está velho — prova

Caso **107** (`0000417-95.2022.5.08.0110`): a planilha diz `A RECEBER` /
`EMBARGOS 2o GRAU`. O banco diz:

| Degrau | Data | Valor nominal |
|---|---|---|
| Protocolo | 06/07/2022 | — |
| Sentença | 19/12/2023 | R$ 917.900,00 |
| Acórdão 2ºG | 20/06/2024 | R$ 977.900,00 |
| **Superior** | — | **PULADO** |
| Acordo homologado | **27/03/2025** | (peça não lida) |
| Honorário no caixa | **02/04/2025** | **R$ 414.492,99** |

Ele nunca teve decisão de instância superior: houve juízo de admissibilidade do
recurso de revista em 07/10/2024, mas o processo fechou acordo depois do acórdão
do TRT e o dinheiro caiu **seis dias depois** da homologação. Quem liberasse tranche por "está em embargos de 2º
grau" estaria pagando por um degrau que não vai existir.

E não é caso isolado: **6 processos** aparecem na planilha com `DECISAO =
SEM DECISAO`; no banco, **4 deles** (`0001529-83`, `0000329-41`, `0016206-20`,
`0000042-08`) são `ACORDO_ANTES_SENTENCA` **já pagos**, e um quinto
(`0000496-65`) é `ACORDO_POS_ACORDAO_2G`. A hipótese do Raym ("pode ser que
tenha feito um acordo antes") se confirma em 4 de 6.

---

## 2. As duas fontes do banco — e por que nenhuma resolve sozinha

| Fonte | Tem | Não tem |
|---|---|---|
| `jm_decisoes` + `jm_valores` | **valor** por decisão e por parte (dano moral, estético, base × meses) | está **atrasada** — só existe até onde alguém leu a peça |
| `vw_jm_marcos` (de `jm_movimentos`, Escavador) | **data** de todo ato decisório, atualizada | valor nenhum |
| `jm_lancamentos` | honorário **no caixa**, com data, `status` (REALIZADO / A_RECEBER) e `pessoa` (HC / HS) | — |

Medição de 03/09/2026 nos 32 casos da planilha: **27 processos têm pelo menos um
degrau decisório posterior à última peça lida — 65 degraus sem valor no total.**

Exemplo: `0000075-06.2023.5.19.0058` (caso 136). Última peça lida: 22/02/2024.
Os marcos mostram acórdão 2ºG em 21/01/2025 e acordo homologado em 02/07/2025.
O `momento_acordo` da `vw_jm_resolucao` diz `ACORDO_POS_ACORDAO_2G` — está certo;
quem está incompleto é o `jm_decisoes`.

### O honorário recebido, esse, fecha

`jm_lancamentos` com `tipo='ENTRADA'`, `categoria ilike 'honor%'` e
`status='REALIZADO'` bate **ao centavo** com a coluna P (`HONORARIO RECEBIDO
24-26`) em **26 dos 32** casos. Os 6 restantes divergem porque a planilha é um
retrato de data anterior — e porque o filtro `status` importa:
`0010336-62.2024.5.03.0083` tem R$ 7.948,98 realizados e R$ 48.455,54 apenas
agendados; somar os dois dá R$ 56.404,52 e infla o recebido em 7×.

`pessoa = 'HC' | 'HS'` separa contratual de sucumbencial no caixa — é o par das
colunas K e L da planilha.

---

## 3. Por que "valor em cada decisão" não é preciosismo

`0001240-82.2020.5.06.0211` (caso 98):

| Degrau | Data | Condenação nominal |
|---|---|---|
| Sentença | 09/11/2021 | R$ 392.200,00 |
| Acórdão 2ºG | 03/02/2022 | **R$ 30.000,00** |
| Decisão TST | 13/10/2022 | R$ 30.000,00 |

O 2º grau reformou e cortou 92% da condenação. Uma escada que reestimasse o
honorário só na sentença teria liberado tranche sobre uma base 13× maior do que
a que sobreviveu. É exatamente o degrau em que a reestimativa salva dinheiro.

O inverso também acontece: `0100419-74.2021.5.01.0281` foi de R$ 400.067,60 na
sentença para R$ 1.756.900,58 no acórdão 2ºG.

---

## 4. O que foi entregue

`supabase/migrations-external/20260903120000_escada_do_honorario_datas_valores_por_decisao.sql`
cria duas views (aditivas, revertíveis com dois `drop view`):

**`vw_jm_escada_honorario`** — formato longo, uma linha por (processo × degrau).
Degraus: `PROTOCOLO`, `SENTENCA`, `ACORDAO_2G`, `SUPERIOR`, `ACORDO`,
`PAGAMENTO`. Colunas: `data`, `valor_nominal`, `dec_id`, `rotulo_original`,
`estado`, `pendencia`.

Os quatro estados respondem "passou por todas mesmo?":

| Estado | Significa | O que fazer |
|---|---|---|
| `ATINGIDO_COM_VALOR` | pisou e a peça foi lida | dá para reestimar |
| `ATINGIDO_SEM_VALOR` | pisou, mas ninguém leu a peça | anexar a peça → `jm_ler_documento` → `jm_corrigir_valores_da_leitura` |
| `PULADO` | não pisou e o processo já encerrou (tipicamente acordo antes) | nada — o degrau não vai existir |
| `PENDENTE` | ainda pode acontecer | acompanhar |

**`vw_jm_escada_honorario_resumo`** — uma linha por processo, com as datas e
valores dos degraus lado a lado, honorário fixado × recebido (contratual e
sucumbencial separados), `pct_do_fixado`, `pct_do_contratual`,
`degraus_sem_valor` e `escada_completa`.

### Regra que as views seguem (skill `conserto-estrutural-nao-pontual`)

Degrau sem valor **não é escondido nem estimado**. Ele aparece como
`ATINGIDO_SEM_VALOR` com a data e o marco que o denunciam, e vai para a esteira
de conserto que já existe. A view é **detector, não filtro**.

---

## 5. O que as views deliberadamente NÃO fazem

1. **Não calculam "honorário esperado naquela data".** O valor por decisão aqui é
   **nominal** — o que a peça escreveu.

   > **Correção de 03/09/2026.** A versão anterior deste texto dizia que "a
   > data-base da correção não está gravada em lugar nenhum do banco". Está
   > errado. Quem determina o termo inicial é **cada sentença ou acórdão**, e ele
   > está em **`jm_decisoes.termo_inicial_jcm`** — preenchido em **435 das 439
   > decisões (99,1%)**; em `jm_partes.termo_inicial_jcm`, em 799 de 1.222 partes
   > (65,4%). Em 32% das decisões o termo é a própria data da decisão; nas outras
   > 68% é anterior (data do acidente, do ajuizamento, da citação) — por isso a
   > coluna existe separada e **não** pode ser substituída por `data_decisao`.

   O que continua faltando é outra coisa: a **data FINAL** até a qual a Tab. Aux
   corrigiu o `condenacao_cjcm` (ver `metodologia-atualizacao.md`, seção 0). Sem
   ela não dá para saber se aquele CJCM está velho, nem completar a correção até
   hoje. Aplicar coeficiente sobre o CJCM repetiria o erro de 19/08/2026, que
   inventou R$ 260 mil numa tela.

   Para o valor NOMINAL da decisão o caminho está aberto: `jm_atualizar(valor,
   jm_decisoes.termo_inicial_jcm, ramo)` corrige da data que a própria peça
   mandou. Falta só a régua de **juros de mora** — no caso 107 o nominal
   corrigido dá R$ 1.229.220,30 contra R$ 1.635.037,25 de `condenacao_cjcm`, e a
   diferença é juros.
2. **Não guardam os percentuais 10/5/10/5/10.** Aquilo é cláusula do fundo, não
   fato do processo. As views entregam os fatos em que o percentual se apoia.
3. **Granularidade é o PROCESSO.** A carteira é `(processo × cliente)`; o
   honorário vem somado das partes. Para rateio por cliente, `jm_partes` /
   `vw_jm_visao_processo`.

---

## 6. O que ainda falta para a escada rodar de ponta a ponta

| # | Falta | Sem isso |
|---|---|---|
| 1 | Ler as peças dos **65 degraus** marcados `ATINGIDO_SEM_VALOR` nos 32 casos | a reestimativa apoia em número velho |
| 2 | A **data final** da correção da Tab. Aux (o termo INICIAL já existe em `jm_decisoes.termo_inicial_jcm`), e a régua de **juros de mora** | não dá para converter valor nominal da decisão em valor de hoje |
| 3 | Os **percentuais do contrato do fundo** gravados em algum lugar (hoje só na aba Simulador) | a liberação continua sendo conta de planilha, não do sistema |
| 4 | `0100419-74.2021.5.01.0281`: `hs = R$ 20.576.341,93` contra condenação nominal de R$ 1.756.900,58 | valor improvável — detector aponta, a peça decide. Não filtrar na tela |

