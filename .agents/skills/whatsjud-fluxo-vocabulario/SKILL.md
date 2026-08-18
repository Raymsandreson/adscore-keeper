---
name: whatsjud-fluxo-vocabulario
description: Fonte da verdade do vocabulário do Fluxo FIDC (régua de 7 estágios, estágios de parcela, taxonomia do livro-caixa, modelo de acordo cota×honorário, códigos TPU, depósito judicial). Use SEMPRE que a tarefa envolver jm_* (processos, partes, acordos, pagamentos, lançamentos), views vw_jm_*, régua de estágios, conciliação, FIDC, cessão de crédito, ou relatórios de jurimetria/fluxo. Acione quando ouvir "estágio", "régua", "vencido", "a receber", "condenação", "acordo", "parcela", "honorário", "indenização", "conciliação", "fluxo mensal", "FIDC", "cessão".
---

# Vocabulário do Fluxo FIDC — v5

Fonte da verdade. Em conflito entre este arquivo e intuição, vale este arquivo.
Banco: **Supabase Externo `kmedldlepwiityjsdahz`** (nunca o Cloud).

## Changelog v4 → v5

1. **Vigente × Alvo corrigido**: a v4 descrevia o modelo-alvo (corretor / FIDC compra só honorário)
   como se fosse o vigente. ERRADO. Ver seção "Modelo VIGENTE vs modelo-ALVO".
2. Códigos TPU incluídos (11385 / 196 / 277 / 14099 / 12066).
3. Campo `jm_partes.deposito_judicial_situacao` incluído.
4. Taxonomia do livro-caixa por CATEGORIA (13/07/2026) incluída — substitui `tipo='ENTRADA'`.
5. Modelo de acordo cota×honorário documentado (padrão jm_acordos id 2/3/5/6).
6. View oficial `vw_jm_kpi_linha_tempo` já É a régua de 7 estágios (trocada em 13/07/2026).

## A RÉGUA OFICIAL — 7 estágios (definida pelo Raym, usar SEMPRE)

| Estágio | Definição | FIDC |
|---|---|---|
| PROJETADO | sem decisão; valor = média por tipo de parte (curva histórica) | fora do fluxo |
| CONDENACAO | juiz fixou valor, SEM data de pagamento | não descontável (deságio maior) |
| A_RECEBER | valor E data, no prazo (acordo a vencer / execução com data) | o ouro — descontável |
| VENCIDO | prometeu (acordo/condenação aceita), data passou, não pagou | risco de crédito |
| EM_EXECUCAO | cobrança forçada (penhora); execução recém-aberta JÁ entra aqui | risco processual |
| DEPOSITADO_EM_JUIZO | valor depositado porém travado (menor até 18 / honorário só ao final) | garantido, NÃO descontável |
| PAGO | caiu na conta | realizado |

**INDEFERIDO** = saída lateral (dinheiro que morreu). Não é estágio da régua.

### Regras invioláveis da régua

- **PROJETADO nunca vence.**
- **Estágio é da PARCELA** (nível processo×cliente); o tempo reclassifica sozinho.
- **Acordo homologado = 100% COM trânsito** (filtro binário COM/SEM).
- Precedência na view: INDEFERIDO > PAGO > DEPOSITADO_EM_JUIZO > EM_EXECUCAO > EM_PAGAMENTO > VENCIDO > A_RECEBER > CONDENACAO > PROJETADO.

### Fronteiras decididas pelo Raym

- Execução recém-aberta sem penhora → já é EM_EXECUCAO (gatilho = protocolo).
- Penhora parcial → parte a parcela: bloqueado vira A_RECEBER, resto segue EM_EXECUCAO.
- DEPOSITADO_EM_JUIZO = **campo explícito**, nunca inferido pela idade (tem juiz que libera a mãe
  e juiz que trava até 18). Lê-se na sentença/acordo → extração com aprovação caso a caso.
- Sucumbencial global → rateado por cliente proporcional ao resultado; valor global do juiz em
  coluna de auditoria.

## Códigos TPU (jm_movimentos.codigo)

| Código | Significado | Efeito na régua |
|---|---|---|
| 11385 | execução iniciada | liga EM_EXECUCAO |
| 196 | extinção | anula 11385 se posterior |
| 277 / 14099 | acordo em execução | anulam 11385 se posteriores |
| 12066 | levantamento de depósito | rastreado (dt_levantamento) |

Regra: vale o ÚLTIMO evento — `EM_EXECUCAO` só se 11385 existe e nenhum 196/277/14099 é posterior.

## jm_partes.deposito_judicial_situacao

`INDEFINIDO` (default) | `LIBERADO_REPRESENTANTE` | `RETIDO_ATE_MAIORIDADE` (CHECK no banco).
O estágio DEPOSITADO_EM_JUIZO **só acende com RETIDO_ATE_MAIORIDADE**. Popular só com aprovação
caso a caso (item #6 da fila).

## Taxonomia do livro-caixa (jm_lancamentos) — por CATEGORIA, nunca por tipo

Decidida pelo Raym em 13/07/2026. Implementada em `vw_jm_caixa_classificado.classe`:

| Categoria | classe | Tratamento |
|---|---|---|
| Honorários / Indenização | REALIZADO | efetivamente recebido |
| Honorários Adiantados Oriz | REALIZADO_ORIZ | recebido antecipado com deságio; soma no realizado, rastreável |
| Honorários/Indenização a receber | A_RECEBER | futuro; data < hoje ⇒ vencido |
| Honorários Adv Parceiro | PARCEIRO | NÃO é receita do escritório; balde próprio (relatório p/ IR) |
| Indenização comprada | COMPRADA | fora deste fluxo (planilha Prudencio Capital) |

**PROIBIDO** usar `tipo='ENTRADA'` como sinal de recebido — inflava o realizado com ~R$2,2M de
"a receber" (ex.: Caso 87 aparecia PAGO com honorários futuros).

## Modelo de acordo — cota × honorário (padrão jm_acordos)

- `jm_acordos.valor_total` = **BRUTO** (cota clientes + honorário). Ex.: id=5 (Caso 203): 80k = 56k + 24k.
- `jm_pagamentos` guarda **só a cota do cliente** por parcela. Honorário NÃO vira linha de pagamento.
- Honorário vive em `jm_acordos.clausulas` (jsonb): `honorarios_pct`, `honorarios_contratuais`,
  `cota_cliente_total`, rateios, datas-âncora.
- **Pagamento confirmado** = `jm_pagamentos.valor_pago IS NOT NULL` (+ `data_recebida`). É o que a
  conciliação lê como `PAGA_CONFIRMADA` e o que ganha do caixa (sem dupla contagem). Esqueleto
  "RECEBIDA sem valor" NÃO é confirmação (era a parcela-fantasma do Caso 7).

## Modelo VIGENTE vs modelo-ALVO (correção central da v5)

**VIGENTE** — operação de crédito com spread, campos de cessão em `jm_partes`
(`cessao_nominal`, `cessao_atual`, `vendida`, `disponivel_venda`, `disponivel_compra`):
antecipa a indenização do cliente (corrigida), subcede a juros menores, controla limite e
estoque cedível. Indenizações compradas ficam na planilha Prudencio Capital (fora deste fluxo).

**ALVO (futuro, NÃO operar como se existisse)** — Raym corretor; FIDC compra só honorário.
Qualquer análise/relatório descreve o vigente; o alvo só aparece rotulado como alvo.

**Flag de risco OAB**: antecipar crédito do próprio cliente tem risco disciplinar — documentado,
ponteiro Dr. Camilo. Documentar não é operar.

## Onde as coisas vivem

- Régua oficial: `vw_jm_kpi_linha_tempo` (7 estágios desde 13/07/2026; `_legacy` = v1 por 24h;
  `_v2` idêntica à oficial, a aposentar).
- Conciliação parcela×caixa: `vw_jm_conciliacao` (situações: PAGA_CONFIRMADA, PAGA_CASADA,
  PAGA_PROVAVEL_AMBIGUA, ENTRADA_DE_OUTRO_FLUXO, SEM_DATA_PREVISTA, ANTERIOR_COBERTURA_CAIXA,
  A_VENCER, POSSIVEL_PAGA_SEM_VINCULO, VENCIDA_SEM_ENTRADA).
- Caixa classificado: `vw_jm_caixa_classificado` (coluna `classe`).
- Visão consolidada p/ jurimetria: `vw_jm_visao_processo` (1 linha por parte).
- Fluxo mensal: `vw_jm_fluxo_mensal` (RECEBIDO / A_RECEBER_CONTRATADO / CONTRATADO_ATRASADO /
  ESTIMADO_CURVA).
- PDFs dos autos: bucket privado `jm-autos` (`jm_documentos.storage_path`); `link_api` do
  Escavador EXPIRA em ~7 dias — arquivar via edge `esc-autos` ação `arquivar` (download não
  consome crédito Escavador).

## Números-âncora (validar contra estes; atualizados 13/07/2026)

344 processos INTERNO (nenhum perdido) · estoque moral+estético atualizado ~R$41,7M (views somam
SÓ moral+estético — honorário não é calculado em view nenhuma) · régua: PROJETADO 147 ·
CONDENACAO 88 · PAGO 64 (R$21,9M) · A_RECEBER 24 · INDEFERIDO 13 · EM_PAGAMENTO 4 ·
EM_EXECUCAO 3 · VENCIDO 1 (Caso 55) · acordos registrados: 6 (inclui 203/INTERCAST id=5 e
7/EQUATORIAL id=6).
