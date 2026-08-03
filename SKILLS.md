# Índice de Skills do Projeto

> Catálogo centralizado das skills ativas. Skills são "especialistas de plantão" que a IA carrega automaticamente quando o contexto bate. Você também pode invocar manualmente digitando `/` no chat ou no botão **+** > Add skill.

## Ativas

| Skill | Quando acionar | Resumo |
|---|---|---|
| **db-tables-map** | Antes de criar tabela, coluna, hook, função ou feature que toca dados de negócio. | Anti-duplicação: obriga checar se já existe tabela/coluna/relação antes de propor `CREATE TABLE`. Contém hot-list de tabelas frequentemente reinventadas (ex: `whatsapp_groups_index`, `lead_whatsapp_groups`, `contact_leads`). |
| **db-railway-routing** | Sempre que a tarefa envolver criar/alterar tabela, RLS, trigger, edge function, webhook, cron ou SQL. | Guarda de trânsito da arquitetura: dados de negócio → Supabase Externo, código HTTP → Railway, Cloud só para auth/metadata. Impede criação no lugar errado. |
| **code-reusables-map** | Antes de criar edge function nova, hook, RPC, webhook, processador ou integração WhatsApp/ZapSign/Meta/IA. | Irmã da `db-tables-map` mas para CÓDIGO. Hot-list de funções/hooks que já resolvem problemas comuns (ex: `send-whatsapp`, `whatsapp-webhook`, família `suggest-*`, `useLeads`). Inclui script `find-function.sh` para varrer Railway + Supabase + hooks. |
| **lead-vs-case-identity** | Quando o pedido tocar identidade de lead vs caso, numeração, nome de grupo WhatsApp, vinculação de processo (INSS/judicial) ou Funil de Vendas vs POP. | Regras invioláveis da hierarquia Empresa→Núcleo→Produto→Funil→(fechado)→Caso→Processos→POP e da cadeia Anúncio→Lead(pode ter grupo)→Contatos→Caso(sempre tem grupo)→Processo→Partes(viram contatos). Manda ADVERTIR e travar quando o pedido contraria a lógica. |
| **funnel-case-numbering** | "PREV 1448", `case_number`, prefixo do funil, sequência de leads fechados, nome de grupo errado pós-fechamento. | Como a numeração de casos fechados por funil é calculada (prefixo + sequência). |
| **ui-sem-sobreposicao** | SEMPRE que criar ou alterar qualquer UI — cabeçalho, card, badge flutuante, tooltip, modal, barra fixa, overlay, FAB. | Regra dura do produto: nada sobreposto a nada. Título e informação 100% visíveis, nunca truncar sem tooltip. Acionar em "está cobrindo", "cortando o texto", "z-index". |
| **rodar-localhost** | "roda o site", "sobe o localhost", "testar as alterações", "ver o que mudou". | Sobe o Vite deste projeto em http://localhost:8080 com hot reload, para conferir antes de publicar no Lovable. |
| **weekly-self-audit** | "roda manutenção", "auditoria semanal", "varredura geral". | Ritual semanal: 5 sub-agentes paralelos (dados, código, segurança, performance, erros) consolidados num relatório único com prioridades. |

## Como usar

1. **Auto-trigger:** a IA carrega a skill sozinha quando o pedido bate na descrição.
2. **Manual:** digite `/` no chat e escolha a skill, ou use o botão **+** > Add skill.

## Como manter atualizado

- Ao criar uma skill nova, adicione uma linha na tabela acima.
- A descrição da linha deve bater com a `description:` do frontmatter do `SKILL.md`.
