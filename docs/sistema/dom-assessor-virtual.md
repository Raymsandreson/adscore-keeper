# Dom — Assessor Jurídico Virtual

Atendente virtual que responde o cliente **dentro do grupo do caso**, com o
andamento real dos autos, em linguagem que o cliente entende. Assina toda
resposta como assessor virtual — nunca se passa por advogado ou por atendente
humano.

Fontes de verdade do código:
- Banco: `supabase/migrations-external/20260821180030_dom_assessor_juridico_virtual.sql`
- Isolamento por grupo: `supabase/migrations-external/20260904120000_dom_isolamento_por_grupo.sql`
- Contexto: `supabase/functions/_external/dom-contexto/index.ts`
- Resposta: `supabase/functions/_external/whatsapp-ai-agent-reply/index.ts` (bloco `=== DOM ===`)

Tudo vive no Supabase **Externo** (`kmedldlepwiityjsdahz`). Agente:
`DOM-Atendente Processual`, id `d6ad8eee-d6a3-452c-b852-b94ef8dd54bf`, que é uma
linha de `wjia_command_shortcuts` exposta pela view `whatsapp_ai_agents`.

## As três travas

O Dom só fala quando as três abrem. Qualquer uma fechada = silêncio.

1. `wjia_command_shortcuts.is_active = true`
2. `wjia_command_shortcuts.contexto_processual = true`
3. O grupo está em `dom_grupos_piloto` com `ativo = true`

Fora disso `dom-contexto` devolve `atende: false` e a resposta é engolida antes
de chegar ao modelo. Três travas de propósito: um atendente que fala com cliente
sobre o processo dele erra caro, e a lista do piloto é o freio de mão.

## Cada grupo é uma caixa fechada

As três fontes que alimentam a resposta são isoladas por grupo:

| fonte | como isola |
|---|---|
| histórico da conversa | `whatsapp-ai-agent-reply` filtra `phone` + `instance_name` |
| andamento processual | `dom_contexto_processual(group_jid)` → lead → autos daquele lead |
| acervo de exemplos | `dom_respostas_parecidas(..., p_group_jid)` — só o mesmo grupo |

O acervo nasceu (21/08/2026) varrendo os 4.546 pares de todos os 481 grupos,
para pegar o tom da equipe. Em 04/09/2026 isso foi fechado: sem `p_group_jid` a
função **não devolve nada**. Falhar calado é o certo — um chamador que esquecer
de passar o grupo receberia, na versão antiga, o acervo inteiro sem perceber.
Custo aceito: grupo novo roda sem exemplos, e o tom vem só do prompt.

## Como ele fala

`blocoComoFalar()` em `dom-contexto` é obrigatório em toda resposta:

- **Nunca pede o número do processo.** Nasceu de um caso real: o atendente
  virtual pediu o número ao cliente para falar do processo *do próprio cliente*.
  Os autos já chegam prontos no bloco de andamento — pedir escancara que ninguém
  está olhando o caso.
- **Zero juridiquês.** O bloco carrega um glossário de tradução obrigatória
  (juntada, conclusos, citação, contestação, réplica, perícia, trânsito em
  julgado, exigência, sentença, arquivado).
- **Uma comparação do dia a dia por resposta**, no máximo.
- **Pergunta sobre andamento** = resumo de 2 a 3 frases de CADA processo e
  requerimento, a partir das últimas movimentações. Audiência ou perícia marcada
  vem primeiro. Sem movimentação recente, diz isso com honestidade — sem prometer
  prazo.

## Modos do piloto (`dom_grupos_piloto.modo`)

- `hibrido` — envia o factual, enfileira o sensível em `dom_respostas_pendentes`
- `rascunho` — enfileira tudo
- `automatico` — envia tudo, sem revisão

O modelo classifica a própria resposta com o marcador `[REVISAR: motivo]`, que é
removido antes do envio. Valor, prazo, mérito de decisão, recurso, acordo e
cliente reclamando são sempre revisão.

## Estado em 04/09/2026

Pronto e vivo:
- 481 grupos com caso mapeados, todos com acervo carregado
- 4.546 pares no acervo; o gatilho `trg_dom_captura_resposta` alimenta sozinho
- `contexto_processual = true`; `respond_in_groups = true`
- prompt sem as frases que mandavam deduzir o processo da conversa
- acervo isolado por grupo

Falta:
- **deploy** de `dom-contexto` (nunca subiu) e de `whatsapp-ai-agent-reply`
  (produção roda v47, de 11/06/2026, sem nenhum código do Dom)
- `is_active = true`
- escolher os grupos do piloto e vincular em `whatsapp_conversation_agents`
- tela da fila `dom_respostas_pendentes` — sem ela o modo híbrido enfileira para
  ninguém
- atraso de 5 min por fila agendada (ver abaixo)
- aviso proativo de movimentação nova (o Dom hoje só reage a mensagem)

## O atraso de 5 minutos NÃO é `response_delay_seconds`

`response_delay_seconds` está implementado como `await setTimeout()` **dentro**
da edge function: ela segura o worker aberto o tempo todo. Limites do Supabase:
wall clock 150s (free) / 400s (pago) e **2s de CPU por request**. Cinco minutos
parados por mensagem, com ~5,9 mil invocações/dia nessa função, bate no teto.

O caminho certo é enfileirar a resposta com `enviar_em = now() + 5min` e deixar
um tick de cron mandar — cancelando se um humano responder antes. A máquina já
existe e está provada: `wa_agendadas_tick()` + cron `wa-mensagens-agendadas`
(migration `20260825170000`), que dispara pelo mesmo `send-whatsapp`.

## Deploy

Não há CLI nem `SUPABASE_PAT` no ambiente remoto. Do seu lado:

```bash
supabase functions deploy dom-contexto --project-ref kmedldlepwiityjsdahz
supabase functions deploy whatsapp-ai-agent-reply --project-ref kmedldlepwiityjsdahz
```

Ao redeployar `whatsapp-ai-agent-reply`, os `_shared/gemini.ts` e
`_shared/doc-utils.ts` **que estão em produção** têm que ir junto. O
`_shared/gemini.ts` da raiz do repo é uma versão mais nova (com roteamento
Anthropic) e **não** faz parte desta mudança — subir ele por engano troca o
provedor de todos os agentes.

## Rollback

```sql
-- desliga o Dom sem tocar em mais nada
update wjia_command_shortcuts set is_active = false
 where id = 'd6ad8eee-d6a3-452c-b852-b94ef8dd54bf';

-- ou tira só os grupos do piloto (o agente fica ligado e mudo)
update dom_grupos_piloto set ativo = false;
```

O bloco do Dom em `whatsapp-ai-agent-reply` é inteiro guardado atrás de
`agent.contexto_processual`, que é `false` em todos os outros agentes: para
quem já roda hoje, o código é inerte.

## Pendência aberta (decisão do Raym)

O `base_prompt` do Dom contém:

```
SEMPRE DEIXE CLARO QUE O CLIENTE PODE COMPARTILHAR SENHAS DENTRO DO GRUPO,
POIS É UM AMBIENTE SEGURO ONDE TODOS SE CONHECEM E TÊM CONFIANÇA
```

O agente está instruído a dizer ativamente ao cliente que pode mandar senha no
grupo. Grupo de WhatsApp não é canal seguro para credencial: fica no aparelho de
cada participante, no backup em nuvem de cada um, e sobrevive à saída de
qualquer um do grupo. Se for a senha do gov.br, é acesso ao Meu INSS do cliente.
**O Dom não deve ser ligado com essa linha ativa.**
