
# Etiquetas de Resultado + Prefixo 🤖 em Agentes

## Metáfora
Hoje a etiqueta funciona como "crachá" do agente IA. Vou adicionar 5 crachás novos que representam o **resultado do lead** (Em andamento, Fechado, Recusado, Inviável, Cancelado). Esses crachás conversam nos 2 sentidos: se você cola no WhatsApp, o status do lead muda no CRM; se você muda o status no CRM, o crachá certo aparece automaticamente na conversa do WhatsApp.

Além disso, prefixo 🤖 em todos os crachás de agente pra você diferenciar de relance "isso é IA" vs "isso é resultado".

---

## O que vai mudar

### 1. Prefixo 🤖 em agentes (mudança pequena, conservadora)
- `sync-agent-labels.ts`: nome enviado pra UazAPI vira `🤖 {agent_name}` em vez de só `{agent_name}`.
- Como a sync é idempotente e compara `mapping.label_name === agentName`, na próxima sync ela detecta mismatch e faz `update` em todas as instâncias. Sem migration de dados — UazAPI renomeia in-place.

### 2. Nova tabela `result_instance_labels` (Externo)
Espelha a `agent_instance_labels` mas pra resultados. Não reaproveito a mesma tabela pra manter o domínio limpo (agente ≠ resultado).

```text
result_instance_labels
  id uuid pk
  result_key text     -- 'in_progress' | 'closed' | 'refused' | 'inviavel' | 'cancelled'
  instance_name text
  label_id text       -- id retornado pela UazAPI
  label_name text     -- '✅ Fechado' etc
  color int           -- paleta UazAPI 0-19
  created_at, updated_at, deleted_at
  UNIQUE (result_key, instance_name)
```

Mapeamento fixo (hardcoded — não vira tela de admin, é regra de negócio):

| result_key | label_name | UazAPI color | lead_status (no banco) |
|---|---|---|---|
| `in_progress` | 🕐 Em andamento | 6 (amarelo) | `active` ou `open` |
| `closed` | ✅ Fechado | 5 (verde) | `closed` |
| `refused` | ❌ Recusado | 7 (vermelho) | `refused` |
| `inviavel` | ⚠️ Inviável | 9 (cinza claro) | `inviavel` |
| `cancelled` | 🚫 Cancelado | 1 (cinza escuro) | `cancelled` (novo valor) |

**Importante sobre cores**: a paleta UazAPI é 0–19 sem documentação clara. Os índices acima são minha melhor aposta baseada no padrão Meta, mas pode acontecer de uma cor sair "errada" no WA igual aconteceu com cinza/azul antes. Se sair errado, ajusto a constante e re-sincronizo (1 linha).

### 3. Nova função Railway: `sync-result-labels`
- Igual `sync-agent-labels`, mas itera os 5 resultados fixos e cria/atualiza em todas instâncias conectadas.
- Botão único na tela de Settings (ou em /agent-monitor) "Sincronizar etiquetas de resultado".
- Idempotente — pode rodar quantas vezes quiser.

### 4. Webhook WA → CRM (whatsapp-webhook.ts)
Estende o bloco que já existe (linhas 789-832 do whatsapp-webhook.ts) que detecta etiquetas de agente. Adiciono lookup paralelo em `result_instance_labels`:

```text
quando webhook recebe label aplicada na conversa:
  1. Já roda: agent label sync → ativa agente
  2. NOVO: result label sync → resolve lead_id da conversa
     - tenta whatsapp_conversation_agents (phone+instance) → lead_id
     - se vazio, tenta contact_leads via contact pelo phone
     - se vazio, ignora (sem lead vinculado = nada a atualizar)
  3. Se achou lead_id E o novo lead_status é diferente do atual:
     - update leads set lead_status = X, updated_at = now()
     - grava em lead_activities um registro 'status_changed_via_label'
```

**Importante**: só atualizo se vínculo for explícito (sua escolha #2). Sem chute por telefone solto.

### 5. CRM → WA (gatilho no Postgres Externo)
Trigger `AFTER UPDATE OF lead_status ON leads`:
- Se `lead_status` mudou pra um dos 5 valores mapeados:
  - Acha a conversa vinculada (phone + instance via `whatsapp_conversation_agents` do lead)
  - Chama edge function `apply-result-label-to-conversation` (Externo) que:
    - Remove as outras 4 etiquetas de resultado da conversa (pra não acumular)
    - Aplica a etiqueta nova via UazAPI `/chat/labels`
- Trigger é `SECURITY DEFINER` e usa `net.http_post` (mesmo padrão dos bridges existentes).

**Por que essa edge mora no Externo e não no Railway**: trigger SQL chama via HTTP. Tanto faz onde a edge roda, mas como ela precisa ler `whatsapp_instances.instance_token` que já é Externo, fica mais simples colocar lá.

### 6. Loop infinito — prevenção
Risco real: webhook muda status → trigger aplica etiqueta → webhook reentra → trigger reentra…

Trava: webhook detecta que a etiqueta sendo aplicada **já está no estado correto** (status atual do lead já corresponde) e faz no-op. Trigger faz a mesma checagem (se etiqueta correta já está aplicada na conversa, no-op). Idempotência mata o loop.

### 7. Sem novo valor `cancelled` em `lead_status`
Hoje os valores válidos são: `active, open, closed, refused, inviavel`. `cancelled` não existe. Vou adicionar como valor aceito (sem CHECK constraint — só uso semântico) e mostrar nas listagens existentes.

---

## Rota de fuga (Regra 1 do CLAUDE.md)
- Tabela nova `result_instance_labels` — drop simples se der ruim.
- Trigger SQL — `DROP TRIGGER` reverte.
- Edge function nova — delete pelo painel.
- `sync-agent-labels.ts` prefixo 🤖 — `git revert` no commit + 1 sync = nomes voltam.
- **Nada apaga dado de cliente**. Pior caso: lead com `lead_status` errado, ajustável manualmente.

---

## Ordem de execução
1. Migration: cria `result_instance_labels` + valor `cancelled` aceito + trigger
2. Edge function Externo `apply-result-label-to-conversation`
3. Railway: nova função `sync-result-labels` + edita `sync-agent-labels` pra prefixo 🤖
4. Railway: edita `whatsapp-webhook.ts` pra detectar etiquetas de resultado
5. UI: botão "Sincronizar etiquetas de resultado" no Settings (perto do botão de sync de agentes)
6. Testes manuais: aplicar cada uma das 5 etiquetas numa conversa de teste, conferir lead_status mudou; mudar lead_status no CRM, conferir etiqueta apareceu no WA.

---

## O que NÃO vou mexer
- Nenhuma tabela existente além de `leads` (só leitura de status atual).
- Nenhum outro webhook.
- `agent_instance_labels` continua igual — agentes e resultados ficam separados.
- Cores dos agentes (verde/cinza) seguem como estão.
- Fluxo de label_document_triggers (ZapSign) intocado.

Posso seguir?
