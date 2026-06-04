# Discadora automática de leads (Meta Cloud Calling — modo stub)

## Metáfora geral
Vou montar a **cabine de telemarketing inteira**: a porta da frente (gatilho do form), a sala de espera (fila), o operador que dá o aviso obrigatório (template de permissão da Meta) e o relógio de tentativas. **Só o último passo** — "tirar o telefone do gancho e discar" — fica como uma alavanca preta marcada `TODO: Meta Calling API`. Quando você receber acesso ao beta, é puxar essa alavanca (uma função, ~30 linhas).

## O que será construído

### 1. Mapeamento "dono do lead → número Meta dele"
Tabela nova no Externo: `whatsapp_cloud_user_numbers`
- `user_id` (dono do lead) → `phone_number_id` (Meta) + `waba_id`
- Tela simples de admin pra cada acolhedor cadastrar seu número Meta
- Se o dono do lead não tem número cadastrado, a discagem é pulada com motivo claro nos logs

### 2. Configuração por funil
Adicionar coluna `settings JSONB` em `kanban_boards` com:
- `auto_call_enabled: bool` — liga/desliga discadora por board
- `auto_call_window: { start: "08:00", end: "20:00", weekdays: [1..5] }` — janela permitida
- `auto_call_max_attempts: 3`
- `auto_call_retry_minutes: [5, 30, 120]` — intervalo entre tentativas
- `auto_call_permission_template_name: "string"` — template de permissão da Meta a usar
- UI: aba "Discadora automática" nas configurações do board

### 3. Gatilho: lead novo entra → vai pra fila
Trigger Postgres no Externo, no `INSERT` da tabela `leads`:
- Lê o board do lead e seu `settings.auto_call_enabled`
- Se ligado, busca o `phone_number_id` do dono via tabela do passo 1
- Insere registro em `whatsapp_call_queue` com:
  - `provider = 'meta_cloud'` (coluna nova)
  - `instance_name = 'cloud_<user_id>'`
  - `status = 'pending_permission'` (estado novo)
  - `lead_id`, `phone`, `agent_id` (do board)

### 4. Processor da fila (Railway)
Função nova no Railway: `meta-call-queue-processor` (roda em cron a cada 1 min).
Para cada item na fila:

**a) Se status = `pending_permission`:**
- Verifica se já tem permissão de chamada ativa pra esse lead (tabela `whatsapp_call_permissions` — nova)
- Se não tem: dispara template de permissão via Graph API (`POST /{phone_number_id}/messages` com tipo `template` — **isso a gente já tem em `send-whatsapp-cloud.ts`**)
- Marca status `awaiting_permission` e aguarda webhook do usuário aceitar
- Webhook `whatsapp-cloud-webhook` ganha branch novo: ao receber callback de aceite de permissão, atualiza `whatsapp_call_permissions` e empurra item da fila pra `ready_to_call`

**b) Se status = `ready_to_call`:**
- Verifica janela de horário
- Verifica `attempts < max_attempts`
- Chama função `dispatchMetaCall()` — **AQUI É O STUB**:
  ```ts
  async function dispatchMetaCall(payload) {
    // TODO: Plugar Meta Cloud Calling API quando liberar acesso
    // Endpoint esperado: POST graph.facebook.com/v21.0/{phone_number_id}/calls
    // Por enquanto: marca status awaiting_meta_calling_api e loga
    return { ok: false, reason: 'META_CALLING_API_NOT_AVAILABLE' };
  }
  ```
- Status vai pra `awaiting_meta_calling_api`, com nota clara

### 5. Painel de monitoramento
Tela `/discadora` mostrando:
- Fila atual (lead, dono, status, tentativas, próximo retry)
- Filtro por board, status, dono
- Botão "Cancelar item" e "Forçar retry"
- Métricas: leads enfileirados hoje, permissões pedidas, permissões aceitas, ligações pendentes do desbloqueio Meta

## O que NÃO será mexido
- `make-whatsapp-call` (UazAPI) — fica intacta, ninguém usa pra esse fluxo
- Distribuição de leads (rotativa por conversão) — já está pronta
- `wjia-followup-processor` — segue tocando follow-ups de mensagem normalmente
- Estrutura do Kanban, distribuição, métricas de conversão — só ganham configuração nova

## Quando a Meta liberar acesso
Você me passa:
1. URL exata do endpoint (provavelmente `POST graph.facebook.com/v{X}/{phone_number_id}/calls`)
2. Payload de exemplo que funcionou no teste
3. Formato da resposta de sucesso e principais erros

Eu plugo na função `dispatchMetaCall()` (única mudança), o status `awaiting_meta_calling_api` vira `calling`, e a fila começa a discar pra valer. **Zero refator no resto.**

## Riscos / pontos de atenção
- **Custo de templates Meta**: cada pedido de permissão é uma mensagem cobrada. A janela e o `max_attempts` precisam ser conservadores no início
- **Permissão de chamada da Meta**: é uma feature relativamente nova (Calling Permission API). Vou usar o template do tipo `CALL_PERMISSION_REQUEST` quando disponível na sua conta. Se sua conta ainda não tem esse tipo de template, vamos usar template comum e tratar a resposta "sim/não" manualmente
- **Trigger no INSERT de leads**: leads criados em massa (bulk import) também cairiam na fila — preciso adicionar flag `skip_auto_call` no INSERT pra esses casos. Vou cobrir os 5 pontos de criação que mapeei
- **Migration reversível**: a coluna `settings` em `kanban_boards` vai com default `'{}'` — rollback é só dropar a coluna sem perda de dado
