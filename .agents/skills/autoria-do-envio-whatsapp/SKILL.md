---
name: autoria-do-envio-whatsapp
description: Como o sistema sabe QUEM da equipe mandou cada mensagem de WhatsApp, e por qual instância. Cobre a tabela whatsapp_message_authors, a edge send-whatsapp v28, a assinatura `*Nome:*` no texto, e a regra de que o id da mensagem (sem o prefixo do dono) é a chave de casamento. Use sempre que a conversa envolver "quem mandou", autoria de mensagem enviada, identificar remetente, external_message_id, ou ao mexer em qualquer bolha de conversa.
---

# Autoria do envio de WhatsApp — quem falou com o cliente

## O problema que isto resolve

`whatsapp_messages` **não tem coluna de autor**. Nunca teve. Uma instância é
compartilhada — "Atendimento Previdenciário" tem dezenas de pessoas com acesso —
então saber que a mensagem saiu por ela não diz nada sobre quem escreveu.

Até 04/09/2026 a única pista era o prefixo `*Nome:*` que o envio identificado
cola **dentro do texto**. Isso deixava de fora justamente o que mais importa numa
conversa de grupo: **áudio e mídia saem sem assinatura** (`/send/media` só aceita
`caption`, e áudio nem isso).

## Antes de prometer autoria: a maior parte do envio não passa pelo sistema

Medido em 04/09/2026, das 13h às 14h: **71 mensagens enviadas, 1 com autoria**, e
a edge de envio teve **3 chamadas em 2 horas**. Confirmado pelo Raym: a equipe
responde majoritariamente pelo **celular / WhatsApp Web**, fora do sistema.

Isso não é defeito da autoria — é o alcance dela. Quem responde pelo aparelho não
passa por lugar nenhum onde exista um usuário logado; a mensagem só chega ao
banco pelo eco do webhook, que não carrega usuário. Para essas, o que dá para
dizer com verdade é **por qual número saiu**, nunca quem digitou.

Portanto: ao propor qualquer coisa baseada em "quem enviou", diga antes qual
fatia isso cobre. Prometer autoria da carteira inteira, hoje, é prometer 1 em 71.

## Como funciona hoje

Duas fontes, nesta ordem de preferência:

1. **`whatsapp_message_authors`** (Supabase Externo) — a fonte de verdade.
   Gravada pela edge `send-whatsapp` **v28** logo após o envio, com o autor
   tirado do **JWT do header Authorization**, validado em `auth.getUser` contra o
   Cloud. Cobre texto, mídia, áudio, contato e enquete.
2. **A assinatura `*Nome:*` no texto** — fallback para mensagem escrita antiga
   (`separarPrefixoRemetente` em `src/lib/whatsappSenderName.ts`).

Sem nenhuma das duas, a bolha fica **sem autor**. Nunca se chuta.

### Regras que não podem ser quebradas

- **O autor vem do JWT, nunca do body.** Se viesse do body, qualquer um poderia
  assinar no lugar de outro. Envio automático (agente de IA, robô do INSS) chama
  com service/anon key, não tem usuário, e por isso fica corretamente sem autor —
  isso é o comportamento certo, não um buraco a tapar.
- **A chave de casamento é o ID DA MENSAGEM, não o `external_message_id`
  inteiro.** O id da UazAPI é `<número do dono>:<id da mensagem>` e o prefixo é
  de QUEM REGISTROU a linha: num grupo, a mesma mensagem aparece uma vez por
  instância participante, cada uma com o seu prefixo. Medido em produção com as
  primeiras autorias: casando pelo id inteiro, 5 de 11; casando só pelo id da
  mensagem, 14 de 16. Use `idDaMensagemNoWhatsApp()` no front e a coluna gerada
  `wa_message_id` no banco — as duas aplicam a mesma regra.
- **Tabela separada, não coluna em `whatsapp_messages`.** A linha da mensagem é
  disputada: a edge de envio insere com `ignoreDuplicates`, e o webhook da UazAPI
  insere a mesma mensagem sem saber o autor. Em 48h medidas, 3.544 de 3.628
  outbound (97,7%) tinham `metadata.EventType`, ou seja, a linha que a tela mostra
  foi gravada pelo WEBHOOK. Como coluna, a autoria sumiria na corrida.
- **Gravar autoria nunca pode derrubar um envio.** É best-effort, dentro de
  try/catch, e sai do caminho da resposta via `EdgeRuntime.waitUntil`.
- **Nunca use o `instance_name` da linha para dizer por qual número a mensagem
  saiu, em grupo.** A linha canônica do dedupe é o primeiro espelho da lista, que
  quase sempre é de uma instância que apenas RECEBEU. No PREV 2209, isso diria
  "Atendimento Previdenciário 2" para uma mensagem que saiu pela "Raym". O campo
  certo é `sent_by_instance`, que `dedupeMirroredMessages` deriva do espelho
  `outbound` (ou, para mensagem do celular, do telefone do autor via
  `getInstanceNameByPhoneSync`).

## Onde está cada peça

| peça | arquivo |
|---|---|
| tabela + RLS | `supabase/migrations/20260904120000_whatsapp_message_authors.sql` |
| coluna de casamento | `supabase/migrations/20260904160000_autoria_casa_pelo_id_da_mensagem.sql` |
| gravação (UazAPI) | `supabase/functions/_external_send-whatsapp/index.ts` (v28) |
| gravação (Cloud API/Meta) | `railway-server/src/lib/autoriaDoEnvio.ts` |
| leitura no front | `src/hooks/useAutoriaDasMensagens.ts` |
| assinatura no texto | `src/lib/whatsappSenderName.ts` |
| bolhas | `WhatsAppChat.tsx`, `DashboardChatPreview.tsx` |

A instância da conversa aparece como chip no header do chat — o dado é
`conversation.instance_name`, que já mandava no envio e no avatar.

## O que continua sem autor (e está certo assim)

- Mensagem enviada **direto do aparelho**: não passa pelo sistema.
- Mensagem anterior à v28 (04/09/2026), exceto texto com assinatura.
- Envio pelo canal Meta enquanto a edge proxy do **Cloud** não for republicada
  (é ela que repassa o `Authorization` ao Railway).
- Envio automático (agente, robô do INSS).

## Rollback

```sql
DROP TABLE public.whatsapp_message_authors;  -- nada mais depende
```
Edge: redeploy de `index.v27.rollback.ts`, espelho fiel da versão anterior.
