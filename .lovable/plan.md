## Objetivo

Fazer os e-mails do INSS **acharem o lead sozinhos**, em vez de cair como órfão.

**Metáfora:** hoje a etiqueta do INSS chega só com um código de rastreio. Vou criar uma "etiqueta de identificação" nos leads (um campo onde você cola o nº do requerimento) — quando o e-mail novo chegar, o sistema confere os crachás dos leads e amarra automaticamente.

---

## Plano

### 1. Criar o campo "Nº Requerimento INSS" no lead
- Inserir uma linha em `lead_custom_fields` (Externo), escopo amplo (board_id = NULL → aparece em todos os funis), tipo `text`.
- Garante que já aparece dentro do form unificado de Lead (que renderiza custom fields automaticamente).

### 2. Auto-match no Railway (`gmail-inss-sync.ts`)
Logo após criar/atualizar o `inss_admin_processes` com `case_id = NULL`:
1. Buscar em `lead_custom_field_values` algum lead cujo valor bate com o `requerimento_number`.
2. Se achar: atualizar o `inss_admin_processes` com `lead_id` + `case_id` correspondente, marcar `linked_at`, e disparar `notify-inss-update`.
3. Se não achar: deixa órfão (comportamento atual).

### 3. Retroativo — botão "Tentar vincular automaticamente"
Na aba "INSS Administrativo", adicionar botão ao lado de "Sincronizar agora": varre os 10 órfãos atuais e tenta o match. Útil quando o operador for cadastrando o nº nos leads.

### 4. UX — facilitar o cadastro do nº no lead
No botão **Vincular** que já existe em cada órfão, depois de vincular ao caso, **gravar automaticamente** o `requerimento_number` no campo customizado daquele lead. Assim, da próxima vez que chegar e-mail desse mesmo requerimento, já casa sozinho — sem o operador ter que digitar nada.

---

## Detalhes técnicos

**Arquivos tocados:**
- SQL (1 INSERT em `lead_custom_fields` no Externo) — via `run-external-migration`
- `railway-server/src/functions/gmail-inss-sync.ts` — bloco de auto-match após upsert do processo
- `railway-server/src/functions/match-inss-orphans.ts` — nova função para o botão retroativo
- `railway-server/src/server.ts` — rota da nova função
- `src/components/processes/InssAdminProcessesTab.tsx` — botão "Vincular órfãos" + gravar nº no custom field ao clicar em Vincular

**O que NÃO vou mexer:**
- Parser do e-mail (não dá pra extrair mais do que já extrai — fonte limitada)
- Lógica de notificação
- Schema da `inss_admin_processes`
- Forms de lead (o campo aparece sozinho por ser custom field)

**Risco/rollback:**
- Custom field é só uma linha — remove com `DELETE` se der ruim
- Mudança no Railway é aditiva (só executa se `case_id` ainda for NULL)
- Deploy do Railway é por commit no GitHub → reversível com revert

---

## O que vai mudar pra você na prática

1. Abre qualquer lead INSS Administrativo → tem um campinho novo "Nº Requerimento INSS"
2. Cola o número lá uma vez
3. Daí em diante, todo e-mail do INSS desse processo já chega vinculado ao lead, com status atualizado
4. Os 10 órfãos atuais: clica em "Vincular" uma vez → o sistema **memoriza** o nº no lead → próximos updates desse mesmo requerimento entram automáticos