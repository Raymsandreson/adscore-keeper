# Chat interno da equipe

Como o chat interno decide **de quem é a conversa**. Regra vigente desde 19/08/2026.

---

## De quem é o chat de cada ficha

O dock "Chat interno da equipe" (`EntityTeamChatDock` → `TeamChatPanel` → `useTeamChat`) aparece em lead, caso, processo, atividade, conversa de WhatsApp, contato e passo de POP. As mensagens vivem em `team_chat_messages` no Supabase Externo, chaveadas por `(entity_type, entity_id)`.

O escopo é resolvido em `src/lib/entityChatScope.ts`:

| Ficha aberta | `kind` | Escreve em | Lê |
|---|---|---|---|
| **Atividade com `case_id`** | `case` | `case:<case_id>` | `case:<id>` **+** `process:<processos do caso>` **+** `activity:<atividades do caso>` |
| **Atividade com `process_id` cujo processo tem caso** | `case` | idem | idem |
| Atividade com processo **órfão de caso** | `process` | `process:<id>` | `process:<id>` + `activity:<atividades do processo>` |
| Atividade sem caso e sem processo | `chain` | `activity:<raiz da cadeia>` | `activity:<todos os elos da cadeia>` |
| Processo | `case` (ou `process` se órfão) | igual às linhas acima — mesmo escopo, mesmo cache | |
| Caso | `case` | `case:<id>` | idem |
| Lead / contato / WhatsApp / passo de POP | `solo` | a própria ficha | a própria ficha |

**A conversa da atividade é a conversa do caso.** O que se escreve numa atividade aparece em todas as atividades e em todos os processos daquele caso, e na ficha do caso — e vice-versa. Fora do dock do próprio dono o painel avisa em cima da lista: *"Conversa do caso `CASO 180` · aparece em todas as atividades e processos dele"*.

### Por que o caso e não o processo

Caso, processo e atividade costumam ter o **mesmo nome** na tela. No CASO 180 a atividade e o processo se chamavam os dois "ACIDENTE DE TRABALHO": em 10/08/2026 uma mensagem com `@Abderaman` foi escrita no chat do processo e ficou invisível na atividade dele — que era exatamente onde ele iria procurar. Eram threads distintos com rótulo idêntico.

O primeiro recorte (18/08/2026) ancorou no processo e resolvia esse caso, mas deixava de fora duas populações grandes — números de 19/08/2026, sobre 35.009 atividades não apagadas:

| | atividades |
|---|---|
| com `case_id` | 14.590 |
| só `process_id`, sem caso | 123 |
| sem caso e sem processo | 20.296 |

E separava conversas do mesmo trabalho: no CASO 180, "ACIDENTE DE TRABALHO" (processo `116125d5`) e "SEGURO DE VIDA" (processo `f10fe14e`) ficavam em threads diferentes. Pelo caso, as 32 atividades e os 2 processos são uma conversa só.

### Sem backfill

Nada foi movido de lugar. As mensagens antigas gravadas em `activity:<id>` e em `process:<id>` continuam gravadas lá e entram na leitura pelas pernas `activity` e `process` do `or=`.

A cadeia (`chain_root_id`, ago/2026) segue valendo para atividade sem caso e sem processo — ver `src/lib/activityChatThread.ts`.

### Tetos

A leitura junta no máximo 200 atividades (`MAX_ATIVIDADES_DO_CASO`) e 50 processos (`MAX_PROCESSOS_DO_CASO`) por caso. Em 19/08/2026 o caso mais movimentado tinha 99 atividades (p95 = 36, p99 = 64) e 16 processos. Bater o teto emite `console.warn` — não trunca em silêncio.

---

## Menções e para onde elas levam

`team_chat_mentions` guarda `(entity_type, entity_id)` iguais aos da mensagem. Como o chat da atividade agora grava em `case`, **menção feita de dentro de uma atividade de um caso nasce como `entity_type='case'`**.

| `entity_type` da menção | Deep-link |
|---|---|
| `case` (novo padrão) | `/cases/<case_id>?highlightMsg=<message_id>` |
| `process` (legado 18/08) | `/cases?openProcess=<process_id>&highlightMsg=<message_id>` |
| `activity` (legado) | `/?openActivity=<etapa viva da cadeia>&highlightMsg=…` |

`/cases/<id>` expande só esse caso e abre o dock do caso com a mensagem destacada. `/cases?openProcess=` resolve o caso-pai, expande o caso e abre o `ProcessDetailSheet`. Quem monta essas URLs:

- `MentionsPanel` (painel de menções) — `case 'case'` e `case 'process'`
- `TeamChatNotifications.getEntityChatUrl` — popup de menção e de thread acompanhado
- `useTeamChat.entityChatUrl` — URL do Web Push

Antes de 18/08/2026 a menção de processo navegava para `/cases/<case_id>` sem destaque e parava no chat do caso, que era outro thread — hoje é o mesmo.

---

## Quem é avisado

- **Menção**: canal Realtime de `team_chat_mentions`. Não depende de follower.
- **Thread acompanhado** (`team_chat_thread_followers`): quem foi marcado ou já falou. `TeamChatNotifications.loadFollowedThreads` traduz as linhas legadas — `resolveActivityChatRoots` (elo → raiz) e `resolveThreadKeys` (atividade ou processo → caso) — para que quem acompanhava pelo id antigo continue avisado depois que a conversa passou a morar no caso.
- **Web Push** (`send-team-push` no Railway): o servidor procura participantes por **um** `entity_type` só. Como o thread do caso mistura mensagens `case`, `process` e `activity`, o cliente manda também `user_ids` com quem já falou na janela carregada — senão quem participou pela outra ponta ficaria de fora.

---

## Armadilhas conhecidas

- O `filter` do Realtime aceita **uma** condição. O hook abre **um canal por tipo lido** (`case`, `process`, `activity`) e filtra os ids no cliente.
- O cache de mensagens é chaveado por `${writeType}:${writeId}` — caso, processo e atividade caem na mesma chave de propósito. Mudar o escopo de leitura sem mudar essa chave contamina o cache dos outros docks.
- `EntityTeamChatDock` lembra aberto/fechado **por tipo de entidade** (`localStorage`), não por registro. Deep-link com `highlightMessageId` força o dock aberto, senão a menção abriria numa ficha com o chat recolhido.
- `in.()` com lista vazia é sintaxe inválida no PostgREST: `activityIdsOfCase` monta as pernas do `or=` condicionalmente.
