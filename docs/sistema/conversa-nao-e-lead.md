# Conversa marcada como "não é lead"

Nem toda conversa do WhatsApp é uma venda em potencial. Parceiro, fornecedor,
advogado da outra parte, grupo da família, vendedor de material de escritório —
tudo isso chega pela mesma caixa de entrada. Esta marcação é como o time diz ao
sistema "já olhei, isso aqui é contato, não é lead" — e como o sistema para de
insistir.

## O problema

O filtro **"Sem lead"** da caixa de entrada sempre foi
`conversations.filter(c => !c.lead_id)`: AUSÊNCIA de vínculo, não decisão. Ele
misturava duas coisas opostas na mesma pilha (481 conversas em 14/09/2026):

- conversas que **ninguém olhou ainda** — trabalho pendente;
- conversas que **alguém já olhou** e concluiu que não viram lead — trabalho feito.

Metáfora: era uma caixa de entrada sem arquivo morto. Quem abrisse no dia
seguinte reabria as mesmas conversas, porque não havia como saber quais já
tinham sido triadas.

Pior: as automações não sabiam tampouco. A ação `create_lead` do agente IA e o
`auto_create_lead` das campanhas CTWA só checavam se o lead **já existia** —
nunca se alguém tinha decidido que ele **não devia existir**. Toda mensagem nova
do mesmo número era uma chance de recriar o lead que a pessoa acabou de
dispensar.

## O que a marcação faz

| Efeito | Detalhe |
|---|---|
| Sai da fila de triagem | O chip "Sem lead" passa a contar só o que **ainda não foi decidido**; o marcado vai para o chip próprio "Não é lead" |
| A IA para de criar lead | Bloqueio nos três caminhos automáticos (abaixo) |
| Fica o registro | Quem marcou, quando e por quê (motivo opcional, uma linha) |
| Nada é apagado | Conversa, mensagens, contato e histórico continuam intactos |

A marcação vale para o **telefone**, não para o par telefone+instância: o lead é
criado por `leads.lead_phone`, então marcar em um número da casa e deixar passar
no outro reabriria exatamente o buraco que a feature fecha.

## Como usar

Na conversa, menu `⋮` → **"Não é lead (só contato)"**. Pergunta o motivo (opcional)
e grava. O cabeçalho da conversa ganha o selo cinza "Não é lead".

Enquanto a marcação está de pé, o item "Criar Lead + Contato" **some do menu** —
de propósito: para criar lead depois, use **"Voltar a tratar como lead"** primeiro.
A decisão fica explícita nos dois sentidos, em vez de o sistema deixar dois
estados contraditórios conviverem.

"Criar Contato" continua disponível o tempo todo: contato é justamente o que essa
pessoa é.

Na lista de conversas, o chip **"Não é lead"** mostra tudo que já foi triado assim.

## Onde o bloqueio acontece

Três caminhos criam lead sozinhos a partir de conversa. Todos checam a marcação
antes, e todos falham "para o lado antigo" (se a tabela estiver indisponível, o
comportamento volta a ser o de antes — a checagem nunca derruba o webhook):

| Caminho | Arquivo | Gatilho |
|---|---|---|
| Ação `create_lead` do agente IA | `supabase/functions/execute-agent-automations/index.ts` | Regra de automação do agente |
| `auto_create_lead` de campanha CTWA | `supabase/functions/whatsapp-webhook/index.ts` | Mensagem vinda de anúncio Click-to-WhatsApp |
| Auto-create por etiqueta | `railway-server/src/functions/whatsapp-webhook.ts` | Etiqueta do WhatsApp mapeada para etapa de funil |

O terceiro é exclusivo do webhook do Railway e não existia na edge — por isso a
trava foi escrita nos dois webhooks.

**Fora do bloqueio, de propósito**: o `zapsign-webhook` cria lead quando um
documento é **assinado**. Assinar contrato é sinal inequívoco de que a pessoa é
cliente — se isso acontecer com um número marcado, a marcação é que está errada,
não a criação do lead.

## Arquivos

- `supabase/migrations/20260914200000_conversa_marcada_como_nao_lead.sql` — tabela `whatsapp_nao_lead` (Externo), RLS e o porquê das decisões
- `src/lib/whatsappNaoLead.ts` — leitura, marcação, desmarcação e o evento que atualiza a lista
- `src/components/whatsapp/WhatsAppChat.tsx` — item do menu, selo do cabeçalho, dialog do motivo
- `src/components/whatsapp/WhatsAppConversationList.tsx` — chip "Não é lead" e correção do contador "Sem lead"

## Rollback

`DROP TABLE public.whatsapp_nao_lead;` — nada existente é alterado pela migration,
e os três bloqueios voltam sozinhos ao comportamento antigo (a checagem trata a
tabela ausente como "não marcado").
