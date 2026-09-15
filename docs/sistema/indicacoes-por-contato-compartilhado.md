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
| `referral-success-scan` | `railway-server/src/functions/` | Casa indicação↔lead, acha desfecho e pede autorização ao indicado. Cron 6h. |
| `referral-thanks-dispatch` | `railway-server/src/functions/` | Lê a resposta e avisa quem indicou. Cron 20min. |
| `referral-sucesso.ts` | `railway-server/src/lib/` | A lógica pura do laço de volta: o que conta como desfecho, o que é um "sim", as travas. 23 testes. |
| `referral-envio.ts` | `railway-server/src/lib/` | Envia pela MESMA instância de onde o cartão veio, casando o nome com `ilike`. |
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

E, em paralelo, o **laço de volta** — que roda sozinho e não depende da esteira
acima ter andado:

```
indicação  ──casa por telefone/contato──→  lead do indicado
                                             ↓  INSS deferido | acordo | pagamento
                                          desfecho detectado
                                             ↓  perguntamos AO INDICADO
                                     "posso contar pra quem te indicou?"
                                    ↙            ↓              ↘
                                 sim         sem resposta        não
                                  ↓           (5 dias)            ↓
                       aviso ao indicador      expira          nunca sai
                       (privado, 8h-20h,
                        1 por 30 dias)
```

Sentença cai em `thanks_status='revisar'` e espera um humano — ver "Decisões".

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

## Avisar quem indicou quando deu certo (15/09/2026)

Quem passa um contato nunca descobre o que aconteceu. Indica o cunhado para o
BPC, o cunhado recebe o benefício seis meses depois, e o indicador segue sem
saber. A notícia boa já está no banco — só não chega a quem a provocou.

### O elo que faltava

A `referrals` guardava o telefone do indicado mas **nunca o lead que ele virou**.
Sem isso não havia como perguntar "o caso dele deu certo?". A coluna
`converted_lead_id` é esse elo, preenchida pelo scan por dois caminhos, nesta
ordem:

1. `indicated_contact_id` → `contact_leads` — o elo explícito, quando alguém já
   disse que este contato é deste lead.
2. Últimos 8 dígitos do telefone contra `leads.phone_match_key` — a **mesma**
   coluna gerada que o resto do sistema usa. Casar por outro critério aqui
   criaria dois universos de "mesma pessoa".

**A ordem não é detalhe.** A primeira medição desta funcionalidade usou só o
telefone e concluiu que o gatilho dispararia zero vez. Estava errada: os 6
deferimentos que existem hoje aparecem **exclusivamente** por `contact_leads`, e
nenhum pelo telefone. Cadastro com número antigo e cliente que trocou de chip são
invisíveis para os 8 dígitos.

Mais de um lead casando = `match_confidence='ambigua'`, lead nulo, nada
automático. Avisar o indicador sobre o desfecho da pessoa errada é notícia falsa
sobre um terceiro, e não tem desfazer.

### O que conta como "deu certo"

| Sinal | Fonte | Automático? |
|---|---|---|
| Pagamento / alvará | marco `pagamento` | sim |
| INSS deferido | `inss_admin_processes.resultado='deferido'` | sim |
| Acordo homologado | marco `acordo` | sim |
| Sentença | marco `sentenca_1grau` | **não** — fila `revisar` |

Empate: vence o mais forte, e pagamento ganha de tudo — dinheiro na mão não
admite discussão.

**Por que a sentença não dispara sozinha.** O marco não distingue procedente de
improcedente, e não é limitação do parser, é do dado: das 287 sentenças gravadas
(conferido em 15/09/2026), **284 não têm a palavra "procedente" em lugar nenhum
da descrição** — a descrição é o cabeçalho da movimentação, não o teor. Das 3 que
têm, 1 é improcedente. A outra fonte possível,
`lead_processes.resultado_atingido_status='confirmado'`, tem 2 linhas na base
inteira, e o rótulo vem do POP, que mapeia um resultado por marco — também não
separa ganhou de perdeu. Então a sentença é **detector, não gatilho**: classifica,
roteia para a fila e alguém confirma. Mesmo princípio de
`conserto-estrutural-nao-pontual`.

### Consentimento não é formalidade

"O Zé que você indicou conseguiu o BPC" conta a um terceiro que o Zé é cliente,
que tem um caso e qual foi o desfecho. Benefício assistencial é dado de saúde e
de renda (LGPD art. 5º, II) e a relação cliente-escritório é coberta por sigilo
profissional.

Por isso o fluxo pergunta **ao próprio indicado** antes: "posso contar pra quem
te indicou que deu certo?". Só o sim, gravado com data em `consent_status`,
libera o aviso.

**Silêncio não é consentimento**: pedido sem resposta expira em 5 dias e o aviso
nunca sai. É o inverso do padrão de marketing, e é de propósito. A leitura da
resposta é determinística primeiro (`interpretarResposta`) e só chama IA na
dúvida; quando nem a regra nem a IA se decidem, fica em aberto e expira. **Não
existe caminho em que a dúvida vira autorização.**

Armadilha coberta por teste: *"não tem problema"* é **sim**, não recusa.

### As travas do envio

- **Sempre no privado.** 997 das 1.416 indicações vieram de grupo, e todas têm
  `referrer_sender_phone`. O cliente autorizou contar a **quem o indicou**, não
  ao grupo de 200 pessoas de onde o cartão saiu.
- **Janela 8h–20h (BRT).** Ninguém recebe notícia de escritório às 3 da manhã.
- **Uma mensagem por indicador a cada 30 dias**, cobrindo todos os desfechos do
  período numa lista só. Um acolhedor com 188 indicações receberia 188 mensagens
  numa semana ruim — vira spam, queima o número e queima quem mais indica.
- **`thanks_enviado_at` trava o reenvio**, mesmo com duas rodadas em paralelo.
- **A IA só reescreve.** Não decide quem recebe, não decide se recebe. Falhou?
  Fica o texto determinístico, que já estava correto.

### Ligar e desligar

Publicar **não** liga o disparo. Os dois crons varrem, classificam e gravam, mas
só mandam mensagem com `REFERRAL_AVISO=on` no Railway. Deploy acontece a cada
merge em `main`, e um merge distraído não pode virar mensagem na casa de gente de
verdade.

Desligar = tirar a variável. **Não precisa de deploy** — é o rollback mais rápido
que existe. Teto por rodada em `REFERRAL_AVISO_LIMITE` (padrão 20).

### Estado no dia em que subiu

Medido em 15/09/2026 — e a base é viva: subiu de 1.416 para 1.437 indicações
durante a própria medição.

| | |
|---|---|
| Indicações | 1.437 |
| Casadas com um lead | 173 (141 por telefone, 97 por `contact_leads`, com sobreposição) |
| Ambíguas (>1 lead pelo telefone) | 3 |
| **Com INSS deferido** | **6** — todas por `contact_leads`, nenhuma pelo telefone |
| Com acordo ou pagamento | 1 |
| Com sentença (vai para revisão) | 1 |

Ou seja: **7 avisos de verdade já na primeira rodada**, e é exatamente por isso
que existe o teto de `REFERRAL_AVISO_LIMITE` por rodada — o backlog acumulado
não pode virar rajada de mensagem no mesmo minuto.

### Custo

Uma chamada Gemini Flash por resposta ambígua de cliente e outra por aviso
enviado — ambas raras por construção. A detecção e o casamento não usam IA.
Ordem de grandeza: centavos por mês no volume atual.

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
