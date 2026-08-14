# Marcos processuais — regras vigentes e pontos a decidir

Documento de revisão. Retrato do banco em **07/08/2026** (Externo `kmedldlepwiityjsdahz`).
Alimenta a linha do trem da ficha do processo, o "status atual", as Metas Processuais por Time e a vista **Carteira** do telão (`TvCarteiraPanel`).

> Revisão anterior: 30/07/2026, com a régua de 10 estações. A régua virou **12** em 06/08/2026 (fase de execução) e a classificação passou a ter **revisão por IA**. Este documento já reflete as duas mudanças.

---

## 1. Como um marco nasce

```
Escavador (API v2)
  └─ /processos/numero_cnj/{CNJ}/movimentacoes
       └─ lead_processes.movimentacoes (jsonb, cru)
            └─ extractMarcos()   supabase/functions/_shared/escavadorMarcos.ts
                 └─ revisaoIA()  supabase/functions/_shared/marcosIA.ts   (Gemini Flash)
                      └─ process_movements  (append-only, 1 linha por marco)
                           ├─ lead_process_current_status  (view: marco atual)
                           └─ estacoesDoProcesso()  src/lib/processStations.ts (linha do trem)
```

Só existe marco onde houve movimentação baixada. Nada é digitado à mão hoje.

**A IA não substitui o parser, revisa.** O determinístico gera candidatos por palavra-chave; a IA confirma, reclassifica ou descarta cada um, devolvendo tipo + confiança + motivo. `marcosIA.ts` não grava — quem chama compara com o determinístico e decide.

**Nada é apagado**: descarte é `descartado_em` + `descartado_motivo` (migration `20260805190000_process_movements_descarte`). A tabela continua append-only; toda contagem de marco filtra `descartado_em is null`.

**Por que a revisão por IA existe** — auditoria de 05/08/2026 sobre 603 linhas de `fonte='escavador'`:

| Marco gerado pelo parser | Linhas | O que era de verdade |
|---|---|---|
| `acordao_2grau` | 96 | só 9 eram acórdão; o resto era Certidão de Publicação (12), Disponibilização no DJE (10), Contrarrazões (9), Recurso Ordinário (6)… |
| `acordao_superior` | 20 | **nenhuma** era acórdão de tribunal superior — eram interposições de RE e remessas |
| `acordo` | 54 | "de Conciliação" (6) e "Una" (3) eram AUDIÊNCIAS virando acordo, empurrando o processo da estação 2/4 direto pra 6 |
| `pagamento` | 44 | "Levantamento da Suspensão" casa a keyword `levantamento` |
| `transito_julgado` | 15 | único marco confiável do parser |

A raiz não é a janela de 180 caracteres, é semântica: a lista de keywords não distingue **a decisão** do **ato da parte** que a provoca nem do **expediente** que a publica. "Contrarrazões da apelação" contém `apelacao`. Nenhuma janela de texto conserta isso.

---

## 2. As 12 estações e a ordem canônica

06/08/2026 — decisão jurídica: a régua terminava em Pagamento e não tinha onde registrar cumprimento de sentença, impugnação, embargos, penhora ou precatório. **39 movimentações em 11 processos** estavam gravadas como `sentenca_1grau`, fazendo o processo parecer parado na sentença com a execução já correndo.

| # | Marco | Como é decidido hoje |
|---|---|---|
| 1 | Petição Inicial | `peticao inicial`, `distribuic`, `protocolo da inicial`, `autuac`, `ajuizamento` |
| 2 | Audiência de Conciliação | detector de compromissos / campo `audiencias` do Escavador |
| 3 | Perícia | idem |
| 4 | Audiência de Instrução | idem |
| 5 | Sentença (1º grau) | `sentenca`, `julgo procedente/improcedente/parcialmente`, `extincao do processo`, `resolucao do merito`, `julgo extinto` |
| 6 | Acordo | acordo **homologado** pelo juízo (ou sentença que homologa). Pedido de homologação não basta |
| 7 | Acórdão (2º grau) | acórdão **publicado** por TRT/TJ/TRF — proferido, publicado, ementa, ata de sessão, inteiro teor |
| 8 | Acórdão (superior) | acórdão **publicado** por TST/STJ/STF, mesmo critério |
| 9 | Trânsito em Julgado | `transito em julgado`, `transitou em julgado`, `certidao de transito` |
| 10 | **Cumprimento de Sentença** | início ou andamento da fase de execução — cumprimento instaurado, execução iniciada, impugnação, embargos, penhora, bloqueio |
| 11 | **Precatório / RPV** | precatório ou RPV **expedido/requisitado** — a requisição saiu, o dinheiro ainda não |
| 12 | Pagamento | `alvara`, `levantamento`, `deposito judicial`, `pagamento efetuado/realizado/integral`, `comprovante de pagamento`, `quitacao` |

**Ordem de avaliação do parser** (a primeira que casa vence): acórdão → acordo → sentença → trânsito → petição inicial → pagamento.

**Sinal primário**: a `classificacao_predita.nome` que o próprio Escavador devolve.
**Fallback**: palavra-chave no *cabeçalho* (título + primeiros 180 caracteres), nunca no corpo inteiro — classificar pelo corpo gerava falso "trânsito em julgado" em toda sentença que termina com "após o trânsito em julgado, arquive-se".

### As estações 10 e 11 não saem do parser

`cumprimento_sentenca` e `precatorio_rpv` **não têm keyword confiável** e não são emitidos por `escavadorMarcos.ts`. Quem os produz é a revisão por IA, promovendo um candidato que nasceu como `sentenca_1grau` ou `pagamento`. A escala do parser precisa conhecê-los mesmo assim, porque `aplicaGuardas()` lê `marco_ordem`.

Também **não entram em `MARCO_ORDEM_RESULTADO`** (`src/components/cases/ProcessResultadoTab.tsx`): são fase de execução, não desfecho. O resultado do caso continua sendo a sentença ou o acordão que gerou a execução — incluí-los faria a execução mascarar o resultado real.

### Onde a escala vive (6 lugares — têm que andar juntos)

| Lugar | Símbolo |
|---|---|
| Banco (autoridade) | `marco_ordem_canonica()` + CHECK de `process_movements` — migration `20260806150000` |
| Edge / parser | `escavadorMarcos.ts` → `MARCO_ORDEM` |
| Edge / IA | `marcosIA.ts` → `MARCO_ORDEM_CANONICA` |
| Front / linha do trem | `src/lib/processStations.ts` → `ORDEM_CANONICA` |
| Front / hook | `useProcessMovements.ts` → `MarcoTipo` |
| Front / rótulos | 3 `Record<MarcoTipo, string>` nos componentes de timeline, resultado e metas |

O banco é a autoridade: o trigger `trg_process_movements_marco_ordem` recarimba `marco_ordem` em todo INSERT/UPDATE a partir de `marco_ordem_canonica()`. Se um dos seis divergir, o marco atual mente.

### Guardas já existentes

1. **Sigilo** — o placeholder "MOVIMENTAÇÃO CONFIDENCIAL — PROCESSO EM SEGREDO DE JUSTIÇA, PRECATÓRIO OU RPV" nunca vira marco (casava `precatorio`/`rpv` e criava falso Pagamento).
2. **"Pagamento" isolado não conta** — só instrumentos concretos de quitação, porque toda sentença diz "condeno ao pagamento de…".
3. **Petição inicial é única** — se o parser achar várias, fica a mais antiga.
4. **Redistribuição não é ajuizamento** (30/07/2026) — petição inicial com data posterior a um marco mais avançado é descartada. Motivo: `0000657-98.2025.5.11.0012` tinha "Distribuído por sorteio" em 08/06/2026 (remessa ao relator no TRT) e acórdão em 29/04/2026; o processo aparecia parado na petição inicial.
5. **Intimação de acórdão não é acórdão** (06/08/2026) — intimação e certidão de publicação são expediente de cartório, mesmo quando transcrevem a ementa e o voto no corpo. Custo conferido antes de aplicar: 4 linhas em 2 processos, e 1 desses perde o marco por não ter outra movimentação registrando o acórdão. Aceito conscientemente.
6. **Requisição expedida não é dinheiro na mão** (06/08/2026) — precatório/RPV expedido é estação 11; só vira Pagamento com notícia de pagamento efetivo ou levantamento.
7. **Execução não é sentença** (06/08/2026) — decisão que julga impugnação ao cumprimento, embargos à execução, penhora ou bloqueio é `cumprimento_sentenca`. A régua registra a fase, não cada incidente.

### Marco "atual" (regra de 30/07/2026, mantida)

É **o marco de maior `marco_ordem`**, com empate desfeito pela data mais recente — antes era simplesmente a data mais recente. Vale na view `lead_process_current_status`, nas RPCs das metas e no "Detalhe do status atual" da ficha.

---

## 3. Cobertura real (07/08/2026)

| | Processos |
|---|---|
| Vivos (`deleted_at is null`) | 1.776 |
| Judiciais | 600 (todos com CNJ) |
| Administrativos | 1.176 (263 com CNJ) |
| Com movimentações baixadas | 604 |
| **Com algum marco vivo** | **411** (380 judiciais, 31 administrativos) |

Ramo da Justiça dos que têm marco: **Trabalho 176 · Federal 128 · Estadual 106** (+1 sem CNJ).

Salto desde 30/07: 68 → 604 processos com movimentações e 89 → 411 com marco, efeito do backfill. `process_movement_monitors` continua **vazio** (0 linhas) e a `check-process-movements` só percorre monitores — o sync ainda não roda sozinho.

#### O denominador não é 1.776 — é 863

Dos 1.776, **913 não têm número nenhum, e a maioria não é processo**: são itens de checklist do POP gravados na mesma tabela (`lead_processes` tem dupla função). Os títulos entregam — "Benefício INSS" 614, "Onboarding" 72, "Organizar docs" 67, "Seguro de Vida" 27. Só ~15 têm número escondido no título. **Não é falha de cadastro, é a tabela guardando duas coisas.** Cobrar régua deles é erro de leitura.

Dos **863 que têm número**, a forma diz o que dá para acompanhar (07/08/2026):

| Forma | Qtd | Com marco | Fonte |
|---|---|---|---|
| CNJ | 626 | 409 | Escavador |
| Requerimento INSS (7-12 dígitos puros) | 194 | 156 | e-mail do INSS |
| NUP `NNNNN.NNNNNN/AAAA-DD` | 10 | 0 | **nenhuma** |
| Indefinido | 33 | ~0 | nenhuma |

Cobertura real: **565 de 863 (65%)**. Os descobertos são 216 CNJ sem movimentação (o buraco de verdade), 38 requerimentos cujo e-mail não chegou, e 43 que nunca terão régua.

### Linhas gravadas por estação (tabela inteira)

| # | Marco | Linhas | Processos | Descartadas |
|---|---|---|---|---|
| 1 | Petição Inicial | 371 | 339 | 40 |
| 2 | Audiência de Conciliação | 147 | 68 | 0 |
| 3 | Perícia | 40 | 26 | 0 |
| 4 | Audiência de Instrução | 25 | 19 | 0 |
| 5 | Sentença (1º grau) | 88 | 56 | 42 |
| 6 | Acordo | 40 | 24 | 24 |
| 7 | Acórdão (2º grau) | 112 | 54 | 72 |
| 8 | Acórdão (superior) | 20 | 11 | 15 |
| 9 | Trânsito em Julgado | 14 | 13 | 3 |
| 10 | Cumprimento de Sentença | 37 | 20 | 0 |
| 11 | Precatório / RPV | 0 | 0 | 0 |
| 12 | Pagamento | 63 | 31 | 33 |

**957 linhas no total: 728 vivas, 229 descartadas.** O descarte concentra exatamente onde a auditoria apontou — acórdão de 2º grau (72 de 112), acordo (24 de 40), pagamento (33 de 63). É a revisão por IA limpando expediente de cartório que virava marco.

**Estação 11 ainda vazia**: nenhum precatório/RPV expedido foi reconhecido até agora. Como o tipo só nasce por promoção da IA, ou os casos ainda não apareceram nas movimentações baixadas ou estão sendo lidos como Pagamento. Vale conferir numa próxima passada.

### Onde os processos estão parados (marco atual)

| Marco atual | Processos |
|---|---|
| Petição Inicial | 252 |
| Audiência de Conciliação | 40 |
| Audiência de Instrução | 17 |
| Perícia | 11 |
| Sentença (1º grau) | 19 |
| Acordo | 6 |
| Acórdão (2º grau) | 25 |
| Acórdão (superior) | 4 |
| Trânsito em Julgado | 6 |
| Cumprimento de Sentença | 17 |
| Pagamento | 14 |

Os 17 em cumprimento de sentença são exatamente o que a régua de 10 escondia: apareciam como parados na sentença.

---

## 4. "Não tem petição inicial" — por que, e o que fazer

**97 dos 411** processos com marco não têm Petição Inicial viva (40 linhas de petição inicial foram descartadas por serem redistribuição ou expediente). Causas:

1. **A movimentação de distribuição é antiga e não veio no lote baixado.** O Escavador devolve a partir de certa data; um processo de 2023 com sync feito em 2026 traz só o recente.
2. **O tribunal não publica a distribuição como movimentação** — em vários sistemas ela é campo do processo (`data_distribuicao`), não movimentação.
3. **Processo administrativo** — não existe "petição inicial", existe protocolo do requerimento.

**Saída disponível sem custo de API**: `lead_processes.data_distribuicao` e `data_inicio` já vêm preenchidos do Escavador em parte da base. Dá para gerar o marco de Petição Inicial a partir do campo do processo quando não houver movimentação correspondente (fonte `campo_processo` em vez de `escavador`). **Pendente de decisão.**

---

## 5. Marcos por rito

A linha do trem filtra estações por perfil (`src/lib/processStations.ts`), regra validada em 13/07/2026 e ampliada em 06/08/2026:

| Rito | Conciliação | Perícia | Instrução |
|---|---|---|---|
| **Trabalhista** (CNJ ramo 5) | sim | sim, salvo caso fatal | sim |
| **Previdenciário** (ramo 4 ou tipo BPC/LOAS/auxílio/aposentadoria/pensão) | não | sim, salvo pensão por morte, maternidade e rural | só pensão por morte ou rural |
| **Cível e demais ramos** | **sim** (art. 334 CPC — 06/08/2026) | só por evidência | só por evidência |

Override manual da perícia: `lead_processes.pericia_prevista` (null = automático).
Evidência sempre vence a previsão: se o marco existe, a estação aparece.

**Execução (10 e 11) nunca é prevista** — só aparece na linha do trem quando o marco existe de fato. Prever execução em todo processo poluiria a linha de quem nunca vai executar (acordo, improcedência), e a fase é eventual por natureza: depende de a parte não cumprir espontaneamente.

### Administrativo (INSS) — régua própria desde 06/08/2026

A régua judicial não serve: o administrativo não é fila que só anda pra frente. No histórico, um requerimento sai de "Concluída" e volta pra "Pendente" 103×, pra "Exigência" 50×, pra "Em Análise" 27×. "Maior ordem vence" mostraria como concluído o que regrediu.

Solução (view `inss_requerimento_status`, migration `20260806170000`): **ancorar no resultado, não no status.**

- **Estações**: `protocolado` → `concedido` | `indeferido` | `encerrado`
  (`encerrado` = cancelada ou arquivado por decurso: terminal, mas nem concessão nem indeferimento — não inventar desfecho que não houve)
- **Alertas** (não são estação, são o que gera ação): `em_exigencia` + `dias_em_exigencia` (**267 requerimentos** hoje, o maior grupo) e `concluida_sem_resultado` (buraco de captura, não estado do requerimento)
- Onboarding ficou **fora** da régua por decisão do usuário — é responsabilidade do funil do lead
- Não cria tabela nem duplica dado: tudo derivado de `inss_admin_processes` (848 requerimentos). Sem sync, sem drift, sem backfill

Na ficha, processo administrativo mostra a régua do INSS em vez de "sem marco" (`df6383c`).

#### Perícia agendada é estado do processo, não marco (13/08/2026)

As datas de **perícia médica** e **perícia social** do Benefício INSS ficam em `lead_processes.pericia_medica_at` / `pericia_social_at` (migration `20260813120000`), editáveis no cabeçalho da atividade — **não** em `process_movements`. Motivo: marco é append-only e descreve o que já aconteceu; agendamento é estado presente e muda quando o INSS remarca, e `tipo_movimentacao='pericia'` não distingue médica de social. Perícia **realizada** continua virando movimentação normalmente. Detalhe funcional em `atividades.md`.

#### NUP não é requerimento — `4445f84` (07/08/2026)

A tela mandava conferir a caixa do INSS para **todo** processo sem requerimento capturado. Para 43 dos 81 isso é falso, e é o mesmo erro da mensagem antiga que culpava o Escavador: só troca o culpado.

Os **10 processos no formato `NNNNN.NNNNNN/AAAA-DD`** são protocolo da administração federal, não requerimento de benefício. Provas: `inss_admin_processes.requerimento_number` tem 7 a 12 dígitos puros em **848/848** linhas — nunca esse formato; o número não aparece no `details` de nenhum requerimento nem nos **2.719** `processual_emails`; e 9 dos 10 estão em itens "Relatório de Acidente" (de 39 desses itens, **29 não têm número algum**). **Não é bug de casamento: o casamento nunca poderia acontecer.**

`classificarNumeroProcesso()` em `src/lib/inssRegua.ts` separa os três, e cada um pede ação oposta:

| Forma | Mensagem | Ação |
|---|---|---|
| `nb` | requerimento ainda não capturado | cobrar a caixa monitorada |
| `nup` | protocolo administrativo fora do acompanhamento | consultar no órgão |
| `indefinido` | o campo não contém número de processo | corrigir o cadastro |

Exigir dígito puro em `nb` não é preciosismo: dos 199 na faixa de 7-12 dígitos, os **5 com separador** (datas, CNPJ) casam **0** vezes; dos 194 sem separador, casam 156.

### O que ainda não tem regra própria

- **Criminal / inquérito policial** (POP "INQUÉRITO POLICIAL", 9 processos): o ciclo é outro — inquérito, denúncia, instrução, sentença. Nenhuma das 12 estações descreve isso direito.

---

## 6. Decisões pendentes

Resolvidas em 06/08/2026 e removidas desta lista: fase de execução na régua, critério do acórdão, exigência de homologação no acordo, conciliação no cível e trilha do INSS administrativo.

1. ~~Backfill dos processos com CNJ que nunca foram consultados~~ — **feito em 14/08/2026**: 7 lotes da `backfill-process-marcos` com `apenas_nunca_buscados`. Dos ~46 em formato CNJ ainda não tentados, 20 tinham movimentação (baixada e extraída) e **~26 deram `Escavador 404`** — todos ajuizados em 2026, ainda não indexados. A edge não carimba `data_ultima_verificacao` no 404, então continuam contando como "nunca consultados"; entram de graça quando aparecerem no push. Números fora do formato CNJ estrito são pulados sem custo (`sem_cnj`).
2. **Monitores**: `process_movement_monitors` está com 0 linhas. Sem cadastrar os processos ativos, o sync não roda sozinho e a cobertura só cresce por backfill manual.
3. ~~Gerar Petição Inicial a partir de `data_distribuicao`~~ — **feito em 14/08/2026, na régua de POP-marcos** (não nas 12 estações): fonte `campo_processo` na `vw_pop_marcos_regua` gera o marco `ajuizamento` pela menor entre `data_distribuicao` e `data_inicio`, com prioridade abaixo de qualquer movimentação (36 processos ganharam ajuizamento assim). As 12 estações de `process_movements` seguem sem essa fonte. Junto veio a extensão da régua aos POPs previdenciários e cíveis — migration `20260814130000_marcos_escavador_todos_os_pops.sql`, detalhes na skill `marcos-pop-e-captura`.
4. **Estação 11 (Precatório/RPV) está zerada** — conferir se são casos que não apareceram ainda ou classificação caindo em Pagamento.
5. **Inquérito/criminal**: criar marcos próprios ou deixar fora da régua?
6. ~~Os 913 processos sem CNJ~~ — **resolvido em 07/08/2026**: não são processos, são itens de checklist do POP. Ficam fora da régua porque não deveriam estar nela. Ver "O denominador não é 1.776" na seção 3.
7. **Validar o número no cadastro** — o campo aceita hoje CNPJ, CEP, data e recado ("reprotocolar-cliente nao foi p perícia"). São 33 registros e a sangria continua. Classificar na hora de salvar (CNJ / requerimento / NUP / sem número) para no futuro; não conserta o passado.
8. **216 CNJ válidos sem nenhuma movimentação** — separar "Escavador devolveu 404" de "nunca buscamos". Hoje aparecem iguais na tela e o tratamento é oposto: um é número inexistente ou segredo de justiça, o outro é fila de trabalho.
