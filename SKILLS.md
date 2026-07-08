# Índice de Skills do Projeto

> Catálogo centralizado das skills ativas. Skills são "especialistas de plantão" que a IA carrega automaticamente quando o contexto bate. Você também pode invocar manualmente digitando `/` no chat ou no botão **+** > Add skill.

## Ativas

| Skill | Quando acionar | Resumo |
|---|---|---|
| **db-tables-map** | Antes de criar tabela, coluna, hook, função ou feature que toca dados de negócio. | Anti-duplicação: obriga checar se já existe tabela/coluna/relação antes de propor `CREATE TABLE`. Contém hot-list de tabelas frequentemente reinventadas (ex: `whatsapp_groups_index`, `lead_whatsapp_groups`, `contact_leads`). |
| **db-railway-routing** | Sempre que a tarefa envolver criar/alterar tabela, RLS, trigger, edge function, webhook, cron ou SQL. | Guarda de trânsito da arquitetura: dados de negócio → Supabase Externo, código HTTP → Railway, Cloud só para auth/metadata. Impede criação no lugar errado. |
| **code-reusables-map** | Antes de criar edge function nova, hook, RPC, webhook, processador ou integração WhatsApp/ZapSign/Meta/IA. | Irmã da `db-tables-map` mas para CÓDIGO. Hot-list de funções/hooks que já resolvem problemas comuns (ex: `send-whatsapp`, `whatsapp-webhook`, família `suggest-*`, `useLeads`). Inclui script `find-function.sh` para varrer Railway + Supabase + hooks. |
| **checklist-inicial-acidente-trabalho** | Ao corrigir, revisar ou finalizar petição inicial de acidente de trabalho (óbito ou sobrevivente). | POP do escritório: documentos, estrutura da peça (endereçamento, qualificação, fatos, direito, pensionamento, pedidos) e princípios de redação. Devolve relatório item a item (✅/❌/⚠️). Primeira da família `checklist-*` de petições. |

## Como usar

1. **Auto-trigger:** a IA carrega a skill sozinha quando o pedido bate na descrição.
2. **Manual:** digite `/` no chat e escolha a skill, ou use o botão **+** > Add skill.

## Como manter atualizado

- Ao criar uma skill nova, adicione uma linha na tabela acima.
- A descrição da linha deve bater com a `description:` do frontmatter do `SKILL.md`.
