# Risco de banimento de instância WhatsApp

Detector, freio e roteamento. Entregue em 15/09/2026.

## O problema, com evidência

Em 2026 três instâncias morreram. Sempre do mesmo jeito: corte seco no meio de
um dia útil, em plena rajada de abordagem a número novo.

| Instância | Última mensagem (Brasília) | No dia do corte | Silêncio |
|---|---|---|---|
| ISRAEL ATENDIMENTO | ter 11/08, **10:48** | 369 msgs desde 09:29 | 35 dias |
| Karolyne Atendimento | qua 02/09, 18:49 | 23 msgs | 13 dias |
| Mateus Atendimento | sex 11/09, **10:53** | 212 msgs | 4 dias |

Duas das três pararam às ~10:50 da manhã de um dia útil. Não é fim de
expediente, não é férias, não é celular descarregado.

Nos dias anteriores, as três faziam o mesmo: **50 a 111 números novos por dia**,
com intervalo mínimo entre uma abordagem e a próxima de **5,3s (Karolyne),
6,0s (Israel) e 6,9s (Mateus)**. Num único dia o Israel fez 29 abordagens a
desconhecidos com menos de 20 segundos entre elas.

Quem sobreviveu faz o oposto. Raym, o maior volume da casa (12.097 msgs em 7
dias), manda 1 mensagem para cada 14 que recebe e nunca passou de 13 números
novos num dia.

**A conexão da instância não é a causa — é o que viabiliza a causa.** O
bloqueio não vem do carro, vem da velocidade; só que o carro permite 120 km/h
que a pé é impossível. Ninguém no aplicativo do celular aborda 99 desconhecidos
com 7 segundos de intervalo. Pela API, é um loop de dez linhas.

## Critérios: o que é oficial e o que é nosso

Isto importa e costuma ser misturado por aí.

### Documentado pelo Meta — vale só para a API oficial (Cloud API)

O Meta publica critérios de qualidade e limites **apenas** para a WhatsApp
Business Platform, onde existe contrato. Resumidamente: pessoas podem bloquear
e denunciar um negócio, e o sistema reduz o quanto ele pode enviar se a faixa
de qualidade ficar baixa por período sustentado; contas novas começam com
limite de 250 e sobem por faixas; violações repetidas dos termos (spam,
classificação errada de template, categorias de alto risco) geram restrições
que aumentam de duração. Há ainda nota de qualidade por template e limites de
template de marketing por usuário.

### Não documentado — a UazAPI

A UazAPI (Baileys / protocolo do WhatsApp Web) **não tem contrato, nem faixa de
limite, nem nota de qualidade publicada**. Usar cliente não oficial já é
violação dos termos. Nada do que dispara banimento ali é documentado pelo Meta,
e quem afirma o contrário está chutando.

### Empírico — calibrado na nossa base

Os limiares deste sistema saíram de 3 instâncias mortas contra 6 vivas. Amostra
pequena; é heurística calibrada, não lei. Por isso vivem em
`wa_risco_config`, editáveis sem migration.

| Critério | Peso | Por quê |
|---|---|---|
| Números novos por dia | 45 | **O critério.** Separação limpa: mortas 50-111/dia, vivas ≤34. Sem sobreposição. |
| Ritmo de máquina (rajada + intervalo mínimo) | 25 | As três mortas abordaram com 5-7s de intervalo. |
| Conversa fria que nunca respondeu | 15 | Melhor proxy de "quantos me denunciaram". Indica, mas Andressa vive em 33,6%. |
| Texto repetido na 1ª mensagem | 10 | Indica, mas Analyne vive com 61,6%. |
| Enviadas por recebida | 5 | Termômetro. Contando grupo separava bem (Mateus 0,84 × Raym 0,07); fora de grupo a separação some — Mateus morreu com 1,04 e Luiz vive com 0,85. |

Classificação: ≥50 CRÍTICO · ≥25 ATENÇÃO · 18h mudo SILÊNCIO SUSPEITO ·
48h PROVAVELMENTE BANIDA · 7 dias ABANDONADA.

### Backtest — o detector teria avisado?

Rodado contra a produção, com corte na véspera de cada queda:

| Corte | 1º | 2º | 3º |
|---|---|---|---|
| 10/08/2026 | **Karolyne 90** | **Israel 62** | Luiz 47 |
| 10/09/2026 | **Mateus 77** | Andressa 24 | Luiz 20 |

Israel morreu 11h depois de marcar 62. Mateus, 11h depois de marcar 77. Nos dois
cortes as instâncias que morreram ficaram em 1º e 2º do ranking.

## Estado: tudo no ar desde 15/09/2026

- `idx_wam_inst_lower_created` criado com `CONCURRENTLY` (74 MB, válido)
- 4 tabelas com RLS, 3 funções, cron `wa-risco-tick` (jobid 5536) a cada 15 min
- tick completo em **1,34 s** para 25 instâncias
- edge `send-whatsapp` **v30** (version 57), `ezbr_sha256` idêntico ao da canary
  `send-whatsapp-canary-v30` que foi testada antes — ver skill
  `deploy-edge-function-verificado`

Smoke test em produção, por `pg_net`:

| Cenário | Resultado |
|---|---|
| body inválido | `{"success":false,"error":"phone/chat_id and message required"}` |
| número novo por instância morta | `RITMO_INSTANCIA_FORA_DO_AR`, `instancia_sugerida: "Atendimento Processual"`, nada enviado |
| conversa em andamento | `CONVERSA_EM_ANDAMENTO`, `permitido: true` |

## O que foi construído

### 1. Monitor vivo (`wa_risco_tick`, cron a cada 15 min)

Ressuscita o que estava morto: `instance_connection_log` parou de ser
alimentado em **28/04/2026** e ninguém soube que o Israel estava fora por 35
dias. Não havia cron nenhum chamando o monitor.

Custo controlado: uma varredura de 30 dias para tabela temporária (49 mil
linhas fora grupo), e todo o resto calculado em memória. O agregado sozinho,
direto na tabela de 7,8 GB, levava 9.712 ms — quatro CTEs fariam o tick passar
de 30s a cada 15 minutos.

Duas janelas de propósito: **30 dias** para comportamento acumulado (razão, %
fria, % texto repetido) e **7 dias/hoje** para operação (números novos, ritmo).
Em 7 dias a razão de todo mundo sobe (Raym vai de 0,07 para 0,41) e o alarme
apontaria gente saudável — alarme que mente ninguém obedece.

### 2. Freio no envio (`wa_gate_envio`, chamado pela edge function v30)

Antes disto **não existia limite de ritmo em lugar nenhum**: `grep` por sleep,
delay, throttle e rate limit na `_external_send-whatsapp` e nos dois enviadores
do Railway dava zero.

O gate freia só **abordagem a número novo**:

- teto diário de números novos por instância (padrão 40)
- intervalo mínimo entre abordagens, com variação aleatória (75s + até 45s)
- texto já usado em N destinos diferentes (padrão 5)
- instância classificada como fora do ar

**Conversa em andamento nunca é freada.** Frear resposta a cliente seria quebrar
o atendimento para resolver um problema que o atendimento não causa.

Contadores O(1) em `wa_envio_contador` e `wa_texto_usado` — o gate roda em todo
envio e nunca toca nos 7,8 GB. Se o gate falhar, o envio sai: banco fora do ar
não pode virar parada de atendimento.

`ignore_ritmo: true` no body pula o freio e deixa rastro no log, igual ao
`ignore_optout` da v26.

### 3. Roteamento (`wa_instancia_alternativa`)

Quando o gate barra, ele diz **qual outra instância deve mandar**. Preferência:
quem já falou com aquele número (o cliente reconhece o remetente), depois a de
menor risco com folga de cota e viva nas últimas 24h. Nunca devolve instância
muda — trocar um número queimado por outro morto é empurrar o problema para
debaixo do tapete.

### 4. Painel do freio, com variação de texto pela IA (`FreioDeRitmoSheet`)

Envio barrado não vira toast vermelho: abre painel lateral com a **saída**, que
muda conforme o motivo.

| Código do gate | O que o painel oferece |
|---|---|
| `RITMO_TEXTO_REPETIDO` | 3 variações pela IA (`ai-text-editor`, action `custom`), ou reescrever à mão ali |
| `RITMO_TETO_DIARIO` | mandar pela instância que o gate sugeriu |
| `RITMO_INSTANCIA_FORA_DO_AR` | idem |
| `RITMO_RITMO` | contagem regressiva e envio ao zerar |

Detalhes que não são enfeite:

- **Variação idêntica ao original é descartada.** O `ai-text-editor` devolve o
  texto de entrada quando a IA está sobrecarregada (`AI_UNAVAILABLE`);
  oferecê-la mandaria o operador bater na mesma porta, porque o gate barra pelo
  hash do texto. Nesse caso o painel diz para reescrever à mão.
- **O botão de enviar fica travado enquanto o texto for o original**, com o
  motivo escrito na tela.
- **Falha no reenvio não fecha o painel** — o gate pode barrar de novo por
  outro motivo, e fechar apagaria o texto que a pessoa acabou de escolher.
- A instrução de variação repete as proibições da apresentação de indicação
  (`referral-outreach.ts`): nada de invenção de dado, nada de promessa de
  resultado, e abertura de telemarketing proibida. Sem isso a IA devolve
  exatamente o que estamos tentando evitar.
- O painel mora no `WhatsAppInbox`, onde a abordagem é digitada e onde o
  listener do evento de reconexão já vivia. Telas que enviam por outro caminho
  (ficha do lead, formulário de atividade) recebem `showFreioToast`, com o
  motivo por extenso.

### 5. Painel em tempo real (`RiscoBanimentoPanel`)

Lê o snapshot e assina Realtime (não `setInterval`). Clique abre painel lateral
por cima, sem redirecionar.

## Rollback

Menos de 1 minuto, na ordem:

```sql
select cron.unschedule('wa-risco-tick');
drop function if exists public.wa_risco_tick();
drop function if exists public.wa_gate_envio(text,text,text,boolean);
drop function if exists public.wa_instancia_alternativa(text,text);
drop table if exists public.wa_instancia_risco, public.wa_envio_contador,
                     public.wa_texto_usado, public.wa_risco_config;
drop index concurrently if exists idx_wam_inst_lower_created;
```

Edge function: `index.v29.rollback.ts` é o espelho fiel da v29 deployada.

Sem tudo isso, o sistema volta exatamente ao comportamento de hoje: envia sem
freio nenhum.

## Achado em produção: o teto está sendo gasto por notificação interna

Olhando `wa_envio_contador` e `wa_texto_usado` no dia do deploy:

| Instância | Números novos hoje | Envios |
|---|---|---|
| Luiz Abraci | 16 | 16 |
| Atendimento Previdenciário 2 | 9 | 9 |
| Raym | 7 | 7 |

E o conteúdo em `wa_texto_usado` é quase todo **aviso interno para a equipe** —
`📌 Nova atividade sua`, `🚨 Um cliente precisa de você agora`. Ou seja: o teto
diário de 40 números novos, que existe para limitar **abordagem a estranho**,
está sendo consumido por robô avisando colega de trabalho.

Não é urgente (16 de 40), e cada colega custa uma vaga só na primeira vez que
aquela instância fala com ele — depois é `CONVERSA_EM_ANDAMENTO` e passa livre.
Mas está errado em princípio, e num dia de muita atividade pode barrar envio de
cliente por causa de notificação interna.

**Conserto proposto, ainda não feito:** os disparos automáticos de notificação
(`notify-activity-created` e companhia) passarem `ignore_ritmo: true`, que já
existe na v30 e deixa rastro no log. Alternativa mais estrutural: o gate não
contar destino que seja telefone de membro da equipe.

## O que este sistema NÃO faz

- Não confirma banimento. Só a UazAPI/WhatsApp sabe; aqui se mede silêncio e
  comportamento. "PROVAVELMENTE BANIDA" é hipótese forte, não carimbo.
- Não distingue mensagem enviada do celular da enviada pelo sistema no freio.
  O campo existe (`metadata->'message'->>'source'`: `web` = sistema,
  `android` = celular do operador) e ainda não é usado na pontuação.
- Não reescreve sozinho. A IA propõe 3 variações e **quem escolhe é a pessoa** —
  nada sai sem alguém clicar. O gate só acusa a repetição; quem redige é o
  `ai-text-editor` chamado pelo painel (ver seção 4).
- Todo o outbound do Mateus tem assinatura de origem `unknown` (id de 20
  caracteres), diferente de todas as outras instâncias. Não sei o que gera
  isso. Investigação em aberto.
