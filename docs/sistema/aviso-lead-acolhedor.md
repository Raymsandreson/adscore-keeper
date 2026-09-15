# Lead novo → WhatsApp do acolhedor

O acolhedor vive no WhatsApp, não na tela. Até aqui, para saber que entrou lead
do tráfego pago ele precisava abrir o sistema — e enquanto não abria, o lead
esfriava. Esta rotina leva o lead ao WhatsApp dele, com um link que abre a
conversa com o cliente **já com a primeira mensagem escrita**.

## O caminho

```
Meta Lead Ads ──► meta-leads-sync (30 min, API da Meta) ──┐
                                                          ├─► leads (board BPC)
              ──► bpc-sheet-sync  (10 min, planilha)   ───┘         │
                                                                    ▼
                                        avisar-acolhedor-lead (cron 3 min)
                                                                    │
                                          UazAPI ──► WhatsApp do acolhedor
```

O gatilho é **varredura**, não hook na criação, porque o lead nasce por dois
caminhos que escrevem na mesma tabela. Pendurar o envio em cada um duplicaria a
regra e colocaria uma chamada de rede dentro do laço que cria lead — onde uma
falha de WhatsApp viraria falha de import.

## O que chega no WhatsApp dele

```
🔥 Lead novo — BPC/Autismo

Quem preencheu: Fernanda Souza
Criança: João
Telefone: (86) 99999-8888

• Já recebe BPC: Não
• Laudo/relatório: Sim
• Renda da família: Até 1 salário mínimo
• CadÚnico: Sim
• Já tem advogado: Não
• Moram na casa: 4

📣 BPC Autismo — Setembro · 🕐 preencheu 14/09 09:32

👉 Toque para falar com ela agora (a mensagem já vai escrita):
https://wa.me/5586999998888?text=Oi%2C%20%C3%A9%20a%20mam%C3%A3e%20do%20Jo%C3%A3o%3F
```

`wa.me` **preenche** a caixa, não envia. É de propósito: o acolhedor lê e ajusta
antes de mandar, e nenhuma mensagem sai para cliente sem gente no meio.

## O nome da criança falta em metade dos leads

Medido no banco real em 14/09/2026, board BPC, últimos 7 dias:

| Origem | Leads | Com nome da criança |
|---|---:|---:|
| API da Meta (`meta-leads-sync`) | 304 | 285 (94%) |
| Planilha (`bpc-sheet-sync`) | 327 | 39 (12%) |

O `meta-leads-sync` grava as respostas do formulário em `leads.notes`; o
`bpc-sheet-sync` não grava, porque a planilha não traz as colunas de
qualificação. Como os dois criam no mesmo board e **quem chega primeiro cria**,
cerca de metade dos leads chega sem o nome.

Isso não segura o aviso e não autoriza inventar nome: a primeira mensagem cai na
versão sem nome (`Oi, tudo bem? É a mamãe?`) e o aviso diz na cara que o nome
não veio. O conserto estrutural é fazer o lead da planilha também carregar as
respostas (enriquecer pelo `facebook_lead_id` na Graph API) — **ainda aberto**.

## Configuração: fica no banco, não no código

Tabela `acolhedor_aviso_config` (Supabase Externo). Nenhum telefone no
repositório.

| Coluna | Papel |
|---|---|
| `operador` | Como `casaOperador` devolve: `Israel`, `Mateus`, `Karolyne`… É por ele que a função sabe de quem é o lead (casa com `leads.source`). |
| `board_id` | O funil. Liga o aviso no BPC sem ligar em todo lugar. |
| `whatsapp` | Destino, só dígitos com DDI. |
| `instancia_remetente` | Instância UazAPI que manda. `NULL` = env `AVISO_LEAD_INSTANCIA`. |
| `mensagem_com_crianca` | 1ª mensagem quando veio o nome. `{crianca}` é o único marcador. `NULL` = `Oi, é a mamãe do {crianca}?` |
| `mensagem_sem_crianca` | 1ª mensagem quando não veio. `NULL` = `Oi, tudo bem? É a mamãe?` |
| `ativo` | Entra ou não na rodada. |

**Operador sem linha aqui não gera aviso.** Silêncio por ausência de cadastro,
nunca por adivinhação de telefone — e a resposta da função conta isso em
`sem_config`, que também vira `console.warn` no cron.

## As quatro travas

Uma função que manda mensagem para o WhatsApp pessoal de alguém não pode
disparar por acidente.

1. **`dry_run` é `true` quando não vem no corpo.** Para valer é explícito.
2. **`janela_minutos` (180).** Lead mais velho que isso não gera aviso — é o que
   impede a primeira rodada de despejar os 2.641 leads dos últimos 30 dias.
3. **`limite` (30 por rodada).** Dia de pico medido: 178 leads no board.
4. **Janela de horário 7h–21h (Brasília),** `AVISO_LEAD_HORA_INICIO`/`_FIM`.
   Aviso de madrugada faz a pessoa silenciar a conversa, e conversa silenciada
   não entrega mais nada. O lead da madrugada não se perde: sai na primeira
   rodada depois que a janela abre, se ainda estiver dentro de `janela_minutos`.

Mais: `lead_aviso_acolhedor.lead_id` é `UNIQUE`. A mesma mãe não vira três
avisos, mesmo com os dois crons de ingestão e a varredura de 3 em 3 minutos.

## Como chamar

```jsonc
// Ensaio: monta tudo e devolve o texto, sem mandar nada.
{"dry_run": true, "limite": 5}

// Para valer (é como o cron chama).
{"dry_run": false}

// Um operador só, para testar o cadastro de uma pessoa.
{"dry_run": false, "operador": "Mateus", "limite": 1}
```

Endpoint: `POST /functions/avisar-acolhedor-lead` no Railway.

Resposta: `candidatos`, `enviados`, `falhas`, `sem_operador` (lead cujo `source`
não casa com operador nenhum — funil sem dono ou palavra-chave nova em
`OPERATOR_KEYWORDS`), `sem_config` (operador existe, ninguém cadastrou o
WhatsApp), e `avisos[]` com o detalhe de cada um.

## O cron

`runAvisoLeadAcolhedor` em `railway-server/src/index.ts`, a cada 3 min.

**Sai desligado.** Ligar é `AVISO_LEAD_ACOLHEDOR=on` nas env vars do Railway,
**depois** de cadastrar quem recebe. Desligar de volta: tirar a env var e
reiniciar; nada se perde, os leads continuam entrando no funil como sempre.

Conferir de fora, sem log do Railway:

```
curl -s https://adscore-keeper-production.up.railway.app/health | jq .aviso_lead_acolhedor
{ "ligado": true, "execucoes": 12, "ultima_em": "...", "ultimo_resultado": "enviados=3 falhas=0 sem_config=0 sem_operador=1", "enviados_acumulado": 3 }
```

`ligado: false` com `enviados_acumulado: 0` é o estado de fábrica, não falha.
A rotina também aparece na aba de Métricas (`rotinasParaOPainel`).

## Latência real

O aviso não sai "no segundo em que a pessoa preenche". O gargalo é a ingestão,
não este cron:

| Etapa | Atraso |
|---|---|
| Meta → `meta-leads-sync` | até 30 min (cron da Graph API) |
| Meta → planilha → `bpc-sheet-sync` | até 10 min, se `SHEET_LEAD_SYNC=on` |
| lead no banco → aviso | até 3 min |

Para encurtar, o caminho é baixar o intervalo do `meta-leads-sync` — que é 30
min porque cada rodada varre os formulários de 3 páginas na Graph API e a Meta
limita chamada por segundo. Isso é decisão à parte, com custo de cota.

## O que esta rotina NÃO resolve

O aviso vai para o **celular pessoal** de cada um (decisão do Raym em
14/09/2026). Consequência aceita e registrada: a conversa que nascer do clique
acontece fora das instâncias monitoradas pela UazAPI, então ela **não** é
gravada em `whatsapp_messages`. Efeito prático: no painel
(`BpcFormLeadsSheet`), esse lead continua marcado como "🔴 ninguém respondeu"
mesmo depois de o acolhedor ter falado com a pessoa — e o `first_contact_by`
nunca vira `operator`.

Para a conversa voltar a ser gravada, o aviso teria que ir para o **chip da
instância** de cada um. Estado das instâncias em 14/09/2026:

| Instância | Última mensagem |
|---|---|
| Mateus Atendimento | ativa (1.421 enviadas em 7 dias) |
| Karolyne Atendimento | 02/09/2026 |
| ISRAEL ATENDIMENTO | 11/08/2026 |

Trocar o destino depois não exige deploy: é um `UPDATE` em
`acolhedor_aviso_config.whatsapp`.

## Privacidade

- `acolhedor_aviso_config.whatsapp` é telefone de funcionário: fica só no banco,
  nunca no repositório, nunca em log. A função loga `lead_id` e `operador`.
- Nome da mãe, nome da criança e telefone do cliente **não** vão para log.
- `lead_aviso_acolhedor` não guarda o texto enviado nem o telefone do cliente —
  guarda o `lead_id`, que já é a fonte do dado.
- RLS habilitado nas duas tabelas, **sem policy**: só `service_role` (os crons
  do Railway) enxerga. Navegador autenticado não lê nem escreve.

## Rollback

```sql
DROP TABLE public.lead_aviso_acolhedor;
DROP TABLE public.acolhedor_aviso_config;
```
E tirar `AVISO_LEAD_ACOLHEDOR` das env vars do Railway. Nada existente é
alterado por esta feature — nenhuma tabela, nenhuma coluna, nenhum fluxo de
criação de lead.
