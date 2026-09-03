# Reimportação da Tab. Aux corrigida — 03/09/2026

## O que estava errado

O import de 18/08/2026 congelou uma versão da Tab. Aux em que o **honorário
sucumbencial** de vários processos estava calculado como `base × 10` em vez de
`base × 0,10` — erro de fator 100. O Raym já tinha corrigido a planilha; o banco
é que ficou para trás.

Caso mais grave, `0100419-74.2021.5.01.0281` (caso 60): HS gravado em
R$ 20.576.341,93 quando o correto é R$ 205.763,42 — exatos 10% da base
(cota do cliente + honorário contratual = R$ 2.057.634,18). A condenação do
processo seguia junto, R$ 22.633.976,11 contra R$ 2.263.397,60.

Isso já tinha sido detectado sem causa em `carteira-pendencias-2026-08-27.md`
("acima de 10x (absurdo): 10 CNJs, R$ 35,1 mi na Tab. Aux"). A causa é esta.

## O que foi feito

Fonte: `Jurimetria/indenização`, aba **Tab. Aux**, exportada em 03/09/2026
(1.034 partes, 290 processos). Conferida antes de entrar: **zero** partes com
HS acima de 60% da base, contra 69 processos suspeitos no banco.

Mudança mínima: só as **313 partes de 76 processos** cujo total divergia. Os
demais não foram tocados.

| | Antes | Depois |
|---|---:|---:|
| Condenação CJCM | R$ 175.338.282,55 | **R$ 142.599.297,61** |
| Honorário sucumbencial | R$ 46.289.483,02 | **R$ 13.341.652,49** |
| Honorário contratual | R$ 41.030.455,24 | R$ 41.043.654,89 |
| Processos com HS > 60% da base | 69 | **3** |

O honorário contratual praticamente não mudou (+0,03%) — **toda a diferença
era o sucumbencial inflado**, o que confirma o diagnóstico.

Casamento: **313 de 313 partes** casaram por `(processo_cnj, nome normalizado)`,
usando `jm_nome_norm` com colapso de espaços. Zero órfãs.

### Conferência caso a caso

| Caso | CNJ | Condenação | HS antes | HS depois |
|---|---|---:|---:|---:|
| 60 | 0100419-74.2021.5.01.0281 | 22.633.976,11 → **2.263.397,60** | 20.576.341,93 | **205.763,42** |
| 179 | 0000042-08.2024.5.08.0116 | 743.962,22 → **585.256,68** | 209.824,56 | **51.321,30** |
| 32 | 0000491-34.2020.5.05.0101 | 899.570,82 (inalterado) | 83.604,70 | 83.604,70 |
| 106 | 0000366-84.2022.5.08.0110 | 1.982.684,10 (inalterado) | 258.610,97 | 258.610,97 |

## Rota de fuga

`public.jm_partes_valores_bkp_20260903` — 1.222 linhas, retrato completo das
colunas de valor antes do UPDATE. O SQL de rollback está no `comment` da tabela.

## Por que a aba "Lançamentos" NÃO substitui a Tab. Aux

Testado e descartado em 03/09/2026. A aba Lançamentos guarda duas coisas na
mesma coluna:

| | Linhas | O que é |
|---|---:|---|
| sem `N° DA PARCELA` | 1.955 | uma linha por **(parte × decisão)** |
| com `N° DA PARCELA` | 1.022 | uma linha por **(parte × parcela de acordo)** |

Tratar tudo como decisão e pegar a mais recente por parte deixaria **702 de
1.191 partes sem valor** e faria sumir **28 processos / R$ 16.460.307,44** que
só existem nas linhas de parcela. Exemplo: em `0000034-39.2023.5.05.0281` a
última linha é a parcela de fev/2024 (R$ 7.405,21) de um acordo de R$ 371.448.

O comentário de `scripts/import-tab-aux.mjs` já dizia isso desde 18/08:
*"Tab. Aux: uma linha por PARTE, quanto VALE. Lançamentos: quando ENTRA. Os
números não se somam."*

**A Tab. Aux é a consolidação de duas coisas que a aba Lançamentos guarda
separadas.** Ela continua sendo a fonte do estoque.

A aba Lançamentos serve para outra coisa, ainda não importada: as **1.955 linhas
de decisão** alimentam `jm_decisoes` + `jm_valores` (a escada de datas e valores
por decisão); as **1.022 de parcela** pertencem a `jm_pagamentos`. São dois
importadores diferentes, não um.

## Pendências

1. **3 processos ainda com HS acima de 60% da base**, R$ 754.944,22 — nenhum
   deles está na Tab. Aux nova, então não foram alcançados:
   `0000370-65.2025.5.22.0001` (razão 0,97), `0001405-30.2024.5.08.0116` (1,67),
   `0000158-20.2025.5.11.0011` (1,24). Todos com `cota_parte_cjcm = 0` — resquício
   de import antigo. Precisam entrar na planilha ou ser zerados à mão.
2. **63 processos do banco não estão na Tab. Aux nova** — todos sem valor
   (`condenacao_cjcm` nulo ou zero), então nada se perdeu. Ficam como
   "não conferidos".
3. **Caso 179**: a carteira projeta R$ 585.256,68, mas os autos registram acordo
   homologado de **R$ 50.000 em 6 parcelas** (13/11/2024). O app já sinaliza
   ("R$ 50.000 ≠ carteira"). Projeção 11,7× acima do acordo real — é detector,
   e a peça decide.

---

# Os dois importadores da aba Lançamentos (03/09/2026)

Entregues em `scripts/`:

| Arquivo | O que faz |
|---|---|
| `jurimetria-lancamentos-comum.mjs` | funções puras compartilhadas: parser de CSV, leitura de célula BR, classificação do rótulo, separação decisão × parcela |
| `import-jurimetria-decisoes.mjs` | linhas **sem** `N° DA PARCELA` → `jm_decisoes` + `jm_valores` |
| `import-jurimetria-parcelas.mjs` | linhas **com** `N° DA PARCELA` → `jm_pagamentos` |
| `src/lib/__tests__/importJurimetriaLancamentos.test.ts` | 24 asserções sobre a lógica pura |

Uso, igual ao `import-tab-aux.mjs` que já existia:

```
node scripts/import-jurimetria-decisoes.mjs --dry-run Lancamentos.csv
node scripts/import-jurimetria-decisoes.mjs --sql saida.sql Lancamentos.csv
```

## O que a leitura do CSV de 03/09/2026 devolve

| | |
|---|---:|
| Linhas úteis (com CNJ de 20 dígitos e cliente) | 2.926 |
| → de **decisão** | 1.904 |
| → de **parcela** | 1.022 |
| Rótulos não mapeados | **0** |
| Decisões de mérito distintas (cnj + tipo + instância + data) | **349** |
| Linhas ignoradas por não serem decisão (SEM DECISÃO e afins) | 580 |
| Parcelas: RECEBIDA / A_RECEBER | 711 / 311 |

## Decisões de desenho, e o motivo de cada uma

**`SEM DECISÃO` não vira decisão.** São 580 linhas cujo valor na planilha é
projeção. Virassem decisão, a escada do honorário liberaria tranche sobre um
número que ninguém julgou.

**Decisão sem data não entra.** Sem data não há degrau na escada.

**A data da parcela cai no campo do status.** `Pago` → `data_recebida`;
`A receber` → `data_prevista`. Preencher os dois é o que faz o caixa mostrar
como realizado o que ainda não entrou.

**A data zero do Excel (30/12/1899) é lida como nulo.** Ela aparece em célula
vazia formatada como data; gravada como termo inicial, faria a correção
monetária render 126 anos.

**Nenhum dos dois apaga.** Registro que está no banco e sumiu da planilha vai
para o relatório como órfão. Isso importa agora por causa do achado abaixo.

## O achado: parcelas viraram decisão na carga de 08/07/2026

Das 95 `HOMOLOGAÇÃO DE ACORDO` em `jm_decisoes`:

- **64** são repetição no mesmo processo
- **52** casam com a data de uma parcela em `jm_pagamentos`

O caso `0000352-23.2023.5.09.0665` tem doze "homologações" mensais (D0091 a
D0102). É **um** acordo pago em doze vezes, não doze acordos. O mesmo em
`0000034-39` (D0011–D0015), `0010054-02` (D0272–D0281), `0024921-34`
(D0397–D0404), `0000407-35` (D0126–D0131).

Isso infla `jm_decisoes` e, por tabela, `jm_valores` — e é a causa provável do
"somar `jm_valores` direto infla ~2,6×" que a migration de 18/08 já registrava
sem explicar.

**Os scripts apontam, não apagam.** Limpar exige decidir caso a caso se a
primeira homologação da série é a real (provavelmente é) e se as demais viram
parcela. Fica para uma rodada dedicada, com aval.

## Estado de `jm_pagamentos`

Já tem **1.022 linhas** e bate com a planilha em **38 dos 40** processos. O
delta é um processo novo (`1000113-66.2025.8.11.0037`) e uma parcela a mais no
banco em `0000648-76.2023.5.23.0076`. O importador existe para manter em dia
sem recarregar tudo.

## Limite desta entrega

O dry-run contra o banco exige `SUPABASE_SERVICE_ROLE_KEY`, que não está no
`.env` (ele só tem as chaves do Cloud `gliigkupoebmlbwyvijp`). Sem ela os
scripts leem e classificam a planilha, mas não comparam com o Externo.

O `vitest` também não roda neste ambiente (`node_modules` ausente). As mesmas
24 asserções do arquivo de teste foram exercitadas em Node puro e passaram —
o teste vitest fica para o CI ou para a máquina do Raym.
