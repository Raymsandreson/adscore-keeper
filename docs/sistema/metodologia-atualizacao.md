# Metodologia de atualização — como um crédito da carteira vira valor de hoje

Este documento existe porque a mesma pergunta ("quanto vale hoje?") tem resposta
diferente conforme o ramo da justiça, a data do fato e a natureza da verba. Sem
uma régua escrita, cada tela responde uma coisa e ninguém sabe qual está certa.

**Estado de cada afirmação está marcado:**
`[NO CÓDIGO]` já implementado e verificado nesta base ·
`[FONTE]` regra externa com fonte citada ·
`[A DECIDIR]` depende de definição do Raym ou de conferência caso a caso.

---

## 1. De que é feita a carteira

`[NO CÓDIGO]` Medido em `jm_partes` (19/08/2026), por segmento do CNJ:

| Ramo | Processos | Partes |
|---|---|---|
| Justiça do Trabalho | 267 | 913 |
| Justiça Estadual | 70 | 234 |
| Justiça Federal | 3 | 3 |

A carteira é majoritariamente trabalhista, mas 70 processos estaduais **não
seguem a mesma régua**. Aplicar a tabela da JT neles é erro silencioso.

---

## 2. Pensionamento: por que existe "à vista" e "parcelado"

`[FONTE]` Numa condenação por morte ou invalidez, a indenização por dano material
não é um bolo único: é **pensão mensal** (art. 950 CC). Ela se divide em:

- **Parcelas vencidas** — do termo inicial até hoje. São pagas **de uma só vez**.
- **Parcelas vincendas** — as futuras. Ou entram em folha de pagamento do devedor,
  ou são garantidas por **constituição de capital** (art. 533 CPC).

O tempo move dinheiro de um lado para o outro: **toda parcela vincenda vira
vencida quando chega seu mês**, e migra para o lado "à vista". Por isso as colunas
da planilha são **um retrato de uma data**, não um valor fixo — e por isso o
honorário à vista cresce sozinho com o tempo.

`[FONTE]` Quando o juiz arbitra a pensão para **pagamento em parcela única**
(art. 950, § único, CC), a prática aplica um **redutor/deságio sobre a soma
aritmética das vincendas**, tipicamente entre 10% e 30% — quanto mais longo o
período, maior o redutor. Isso não é a nossa correção: é a conta do juízo.

`[A DECIDIR]` A planilha registra o valor já arbitrado ou a soma aritmética? Se
houver deságio judicial embutido em algum caso, ele precisa ficar visível, senão
a carteira parece ter encolhido sem motivo.

### Como isso está gravado hoje

`[NO CÓDIGO]` Conferido nas 55 partes com vincendo:

```
VENCIDO  (à vista)   bruto = cota_parte_vista_cjcm + hc_vista
VINCENDO (a correr)  bruto = (cota_parte_cjcm − cota_parte_vista_cjcm) / 0,7
```

O honorário contratual é **30% do bruto de cada fatia** — 30,00% exatos em 54/55
(fatia vencida) e 53/55 (fatia vincenda). Logo `cota_parte_cjcm` **já vem
líquida** nas duas.

E a coluna "condenação" **não é o bruto**: `condenacao_cjcm = cota líquida +
hc_vista + hs`, deixando `hc_parcelado` de fora. O bruto real é
`condenação + hc_parcelado`.

`[FONTE]` Nota que vale conferir: há entendimento de que **não incide honorário
sobre o capital constituído** para garantir as vincendas — a constituição é
garantia, não pagamento. Se algum caso da carteira teve capital constituído, o
honorário sobre aquela fatia pode não ser devido na forma em que está projetado.
`[A DECIDIR]`

---

## 3. Justiça do Trabalho — a régua

### 3.1 Linha do tempo das regras

| Período | Correção | Juros | Fonte |
|---|---|---|---|
| até 17/12/2020 | TR (depois questionada) | 1% a.m. | regime anterior |
| 18/12/2020 a 29/08/2024 | **IPCA-E** na fase pré-judicial; **SELIC** a partir do ajuizamento | embutidos na SELIC após a citação | `[FONTE]` ADC 58/STF |
| a partir de **30/08/2024** | **IPCA** | **SELIC − IPCA**, com **piso zero** se der negativo | `[FONTE]` Lei 14.905/2024, vigente 60 dias após a publicação |

`[FONTE]` A ADC 58 (STF, dez/2020) fixou IPCA-E na fase pré-judicial e SELIC a
partir do ajuizamento. A Lei 14.905/2024 alterou o Código Civil e o TST adequou
sua jurisprudência: correção pelo **IPCA** e juros pela **diferença SELIC − IPCA**,
com marco em **30/08/2024**. O CSJT publica a **Tabela Única de Atualização
Monetária da Justiça do Trabalho** que consolida isso.

### 3.2 O que o sistema já faz

`[NO CÓDIGO]` Existe pipeline automático — `jm_indices_tick()`, cron
`jm_indices_diario` às 07:30 — que busca no Bacen SGS: **SELIC série 4390** e
**IPCA série 7478**, e mantém dois índices em `jm_indices`:

| Índice | Composição | Cobertura | Safra atual |
|---|---|---|---|
| `SELIC_SIMPLES_JT` | **soma** das taxas mensais | 1995-01 → 2026-08 | 2026-08 |
| `TCM_ESTADUAL` | **produto** (juros compostos) | 1964-01 → 2026-08 | 2026-08 |

A regra do coeficiente da JT, verificada contra as 379 linhas que já existiam
(**379 idênticas, 0 divergentes**):

```
coeficiente(competência) = 1 + Σ SELIC(m)/100
```
somando de `competência` até o mês **anterior** à referência. A SELIC do mês de
referência **não incide** — competência igual à referência vale exatamente 1,0.

`[NO CÓDIGO]` **Safra, não sobrescrita.** `jm_indices` tem chave única
`(indice, competencia, referencia)`. Cada rodada grava uma safra nova e preserva
as anteriores — dá para responder "quanto a carteira valia corrigida até jul/2026"
depois de agosto chegar. Toda tela mostra a data de referência ao lado do valor.

### 3.3 A régua implementada (19/08/2026)

`[NO CÓDIGO]` Dois índices novos em `jm_indices`, gerados por
`jm_regua_por_ramo()`: **`REGUA_TRABALHISTA`** e **`REGUA_COMUM`**, 380
competências cada (1995-01 → 2026-08), na mesma mecânica de safra.

O fator é montado **mês a mês, com a regra vigente em cada mês** — não uma regra
escolhida pela data do crédito. Um crédito de 2022 corre sob ADC 58 até ago/2024
e sob a Lei 14.905 daí em diante; escolher uma régua só erraria os dois trechos.

```
TRABALHISTA   mês <= 2024-08  ->  SELIC simples somada (ADC 58)
              mês >= 2024-09  ->  correção IPCA (produto) + juros max(0, SELIC−IPCA)
COMUM         mês <= 2024-08  ->  correção IPCA (produto) + juros 1% a.m. simples
              mês >= 2024-09  ->  idêntico ao trabalhista

fator = Π(1 + correção do mês) × (1 + Σ juros do mês)
```

Corrige-se o principal e só então os juros incidem sobre o corrigido.

**De onde vêm as taxas mensais.** Não há série crua gravada, mas ela se recupera
exatamente dos coeficientes acumulados que o tick já mantém, porque um é soma e o
outro é produto: `SELIC(m) = coef_SELIC(m) − coef_SELIC(m+1)` e
`IPCA(m) = coef_TCM(m)/coef_TCM(m+1) − 1`. Conferido contra os valores que a
migration `20260816000000` registrou como verificados no Bacen — SELIC jul/2026
1,22% e IPCA jul/2026 0,06%: a derivação devolve exatamente os dois.

### 3.4 Quanto isso muda

`[NO CÓDIGO]` Carteira não-paga, com data-base, na safra 08/2026:

| Ramo | Partes | Nominal | Régua antiga | Régua correta | Diferença |
|---|---|---|---|---|---|
| Trabalhista | 345 | 117,36 mi | 152,81 mi | **155,84 mi** | +3,03 mi |
| Comum | 163 | 33,96 mi | 49,48 mi | **58,17 mi** | +8,69 mi |

**+R$ 11,7 milhões** de subavaliação, dos quais **R$ 5,6 milhões são honorário do
escritório**. A distorção maior está na justiça comum, que vinha sendo corrigida
pela tabela trabalhista por omissão — não por decisão.

Exemplo: processo `0000072-69.2023.5.13.0009` (TRT13, termo inicial 25/04/2024,
coeficiente 1,3175) — nominal R$ 821.599,58 → **R$ 1.082.448,38 hoje**, sendo
R$ 819.252,87 do cliente e R$ 389.548,60 nosso.

### 3.5 O que ainda falta

`[A DECIDIR]` **Corte mensal em ago/2024.** A lei entrou em 30/08/2024, dois dias
antes do fim do mês. O corte aqui é em setembro — mesma simplificação das tabelas
práticas mensais. O pro-rata desses dois dias não está aplicado.

`[A DECIDIR]` **Regime anterior a dez/2020 na JT.** Antes da ADC 58 valia a TR.
A régua trabalhista aplica SELIC simples nesse trecho, o que **superestima**
créditos antigos. Afeta poucas partes (a mais antiga é de 2015), mas afeta.

## 4. Justiça Estadual — régua diferente

`[FONTE]` Termos iniciais, que são a fonte mais comum de divergência:

| Verba | Correção corre desde | Juros correm desde | Fonte |
|---|---|---|---|
| Dano **moral** | a data do **arbitramento** | o **evento danoso** (se extracontratual) | Súmula 362 STJ · Súmula 54 STJ |
| Dano **material** / pensão | o **vencimento de cada parcela** | o vencimento de cada parcela | `[FONTE]` |

Repare: em dano moral, correção e juros **partem de datas diferentes**. Corrigir
o dano moral desde o evento (e não desde o arbitramento) infla o valor — é o erro
clássico, e o mais difícil de perceber porque o número "parece" certo.

`[FONTE]` A partir de **30/08/2024** a Lei 14.905/2024 unificou: IPCA para
correção e SELIC−IPCA (piso zero) para juros, **abolindo as tabelas práticas dos
tribunais estaduais** para o período novo. Antes disso valia a tabela prática do
TJ com juros de 1% a.m.

`[NO CÓDIGO]` A régua comum está implementada em `REGUA_COMUM` (ver 3.3).
`TCM_ESTADUAL` continua **manual** — o Bacen não publica a tabela de
correção estadual. A safra dela envelhece sem avisar, e é por isso que a tela
mostra a data de referência ao lado de todo valor corrigido.

---

## 5. O que nunca se corrige

`[NO CÓDIGO]` Já implementado e verificado:

1. **Valor PAGO não corrige.** Correção atualiza o que está **por** receber.
   Dinheiro que caiu na conta fica no nominal — a tela mostra "Pago em `<data>` —
   valor que já caiu na conta não corrige".
2. **Parcela recebida sem valor digitado ainda é PAGO.** 344 de 703 parcelas
   vieram com `data_recebida` preenchida e `valor_pago` nulo. "Recebeu" e "quanto
   recebeu" são perguntas separadas — a segunda em branco não desfaz a primeira.
3. **Adiantamento do FIDC (Oriz) não é o processo pagando.** Entrou caixa, o
   processo continua tramitando, e o crédito segue corrigindo.

---

## 6. Régua de decisão — qual índice aplicar

Para cada `(processo × parte × verba)`:

1. **Já foi pago?** → não corrige. Fim.
2. **Qual o ramo?** (dígito J do CNJ: 5 = trabalho, 8 = estadual, 4 = federal)
3. **Qual a natureza?** moral, material/pensão, honorário
4. **Qual a data-base?** arbitramento (moral) · vencimento de cada parcela
   (pensão) · ajuizamento (JT pós-ADC 58)
5. **A data-base cai em qual janela?** pré-ADC 58 · ADC 58 · pós-Lei 14.905
6. **Aplica o coeficiente da safra vigente** e **mostra a data de referência**.

`[A DECIDIR]` Os passos 3 a 5 não existem no código hoje: a base não guarda
natureza da verba nem data de arbitramento por parte, e o coeficiente é único por
competência. Implementar isso é trabalho de schema, não de tela.

---

## 7. O que falta para a metodologia virar código

Em ordem de impacto sobre o número final:

1. ~~Implementar a régua da Lei 14.905~~ — **feito** (3.3).
2. ~~Separar a régua estadual da trabalhista~~ — **feito** (3.3).
3. ~~Guardar a data-base por verba~~ — **parcial**: `termo_inicial_jcm` está no
   banco em 799 partes (666 com valor). Faltam **22 partes com valor e sem
   termo** — a planilha não trouxe. Elas entram só pelo nominal, e a tela diz
   isso em vez de fingir que corrigiu.
4. **Data-base por VERBA, não por parte.** Em dano moral a correção corre do
   arbitramento e os juros do evento (Súmulas 362 e 54 do STJ) — datas
   diferentes, e hoje há uma só por parte. Enquanto isso não existir, o dano
   moral da justiça comum corre desde o termo único da planilha. `[A DECIDIR]`
5. **Registrar o percentual do contrato por parte.** Os 30% foram *inferidos* da
   aritmética, não lidos de um campo. Contrato diferente quebra a conta em
   silêncio.
6. **Marcar onde houve constituição de capital** — muda se há honorário sobre a
   fatia vincenda.

## Fontes

- [Migalhas — Lei 14.905/24: TST padroniza correção monetária na Justiça do Trabalho](https://www.migalhas.com.br/depeso/421378/lei-14-905-24-tst-padroniza-correcao-monetaria-na-justica-do-trabalho)
- [ConJur — A decisão da SBDI-I do TST e a ADC 58: juros trabalhistas x taxa legal](https://www.conjur.com.br/2025-jan-28/a-decisao-da-sbdi-i-do-tst-e-a-adc-58-juros-trabalhistas-x-taxa-legal/)
- [TRT5 — CSJT disponibiliza tabela de atualização monetária de débitos trabalhistas](https://trt5.jus.br/noticias/csjt-disponibiliza-tabela-atualizacao-monetaria-debitos-trabalhistas)
- [TRT1 — Atualização Monetária](https://www.trt1.jus.br/atualizacao-monetaria)
- [TJSC — Adequação do módulo de cálculos judiciais às novas regras de atualização monetária no Código Civil](https://www.tjsc.jus.br/documents/3061010/6001733/Adequa%C3%A7%C3%A3odom%C3%B3dulodec%C3%A1lculosjudiciais%C3%A0snovasregrasdeatualiza%C3%A7%C3%A3omonet%C3%A1rianoC%C3%B3digoCivil.pdf)
- [STJ — Súmula 362](https://www.stj.jus.br/docs_internet/revista/eletronica/stj-revista-sumulas-2012_32_capSumula362.pdf)
- [Melo Campos — Pensão por ato ilícito e o art. 950 do Código Civil: cálculo, garantias, parcelamento](https://melocampos.com.br/2025/11/28/pensao-por-ato-ilicito-e-o-art-950-do-codigo-civil-calculo-garantias-parcelamento-e-estrategias-de-defesa-sob-a-otica-do-devedor/)
