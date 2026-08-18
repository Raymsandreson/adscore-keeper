# Chat interno da equipe

Como o chat interno decide **de quem é a conversa**. Regra vigente desde 18/08/2026.

---

## De quem é o chat de cada ficha

O dock "Chat interno da equipe" (`EntityTeamChatDock` → `TeamChatPanel` → `useTeamChat`) aparece em lead, caso, processo, atividade, conversa de WhatsApp, contato e passo de POP. As mensagens vivem em `team_chat_messages` no Supabase Externo, chaveadas por `(entity_type, entity_id)`.

O escopo é resolvido em `src/lib/entityChatScope.ts`:

| Ficha aberta | Escreve em | Lê |
|---|---|---|
| **Atividade COM `process_id`** | `process:<process_id>` | `process:<id>` **+** `activity:<todas as atividades do processo>` |
| Atividade SEM `process_id` | `activity:<raiz da cadeia>` | `activity:<todos os elos da cadeia>` |
| Processo | `process:<id>` | igual à linha 1 — mesmo escopo, mesmo cache |
| Lead / caso / contato / WhatsApp / passo de POP | a própria ficha | a própria ficha |

**A conversa da atividade é a conversa do processo.** O que se escreve na atividade aparece em todas as atividades daquele processo e na ficha do processo, e vice-versa. O painel avisa isso em cima da lista: *"Conversa do processo `<nº>` · aparece em todas as atividades dele"*.

### Por que

Processo e atividade costumam ter o **mesmo nome** na tela. No CASO 180 os dois se chamavam "ACIDENTE DE TRABALHO": em 10/08/2026 uma mensagem com `@Abderaman` foi escrita no chat do processo e ficou invisível na atividade dele — que era exatamente onde ele iria procurar. Eram dois threads distintos com rótulo idêntico.

### Sem backfill

Nada foi movido de lugar. As mensagens antigas gravadas em `activity:<id>` continuam gravadas lá e entram na leitura pela perna `activity` do `or=`. A cadeia (`chain_root_id`, ago/2026) segue valendo para atividade **sem** processo — ver `src/lib/activityChatThread.ts`.

### Teto

A leitura junta no máximo 200 atividades por processo (`MAX_ATIVIDADES_DO_PROCESSO`). Em 18/08/2026 o processo mais movimentado tinha 51 atividades (p95 = 18). Bater o teto emite `console.warn` — não trunca em silêncio.

---

## Menções e para onde elas levam

`team_chat_mentions` guarda `(entity_type, entity_id)` iguais aos da mensagem. Como o chat da atividade agora grava em `process`, **menção feita de dentro de uma atividade com processo nasce como `entity_type='process'`**.

Processo não tem rota própria. O destino de todo mundo é a página de casos com o deep-link:

```
/cases?openProcess=<process_id>&highlightMsg=<message_id>
```

`CasesPage` resolve o caso-pai do processo, carrega e expande só esse caso, abre o `ProcessDetailSheet` e destaca a mensagem no dock. Quem monta essa URL:

- `MentionsPanel` (painel de menções) — `case 'process'`
- `TeamChatNotifications.getEntityChatUrl` — popup de menção e de thread acompanhado
- `useTeamChat.entityChatUrl` — URL do Web Push

Antes de 18/08/2026 a menção de processo navegava para `/cases/<case_id>` e parava no chat do **caso** — outro thread, quase sempre vazio.

---

## Quem é avisado

- **Menção**: canal Realtime de `team_chat_mentions`. Não depende de follower.
- **Thread acompanhado** (`team_chat_thread_followers`): quem foi marcado ou já falou. `TeamChatNotifications.loadFollowedThreads` traduz as linhas legadas — `resolveActivityChatRoots` (elo → raiz) e `resolveActivityProcessIds` (atividade → processo) — para que quem acompanhava pelo id da atividade continue avisado depois que a conversa passou a morar no processo.
- **Web Push** (`send-team-push` no Railway): o servidor procura participantes por **um** `entity_type` só. Como o thread do processo mistura mensagens `process` e `activity`, o cliente manda também `user_ids` com quem já falou na janela carregada — senão quem participou pela outra ponta ficaria de fora.

---

## Armadilhas conhecidas

- O `filter` do Realtime aceita **uma** condição. O hook abre **um canal por tipo lido** (`process` e `activity`) e filtra os ids no cliente.
- O cache de mensagens é chaveado por `${writeType}:${writeId}` — atividade e processo caem na mesma chave de propósito. Mudar o escopo de leitura sem mudar essa chave contamina o cache do outro dock.
- `EntityTeamChatDock` lembra aberto/fechado **por tipo de entidade** (`localStorage`), não por registro. Deep-link com `highlightMessageId` força o dock aberto, senão a menção abriria numa ficha com o chat recolhido.
