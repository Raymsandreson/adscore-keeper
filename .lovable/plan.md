# Plano — Cliente principal + alerta de saída do grupo

## Frente 1 — Cliente principal + relação entre contatos

### O que muda visualmente
No diálogo de membros do grupo (e em qualquer tela de contatos de um lead/caso):

- Cada membro ganha um **toggle "Cliente principal"** (estrela/coroa). Só pode ter **1 principal por lead**.
- O campo atual "Relação com a vítima" vira **"Relação com o cliente principal"** (filho, esposa, irmão, advogado, testemunha, outro…) e fica **desabilitado** enquanto não houver cliente principal definido.
- Quando alguém é marcado como principal, o campo dele some (ele é a referência) e nos demais aparece "Relação com [Nome do Principal]".

### Schema (Supabase Externo, via `run-external-migration`)
Adicionar em `contact_leads` (tabela que já vincula contato↔lead):
- `is_primary_client BOOLEAN DEFAULT false`
- `relationship_to_primary TEXT` (livre + sugestões)
- Índice parcial único garantindo 1 principal por lead: `CREATE UNIQUE INDEX ... ON contact_leads(lead_id) WHERE is_primary_client = true`

Manter o campo antigo `relationship_to_victim` por 24h como `_legacy`, depois remover (Regra 4).

### Migração de dados
Para leads em funis de **Acidente de Trabalho**: copiar `relationship_to_victim` → `relationship_to_primary`. Demais leads: descartar (não fazia sentido).

---

## Frente 2 — Saída do grupo

### Detecção (webhook tempo real)
- Adicionar handler no Railway (`whatsapp-group-participant-left.ts`) que escuta eventos `group.participant.leave` da UazAPI.
- Valida assinatura/token do webhook (Princípio de cibersegurança 3).
- Quando dispara: grava em nova tabela `whatsapp_group_exits` (group_jid, phone, exit_at, exit_type: 'left'|'removed').
- Atualiza `whatsapp_groups_cache` removendo o participante.

### Card fixo na aba Atividades
- Componente novo `GroupExitAlert` no topo de `LeadActivitiesTab`/`CaseActivitiesTab`.
- Mostra: "⚠️ [Nome ou telefone] saiu do grupo em [data/hora]. Não envie atualizações pelo grupo sem verificar."
- Botão "Marcar como visto" (grava `acknowledged_by` + `acknowledged_at` na linha de `whatsapp_group_exits`).
- Permanece visível enquanto houver saídas não-reconhecidas.

### Atividade automática para o responsável processual
- Adicionar **campo obrigatório** `processual_responsible_id` em `leads` (UUID do profile). Validação no form de lead.
- Quando saída detectada: criar `lead_activities` do tipo `notificacao`, prioridade `alta`, assigned_to = `processual_responsible_id`, título "Cliente saiu do grupo".
- Se o lead não tiver responsável processual definido (legacy), cair para `assigned_to` do lead com aviso.

---

## Arquivos afetados

**Schema (Externo)**
- `contact_leads`: novos campos
- `leads`: `processual_responsible_id NOT NULL` (com default backfill = assigned_to)
- `whatsapp_group_exits`: tabela nova

**Backend**
- `railway-server/src/functions/whatsapp-group-participant-left.ts` — novo
- `railway-server/src/index.ts` — registrar rota
- `supabase/functions/whatsapp-uazapi-webhook` — encaminhar evento de saída

**Frontend**
- `src/components/whatsapp/GroupMembersDialog.tsx` — toggle principal + relação dinâmica
- `src/components/leads/LeadFormDialog.tsx` (ou equivalente) — campo obrigatório
- `src/components/leads/LeadActivitiesTab.tsx` + `src/components/cases/CaseActivitiesTab.tsx` — `GroupExitAlert`
- `src/components/whatsapp/GroupExitAlert.tsx` — novo
- `src/hooks/useGroupExits.ts` — novo, com realtime

---

## Ordem de execução
1. Migration no Externo (schema + backfill)
2. Webhook + handler Railway
3. Hook + componente de alerta
4. UI do GroupMembersDialog (toggle principal + relação)
5. Campo obrigatório no form de lead
6. Testes manuais: criar lead → marcar principal → simular saída via webhook → ver card + atividade

---

## O que NÃO vai mexer
- Estrutura de membros do grupo no UazAPI (continua igual)
- Demais campos do contato (profissão, classificação, etc)
- Fluxo de adicionar/remover/promover membros (parte 2 anterior continua intacta)
- Funis de Acidente de Trabalho seguem funcionando — só renomeia o campo

---

## Risco / Rollback
- Migration reversível: campos novos são opcionais (exceto `processual_responsible_id`, que tem default de backfill).
- Tabela `whatsapp_group_exits` é nova → drop limpo se precisar reverter.
- Componentes novos são aditivos.
- Webhook handler pode ser desativado via flag se gerar ruído.

Aprovar pra eu começar pela migration?