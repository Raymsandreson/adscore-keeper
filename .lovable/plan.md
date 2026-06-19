
## Diagnóstico

### Por que sobram órfãos hoje

O matcher tem 6 caminhos (nº requerimento, custom field, atividade, CPF lead, CPF contato, nome). Ele roda em 3 momentos: (1) ao chegar e-mail novo no `gmail-inss-sync`; (2) cron de 15 min em `match-inss-orphans`; (3) botões manuais. Os gaps que produzem órfãos persistentes:

- **CPF quase nunca vem no e-mail do INSS** → o caminho mais forte (CPF) cobre pouco.
- **Direção única**: o sistema só procura "este órfão tem lead?". Nunca procura o oposto — "este lead novo tem órfão pendente?". Quem cria o lead **depois** do e-mail nunca dispara re-match.
- **`benefit_number` (NB) está parseado mas não é usado no matcher.**
- **`auto-link-inss-by-name` devolve `ambiguous` (>1 candidato) e ninguém olha** — não tem UI dedicada pra desempatar.
- **Nº Requerimento INSS não é exigido nem sugerido no LeadForm** quando o produto/serviço é INSS, então o caminho mais determinístico (custom field) raramente é preenchido.

### Por que o backfill trava em ~509 / ~125

- **Processual** (`gmail-processual-sync`): **não tem paginação**. Só lê a 1ª página (`maxResults` ≤ 100). Soma com o que já estava em base = teto fixo. Não importa quantas vezes você clicar "Sincronizar", nunca passa do que cabe em 1 página + delta recente.
- **INSS** (`gmail-inss-sync`): backfill existe e é mês-a-mês, mas (a) usa filtro `subject:"[INSS]"` e o gov.br tem variações de assunto (`[INSS Digital]`, sem colchete, etc.) que ficam de fora; (b) o cursor está salvo em `inss_sync_state.last_result.cursor` mas a UI atual **não relê esse cursor** — cada clique em "Backfill" reinicia em jan/2022 e percorre lendo `existing` no DB pra pular, então parece "travado" porque cada lote desperdiça o orçamento revisitando os mesmos meses cheios.

## Plano de execução

### Frente A — Reduzir órfãos / facilitar vínculo

**A1. Matcher reverso (lead → órfão)** — quando lead é criado/atualizado, dispara busca de órfãos compatíveis.
- Nova função Railway `match-orphans-for-lead` que recebe `lead_id` e procura em `inss_admin_processes` órfãos com nome compatível (mesma lógica `namesAreCompatible`), CPF igual, ou requerimento já gravado no custom field.
- Chamada disparada do front em 2 pontos: (a) toast/CTA depois de salvar lead; (b) ao preencher o custom field "Nº Requerimento INSS" no LeadForm.

**A2. Adicionar `benefit_number` (NB) ao matcher** — buscar em `lead_custom_field_values` por um novo field "NB INSS" e em `lead_processes.process_number`.

**A3. UI "Órfãos ambíguos"** — nova seção colapsável na aba INSS:
- Roda `auto-link-inss-by-name` em `dry_run`, lista os com `candidates.length > 1`.
- Cada item mostra os 2-5 leads candidatos como botões; 1 clique vincula.

**A4. Vincular em lote por CPF** — botão "Vincular órfãos com CPF" que percorre todos os órfãos onde `cpf_segurado` casa com `leads.cpf` ou `contacts.cpf` e aplica match (caminho 100% determinístico, sem ambiguidade).

**A5. Highlight do campo "Nº Requerimento INSS" no LeadForm** — quando o produto/serviço do lead for INSS/BPC/Previdenciário, o custom field aparece em destaque com placeholder e validação de formato. Mata o problema na origem.

**A6. No fechamento do funil (`CloseLeadDialog`/ZapSign defaults)** quando produto = INSS, exigir o Nº Requerimento antes de criar o caso.

### Frente B — Backfill de e-mails antigos

**B1. Paginação real no `gmail-processual-sync`** — adicionar loop com `pageToken`, parâmetro `backfill: true`, cursor `{ inbox, page_token }` salvo em nova tabela `processual_sync_state`, e UI com botão "Buscar mais antigos" + barra de progresso (mesmo padrão do INSS).

**B2. INSS — relaxar filtro de assunto** — trocar `subject:"[INSS]"` por `(subject:INSS OR from:noreply@inss.gov.br OR from:naoresponder@inss.gov.br OR from:meuinss@)` para capturar variantes que hoje são perdidas.

**B3. INSS — persistir e reutilizar o cursor** — UI lê `inss_sync_state.last_result.cursor` na montagem; botão "Continuar backfill de onde parou" usa esse cursor em vez de reiniciar em 2022. Botão separado "Recomeçar do zero" pra casos de troca de filtro.

**B4. Painel de diagnóstico de sync** (pequeno bloco no topo das duas abas):
- Total de e-mails na base · mais antigo · mais novo
- Mês/cursor atual do backfill em andamento
- Inbox usadas, última execução, contagem de erros

### Itens técnicos

```text
Banco (Externo) — migrations:
  + processual_sync_state(id=1, last_run_at, last_result jsonb, cursor jsonb)
  + lead_custom_field "NB INSS" (UUID novo via seed)
  + index gin trigram em inss_admin_processes.nome_segurado (já há?)
  + index em inss_admin_processes (case_id NULL, lead_id NULL) — partial

Railway (novas/editadas):
  + match-orphans-for-lead.ts            (A1)
  ~ inss-matcher.ts                      (A2 — adiciona caminho NB)
  ~ gmail-processual-sync.ts             (B1 — paginação + backfill)
  ~ gmail-inss-sync.ts                   (B2 — filtro relaxado)

Frontend:
  ~ InssAdminProcessesTab.tsx            (A3, A4, B3, B4)
  ~ ProcessualEmailsTab.tsx              (B1 UI, B4)
  ~ LeadForm / custom field config       (A5)
  ~ CloseLeadDialog / ZapSign defaults   (A6)
  + hook useOrphanMatchOnLeadSave        (A1 trigger)
```

## Perguntas antes de executar

1. Quer tudo de A e B no mesmo passo, ou prefere **fazer Frente B primeiro** (destravar backfill) e só depois reduzir órfãos? Frente B sozinha já vai aumentar a quantidade de e-mails na base — vale subir Frente A junto pra não inflar a lista de órfãos.
2. **A5 e A6** mexem em LeadForm e fechamento — confirmo que o produto/serviço a usar como gatilho é o que já está em `kanban_boards.product_service_id` filtrando por nome contendo "INSS"/"BPC"/"Previd"?
3. **B2** (filtro INSS relaxado) pode trazer e-mails de *outras* origens que mencionam "INSS" no assunto e que serão parse-failed. Aceita o ruído controlado (vão pra `inss_status_history` como `PARSE_FAILED` sem virar processo) pra não perder e-mail legítimo?
