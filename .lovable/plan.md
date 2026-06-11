## Metáfora

Dois tipos de atendente no balcão:

- **Balcão transparente (Dom):** "deixa eu confirmar com o time e te retorno até o fim do dia". O cliente sabe que existe um time atrás.
- **Balcão disfarçado (agente-humano):** *finge* ser o próprio atendente humano. Não pode dizer "vou ver com o time" — isso quebra o disfarce. Ele responde algo natural ("deixa eu olhar uma coisa rapidinho e já te falo", "vou te ligar daqui a pouco pra explicar melhor") e nos bastidores **cutuca o humano de verdade** pra ligar / agendar reunião / fechar o caso.

O mecanismo é o mesmo: o agente solta um marcador invisível, o backend transforma em **atividade + ping no chat interno** pro responsável. O que muda é a **frase visível** e o **tipo de pedido**.

## Escopo

### 1. Campo "Responsável pelo processo" (novo)

- Coluna `responsible_user_id uuid` em `lead_processes` (Externo).
- UI: seletor de usuário no form/detalhe do processo.
- Ordem de fallback (configurável por agente): responsável do processo → acolhedor do caso → dono do lead.

### 2. Config no agente — bloco "Handoff humano"

Em "Configuração do agente IA", nova seção com:

- **Modo do agente** (radio): 
  - `Transparente` — pode dizer abertamente que vai verificar com o time.
  - `Disfarçado (humano)` — nunca admite time atrás; usa frases naturais e o handoff é silencioso.
- **Quem assume** (lista ordenada de fallback): Responsável do processo · Acolhedor do caso · Dono do lead.
- **Prazo padrão**: Fim do expediente (default) · +2h · +4h · Próximo dia útil.
- **Hora fim do expediente** (default 18:00).
- **Notificar responsável no chat interno** (toggle, default ON, só ele recebe).
- **Frases por tipo de handoff** (textarea por linha, com defaults diferentes por modo):
  - `retorno` — precisa confirmar algo. 
    - Transparente: *"Deixa eu confirmar com o time e te retorno até HH:MM."*
    - Disfarçado: *"Deixa eu olhar uma coisa aqui rapidinho e já te chamo, tá?"*
  - `ligacao` — humano precisa ligar pro cliente.
    - Transparente: *"Vou pedir pra alguém do time te ligar pra explicar melhor."*
    - Disfarçado: *"Te ligo daqui a pouco pra explicar melhor, ok?"*
  - `reuniao` — agendar reunião pra fechar.
    - Transparente: *"Vou alinhar uma reunião com o time."*
    - Disfarçado: *"Acho melhor a gente conversar com calma — qual horário você prefere?"*
  - `fechamento` — pronto pra fechar, precisa só de uma confirmação humana.
    - Disfarçado: *"Vou organizar isso e já te confirmo."*

Persistir tudo em `whatsapp_ai_agents.handoff_config` (jsonb).

### 3. Marcadores que o Dom (qualquer agente) aprende

Injetar no prompt-base:

```
Quando precisar de ação humana, escreva no FINAL da resposta UM dos marcadores abaixo. 
Eles NÃO aparecem pro cliente — são removidos antes do envio.
Você ainda DEVE escrever uma resposta natural pro cliente conforme seu modo.

[HANDOFF:retorno: <motivo>]      — precisa que humano confirme algo
[HANDOFF:ligacao: <motivo>]      — humano precisa ligar pro cliente
[HANDOFF:reuniao: <motivo>]      — precisa agendar reunião
[HANDOFF:fechamento: <motivo>]   — caso pronto pra fechar, só falta humano confirmar
```

Em modo disfarçado, o prompt também recebe:

```
IMPORTANTE: Você é a própria pessoa que atende. NUNCA mencione "time", "equipe", "vou verificar com alguém". 
Fale como se a ação fosse SUA ("vou olhar", "te ligo", "vou organizar").
```

### 4. Backend (Railway — handler de resposta do agente)

Antes de mandar a resposta pro WhatsApp:

1. Detecta regex `\[HANDOFF:(\w+):\s*(.+?)\]`.
2. Remove o marcador da mensagem visível.
3. Resolve responsável pela ordem configurada no agente.
4. Calcula deadline (fim do expediente conforme config).
5. **Procura atividade pendente do mesmo tipo** pro mesmo lead/caso:
   - Existe → `UPDATE` motivo + deadline (não duplica).
   - Não existe → `INSERT` em `lead_activities` com title específico do tipo:
     - `retorno` → "Retornar ao cliente"
     - `ligacao` → "Ligar para cliente"
     - `reuniao` → "Agendar reunião"
     - `fechamento` → "Fechar caso"
6. Se toggle de chat ligado → DM pro responsável via `team_conversations` (direta, só ele vê).

### 5. Bug paralelo: agente não pegou as mensagens do grupo

Investigação primeiro, sem mexer em nada:
- Ler `railway-server/src/functions/` (handler de mensagem).
- Conferir se mensagens de grupo entram na janela de contexto do próximo turno.
- Pedir ao usuário **um exemplo concreto** (grupo/lead/horário) pra olhar log real.

## O que NÃO vou mexer

- Unificação de forms (assunto fechado).
- Lógica de templates, AI suggestions, envio de áudio.
- Permissões/RLS além do GRANT da coluna nova.

## Ordem de execução

1. Migration Externo: `lead_processes.responsible_user_id`.
2. UI do processo: seletor de responsável.
3. Migration Cloud: `whatsapp_ai_agents.handoff_config jsonb`.
4. UI do agente: bloco "Handoff humano" (modo + fallback + prazos + frases).
5. Atualizar prompt-base injetado no handler do agente (modo disfarçado/transparente + marcadores).
6. Handler Railway: parse dos `[HANDOFF:...]`, create/update atividade, DM chat interno.
7. Investigar bug das mensagens de grupo (precisa do exemplo).

## Rollback

- Cada migration com `DROP COLUMN IF EXISTS` documentado.
- `handoff_config` null → comportamento antigo (feature-flag implícita).
- Prompt versionado: reverter trecho.

## Pergunta antes de começar

1. Confirma o desenho dos **dois modos** (Transparente vs Disfarçado) e os **4 tipos de handoff** (retorno / ligação / reunião / fechamento)?
2. Falta algum tipo de ação humana que eu não cobri?
3. Me passa um lead/grupo específico onde o agente não pegou as mensagens do grupo — preciso pra ler log real.