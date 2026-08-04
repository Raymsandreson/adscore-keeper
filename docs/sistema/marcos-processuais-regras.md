# Marcos processuais — regras vigentes e pontos a decidir

Documento de revisão. Retrato do banco em **30/07/2026** (Externo `kmedldlepwiityjsdahz`).
Alimenta a linha do trem da ficha do processo, o "status atual" e as Metas Processuais (por time
**ou por pessoa**, desde 04/08/2026 — ver `docs/sistema/comunicacao-gestao.md`).

---

## 1. Como um marco nasce

```
Escavador (API v2)
  └─ /processos/numero_cnj/{CNJ}/movimentacoes
       └─ lead_processes.movimentacoes (jsonb, cru)
            └─ extractMarcos()   supabase/functions/_shared/escavadorMarcos.ts
                 └─ process_movements  (append-only, 1 linha por marco)
                      ├─ lead_process_current_status  (view: marco atual)
                      └─ estacoesDoProcesso()  src/lib/processStations.ts (linha do trem)
```

Só existe marco onde houve movimentação baixada. Nada é digitado à mão hoje.

---

## 2. Os 10 marcos e a ordem canônica

| # | Marco | Como é detectado hoje (palavras-chave normalizadas) |
|---|---|---|
| 1 | Petição Inicial | `peticao inicial`, `distribuic`, `protocolo da inicial`, `autuac`, `ajuizamento` |
| 2 | Audiência de Conciliação | vem do detector de compromissos / campo `audiencias` do Escavador |
| 3 | Perícia | idem |
| 4 | Audiência de Instrução | idem |
| 5 | Sentença (1º grau) | `sentenca`, `julgo procedente/improcedente/parcialmente`, `extincao do processo`, `resolucao do merito`, `julgo extinto` |
| 6 | Acordo | `acordo`, `homologacao de acordo`, `transacao`, `conciliacao`, `autocomposicao` |
| 7 | Acórdão (2º grau) | `acordao`, `apelacao`, `deram/negaram provimento`, `recurso ordinario/especial/extraordinario` |
| 8 | Acórdão (superior) | os mesmos marcadores + `stj`, `stf`, `superior tribunal`, `supremo`, `tribunal superior` no cabeçalho |
| 9 | Trânsito em Julgado | `transito em julgado`, `transitou em julgado`, `certidao de transito` |
| 10 | Pagamento | `alvara`, `rpv`, `precatorio`, `levantamento`, `deposito judicial`, `pagamento efetuado/realizado/integral`, `comprovante de pagamento`, `quitacao` |

**Ordem de avaliação** (a primeira que casa vence): acórdão → acordo → sentença → trânsito → petição inicial → pagamento.

**Sinal primário**: a `classificacao_predita.nome` que o próprio Escavador devolve.
**Fallback**: palavra-chave no *cabeçalho* (título + primeiros 180 caracteres), nunca no corpo inteiro — classificar pelo corpo gerava falso "trânsito em julgado" em toda sentença que termina com "após o trânsito em julgado, arquive-se".

### Guardas já existentes

1. **Sigilo** — o placeholder "MOVIMENTAÇÃO CONFIDENCIAL — PROCESSO EM SEGREDO DE JUSTIÇA, PRECATÓRIO OU RPV" nunca vira marco (casava `precatorio`/`rpv` e criava falso Pagamento).
2. **"Pagamento" isolado não conta** — só instrumentos concretos de quitação, porque toda sentença diz "condeno ao pagamento de…".
3. **Petição inicial é única** — se o parser achar várias, fica a mais antiga.
4. **Redistribuição não é ajuizamento** (30/07/2026) — petição inicial com data posterior a um marco mais avançado é descartada. Motivo: `0000657-98.2025.5.11.0012` tinha "Distribuído por sorteio" em 08/06/2026 (remessa ao relator no TRT) e acórdão em 29/04/2026; o processo aparecia parado na petição inicial.

### Marco "atual" (30/07/2026)

Passou a ser **o marco de maior `marco_ordem`**, com empate desfeito pela data mais recente — antes era simplesmente a data mais recente. Vale na view `lead_process_current_status`, nas RPCs das metas e no "Detalhe do status atual" da ficha. Corrigiu 18 dos 89 processos com marco, todos para um estágio mais avançado.

---

## 3. Cobertura real

| | Processos |
|---|---|
| Vivos (`deleted_at is null`) | 1.647 |
| Judiciais | 578 (todos com CNJ) |
| Administrativos | 1.069 (204 com CNJ) |
| Com movimentações baixadas | 68 |
| **Com algum marco** | **89** (86 judiciais, 3 administrativos) |

Ramo da Justiça dos que têm marco: Trabalho 55 · Estadual 19 · Federal 15.

**Por que tão pouco**: `process_movement_monitors` está vazio e a `check-process-movements` só percorre monitores ativos; além disso 865 processos não têm CNJ. Detalhes em `docs/sistema/comunicacao-gestao.md`.

---

## 4. "Não tem petição inicial" — por que, e o que fazer

**57 dos 89** processos com marco não têm Petição Inicial; **22** deles têm outros marcos (ou seja, o processo claramente foi ajuizado). Causas:

1. **A movimentação de distribuição é antiga e não veio no lote baixado.** O Escavador devolve a partir de certa data; um processo de 2023 com sync feito em 2026 traz só o recente.
2. **O tribunal não publica a distribuição como movimentação** — em vários sistemas ela é campo do processo (`data_distribuicao`), não movimentação.
3. **Processo administrativo** — não existe "petição inicial", existe protocolo do requerimento.

**Saída disponível sem custo de API**: `lead_processes.data_distribuicao` e `data_inicio` já vêm preenchidos do Escavador em parte da base. Dá para gerar o marco de Petição Inicial a partir do campo do processo quando não houver movimentação correspondente (fonte `campo_processo` em vez de `escavador`). **Pendente de decisão.**

---

## 5. Marcos por rito

A linha do trem já filtra estações por perfil (`src/lib/processStations.ts`), com regra validada em 13/07/2026:

| Rito | Conciliação | Perícia | Instrução |
|---|---|---|---|
| **Trabalhista** (CNJ ramo 5) | sim | sim, salvo caso fatal | sim |
| **Previdenciário** (ramo 4 ou tipo BPC/LOAS/auxílio/aposentadoria/pensão) | não | sim, salvo pensão por morte, maternidade e rural | só pensão por morte ou rural |
| **Demais ramos** | só por evidência | só por evidência | só por evidência |

Override manual da perícia: `lead_processes.pericia_prevista` (null = automático).
Evidência sempre vence a previsão: se o marco existe, a estação aparece.

### O que ainda não tem regra própria

- **Cível / consumidor** (ramo 8 — 19 processos com marco): hoje cai em "demais ramos". Falta decidir se conciliação (art. 334 CPC) entra como prevista.
- **Criminal / inquérito policial** (POP "INQUÉRITO POLICIAL", 9 processos): o ciclo é outro — inquérito, denúncia, instrução, sentença. Nenhum dos 10 marcos descreve isso direito.
- **Execução / cumprimento de sentença**: hoje "Pagamento" cobre alvará e RPV, mas não distingue início da execução, embargos, penhora.
- **Administrativo (INSS)**: tem trilha própria em `inss_admin_processes.current_status` — Concluída 299, Exigência 279, Protocolado 129, Cancelada 33, Em Análise 28, Pendente 21. **Não conversa** com `process_movements`, então esses 1.069 processos ficam fora de qualquer meta por marco.

---

## 6. Decisões pendentes (para revisar juntos)

1. **Limpar as 13 linhas de petição inicial que são redistribuição** já gravadas? A guarda nova só vale para extrações futuras; `process_movements` é append-only e não tem DELETE via app.
2. **Re-extrair os marcos dos 68 processos com movimentações salvas** aplicando as regras atuais? Custo zero de API (o jsonb já está no banco).
3. **Backfill das movimentações** dos 782 processos com CNJ (782 chamadas ao Escavador) — é o que realmente destrava as metas.
4. **Gerar Petição Inicial a partir de `data_distribuicao`** quando não houver movimentação?
5. **Rito cível**: conciliação do art. 334 entra como estação prevista?
6. **Inquérito/criminal**: criar marcos próprios ou deixar fora da régua de marcos?
7. **Administrativo INSS**: trazer `current_status` para a régua de metas como trilha paralela?
8. **Monitores**: cadastrar `process_movement_monitors` para os processos ativos, para o sync passar a rodar sozinho.
