

# Filtro de Agente por **Resultado do Lead** × **Funil**

## O que você quer (entendi agora)

Igual ao print do "Editar Lead": existe o campo **Resultado do Lead** com 4 valores → **Em Andamento**, **Fechado**, **Recusado**, **Inviável**.

Você quer poder dizer, pra cada agente IA:

> "Esse agente responde leads do funil **Acidente de Trabalho** que estão com resultado **Em Andamento**. Não responde se estiver Fechado, Recusado ou Inviável."

Cruzamento **Funil × Resultado** define se o agente atua ou fica calado.

## Por que você "achava que já existia"

**Estava certo pela metade.** Eu verifiquei:

- Os campos `lead_status_filter` e `lead_status_board_ids` **já existem no banco** na tabela `whatsapp_ai_agents` (e também em `wjia_command_shortcuts`).
- O código **lê** esses campos quando carrega o agente (`WhatsAppCommandConfig.tsx` linha 206-207).
- Mas **não existe nenhum input visual** pra você editar. Foi infraestrutura preparada e nunca finalizada na tela.
- E a lógica do responder (`whatsapp-ai-agent-reply` / wjia-agent) **ignora esses campos** em runtime.

Resultado: o "armário" foi construído, mas não tem porta nem prateleira, e o motor não olha pra ele.

## O que eu vou fazer

### Parte 1 — UI (criar a porta do armário)

Na configuração de cada **Agente IA** (não na aba Grupos), adicionar uma seção nova chamada **"Quando esse agente deve responder"** com uma matriz simples:

```text
┌─ Quando esse agente deve responder ─────────────────────────┐
│                                                              │
│  Funil: [Acidente de Trabalho ▼]   [+ adicionar outro funil]│
│                                                              │
│  Responder leads com resultado:                              │
│   [✓] Em Andamento                                           │
│   [ ] Fechado                                                │
│   [ ] Recusado                                               │
│   [ ] Inviável                                               │
│                                                              │
│  Se o lead não estiver em nenhum funil/resultado marcado,    │
│  o agente fica em silêncio.                                  │
└──────────────────────────────────────────────────────────────┘
```

- Multi-select de funis (`lead_status_board_ids` — array de UUIDs de `kanban_boards`).
- Multi-select de resultados (`lead_status_filter` — array de strings: `in_progress`, `closed`, `refused`, `unviable`).
- Default ao criar agente novo: tudo marcado (comportamento atual = responde sempre).
- Default ao deixar vazio: também responde sempre (retrocompatibilidade — não quebra agentes já configurados).

### Parte 2 — Lógica (fazer o motor olhar pro armário)

No responder de IA (vou identificar se está em `whatsapp-ai-agent-reply` no Cloud ou no `wjia-agent`/Railway antes de mexer), adicionar **bem no início**, antes de gerar resposta:

```text
1. Buscar lead pelo phone+instance.
2. Se lead existe E agente tem lead_status_board_ids preenchido:
   → Se lead.board_id NÃO está na lista → return silencioso.
3. Se lead existe E agente tem lead_status_filter preenchido:
   → Se lead.status NÃO está na lista → return silencioso.
4. Se passou nos dois filtros → segue fluxo normal.
```

"Silencioso" = não responde, não loga erro, não consome token. Só ignora.

### Parte 3 — Onde colocar a UI exatamente

Na tela de edição do agente IA (componente que hoje configura o agente — vou localizar com precisão antes de codificar; provavelmente um filho de `WhatsAppCommandConfig.tsx` ou modal próprio). **Não** vou mexer na aba "Grupos" pra essa feature — você tem razão, é config de agente, não de grupo.

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| Componente de edição do agente (a localizar) | Adicionar bloco "Quando responder" com 2 multi-selects |
| `update-agent-filters/index.ts` | Já existe e está pronto pra receber os 2 arrays. Sem mudança. |
| Edge function do responder (a confirmar local) | Adicionar guarda de filtro no início + 1 query no banco do lead |

**Não mexe em:** schema do banco (campos já existem), aba Grupos, `agent_stage_assignments` (continua funcionando pra troca por etapa), nenhum outro fluxo.

## O que fica pendente (próximos planos, separados)

- Reorganização visual da aba "Grupos" (ideia anterior, fica em standby).
- Fix Cloud→Externo do destino dos dados (ainda pendente, conforme combinado).

## Risco e rollback

- Risco: **baixo**. Schema já existe, função `update-agent-filters` já existe, retrocompatível (vazio = comportamento atual).
- Rollback: `git restore` nos 2 arquivos editados. Banco não muda.
- Validação: criar agente teste com filtro "só Em Andamento", mandar mensagem de lead Fechado, confirmar silêncio nos logs.

## Ordem de execução

1. Localizar componente exato de edição do agente (1 grep).
2. Localizar edge function do responder ativo (Cloud vs Railway).
3. Adicionar UI dos 2 multi-selects + integração com `update-agent-filters`.
4. Adicionar guarda no responder.
5. Testar com 1 agente real seu antes de considerar pronto.

