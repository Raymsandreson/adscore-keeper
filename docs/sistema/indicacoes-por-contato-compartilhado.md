# Indicações por contato compartilhado

Quem indicou quem, a partir dos cartões de contato (vCard) compartilhados nas
conversas do WhatsApp. Aba **Indicações**, em Contatos, ao lado de Grupos.

## O problema

Todo dia alguém pede "me manda o contato do seu cunhado" e recebe o cartão pelo
WhatsApp. Esse cartão chegava, virava mensagem de texto e morria ali: não havia
como saber quem indicou quem, quantas indicações cada pessoa já deu, nem se
alguém chegou a falar com o indicado.

O dado sempre existiu — só nunca foi lido.

## Como o dado chega

A UazAPI manda o cartão dentro de `metadata`:

```
metadata->message->messageType          = 'ContactMessage' | 'ContactsArrayMessage'
metadata->message->mediaType            = 'vcard'
metadata->message->content->vcard       = 'BEGIN:VCARD…item1.TEL;waid=558699275467…'
metadata->message->content->displayName = 'Nome que aparece no cartão'
```

O telefone sai do **`waid`**, não do número formatado da linha `TEL`: o `waid` é
o id real no WhatsApp, já com DDI e sem máscara.

Volume medido em 11/09/2026 (banco Externo): 214 cartões recebidos em 10 dias,
54 conversas distintas. ~24/dia.

## Peças

| Peça | Onde | O que faz |
|---|---|---|
| `lerVcard` / `contatosCompartilhados` | `railway-server/src/lib/vcard.ts` | Lê o cartão. Lógica pura, com testes contra payloads reais. |
| `capturarIndicacao` | `railway-server/src/lib/referral-capture.ts` | Grava em `referrals`. Descarta cartão da própria casa e da própria pessoa da conversa. |
| gancho do webhook | `railway-server/src/functions/whatsapp-webhook.ts` | Chama a captura depois da mensagem gravada, fire-and-forget, só inbound. |
| `referral-classify` | `railway-server/src/functions/` | IA lê a conversa ao redor do cartão e **sugere** o assunto. |
| `referral-outreach` | `railway-server/src/functions/` | `draft` escreve a apresentação; `send` envia. |
| `referral-backfill` | `railway-server/src/functions/` | Recupera o histórico, dia a dia. |
| Aba Indicações | `src/components/contacts/ReferralsInboxTab.tsx` | Fila, ranking de quem mais indica, ficha em Sheet. |
| Tabela `referrals` | `supabase/migrations/20260911141500_…sql` | Banco **Externo**. |

## Esteira

```
cartão chega  →  novo
                  ↓  alguém confirma o assunto (a IA sugere, o humano confirma)
              classificado
                  ↓  clique em "Enviar apresentação"
               contatado
                  ↓
              convertido | descartado
```

## Decisões que valem lembrar

**A mensagem de apresentação nunca sai sozinha.** Quem chega por cartão
compartilhado é uma terceira pessoa que ainda não falou com a gente. Disparo
automático abordaria despachante, cartório e colega de trabalho junto com a
indicação de verdade — e um número que faz isso em escala é bloqueado pelo
WhatsApp. O texto é gerado pela IA, fica na ficha, e só sai por clique.

**A classificação da IA é sugestão, não verdade.** `ai_suggested_product` é
palpite e aparece marcado como tal. O que entra em relatório é `product_name`,
que só existe depois que alguém confirmou. Classificação errada em relatório de
gestão é pior que classificação nenhuma: ninguém desconfia de um número que já
está na tela.

**`message_type` das mensagens não foi alterado.** O cartão continua gravado
como `'text'`. Mudar para `'contact'` arriscaria a renderização do chat
(`WhatsAppChat.tsx`) sem ganho nenhum — a `referrals` resolve sem tocar lá.

**A varredura do backfill é dia a dia.** `whatsapp_messages` tem 1,7 milhão de
linhas e nenhum índice em `metadata`. Filtrar o jsonb na tabela inteira estoura
o timeout (medido: 60s, duas vezes). Filtrando primeiro por `created_at`, cada
dia responde em instantes.

**Uma instância pode ter mais de um usuário.** Por isso a indicação guarda
`instance_name` + `instance_owner_phone` (o dono do número) e um
`assigned_user_id` escolhido na tela, casando `profiles.default_instance_id`
com `whatsapp_instances.id`. O dono do número não responde "de quem é essa
indicação".

## Estado (14/09/2026)

Backfill de 90 dias feito: **1.416 indicações** gravadas, de 16/06 a 14/09, em
18 instâncias — 713 pessoas distintas indicadas, 323 indicadores, 631 já
existiam na agenda de contatos. A captura ao vivo estava funcionando desde o
deploy (69 indicações em 3 dias antes do backfill).

O backfill NÃO rodou pela função `referral-backfill`: o ambiente daquela sessão
não alcançava o Railway (403 do proxy). Foi executado com o MESMO parser
(`vcard.ts` compilado, rodando fora do servidor) e o mesmo critério de
descarte, gravando por SQL. A função continua sendo o caminho normal — pelo
botão na aba.

### Defeito conhecido: a mesma mensagem conta várias vezes

Um cartão compartilhado num grupo onde participam vários números nossos chega
uma vez por instância, e o id da mensagem carrega o número que recebeu como
prefixo (`558695590127:3AEBAD…`). Como a chave de idempotência usa o id
inteiro, as seis cópias entram como seis indicações.

Medido: **1.416 linhas para 898 eventos reais — 36,6% de inflação**. O ranking
sente: o grupo "ACOLHEDORES - PREVIDENCIÁRIO" aparece com 30 indicações quando
são 7; já "TERRAS ALPHAVILLE" (grupo com uma instância só) tem 188 = 188.

A correção estrutural é chavear pelo id real da mensagem — o trecho DEPOIS do
`:`, que é o mesmo em todas as instâncias — em vez do id completo. Isso muda o
índice único e exige desduplicar o que já está gravado. Ainda não foi feito.
Não filtrar isso na tela: a tela some o que está no banco, e esconder a
duplicata trocaria um número errado por outro.

## Como operar

- **Backfill** (uma vez, após a migration): botão **"Buscar indicações antigas"**
  na própria aba. Ele conta primeiro e pergunta antes de gravar. É idempotente —
  repetir não duplica. Pela API: `POST /functions/referral-backfill` com
  `{"days": 90, "dry_run": true}`, depois sem `dry_run`.
- **Reclassificar uma indicação**: botão "Ler a conversa" na ficha.
- **Rollback**: `DROP TABLE public.referrals;` — nada existente é alterado por
  esta funcionalidade.

## Custo

Uma chamada Gemini Flash por indicação classificada e outra por apresentação
escrita — só quando alguém clica. No volume atual (~24 cartões/dia), ordem de
grandeza de centavos por dia. A captura e o backfill não usam IA.
