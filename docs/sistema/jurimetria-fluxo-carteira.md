# Jurimetria e fluxo da carteira — estado real em 07/08/2026

Documento de partida para a tela de "quanto dinheiro tem em cada estágio, por carteira e por POP".
**Nada disso está implementado no app hoje.** Este é o mapa do terreno, levantado com SQL no banco real e com a planilha aberta.

Vocabulário de estágios: skill `whatsjud-fluxo-vocabulario` (v4) — é a fonte da verdade e não se reabre aqui.

---

## 1. Onde vivem os dados

Tudo no **Supabase Externo** `kmedldlepwiityjsdahz`. **Nenhuma referência a `jm_` existe no front** — a camada é 100% banco.

**15 tabelas** (07/08/2026):

| Tabela | Linhas | O que é |
|---|---|---|
| `jm_processos` | 344 (333 CNJ distintos) | o processo; tem `caso`, `fase`, `objetivo`, `passo`, `origem` |
| `jm_partes` | 1.201 | **o cliente dentro do processo** — a granularidade que vale |
| `jm_valores` | 1.652 | `dano_moral`, `dano_estetico`, `base_calculo`, `meses_pensionamento`, `hs_pct` |
| `jm_pagamentos` | 1.022 | parcelas: `n_parcela`, `data_prevista`, `data_recebida`, `status`, `desagio` |
| `jm_movimentos` | 37.649 | movimentações (DataJud) |
| `jm_lancamentos` | 4.364 | caixa realizado, com `responsavel` e `categoria` |
| `jm_decisoes` | 439 | decisões, com `termo_inicial_jcm` (base da correção) |
| `jm_marco_config` | 22 | **a régua de marcos da jurimetria** (ver §4) |
| `jm_acordos` | 6 | acordos com `n_parcelas`, `multa_pct` |
| `jm_indices` | — | índices de correção; alimentado pelo cron `jm_indices_diario` |
| `jm_config` | 1 | ver alerta em §7 |
| `jm_documentos`, `jm_datajud_req`, `jm_esc_solicitacoes`, `jm_http_req` | — | apoio/ingestão |

**14 views**, das quais importam: `vw_jm_visao_processo` (1.186 linhas, granularidade cliente — a mais completa), `vw_jm_marcos`, `vw_jm_caixa_classificado`, `vw_jm_fluxo_mensal`, `vw_jm_status_pagamento`, `vw_jm_conciliacao`.

---

## 2. A planilha NÃO está sincronizada

**"Jurimetria/indenização"** — `1WQCQdYwvBBvIfS2iiU1iiFiCZ38j2zHDTmpy1AXxFMM`, dona `raymsandresonadv@gmail.com`, criada em 09/2024.

- **Modificada em 06/08/2026 18:20**
- `jm_processos.created_at` vai de **08/07 a 10/07/2026 e para ali**
- Dos 24 crons do banco, o único `jm_` é `jm_indices_diario` (índices de correção). **Não existe rotina que leia essa planilha.**
- `sync-hearings-from-sheet-daily` é outra planilha (audiências), não esta

**Foi uma carga única de julho.** Um mês de edições não está no banco.

### Aba `Tab. Aux` — o mapa das colunas

Intervalo real **`A3:AB28572`**. Cabeçalho na linha 3:

| Col | Cabeçalho |
|---|---|
| J | Fase Atual |
| K | TOTAL DA CONDENAÇÃO CJCM |
| L | TOTAL PARTE CJCM |
| M | TOTAL À VISTA PARTE CJCM |
| **N** | **HONORÁRIOS CONTRATUAIS À VISTA** |
| **O** | **HONORÁRIOS CONTRATUAIS PARCELADO** |
| **P** | **HONORÁRIOS SUCUMBENCIAIS** |
| Q | AUX |
| R | TEMPO DA ÚLTIMA DECISÃO |

**A separação à vista × parcelado já existe na planilha, em coluna própria (N e O).**

Regra de cálculo, conforme o Raym (07/08/2026): os honorários saem da indenização do cliente — **danos morais + danos materiais (parcelas vencidas e vincendas) + percentual de sucumbência**. Não é percentual fixo.

> **Cuidado ao ler a planilha por ferramenta.** O `read_file_content` do Drive devolve um texto achatado, sem separar abas, e **não traz a `Tab. Aux` inteira** — traz um recorte pequeno de outra aba. Quem confiar nesse export vai subestimar grosseiramente o volume de dados (ver §6, erro 2). Para trabalhar a sério com a planilha, exportar aba por aba.

---

## 3. Os componentes do valor — e o que NÃO concilia

Somando `vw_jm_visao_processo` (1.186 clientes, 342 processos):

| Componente | Valor | Observação |
|---|---|---|
| Dano moral atualizado | R$ 40,23 M | |
| Dano estético atualizado | R$ 1,45 M | |
| **Pensionamento** (`base_calculo_atualizada` × meses) | **R$ 72,07 M** | só 174 clientes têm |
| **Total** | **R$ 113,75 M** | |
| Pago (dedup por processo) | R$ 23,33 M | |
| A receber (dedup por processo) | R$ 0,73 M | |

**`base_calculo` = R$ 6,52 M é a base MENSAL do pensionamento** — o valor de uma parcela, não o total. Multiplicado pelos meses de cada cliente vira os R$ 72,07 M. Confundir os dois é o erro mais fácil de cometer aqui.

**A conciliação com a âncora de ~R$ 41,7 M do vocabulário NÃO fechou.** Moral + estético dá R$ 41,68 M e *parece* bater, mas só porque ignora o pensionamento inteiro. É coincidência, não conciliação (ver §6, erro 1).

### A armadilha do `pago_processo`

`vw_jm_visao_processo` é por **cliente**, mas as colunas `pago_processo` e `a_receber_processo` vêm de `vw_jm_status_pagamento`, que é por **processo**:

```sql
FROM jm_partes pa
  JOIN jm_processos p USING (processo_cnj)
  LEFT JOIN vw_jm_status_pagamento sp USING (processo_cnj)   -- <- por PROCESSO
```

Um processo com 5 clientes repete o mesmo `pago` 5 vezes. **Somar direto dá R$ 112,85 M — falso.** O correto é `select distinct processo_cnj, pago_processo` antes de somar, o que dá R$ 23,33 M. Não é dado sujo; é semântica de coluna. Vale para qualquer coluna com sufixo `_processo`.

---

## 4. Três réguas diferentes — não confundir

| Régua | Onde vive | Itens | Para que serve |
|---|---|---|---|
| **Marcos processuais** | `process_movements` (app) | 12 estações: petição inicial → pagamento | onde o processo está, no app |
| **Marcos da jurimetria** | `jm_marco_config` | 19 marcos em 7 fases: CONHECIMENTO, RECURSAL, ACORDO, SATISFACAO, SUSPENSO, DEFINITIVO, ENCERRADO | onde o processo está, na jurimetria |
| **Estágio de fluxo** | não existe ainda | 7: PROJETADO, CONDENAÇÃO, A RECEBER, VENCIDO, EM EXECUÇÃO, DEPOSITADO EM JUÍZO, PAGO | **cadê o dinheiro** |

As duas primeiras são de base diferente (Escavador vs DataJud) e não se falam. A jurimetria tem estados que o app não tem (`SUSPENSAO_IRDR`, `LIQUIDACAO_INICIADA`).

**Decisão do Raym (07/08/2026): a tela agrupa dinheiro pela régua de 7 estágios de fluxo.** Marco processual é *onde o processo está*; estágio é *quanto daquilo é caixa*. Um acórdão pode ser CONDENAÇÃO (valor certo, sem data) — firme, mas não antecipável. Agrupar dinheiro por marco soma CONDENAÇÃO com A RECEBER e produz número que parece caixa e não é.

---

## 5. Cobertura dos filtros pedidos

Casamento `jm_processos.processo_cnj` × `lead_processes.process_number` (só dígitos):

| | Processos |
|---|---|
| CNJ distintos na jurimetria | 333 |
| Casam com processo vivo do app | **205** |
| Só na jurimetria (fora do app) | 136 |
| Dos casados: com POP (`workflow_name`) | 196 |
| Dos casados: com time (`vw_process_assignment`) | 193 |
| Dos casados: **com dono** (`vw_process_assignment.user_id`) | **140** |

- **Filtro por carteira cobre ~42% da jurimetria.** O resto precisa de um balde "sem carteira" explícito na tela.
- `lead_processes.responsible_user_id` só tem **10** dos 205 — **não usar**. A fonte de dono é `vw_process_assignment` / `process_owners()`.
- **À vista × parcelado**: `jm_pagamentos` cobre **44 dos 333** processos (713 parcelas RECEBIDA, 219 PREVISTA, 90 A REVISAR). Nos outros 289 a modalidade fica **em branco, nunca zero** — zero diria "à vista", e não é o que se sabe.

### Percentuais de honorário já no banco

- `jm_valores.hs_pct`: preenchido em **1.651 de 1.652** — 0% (485), 10% (569), 15% (351), 5% (174), 6% (25), 12% (14)
- `lead_processes.fee_percentage`: 294 de 1.776, média **29,98%**

Servem de referência, **mas não substituem o cálculo da planilha** (§2): o honorário é derivado da indenização, incluindo materiais, não de um percentual chapado sobre o bruto.

### Outros números úteis

184 clientes menores de idade (crédito inalienável, art. 1.691 CC → DEPOSITADO EM JUÍZO) · 0 cotas marcadas como `vendida` · `jm_processos.origem` = INTERNO em 100%.

---

## 6. Dois erros já cometidos aqui — não repetir

**1. "A conciliação fechou" (falso).** Somar moral + estético dá R$ 41,68 M, que bate com a âncora de ~R$ 41,7 M do vocabulário — mas ignora R$ 72,07 M de pensionamento. Bater com um número de memória **não é conciliar**. Conciliação é fechar componente a componente contra a fonte, não achar um total parecido.

**2. "Só 8 clientes têm honorário na planilha" (falso).** Veio de ler o export achatado do Drive, que trouxe um recorte de outra aba. A `Tab. Aux` real vai até a linha 28572. **Nunca concluir sobre volume de dados a partir desse export.**

Os dois têm a mesma raiz: conclusão sobre a base inteira a partir de uma amostra não verificada. Daí o método do §8.

---

## 7. Alertas de segurança

- **`jm_config` guarda a API key do DataJud em texto plano** (`chave = 'datajud_api_key'`). A tabela está com RLS ligado e **zero policies**, então nem `anon` nem `authenticated` leem — só `service_role`. Não é vazamento, mas o lugar de credencial é env var/vault. Corrigir em passada separada.
- **`jm_partes` tem dado pessoal** — `nascimento`, `telefone`, `cep`, `cidade_mora`, `bairro`. RLS ligado, policy `TO authenticated`, SELECT. Qualquer view nova sobre ela precisa de `security_invoker = on`, senão fura o RLS.
- Ao exportar a planilha para arquivo temporário, ela carrega **nome de cliente e CNJ**. Manter no scratchpad da sessão, **nunca no repo**.

---

## 8. Combinado para a próxima sessão: piloto de 5 processos

**Decisão do Raym (07/08/2026): fazer do zero, com 5 processos, e só depois generalizar.**

Método:

1. Escolher 5 processos — de preferência com litisconsórcio (vários clientes) e pelo menos um com parcelas em `jm_pagamentos`, um com cliente menor e um em execução.
2. Para cada par `(processo × cliente)`, fechar **célula a célula contra a `Tab. Aux`**: total da condenação (K), total da parte (L), à vista (M), contratual à vista (N), contratual parcelado (O), sucumbencial (P).
3. Só quando os 5 fecharem, escrever a regra de derivação — e só então rodar na base toda.
4. Conciliar de novo na base toda **antes** de qualquer tela.

Regra dura do Modo Leopardo (do vocabulário): nenhuma migração física sem aval explícito do Raym, sem a conciliação fechar, e fora do horário do cron `esc_colher`. Migrações são aditivas.

O que a tela precisa entregar, quando chegar a hora: filtro **carteira / todas** e **POP**; dinheiro agrupado pelos **7 estágios**; **cota do cliente e honorário em colunas separadas, nunca somadas**; honorário aberto em **à vista × parcelado**.

---

## 9. Perguntas em aberto

1. Os 136 processos que só existem na jurimetria entram na tela ou ficam fora?
2. Reimportar a planilha: quais abas ainda valem, agora que se sabe que a `Tab. Aux` é a que interessa?
3. Sync recorrente da planilha, ou a planilha deixa de ser fonte e o banco passa a ser?
4. Qual régua de marcos morre — ou as duas convivem, cada uma no seu lugar?
