## Problema 1 — Mensagens não aparecem (sincronização)

### Diagnóstico
O `useWhatsAppMessages` depende **100% do Realtime** do Supabase externo. Não existe nenhum polling de segurança (`grep` em `setInterval`, `polling` retornou só comentários). Quando:
- O canal Realtime cai (rede instável, troca de aba, suspend do laptop, limites do servidor),
- Um INSERT chega antes do canal estar `SUBSCRIBED`,
- O filtro `instance_name=eq.X` não bate por algum desalinhamento de canonicalização,

…a mensagem fica órfã no DB externo. O usuário só descobre quando troca de instância ou aperta refresh manual. Isso explica o "algumas chegam, outras não".

Existe ainda um sintoma secundário: em `useWhatsAppMessages.ts` linha 241, a contagem de telefones distintos usa `.limit(1000)` — em instâncias com mais de 1000 conversas o contador fica errado (não é o foco aqui, mas anoto).

### Correção
1. **Polling de segurança** — adicionar um `setInterval` no hook que dispara `fetchMessages(true)` a cada 30s **somente quando a aba está visível** (`document.visibilityState === 'visible'`). Reduz a janela de perda para 30s no pior caso. Custo: 1 RPC `get_conversation_summaries` por minuto por usuário ativo — aceitável (a função é leve, com índice `idx_wam_inst_phone_created`).
2. **Refetch ao voltar foco** — listener em `visibilitychange` que dispara `fetchMessages(true)` quando a aba volta de hidden→visible. Cobre o caso "deixei o computador 1h, voltei".
3. **Refetch ao reconectar Realtime** — no callback `.subscribe((status) => …)` do canal de mensagens, quando `status === 'SUBSCRIBED'` e já houve uma desconexão prévia (`realtimeHealthy` era `false`), dispara um `fetchMessages(true)` para recuperar mensagens perdidas durante a queda.

Nada disso muda a UI — é puramente resiliência. Marcação `silent=true` evita o toast "X conversas carregadas".

## Problema 2 — Texto vaza para a direita na lista

### Diagnóstico
No `WhatsAppConversationList.tsx` linha 620, o `<button>` que envolve cada cartão tem `flex-1 flex items-start gap-3` mas **não tem `min-w-0`**. O filho interno (linha 639) tem `flex-1 min-w-0`, mas em flex aninhado o `min-w-0` precisa estar em **toda a cadeia de pais flex** para o `truncate` funcionar. Sem `min-w-0` no botão, títulos longos como "Cândido x RPJ Transportes | 21/08/2025" forçam o cartão a ser mais largo que o container `w-80`.

### Correção
Adicionar `min-w-0` no `<button>` (linha 620–629). É uma mudança de uma classe. Também adicionar `overflow-hidden` no wrapper externo da linha 610 como cinto-e-suspensório.

## Problema 3 — Permitir redimensionar a largura da lista

### Diagnóstico
Hoje em `WhatsAppInbox.tsx` linha 1030–1052, a lista tem largura fixa `md:w-80` (320px) e o chat ocupa `flex-1`. O projeto já tem `src/components/ui/resizable.tsx` (shadcn) instalado — pode ser usado diretamente.

### Correção
Substituir o layout flexbox da área principal por `ResizablePanelGroup` horizontal:
- Painel 1 (lista): `defaultSize={25}`, `minSize={18}`, `maxSize={45}`
- `ResizableHandle withHandle`
- Painel 2 (chat): ocupa o resto

Persistir a largura escolhida em `localStorage` (`whatsapp_list_panel_size`) para restaurar entre sessões. Comportamento mobile preservado: no mobile já existe a lógica `${selectedPhone ? 'hidden md:flex' : 'flex'}` — usar `ResizablePanelGroup` apenas em `md:` e manter o layout atual em mobile via condicional.

Como `WhatsAppConversationList` já usa `flex-1 min-w-0` corretamente nos cartões (após a correção do Problema 2), os cartões irão se alongar/encurtar conforme o painel for redimensionado.

## Detalhes técnicos

**Arquivos a alterar:**
- `src/hooks/useWhatsAppMessages.ts` — adicionar `useEffect` com `setInterval` (30s) + listener `visibilitychange` + refetch on reconnect.
- `src/components/whatsapp/WhatsAppConversationList.tsx` — adicionar `min-w-0` no botão do cartão (linha 620) e `overflow-hidden` no wrapper (linha 610).
- `src/components/whatsapp/WhatsAppInbox.tsx` — envolver área principal em `ResizablePanelGroup` (em desktop), preservar comportamento mobile, persistir tamanho em `localStorage`.

**Arquivos NÃO tocados:**
- Nenhuma mudança em edge functions.
- Nenhuma migration SQL.
- Nenhum mexido em `WhatsAppChat.tsx` (só recebe `flex-1` do painel pai, não precisa ajuste).
- Nenhum mexido na lógica de canonicalização de instâncias ou no handler de Realtime.

**Risco / rollback:** mudanças confinadas a 3 arquivos de UI/hook. Se o polling causar carga excedente, basta remover o `useEffect` novo (10 linhas). Se o resizable quebrar layout, basta reverter o `WhatsAppInbox.tsx`.

**Custo:** ~2 chamadas RPC adicionais/min/usuário. Para 50 usuários simultâneos = 100 RPC/min = irrelevante para a função inlineada com índice.
