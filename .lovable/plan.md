## Objetivo

Trocar todas as 43 referências em `src/` que leem (e escrevem) as tabelas de agente/instância no banco Cloud para o banco Externo, **sem mexer em dados** e mantendo todas as triggers/funções do Cloud no lugar (Fase C cuidaria disso depois).

## Metáfora

Hoje o app tem duas estantes (Cloud e Externo) com os mesmos rótulos, mas o estoque novo só entra no Externo. Vários funcionários ainda leem da estante velha (Cloud) — vendo livros faltando ou desatualizados. Esta fase vira o crachá de cada funcionário para "ler só do Externo". As estantes velhas continuam de pé, intocadas; só ninguém mais lê delas.

## Escopo

43 arquivos em `src/`, agrupados por tabela:

**Instâncias (`whatsapp_instances`, `whatsapp_instance_users`)** — ~15 arquivos
- hooks: `useWhatsAppMessages`, `useCallRecords`, `useWhatsAppInstanceStatus`, `useBroadcastLists`, `useIncomingCallDetector`
- componentes: `FloatingWhatsAppCall`, `WhatsAppReportSettings`, `WhatsAppLeadsDashboard`, `WhatsAppInstanceManager` (resto), `AIRealtimeFeed`, `agent-monitor/*`, `MemberDetailSheet`, `TeamManagement`, `WhatsAppInstancePermissions`

**Agentes / shortcuts (`whatsapp_ai_agents`, `wjia_command_shortcuts`)** — ~8 arquivos
- `DashboardChatPreview`, `CTWACampaignAutomation`, `ArchivedItemsPanel`, `agent-monitor/useMonitorData`, `WhatsAppCommandConfig`, `MemberAssistantSettings`, `WhatsAppAIAgents`, `WhatsAppChat`, `ContactsListPage`

**Conversation agents / call queue / notas / outros** — ~10 arquivos
- `AgentConversationsList`, `CallQueuePanel`, `WhatsAppNotificationSettings`, `useWhatsAppInternalNotes`, `useAgentStageAssignments`, `AIKnowledgeGenerator`

## Padrão de troca

Em cada arquivo:
1. Trocar import: `supabase` (cliente Cloud) → `db` (Externo), do barrel `@/integrations/supabase`.
2. Trocar `supabase.from('tabela_X')` → `db.from('tabela_X')` **apenas para as tabelas listadas acima**.
3. Manter `supabase` (= `authClient`) para tudo que continua sendo Cloud (`profiles`, `user_roles`, `team_conversations`, `team_chat_*`, auth.uid(), realtime de chat interno, etc.).
4. Onde o arquivo já usa `externalSupabase`, normalizar para `db` (mesmo cliente, alias oficial).

## Pontos sensíveis (checagem manual por arquivo)

- **`DashboardChatPreview.tsx`** já mistura `supabase` e `externalSupabase` para essas mesmas tabelas — preciso unificar para `db`. Risco: regressão no chat. Verificar abrir conversa, listar agentes e trocar agente após mudança.
- **`useWhatsAppMessages.ts`** já usa `authClient.from('whatsapp_instances')` em 4 pontos — trocar para `db.from(...)`. Esse hook é o coração do chat.
- **`CTWACampaignAutomation.tsx`** lê `whatsapp_agent_campaign_links` (Cloud) e `wjia_command_shortcuts` (Cloud) + `whatsapp_conversation_agents` (Externo). Trocar tudo do bloco para `db`.
- **`WhatsAppNotificationSettings.tsx`** — `whatsapp_notification_config` no Externo tem 1 linha igual à Cloud, ok migrar.
- **`useWhatsAppInternalNotes`** ⚠️ Externo tem 3 notas vs 6 no Cloud. Migrar leitura agora **vai esconder** 3 notas existentes. Recomendação: antes de migrar este hook, copiar as 3 órfãs Cloud→Externo (passo separado, com sua confirmação). Se preferir, deixo este arquivo de fora da Fase A e trato em Fase A.1.

## Rollback

- Mudança puramente de código (nenhum DDL/DML). Reverter = `git restore` nos arquivos editados.
- Triggers Cloud (`auto_swap_agent_on_stage_change` etc.) continuam ativas — qualquer regressão de escrita ainda alcança Cloud por baixo. Fase B/C trata isso.

## O que NÃO vou fazer nesta fase

- Não desabilitar/renomear nenhuma tabela Cloud.
- Não tocar em edge functions nem triggers.
- Não copiar dados entre bancos (exceto se você aprovar o ponto das 3 notas órfãs).
- Não mexer em `src/integrations/supabase/client.ts` nem `types.ts`.
- Não tocar em arquivos fora da lista acima, mesmo se for "limpeza óbvia".

## Verificação pós-edit

1. `npm run build` (típechek).
2. Smoke test manual sugerido por você: abrir chat de uma conversa, abrir Configurações → Instâncias, abrir CTWA campanhas, abrir Monitor IA. Em cada tela conferir se a quantidade de itens bate com a do Externo (que tem mais).
3. Olho no console: nenhum erro `relation does not exist` (sinal que esqueci alguma tabela só-Cloud).

## Pergunta antes de executar

`whatsapp_internal_notes`: incluo no lote (esconde 3 notas órfãs do Cloud) ou deixo fora e a gente trata depois?
