# Módulos Comunicação e Gestão

Documentação funcional de WhatsApp, chat da equipe, campanhas, relatórios IA, equipe, analytics, financeiro, configurações, notícias e ligações. Rótulos entre aspas são o texto exato exibido na interface.

---

## WhatsApp — `/whatsapp`

**Propósito**: inbox unificada do escritório — atende conversas de várias instâncias (UazAPI) e do número oficial Meta (WhatsJUD API), com criação de lead/contato/caso a partir da conversa e apoio de IA.

### Cabeçalho
- Abas "WhatsApp" / "WhatsJUD API" — alternam entre instâncias UazAPI e o número oficial Meta.
- Chip de status Cloud (Conectado/Offline) — checa o token do número Meta.
- Seletor de instância ("Todas conectadas" + lista) — filtra conversas por número.
- "QR / Código" / "Reconectar" — pareia ou reconecta a instância.
- Ícones: Lote (seleção em lote → "Criar Leads em Lote"), Compartilhadas comigo, Google Workspace, importar contatos (Google/WhatsApp), "Contatos", Dashboard de leads, atualizar, Configurações.

### Painel da conversa
- "Abrir WhatsApp", abrir ficha do lead, "Mudar etiqueta no WhatsApp e etapa no Kanban", ficha do contato, "Ligar via CallFace".
- Menu de criação: "Vincular Lead", "Criar Lead + Contato", "Criar Caso Jurídico", "Atualizar com IA" (extrai e preenche campos a partir da conversa).
- Por mensagem: "Copiar texto", "Sugerir resposta a esta mensagem com IA", "Comentar" (leva a mensagem citada para o chat interno da equipe), "Criar atividade a partir desta mensagem".
- **Mensagem que virou atividade fica marcada**: criada a atividade a partir de uma bolha (ou de várias, pelo checkbox → "Criar atividade"), a mensagem de origem ganha o selo "Virou atividade: {assunto}" e clicar nele abre a **ficha completa da atividade no painel lateral**, sem sair da conversa — mesmo comportamento do chat interno da equipe. O vínculo fica em `whatsapp_message_activities` (Externo), carregado por telefone. Fechar o formulário sem criar não marca nada.
  - Com o selo na bolha, a **nota interna "Atividade criada" deixa de ser gravada** — repetia a mesma informação logo abaixo da mensagem. Ela continua existindo quando a atividade nasce fora de uma mensagem (menu do topo) ou quando o vínculo falha: aí é o único registro na conversa.
  - **Filtro "Atividade pendente"** na lista de conversas (chips de filtro): mostra só as conversas cuja mensagem virou atividade **ainda em aberto** (qualquer status ≠ `concluida`). A contagem é carregada uma vez ao abrir a lista e se atualiza quando um vínculo novo é criado.
  - **Caminho de volta**: a ficha da atividade traz "Ver mensagem de origem", que abre a conversa **no painel de baixo pra cima, por cima da ficha** (`DashboardChatPreview`, o mesmo da caixa de pendências) — rola até a bolha e a destaca por 2s; fechar devolve a ficha como estava. Não redireciona (regra permanente `ui-sem-redirecionar`).
  - A inbox completa também aceita `/whatsapp?openChat={phone}&msg={message_id}` com o mesmo destaque. Em grupo, a mesma mensagem chega replicada em cada instância conectada (ids e `external_message_id` diferentes); quando o id não é o da instância aberta, a cópia visível é encontrada pelo próprio vínculo com a atividade.
  - **Não é retroativo**: o vínculo nasce no momento da criação. Atividades criadas antes de 06/08/2026 não têm selo e não há backfill possível — a nota interna antiga não guardava `message_id` nem `activity_id`.
- **O formulário vem preenchido pela IA** (desde 06/08/2026): criar atividade a partir de mensagem usa `chat-to-activity` (Railway) e abre o **formulário completo** (`ActivityFullSheet`) — o mesmo caminho do chat interno da equipe. Antes abria o formulário reduzido do WhatsApp com o texto no campo de ditado (`parse-activity-dictation`), e só o assunto vinha preenchido.
  - Vêm da IA: assunto, tipo, prioridade, "O que foi feito", "Como está" e "Próximo passo" (este nunca fica vazio — no mínimo descreve a própria tarefa). A conversa de origem fica nas observações sob "— Origem: conversa do WhatsApp —".
  - **Assessor**: o sugerido pela conversa vence ("fulano, faz isso"); sem sugestão, fica **quem está criando**. **Prazo**: o citado na conversa vence; sem citação, **hoje**.
  - O formulário reduzido (`WhatsAppActivitySheet`) continua nos caminhos **sem** mensagem de origem — menu do topo da conversa, preview do lead — e como rede de segurança se a IA falhar (aí abre com o texto no ditado, como antes).
- **Dono da conversa** (desde 07/08/2026): no cabeçalho, ao lado do nome, aparece "sua conversa" / "com {primeiro nome}" / "sem dono", com **Assumir** e **Passar** (escolhe outra pessoa da equipe). Existe porque a linha compartilhada não dizia de quem era o papo — e sem isso a pendência do cliente caía em "sem responsável definido" mesmo com alguém claramente atendendo.
  - **Abrir uma conversa órfã já assume ela.** O claim é `insert` (sticky): abrir a conversa de outra pessoa **não rouba** nada. Duas exceções de propósito: **grupo** (dono de grupo é resposta errada — vários processos ali dentro) e o modo **"Todas as conversas"** (quem audita o pool está olhando, não atendendo; sem isso uma passada de gestor viraria dono de tudo que abrisse).
  - **Respondeu na conversa de outra pessoa** → pop-up "Assumir esta conversa?", **uma vez por conversa por sessão**. Responder não transfere sozinho; quem passou a atender precisa dizer que assumiu, senão a pendência continua sendo cobrada de quem saiu do papo.
  - Tabela `whatsapp_cloud_assignees` (PK `phone` + `instance_name`, IDs do **Externo**). Nasceu só no `cloud_gerencia`; desde 07/08/2026 vale para **todas as instâncias** — o mapa do front passou a ser chaveado por telefone+linha (o mesmo telefone pode falar com duas linhas, cada uma com seu dono) e o realtime perdeu o filtro de instância. `ConversationOwnerControl.tsx`; `claimConversation`/`transferConversation` em `useWhatsAppMessages`.
- **Buscar dentro da conversa — texto e data** (desde 07/08/2026): a **lupa** no topo da conversa abre uma barra logo abaixo do cabeçalho (empurra a lista de mensagens, não cobre nada) com campo de texto, botão de **calendário**, setas ↑/↓ para andar entre os resultados e contador ("3 de 12"). `Enter` vai pro próximo, `Shift+Enter` pro anterior, `Esc` fecha.
  - A busca roda no **Externo, filtrada pela própria conversa** (`instance_name` + `phone`, que caem no índice `idx_wam_inst_phone_created`), então **alcança o histórico inteiro** — não só as mensagens já carregadas em memória. Medido no grupo mais pesado do banco (26k mensagens): ~95ms com cache quente. O termo sai realçado nos resultados e também nas bolhas do chat.
  - **Calendário**: escolhido o dia, a lista abre pelas **primeiras mensagens daquele dia**. Com termo digitado junto, filtra o termo dentro do dia.
  - Clicar num resultado **centraliza a bolha e a destaca por 2s** (mesmo flash do deep link da atividade). Uma faixa âmbar mostra "Você está em {data} às {hora}" com **"Voltar ao fim da conversa"**.
  - **Modo âncora** (por que existe): pular pra uma mensagem de meses atrás **não** renderiza tudo desde ela até a mais recente — conversa de 20k mensagens travaria o navegador. A timeline passa a desenhar uma **janela em volta da mensagem**, que cresce conforme se rola pra cima ou pra baixo, buscando no servidor o que falta. Enquanto a âncora está ativa, mensagem nova **não puxa a tela pro fim**. Ao rolar pra baixo, salto de mais de 1h entre a borda da janela e o item seguinte faz pedir a continuação ao servidor antes de avançar — a conversa não pula de data em silêncio.
  - `WhatsAppChatSearchPanel.tsx`; `searchConversationMessages` / `getConversationMessagesAround` / `getConversationMessagesForward` em `external-rpc.ts`; `loadConversationMessagesAround` / `loadConversationMessagesForward` em `useWhatsAppMessages`.
- **Cabeçalho do painel de baixo (`DashboardChatPreview`) mostra nome, não JID** (desde 07/08/2026): grupo é detectado por `isWhatsAppGroupId` — testar só `@g.us` fazia o grupo com **JID bare** (`1203…`, como vem em `whatsapp_messages.phone`) cair no ramo de conversa individual: o título virava o número e o lead vinculado pelo grupo nunca aparecia. O nome sai do `whatsapp_groups_cache` (nome atual, sincronizado da UazAPI) → nome guardado em `lead_whatsapp_groups` → nome do lead → `Grupo •••771767`. A linha de baixo diz "Grupo WhatsApp • {lead}" ou "sem lead vinculado".
  - **Grupo não casa mais contato por telefone**: o `ilike` dos últimos 8 dígitos do JID colava um contato qualquer (ou o próprio "contato" criado com o JID no campo telefone) no cabeçalho. Agora o contato vem só do `contact_leads` do lead.
  - **Menu de criação avisa o que já existe**: com lead vinculado, "Vincular Lead"/"Criar Lead + Contato" dão lugar a **"Lead já criado • {nome}"** (abre a ficha); idem "Contato já criado" e "Caso já criado • {nº}" (abre o lead na aba Casos). Sem vínculo, os itens de criar seguem como eram.
  - Selo **"⚠ N leads no grupo"** quando o mesmo JID está vinculado a mais de um lead (acontece: as duas grafias do `group_jid` podem apontar para leads diferentes). É aviso, não correção automática.
- Mídia: baixar e "Salvar na pasta do lead no Google Drive" (com classificação por IA).
- Criação de caso pelo WhatsApp: "Preencher com IA a partir da conversa" → "Criar Caso" (cria lead fechado + contato + caso + processos detectados + atividades).

### Grupo é uma conversa só — os espelhos por instância (18/08/2026)

Em grupo, **cada instância-membro grava a sua própria cópia de cada mensagem** em `whatsapp_messages` (~2,6 linhas por mensagem real). Três consequências foram corrigidas em 18/08/2026:

- **O lado da bolha não vem mais do `direction` de um espelho qualquer.** A instância que enviou grava `outbound`; as outras gravam a MESMA mensagem como `inbound`. Como o menu "Grupo WA" das atividades dedupava em ordem crescente (ficava o espelho mais antigo, quase sempre `inbound`) e a aba do WhatsApp em decrescente, a mesma mensagem aparecia de lados opostos: 20% das mensagens de grupo tinham `direction` conflitante entre espelhos (no grupo do PREV 1428, 19 de 24). `dedupeMirroredMessages` (`src/lib/whatsappGroupMirror.ts`) decide por todos os espelhos: é nossa se **algum** é `outbound` **ou** se o autor no `metadata` é o número de uma instância (`whatsapp_instances.owner_phone`, via `getOurInstancePhones`) — este segundo sinal responde por 34% das nossas mensagens, as escritas pelo celular, que não geram espelho `outbound` nenhum.
- **A aba do WhatsApp deixou de mostrar só o pedaço de uma instância.** Cada instância entrou no grupo num momento diferente: em 1.544 pares (grupo, instância) medidos em 11–18/08, 15% enxergavam menos da metade das mensagens e 6% menos de um quinto. `getConversationKey` ignora a instância quando o alvo é grupo (uma conversa na lista, no cache e no realtime) e as leituras de conversa não filtram instância em grupo (`external-rpc.ts`). O badge de não lidas passa a usar a maior contagem entre as instâncias, não a soma, e `markMessagesAsRead` marca em todas.
  - O `limit` das páginas é de **linhas**, não de mensagens: em grupo, 300 linhas rendem ~115 mensagens. Triplicar a página levaria a abertura de um grupo pesado de 1,5MB para 4,2MB de egress (FAMILIA 374, 13.114 linhas); quem rola até o topo puxa a próxima página sozinho. O caminho para baratear é parar de trazer o `metadata` inteiro, que é 80% do payload.
- **O menu "Grupo WA" abre pelo fim da conversa.** Buscava 3.000 linhas em ordem **crescente** — as mais antigas —, então grupo movimentado parava meses atrás sem avisar (a FAMILIA 374 exibia só até 19/05/2026). Agora são 800 linhas da mais recente para a mais antiga, com "Carregar mensagens anteriores", e traz as projeções `metadata->message->>sender_pn/sender_lid/senderName` para exibir quem falou (o jsonb inteiro custaria 7,5x o payload).

**Mensagem enviada para o JID sumia do menu** (corrigido na edge `send-whatsapp` v25, deployada no Externo em 18/08/2026): o alvo do envio pode ser `120…@g.us`, mas a coluna `phone` tem de guardar só dígitos — é assim que o webhook grava e é por essa forma que o menu procura a conversa. Eram 1.505 linhas entre 09/04 e 18/08, todas outbound nossas (~300/mês), vindas de `sendActivityGroupNotification` e `sendVoiceToWa`. `storagePhone` separa o alvo do envio da forma gravada; backfill de 1.548 linhas aplicado (inclui 43 com `@s.whatsapp.net`, de abril).

### Mensagem citada — o "responder" do WhatsApp na bolha (26/08/2026)

Quando alguém responde citando uma mensagem, a UazAPI entrega a resposta com o id da citada em `metadata.message.quoted` (= `content.contextInfo.stanzaID`) e uma **cópia do conteúdo citado** em `content.contextInfo.quotedMessage`. Nada disso era lido: a bolha mostrava só o texto da resposta — que muitas vezes é um "." solto, porque quem responde um PDF ou um áudio escreve só um ponto para apontar o arquivo. Sem o bloco de citação, a mensagem chegava sem contexto e não havia nada para clicar (relato de 21/08/2026 no grupo FAMÍLIA 345, respondendo um PDF de 30/06).

- **A bolha mostra a citação** (`QuotedMessagePreview`): autor, ícone do tipo e prévia — texto, legenda, nome do arquivo, "Mensagem de voz", "Foto", "Localização", "Enquete". A prévia sai do próprio payload, sem ida ao banco. Tipos e desembrulho (efêmera, ver-uma-vez, documento com legenda) em `src/lib/whatsappQuotedMessage.ts`.
- **Clicar leva até a original**, com o mesmo pulo da busca da conversa (`jumpToSearchHit`): rola até a bolha e pisca por 2s. Se a citada está fora do trecho carregado — o normal, porque se cita mensagem de meses atrás —, o id vira `created_at` em `findMessageByWhatsAppId` (`external-rpc.ts`) e o trecho é baixado em volta dela.
- **O id do WhatsApp é a chave, não o uuid da linha.** Em grupo cada instância grava a sua cópia, com uuid próprio; o `stanzaID` é o mesmo em todas. Por isso o alvo do pulo é reprocurado depois do carregamento (a cópia visível pode ser a de outra instância) e a busca no banco monta valores exatos `<owner>:<id>` para `external_message_id` — que tem índice btree —, em vez de um `LIKE '%:id'` que varreria a tabela.
- **Escala e cobertura**: 2.497 de 28.684 mensagens (8,7%) em 24–26/08 são respostas citando alguma coisa; numa amostra de 200, **200 tinham a mensagem original salva no banco** — o clique quase sempre encontra alvo. Quando não encontra, avisa em vez de ficar girando.
- **Não confundir com o anúncio Click-to-WhatsApp**, que também usa `contextInfo` (via `externalAdReply`) mas não cita mensagem nenhuma — segue caindo no card de anúncio.

### Foto de perfil do WhatsApp — conversa, ficha do lead e contatos (26/08/2026)

A **foto de perfil do WhatsApp** aparece na lista de conversas, no cabeçalho do chat, no resumo da **ficha do lead**, na **ficha do contato** e na **lista de contatos**, no lugar do ícone. Quem não tem foto (ou não a expõe) continua no ícone de sempre — nunca fica espaço vazio.

- **A UazAPI entrega a foto em `/chat/details`**: `imagePreview` (96px) com `preview: true`, `image` (original) com `preview: false`.
- **A URL dela NÃO serve para exibir.** O link aponta para `pps.whatsapp.net` com validade assinada no próprio endereço (`oe=<epoch em hex>`). Medido em 26/08/2026 sobre `whatsapp_chat_details_cache`: **9 das 25 fotos mais recentes já respondiam 403** — inclusive linhas gravadas no mesmo dia, porque a UazAPI guarda a URL dela e devolve vencida. Colocar esse link num `<img>` dá foto que quebra em dias, calada.
- **Por isso a imagem é nossa**: `get-whatsapp-avatars` (Railway) baixa o binário, converte para webp 256px (~10 KB) e guarda no bucket **privado** `wa-avatars` do Externo. O front recebe **signed URL de 7 dias**. Bucket público foi descartado de propósito: o caminho seria adivinhável pelo telefone, e foto de cliente é dado pessoal (LGPD).
- **Cache em `whatsapp_avatars`** (Externo, RLS ligada e sem policy — só service role): 7 dias para quem tem foto, 3 dias para quem não tem (o que muda aí é a configuração de privacidade, não a foto). `source_key` é o nome do arquivo na URL do WhatsApp: se não mudou, a imagem não é reprocessada.
- **Instância fora do ar ≠ sem foto.** A `WHATSJUD IA` respondia 503 na medição; se isso virasse `has_photo = false`, a foto de quem tem sumiria da tela por três dias. Falha de consulta não grava nada e volta a ser tentada.
- **Grupo é o ID de 18 dígitos sem `@g.us`** — é assim que o webhook grava `whatsapp_messages.phone`. A chave do cache e da resposta é sempre só dígitos; o `@g.us` é acrescentado apenas na hora de perguntar à UazAPI, que só reconhece grupo pelo JID completo.
- **Custo controlado**: a foto só é pedida quando o avatar entra na tela (IntersectionObserver único), em lotes de até 40 conversas por chamada, com cache em memória + `localStorage`. Sem isso, abrir o inbox com 400 conversas seriam 400 consultas à UazAPI de uma vez.
- **A chave do cache normaliza a instância** (`avatarKey`). Até 27/08/2026 não normalizava na volta: o lote gravava `Raym|55…` e a tela lia `raym|55…`, então **nenhuma foto aparecia na aba do WhatsApp** — e o telefone ficava preso em `inFlight`, sem nova tentativa até recarregar. Ficha do lead e contatos escapavam porque mandam a instância vazia. Travado por teste em `src/hooks/__tests__/useWhatsAppAvatars.test.ts` (com o código antigo, os 4 casos falham).
- **A foto fica salva entre sessões**: `localStorage` (chave `wa_avatars_v2`, TTL 6 dias) em vez de `sessionStorage`, e o arquivo sobe ao bucket com `cacheControl: '604800'` (7 dias). Antes ia sem isso e valia o default de 1 hora do Storage, então o navegador rebaixava a mesma imagem quase toda abertura. **A signed URL não devolve `Cache-Control`** — o gateway traduz o prazo em `Expires` (+7 dias) com `ETag` e `Last-Modified`; para conferir se um objeto tem o prazo certo, olhe `metadata.cacheControl` no `storage/v1/object/list`, não o header.
  - `refresh: true` reenvia a imagem mesmo quando a foto não mudou — é o único jeito de corrigir arquivo antigo. Usado em 27/08/2026 para refazer as **73 fotos** que já estavam no bucket sem prazo de cache (`fetched: 73`, `failed: 0`).
- **A instância é opcional.** A aba do WhatsApp sabe de qual instância é a conversa; a ficha do lead e a lista de contatos só têm o telefone. Sem ela, o servidor pergunta a quem já trocou mensagem com aquele número (`whatsapp_messages.phone`, que tem índice) e lê o cache por telefone em qualquer instância — assim a foto que a aba do WhatsApp já baixou serve para a ficha sem gastar chamada nova.
- **Só instância conectada é consultada.** `whatsapp_instances.is_active` é `true` nas 26 cadastradas, inclusive nas desligadas: medido em 26/08/2026, **8 respondiam `connected`, 14 `disconnected` e 4 devolviam 401**. Antes desse filtro, pedir a foto sem instância caía em instância morta e voltava "sem foto" para todo mundo. O estado é sondado (`/instance/status`) no máximo a cada 5 minutos, e a busca tenta até 3 instâncias por telefone.
- **Link vencido na origem** (a UazAPI às vezes devolve URL já expirada) mantém a foto anterior e reagenda a tentativa para **1 hora**, não para o TTL cheio.
- **Teto na lista de contatos**: abaixo de `ENRICH_LIMIT` (300 linhas, o mesmo teto das etiquetas) a foto só aparece se já estiver em cache — rolar 36 mil contatos buscando foto seria uma consulta por linha.
- **Dentro do grupo, cada mensagem mostra a foto de quem falou** (27/08/2026), fora da bolha e alinhada ao nome, como no WhatsApp. Clicar na foto abre a ficha do participante no painel lateral — o mesmo destino do nome. Participante ainda não identificado (só `@lid`, sem telefone no roster) fica no círculo com ícone: o alinhamento das bolhas não depende de ter foto. Vale na aba WhatsApp (`WhatsAppChat`) e na prévia do dashboard/ficha (`DashboardChatPreview`, avatar menor).
  - Medido em 27/08/2026 num grupo de 18 remetentes: **3 de 8 participantes consultados tinham foto**, `failed: 0` e `unreachable: 0` — quem aparece sem foto é privacidade do próprio contato, não falha nossa.
  - Custo: os participantes entram no mesmo lote de 40 e no mesmo cache de 7 dias dos contatos, então a foto do cliente que já apareceu na lista de conversas não é buscada de novo dentro do grupo.
- Arquivos: `railway-server/src/functions/get-whatsapp-avatars.ts`, `src/hooks/useWhatsAppAvatars.ts`, `src/components/whatsapp/WhatsAppAvatar.tsx`.

### Chat interno da equipe dentro da conversa (botão "Equipe")
- Botão **"Equipe"** no topo da conversa abre/fecha o chat interno sobre aquele cliente — coluna própria no desktop, painel deslizante em tela estreita. O cliente não vê nada do que é escrito ali. O estado (aberto/fechado) fica salvo por navegador; ao fechar, um aviso lembra que a reabertura é nesse mesmo botão.
- `@` no campo lista os membros e traz **"@todos"** no topo (avisa a equipe inteira). Escrever `@todos`, `@equipe` ou `@todas` na mão tem o mesmo efeito.
- **Quem cuida do caso vem primeiro no `@`**: acima da equipe aparece o bloco "Quem cuida deste caso" com os **responsáveis** e o **acolhedor**, cada um com o selo do papel ao lado do nome — dá pra acionar a pessoa certa sem abrir a ficha.
  - **O responsável é do processo**, não do caso: cada processo pode ter o seu (`lead_processes.responsible_user_id`). No chat do lead/caso/conversa aparece **um item por responsável, com o processo dele embaixo do nome** ("Seguro de vida judicial"); quando todos os processos são da mesma pessoa vira um item só ("3 processos"). No chat de um processo (ou da atividade dele) aparece só o responsável daquele processo.
  - Processo **sem responsável próprio** usa o responsável processual do lead (`leads.processual_responsible_id`) e o item mostra "herdado do caso". Hoje só 172 de 1.727 processos têm responsável próprio preenchido.
  - **Acolhedor** vem de `leads.acolhedor`, que é texto livre; quando é apelido genérico ("Atendimento Previdenciário") ou não casa com um usuário, o nome aparece rotulado mas sem virar menção.
  - Vale em todo chat interno com caso por trás: ficha do lead, do processo, do caso, da atividade e a conversa/grupo do WhatsApp (o grupo é ligado ao lead por `lead_whatsapp_groups`).
- **Quem é marcado com `@` ganha acesso a esta conversa do WhatsApp** e é notificado — inclusive quando a instância não é dele. Com "@todos" isso vale para todo mundo, e o sistema avisa quantas pessoas serão liberadas antes do envio. O acesso é revogável no diálogo de compartilhamento.
- **Comentar mensagem do cliente**: "Comentar" numa bolha (ou o checkbox de seleção → "Comentar com a equipe", para várias de uma vez) cola as mensagens citadas no rascunho do chat interno, com autor e hora. Transcrição de áudio entra como texto; citação acima de 400 caracteres é cortada com "…". Na mensagem enviada, o trecho citado aparece em bloco separado com barra lateral.

### Pendências do cliente — "Cliente ficou de" (desde 05/08/2026; leitura por IA desde 06/08/2026)

Barra logo abaixo do "Progresso" do POP, dentro da conversa: **o que o CLIENTE ficou de fazer**. Quem monta a lista é a **IA lendo a conversa** — avaliar o escritório no Google, gravar o vídeo de depoimento, mandar um documento, comparecer na perícia. Antes disso não existia registro nenhum: atividade é tarefa do assessor e checklist é passo de POP; a promessa do cliente não tinha onde morar, e ninguém ia parar no meio do atendimento pra cadastrar à mão.

- **A IA lê e registra sozinha.** Ao abrir a conversa, `detect-client-commitments` (Railway) varre as últimas 120 mensagens, identifica as promessas do cliente e grava. Na mesma passada ela devolve o **resumo do contexto** (3–5 frases: o que o cliente pede, em que pé está, o que trava agora) e marca o que **já foi resolvido**. O título sai **com as palavras da conversa** ("Mandar a carteira de trabalho", "Levar o laudo na perícia do dia 12") — não existe lista fechada de tipos; `kind` é rótulo livre que a IA escreve.
- **Custo controlado por cache**: `lead_client_commitment_scans` guarda a última mensagem já analisada por conversa. Reabrir a mesma conversa sem mensagem nova **não gasta chamada de IA**. "Reler a conversa" no painel força a varredura (`force: true`).
- **Resumo da conversa** no topo do painel — fica em `lead_client_commitment_scans.summary`, então quem abrir depois lê o contexto sem esperar nova análise. Resposta vazia da IA **não apaga** o resumo bom da varredura anterior.
- **"Já resolvidas"** (seção aberta por padrão): promessa cumprida dentro da conversa nasce com `status='feito'` e `done_by_name='IA (visto na conversa)'`; pendência que já estava aberta e que a conversa mostra cumprida é **fechada** na varredura seguinte (`closed` na resposta) — sem isso o dedup barraria o insert e ela ficaria eternamente aberta na tela.
- **O que a IA NÃO registra**: tarefa do escritório (protocolar, dar retorno) e promessa vaga (confiança < 0,5 é descartada antes de gravar).
- **Erro aparece com o motivo**: falha de leitura mostra o que houve (função ainda não publicada no Railway, IA fora do ar). `success:false` com HTTP 200 também conta como falha — antes o painel dizia "nada em aberto" quando na verdade a análise nem tinha rodado.
- **Não duplica, nem com outras palavras**: além do índice único por alvo + título (`lcc_dedup_idx`), a gravação compara por **semelhança de palavras-chave** (Jaccard ≥ 0,7, ignorando verbo genérico e artigo). "Fazer a visita do caso do Morumbi" e "Realizar a visita do caso do Morumbi" contam como a mesma — foi o que apareceu em produção em 06/08/2026, seis pendências com duas repetidas. Já "visita do Morumbi" × "visita de Itatiba" seguem separadas. Regra em `src/lib/clientCommitments.ts` (`isSameCommitmentTitle`, com testes), espelhada na função do Railway; o registro manual avisa "já existe uma pendência parecida" antes de gravar.
- **Aviso ao entrar na conversa**: com pendência em aberto, o painel abre sozinho **uma vez por conversa por sessão** — a barra no topo passava despercebida no meio do atendimento. O checkbox "Avisar ao abrir uma conversa com pendência em aberto" desliga o comportamento (preferência por navegador, `wa-commitment-alert`).
- **"Atividade"** no card cria a tarefa do escritório para tratar da pendência: abre o mesmo formulário de "Criar atividade a partir desta mensagem", já preenchido com o título, a fala do cliente e o prazo. A pendência (do cliente) e a atividade (do assessor) seguem separadas — uma não vira a outra.
- **"Não era"** (só em pendência da IA): marca `status='descartada'`, some da tela e a IA não registra aquilo de novo. É a correção quando ela entende errado — diferente de "Desistiu", que é o cliente desistindo de verdade.
- **"Feito" pergunta QUEM resolveu** — a instância é compartilhada (a de atendimento tem 42 pessoas com acesso), então gravar sempre o usuário logado apagava quem de fato tratou o cliente. O diálogo já vem **pré-selecionado com quem falou por último na conversa**: `whatsapp_messages` não guarda autor, mas o envio com "Identificar remetente" prefixa o texto com `*Nome:*`, e é daí que sai a identificação (`src/lib/whatsappSenderName.ts`, 13 testes). Nome abreviado casa por primeiro + último ("Ana Souza" → "Ana Carolina Moreira Souza"); **dois membros com o mesmo primeiro+último não casam** — melhor perguntar que chutar. Sem ninguém identificado, o diálogo abre vazio e obriga a escolher. Grava em `done_by`/`done_by_name`.
- Por item: **Feito**, **Cobrar**, **Desistiu**, **Não era**, **Reabrir**, excluir. **"Cobrar" não envia nada**: **escreve o texto no campo de mensagem** pro assessor revisar e enviar. O texto é escolhido por palavra-chave do título/kind, já que o tipo é livre.

##### Cobrança responde a promessa e vira histórico (desde 12/08/2026)

O card só dizia "cobrado 3x". Não dava para saber **quando** cada cobrança saiu, **quem** mandou, **o que** foi dito, nem **qual bolha** da conversa era a cobrança — e o contador subia no **clique** do botão, então "cobrado 3x" podia ser três rascunhos que ninguém enviou.

- **"Cobrar" arma, não conta.** O texto vai pro campo e aparece a faixa **"Cobrando: \<pendência\>"** acima do input (com o trecho da promessa e um X que cancela). Nada é gravado até a mensagem sair.
- **A cobrança sai respondendo à promessa**, igual ao "responder" do WhatsApp: o envio leva `replyid` = `external_message_id` da mensagem que a IA marcou como origem (`source_message_id`). Sem mensagem de origem em mão, sai como mensagem normal e a faixa avisa.
- **Histórico por pendência** em `lead_client_commitment_reminders` (Externo, RLS `authenticated` como as demais): data, quem cobrou, texto enviado, id da bolha e a mensagem citada. O card lista as cobranças e cada uma tem **"ver na conversa"**, que pula até a bolha (mesmo modo âncora da busca).
- **Selo na bolha**: a mensagem enviada ganha **"Cobrança: \<pendência\>"**, do mesmo jeito que a mensagem do cliente ganha "Virou pendência".
- Vale na conversa completa (`WhatsAppChat`) e no painel de baixo do dashboard (`DashboardChatPreview`), que compartilham o `CommitmentItemCard`.
- Infra: `sendMessage` (`useWhatsAppMessages`) ganhou um extra opcional `{ replyid, onSent }`; a edge **`send-whatsapp` do Externo foi para a v24** — repassa `body.replyid` para a UazAPI (texto e mídia) e devolve `external_message_id`. A fonte dela passou a ser versionada em `supabase/functions/_external/send-whatsapp/index.ts` (antes só existia no Supabase); **rollback = apagar os dois blocos marcados `v24` e redeployar**. Migration `20260812120000`.
- **Registro manual continua**, escondido atrás de "Adicionar à mão" — é exceção, não o caminho principal. Na bolha, o botão "Pendência" abre esse formulário já com a mensagem citada.
- **Prazo é opcional e sem prazo nunca vence** — a maioria das promessas do WhatsApp não tem data. Vencida = em aberto com prazo anterior a hoje.
- Tabela `lead_client_commitments` (Externo, RLS + realtime): conversa sem lead também controla pendência (`lead_id` OU `phone`+`instance_name`, garantido por CHECK). Marcação feita por outro assessor aparece na hora via Realtime.
- Código: função `railway-server/src/functions/detect-client-commitments.ts`; regras puras em `src/lib/clientCommitments.ts` (13 testes); dados em `src/hooks/useClientCommitments.ts`; UI em `ClientCommitmentsBar.tsx` / `ClientCommitmentsPanel.tsx`. Migrations `20260805140000`, `20260806120000` e `20260806140000`.
- **Ainda não existe** (fase 2): pendência vencida virando atividade de cobrança do responsável, e varredura em segundo plano das conversas que ninguém abriu.

#### Caixa de pendências — "📌 Pendências" (desde 06/08/2026)

Botão no cabeçalho de **Atividades**, ao lado de "💬 Feedbacks", com deep-link `?pendencias=1`. Mesmo formato do funil de feedbacks, porque o problema é o mesmo: dívida espalhada que ninguém vê se não for procurar. **Tira a dependência de alguém lembrar de abrir a conversa.**

- Duas visões: **Calendário** (padrão — mês com a contagem por dia, dia com pendência vencida em vermelho, hoje já vem selecionado) e **Lista** (agrupada por urgência: Vencidas, Hoje, Amanhã, Próximos 7 dias, Mais para frente, Sem data).
- **Sem prazo marcado, a pendência entra pela data em que foi combinada** — a maioria das promessas de WhatsApp não tem data ("depois eu te mando"), e sem esse fallback a lista por data ficaria vazia.
- Filtros: **Todas** / **Só as minhas** (sou responsável pelo caso) / **Sem responsável definido** (o balde que ninguém cobre hoje) / **Viraram atividade**, **por pessoa da equipe** (ver abaixo), mais busca por cliente ou pendência.
- Por item: **Feito** (pergunta quem resolveu, pré-selecionando o responsável do caso — fora da conversa não dá para saber quem falou por último), **Abrir conversa** (abre a conversa no **painel de baixo** — com as mesmas peças da conversa completa: progresso do POP, barra "Cliente ficou de" com a lista de pendências e o chat interno da equipe —, sem sair da caixa — a lista sai da frente e volta sozinha ao fechar; empilhar o Drawer sobre o Sheet deixaria dois modais disputando foco e trava de rolagem. Dentro dele, "abrir no WhatsApp" leva à inbox completa quando for preciso o resto das ferramentas) , **Gerar atividade** e **Não era** nas detectadas pela IA.
- **"Gerar atividade" (desde 07/08/2026)** — mesma saída que já existia no painel de dentro da conversa, agora também na caixa: abre o formulário normal de atividade (`ActivityFormCompact`, sem subformulário paralelo) já preenchido — título `Pendência do cliente: …`, lead e contato vinculados, responsável = dono resolvido pela view (UUID do Externo → Cloud via `remapToCloud`) e observações com a pendência, a frase do cliente e o prazo combinado. **Prazo nunca nasce no passado**: usa o combinado só se for futuro, senão hoje — pendência vencida se trata hoje, e atividade nascer atrasada estraga o indicador. A caixa fecha ao abrir o formulário, como no funil de feedbacks (dois Sheets abertos disputam foco). Handler `openActivityFromCommitment` em `ActivitiesPage.tsx`.
- **"Interna" agora aparece mesmo com cliente vinculado** — o botão vivia dentro do bloco que só renderiza quando NADA está vinculado (`ActivityFormCompact.tsx`), então toda atividade aberta a partir de um cliente (pendência, lead, conversa) ficava travada no **POP obrigatório** (`ActivitiesPage.tsx`: `!formWorkflowId && !formIsSystem && !formIsManagement` → "Selecione um POP para continuar") sem nenhuma saída na tela. "Interna" não é vínculo: é o que dispensa o POP. Lead/Caso/Contato continuam só quando nada está vinculado. Marcar interna com lead junto é aceito (`useLeadActivities`: a flag é **alternativa** ao vínculo, não exclusiva) e não filtra o telão — só acrescenta "Reunião" à lista de tipos.
- Fonte: view `vw_client_commitments_owner` (Externo, `security_invoker`), que resolve o dono com a **mesma cascata do telão** — a regra deixou de ser duplicada dentro da função `tv_atividades_ranking`, que agora lê a view. Conferido na troca: números por pessoa idênticos.
- Regras puras em `src/lib/clientCommitmentsInbox.ts` (19 testes); dados em `useClientCommitmentsInbox`; UI em `ClientCommitmentsInbox.tsx`. Migration `20260806220000`.

##### A caixa lê TODAS as abertas, e a data é a da promessa (desde 12/08/2026)

Sintoma: o telão cobrava **1 pendência faltando** da Andressa e a caixa dizia **"nenhuma"**. Dois defeitos independentes, os dois em torno de data.

- **Teto escondia linha.** A caixa lia `limit(500)` ordenado por `due_date` com nulos no fim. Em 12/08/2026 havia 691 abertas, 462 **sem prazo**: as 229 com prazo entravam e sobravam 271 vagas para 462 — **191 nunca chegavam à tela**, e o corte caía justamente nas sem prazo, que a própria tela posiciona por `promised_at`. O telão lê a mesma view **sem teto**, daí a divergência. Agora lê em páginas de 1000 até esgotar (teto de segurança 5000); o badge de vencidas passou de 143 para 567 — não era regressão, era backlog escondido.
- **`promised_at` era a data da varredura.** A coluna é `DEFAULT now()` e `detect-client-commitments` nunca a preenchia: **100% das 1174 pendências da IA** nasceram com `promised_at = created_at`, deslocamento médio de **26,9 dias** (pior caso 162). Promessa de 20/07 varrida em 10/08 aparecia no dia 10/08. Agora sai do timestamp da mensagem da promessa.
- **Mensagem de origem por número, não por UUID.** O `promised_at` depende de saber QUAL mensagem originou a pendência, e a IA errava ao copiar 36 caracteres — 46% das linhas ficavam sem `source_message_id`. O transcript numera as mensagens (`#1`, `#2`, …) e a IA devolve só o número; se falhar, cai para o UUID cru e depois para casar o `quote` (literal) no texto das mensagens. O log de cada varredura mostra `com_origem=` e `com_prazo=`.
- **`due_date` resolve pela data da mensagem, não por hoje.** O prompt mandava resolver "amanhã"/"sexta" por hoje, mas a varredura roda dias depois — "amanhã" dito em 03/08 virava data errada. O transcript passou a trazer a data em `AAAA-MM-DD` (em `dd/mm/aaaa` a IA troca dia por mês). Marcador brando ("mais tarde", "semana que vem") passou a valer; **"quando puder" e "te mando depois" continuam sem prazo** — a amostra mostra que a maioria das promessas não tem data mesmo, e prazo inventado vira cobrança errada.
- Verificado em produção (deploy `fc308a3a8`): pendências novas nasceram com `promised_at` igual ao timestamp da mensagem (11/08 12:29:58 e 10/08 21:54:30), com a varredura em 12/08 17:25.
- **Histórico corrigido em 12/08/2026** com `UPDATE … SET promised_at = m.created_at FROM whatsapp_messages m WHERE m.id::text = c.source_message_id`: 639 linhas (387 abertas), conferido depois com 641 batendo e 0 divergentes. A promessa mais antiga da base passou a aparecer em 02/03/2026 — estava posicionada como recente. **Backup em `zz_lcc_promised_bkp`** (id, promised_at, source_message_id, backup_at — a tabela inteira, 1179 linhas); rollback = `UPDATE lead_client_commitments c SET promised_at = b.promised_at FROM zz_lcc_promised_bkp b WHERE b.id = c.id`. As 535 linhas sem `source_message_id` seguem com a data da varredura — não há de onde tirar a data delas.

##### De quem é a pendência — cascata de 5 degraus (desde 07/08/2026)

Em 07/08/2026, 207 das 256 pendências abertas apareciam como "sem responsável definido": a cascata só olhava lead/processo, e quem é **parceiro/acolhedor** não tem processo nem assessor atribuído — sumia da cobrança mesmo com a conversa rodando numa linha com dono conhecido.

Ordem atual (o primeiro que existir), em `20260807120000_owner_por_conversa_e_instancia.sql`:

1. responsável do processo mais recente do lead
2. responsável processual do lead
3. último assessor que trabalhou o lead
4. **dono da conversa** (`whatsapp_cloud_assignees`, por telefone+linha)
5. **dono da instância** (`whatsapp_instances.owner_user_id`)

Os degraus novos entraram **depois** dos três antigos de propósito: nenhuma pendência que já tinha dono mudou de dono (os 8 donos anteriores mantiveram contagem idêntica). Resultado medido: 207 → 176 sem dono. Os IDs das duas tabelas são do **auth Externo** (mesmo espaço de `assigned_to`) — não passam por `auth_uuid_mapping`.

**Grupo fica de fora**: 193 das 207 sem dono são conversas de grupo (174 só na instância "Atendimento Previdenciário"). Grupo tem vários processos falando no mesmo lugar, então "dono do grupo" responde a pergunta errada — a atribuição em grupo precisa ser por pendência, não por conversa, e ainda não existe.

**Nome do responsável**: `owner_user_id` vem do Externo e a lista de nomes vem do Cloud. Sem passar pelo remap (`remapToCloudSync`), quem tem UUID diferente nos dois bancos aparecia como "sem responsável" **tendo dono**. Dono sem nome resolvido mostra "responsável não identificado" — não é o mesmo que órfã.

##### Filtrar por membro, com a conta de cada um (desde 07/08/2026)

Dava para ver "as minhas" e "sem responsável", nunca **quanto cada pessoa está devendo** — a pergunta "quem está com o quê" só se respondia abrindo pendência por pendência.

O filtro do topo virou **combobox com busca** (`Popover` + `Command`, mesmo padrão de `AcolhedorCombobox` e `HearingMemberPicker`), com as opções fixas no topo e, abaixo, **uma linha por pessoa que tem pendência**, com o total e as vencidas em vermelho. Digitar filtra pelo nome — com a equipe inteira na lista, rolar até o nome é mais lento que digitá-lo.

- **Só quem tem pendência aparece**: listar a equipe inteira com zero é ruído.
- **A contagem sai da fila de cobrança inteira, nunca da lista exibida** (`countByOwner` em `clientCommitmentsInbox.ts`, 5 testes). Se saísse do resultado do próprio filtro, escolher um membro zeraria o número de todos os outros — e o filtro deixa de mostrar para onde ir em seguida. Só a busca por texto afeta os números.
- **O id entra no `value` do `CommandItem` junto do nome** (`"<nome> <uuid>"`): o cmdk filtra pelo `value`, então uuid puro não casaria com o nome digitado, e nome puro fundiria dois homônimos num item só.
- Dono sem nome resolvido vira `Não identificado #<4 primeiros do id>` — sem o sufixo, várias pessoas diferentes viravam uma linha só.

Medido na entrada (07/08/2026, 386 abertas): **266 (69%) sem responsável**; depois, Maria Lydia 36, Keliane 23, Analyne 13, Vanessa 12, João Manoel 11, Raym 7, Martin 5, e mais 8 pessoas com ≤3. O filtro por pessoa só alcança o terço com dono atribuído — o gargalo é a cascata, não a interface.

**Os dois números de "vencida" da tela são definições diferentes, não bug**: o selo do topo conta prazo estourado (`due_date < hoje`, 58 na medição); o grupo "Vencidas" da lista conta pela data efetiva, que cai no dia em que foi combinada quando não há prazo (215). `isCommitmentOverdue` é a primeira; `bucketOf`/`commitmentDate`, a segunda.

##### Virou atividade + troca de responsável (desde 07/08/2026)

Duas lacunas que a equipe apontou usando a caixa:

- **"Gerar atividade" não fechava o ciclo.** O botão só pré-preenchia o formulário; nada registrava que aquela pendência já estava sendo tratada, então ela reaparecia no dia seguinte para quem tinha acabado de abrir a tarefa. Agora, ao **salvar** a atividade, `lead_client_commitments.activity_id` + `converted_at` são gravados (`linkCommitmentToActivity` em `ActivitiesPage.tsx`, origem guardada em ref porque o salvamento é assíncrono). A caixa avisa "Pendência virou atividade e saiu da cobrança", ela sai da fila e passa a viver no filtro **"Viraram atividade"**, com o botão **Ver atividade** abrindo a ficha em **aba lateral** (`openActivityById`, sem redirecionar; busca no banco quando a atividade não está na lista carregada).
  - A pendência **não** é fechada: o cliente continua devendo o que prometeu. O que muda é que existe tarefa nossa cuidando disso — por isso sai da cobrança, e não da base.
  - `activity_id` tem FK `ON DELETE SET NULL`; `isCommitmentConverted` olha `converted_at` também, senão apagar a atividade devolveria a pendência para a fila como se nada tivesse acontecido.

- **Responsável era 100% derivado.** Dava para corrigir o dono do caso ou da linha, nunca o de UMA pendência. Entrou a coluna `assigned_to` (UUID do Externo, mesmo espaço de `lead_activities.assigned_to`) como **degrau 0** da cascata acima. Na UI, o texto "responsável: …" do card é clicável (e há o botão **Responsável**) → dialog com a equipe e **"Voltar ao automático"**, que zera `assigned_to` e devolve a pendência para a cascata. Escrita por `setAssignee`; o hook **relê a linha da view** depois de gravar, em vez de adivinhar o dono no JS — a cascata mora no banco e não pode ser repetida no front.
  - Efeito visível: `tv_atividades_ranking` lê a view, então trocar o responsável move a contagem de pessoa no telão.

Migration `20260807170000_pendencia_vira_atividade_e_responsavel.sql`. A view precisou de `DROP` + `CREATE` (ela expande `c.*`, e `CREATE OR REPLACE` recusa coluna nova no meio). Conferido depois de aplicar: 404 abertas / 267 sem dono, **idêntico ao antes** — nenhuma pendência mudou de dono ao subir.

##### Mesmas ações dentro da conversa + nome da conversa na lista (desde 07/08/2026)

- **A pendência tem as mesmas ações nos dois lugares.** Pelo chat só havia Feito / Cobrar / Desistiu / Não era: quem percebia o dono errado ou queria abrir a tarefa tinha que sair da conversa e ir na caixa. O `useClientCommitments` (da conversa) passou a ler a **mesma view** `vw_client_commitments_owner` da caixa — daí vêm `owner_user_id`, `activity_id` e `converted_at`, que a leitura crua da tabela não tinha. Escrita continua na tabela (a view é só leitura) e o patch faz **merge** para não perder as colunas que só a view devolve.
  - Card do chat agora tem: **responsável clicável**, botão **Responsável**, **Gerar atividade**, selo **"Virou atividade do escritório"** e **Ver atividade** (aí "Gerar atividade" some — duas tarefas para a mesma promessa era o efeito antigo).
  - "Gerar atividade" pelo painel de baixo abre o formulário já preenchido (título `Pendência do cliente: …`, prazo combinado só se for futuro, responsável = dono resolvido, contexto nas observações) e, ao **salvar**, grava `activity_id` + `converted_at` — mesmo fechamento de ciclo da caixa. `WhatsAppActivitySheet` ganhou `defaultTitle` / `defaultNotes` / `defaultDeadline` / `defaultAssignedTo`; o responsável sugerido vence o usuário logado.
  - A troca de responsável virou peça única (`CommitmentAssigneeDialog.tsx`), usada pelo painel de baixo e pelo chat completo. `markConverted` / `setAssignee` em `useClientCommitments`.

- **A lista mostra o nome do grupo/contato, não o JID.** Sem lead vinculado a caixa exibia `120363412904771767` como cliente. `useConversationDisplayNames` resolve **em lote** (uma query por fonte): cache de grupos da UazAPI → nome no vínculo → contato; sem nada, `Grupo •••771767`. Casa por dígitos, então serve para as duas grafias do JID. Medido em 07/08/2026: das 171 conversas com pendência aberta, 133 já tinham `lead_name`, 29 eram grupo sem nome (**28 resolvidos pelo cache**) e 9 individuais (todos casaram em `contacts` por telefone exato). O nome resolvido também entra na **busca** — dá para procurar pelo nome do grupo.
  - Regra pura `conversationDisplayName` em `src/hooks/useConversationDisplayNames.ts` (6 testes, incluindo "nunca contém o JID").

**Fluxo recomendado**: selecionar a instância → abrir a conversa → usar "Sugerir resposta com IA" quando útil → quando o lead avança, "Criar Lead + Contato" e depois "Criar Caso Jurídico"; "Atualizar com IA" completa os campos ao longo do atendimento. Dúvida interna sobre o que o cliente disse: "Comentar" na mensagem e `@` em quem precisa responder — em vez de printar e mandar em outro canal. Promessa do cliente ("vou avaliar", "vou gravar o vídeo") a IA já registra sozinha na barra "Cliente ficou de" — o assessor só marca **Feito**, **Cobra** ou corrige com **"Não era"**.

### Mensagem agendada — escrever agora, sair na hora marcada (25/08/2026)

Escreve no campo do chat e clica no **relógio ao lado do botão de enviar** (ou "Agendar mensagem" no menu do clipe). Escolhe dia e hora — com atalhos "Daqui a 1 hora", "Amanhã 8h", "Segunda 8h" — e, se quiser, a repetição: **todo dia, toda semana** (com os dias marcados: seg/qui, por exemplo), **todo mês** ou **personalizado** ("a cada 3 semanas"). A recorrência aceita fim por data (`repetir_ate`) ou por número de envios (`max_envios`); sem nenhum dos dois, repete sem fim. A janela mostra a frase pronta ("Toda segunda e quinta às 08:00") e os **próximos 4 envios** antes de salvar.

Enquanto houver algo na fila, um chip acima do campo diz quantas e quando sai a próxima — mensagem agendada não pode virar surpresa para quem atende a conversa depois. Cancelar é "tirar da fila" na própria janela: a linha fica com `cancelado_em`, não é apagada.

- **Ela olha a conversa antes de sair** (25/08/2026, ligado por padrão, chave "Não enviar se o cliente responder antes"). Quase toda agendada é cobrança de uma resposta que ainda não veio; se a resposta chegar antes da hora, a cobrança sairia como se ninguém tivesse lido o cliente. A regra é deliberadamente burra e objetiva: **não sai se houver `inbound` na conversa mais novo que o marco** (o mais recente entre agendamento, último envio e última verificação) — `wa_agendada_deve_enviar()`, só leitura, dá para perguntar "esta sairia agora?" em produção sem mandar nada. Sem IA de propósito: a pergunta tem resposta no banco, e um modelo julgando a cada minuto custa, erra calado e não se explica depois. A **última verificação entra no marco** para que uma recorrente pulada uma vez não seja pulada para sempre. Cobrança **única** pulada por resposta sai da fila (`encerrado_motivo = 'respondida'`); recorrente só perde aquela ocorrência. Desligar a chave é o caminho de aviso de audiência, parabéns e lembrete de parcela, que têm de sair mesmo com a conversa ativa. O que aconteceu fica em `ultimo_resultado` e aparece na bolha e na fila.
- **Quem dispara é o banco, não o navegador.** `wa_agendadas_tick()` roda de minuto em minuto no pg_cron do **Externo** e chama a MESMA edge function do envio na hora (`send-whatsapp`) — sem segunda porta de saída para o WhatsApp. A mensagem sai com o computador desligado.
- **O texto vai pronto para o banco**, já com a assinatura `*Nome:*` de "Identificar remetente", montada por `prefixarRemetente` (`src/lib/whatsappSenderName.ts`) — o mesmo trecho que o envio imediato usa desde que foi extraído para lá. Em grupo, `@Fulano` já vai reescrito como `@<número>`, com a lista de marcados. O banco não remonta texto.
- **Atraso não vira enxurrada.** O que venceu há mais de 12 h (tick parado) fica registrado como `pulada` e a recorrência anda para a data seguinte — "bom dia" às 3 da manhã de dois dias depois é pior que não mandar. A mesma regra vale ao recalcular: a próxima data pula tudo que ficou para trás, em vez de despejar os envios perdidos.
- **Saiu ou não saiu**: `whatsapp_agendamento_envios` guarda uma linha por disparo; `wa_agendadas_conferir()` lê a resposta do pg_net e carimba `enviada`/`falhou`. Necessário porque `net._http_response` só guarda ~6 h — sem essa tabela, falha de madrugada não deixaria rastro. HTTP 200 não basta: a `send-whatsapp` responde 200 com `{"success": false}` em instância desconectada.
- **A conta da próxima data existe em dois lugares** — `public.wa_agendada_proximo` (banco, decide) e `proximoEnvio` em `src/lib/mensagemAgendada.ts` (tela, mostra a previsão). Mesmas regras: a hora do dia nunca muda, mês curto encurta o dia (31/01 → 28/02) e a conta é feita em horário de Brasília. Mexeu num, mexa no outro.
- **Não é um `cron.schedule` por mensagem**: job por agendamento vira lixo acumulado e não responde "o que está agendado para este contato?", que é o que a tela precisa mostrar.
- Migration: `supabase/migrations-external/20260825170000_mensagem_agendada_com_recorrencia.sql` (Externo). Tabelas `whatsapp_mensagens_agendadas` e `whatsapp_agendamento_envios`.

### Vincular grupo do WhatsApp ao lead — "Buscar grupos" (ago/2026)

Mesmo dialog (`LeadGroupSearchDialog`) na ficha do lead (campo "Grupos WhatsApp") e na tela de Atividades (botão "Vincular WA"). Dois modos:

- **Por nome** — varre TODAS as instâncias conectadas via `whatsapp_groups_index`. **Não precisa de instância definida.**
- **Por participante** (telefone do lead) — precisa de uma instância concreta, que é quem conhece os grupos daquele número.

**A instância é resolvida pelo próprio dialog** (`resolveLeadSearchInstanceName`, `src/lib/leadSearchInstance.ts`), em cascata: instância que espelha o histórico do lead (cobre ~63% dos leads com atividade recente) → `default_instance_id` do perfil (**só 8 de 4.161 perfis têm o campo preenchido** — parar aqui não resolvia) → instância ativa agora, medida pelo espelho global mais recente e preferindo Atendimento Previdenciário 1/2. Nenhuma resolvida não bloqueia: a busca por nome segue funcionando.

Isto é **leitura**. Para decidir por onde ENVIAR em grupo continua valendo `resolveGroupSenderInstanceName` (só quem tem espelho recente no próprio grupo) — nunca a instância pessoal de quem está logado.

**Quem envia no grupo, hoje** (`src/lib/whatsappGroupInstance.ts`, revisto em 17/08/2026): candidatas são as instâncias que espelharam o grupo **e estão conectadas agora**; entre elas vence a primeira instância **da firma** na ordem da área do caso — **trabalhista sai pela Atendimento Processual**, as demais mantêm Previdenciário 1/2 primeiro; sem nenhuma da firma disponível, o espelho mais recente entre as conectadas; e se nada estiver conectado, o espelho mais recente (comportamento antigo, para não deixar de tentar).

- **Área vem do CNJ, não de coluna de área.** O 5º campo de `NNNNNNN-DD.AAAA.J.TR.OOOO` é o ramo da Justiça (`5` = Trabalho, `4` = Federal, `8` = Estadual), e o lead é considerado trabalhista quando **algum** processo dele é `J=5`. Não use `lead_processes.area`: está **95,6% vazia** (1.797 de 1.880) e o resto é inconsistente ("CIVEL", "CÍVEL", "Cível"). Board também não serve de sinal único — 4,7% dos leads não têm.
- **Conexão é checada** via `check-whatsapp-status` (~0,5s, cache de 60s no módulo). Se a checagem falhar, **ninguém é filtrado**: barrar o envio por causa de uma sonda que caiu é pior que tentar por uma instância possivelmente fora.
- **Incidente que motivou** (17/08/2026): áudio do grupo *Família 293 | Edison x Injeplast* morria com *"WhatsApp instance is disconnected"*. A escolhida era a **Atendimento Previdenciário** por três motivos somados — primeira da lista fixa, **desconectada**, e sem espelhar o grupo havia 6 dias (passando raspando pela trava de 7). A **Atendimento Processual** estava conectada e espelhando o grupo no mesmo minuto, e o lead tem processo trabalhista (`…2025.5.05.0195`). Coberto por `src/lib/__tests__/whatsappGroupInstance.test.ts` com os espelhos e o status reais do dia.
- **Pendência conhecida**: `DashboardChatPreview.tsx` tem uma **cópia própria** dessa lógica (lista fixa de preferidas, sem checagem de conexão) para o envio pelo chat. Não foi migrada — o envio por ali ainda pode cair em instância desconectada.

**Regressão corrigida em 07/08/2026**: a tela de Atividades montava o dialog com `instanceName={undefined}` fixo, então todo "Buscar" caía em *"Instância WhatsApp não definida para este lead"* (o Enter no campo disparava o erro mesmo com o botão desabilitado). A `find-contact-groups` também exigia `instance_name` na busca por nome, onde ele só serve de desempate; hoje ela roda no Externo (rota `external` no `functionRouter`, fallback → Cloud) e só exige instância na busca por participante.

#### Instância morta no índice de grupos (07/08/2026)

`whatsapp_groups_index` identifica quem viu cada grupo pelo **nome** da instância (`instance_name` é parte da PK), e nome de instância removida ou renomeada fica lá para sempre: eram **504 de 27.924 linhas** — "BRUNO DANTAS" (345, congeladas em 24/05) e "Auxílio Maternidade" (159, ainda regravadas pelo webhook). Escolher um desses grupos na busca levava a `instance not found` e roster vazio.

- `get-group-participants` (Railway) **não aborta mais** quando a instância pedida não está cadastrada: segue sem preferida e usa a varredura entre instâncias que já existia ali. Cache e `chat_details` passam a ser gravados sob quem de fato respondeu — grupo com índice desatualizado refaz a varredura, em vez de espalhar o nome fóssil.
- `whatsapp_groups_index.instance_id` (FK para `whatsapp_instances`) é preenchido por trigger case-insensitive; nem a sync nem o webhook precisaram mudar. **`instance_id IS NULL` é a medida do problema** — 504 linhas hoje.
- `search_whatsapp_groups_by_tokens` devolve o nome **vivo** da instância quando o id resolve, e só cai no texto histórico quando ela não existe mais.

Renomear as linhas órfãs para a instância atual **não** é a correção: "Bruno Wenner" (mesma pessoa, instância recriada em 31/07) não alcança aqueles grupos — quem alcança é "Raym". Quem resolve é a varredura, não o nome.

---

## WhatsApp Cloud API (Meta oficial) — canal `cloud_gerencia`

**O que é**: linhas oficiais da Meta, separadas da UazAPI. Cada número é uma linha em `whatsapp_cloud_config` (`instance_name` + `phone_number_id` + `waba_id`), e `instance_name` é o mesmo que vai em `whatsapp_messages`. Hoje existe uma: **`abraci`** — `+55 86 8900-9137`, WABA `458751397321968`, nome exibido ao cliente "ABRACI- Associação Brasileira de Combate…" (o nome é propriedade do número e não muda enquanto ele viver nessa WABA).

### Multi-número (desde 02/09/2026)

Antes existia uma linha só, chamada `cloud_gerencia`, e esse nome vivia hardcoded em ~20 comparações de string. Renomeada para `abraci` (750 linhas: 674 mensagens, 75 atribuições, 1 instância).

- **"É Cloud?" pergunta ao dado**, não à string: `src/lib/cloudApiInstances.ts` (front) e `railway-server/src/lib/cloudInstances.ts` (servidor). O marcador é `whatsapp_instances.instance_token = 'cloud_api_meta'`; a semente cobre os nomes conhecidos e `carregarInstanciasCloud()` acrescenta os cadastrados depois, sem release.
- **Webhook carimba a linha certa**: `value.metadata.phone_number_id` do payload resolve qual `whatsapp_cloud_config` recebeu (cache de 60s). Sem match, cai em `cloud_gerencia`.
- **Envio escolhe a linha pelo `instance_name` da conversa**, não pela "config ativa". `maybeSingle()` ali seria uma bomba: com duas linhas ativas ele **erra**.
- **`WHATSAPP_CLOUD_APP_SECRET` aceita lista separada por vírgula.** Cada WABA pode estar inscrita num App diferente e cada App assina com o seu secret — com um secret só, ligar o 2º número derruba o inbound do 1º com 401, que não aparece em lugar nenhum daqui.

**Seletor de linha** (`/whatsapp-api/conversas`): a barra ganha um dropdown "Todas as linhas" + uma entrada por linha, e ele **só aparece com 2+ linhas** — dropdown de um item é ruído. Com mais de uma linha a caixa abre em "Todas", porque abrir fixado numa esconderia as conversas da outra sem aviso. Quando duas ou mais linhas aparecem na lista, cada conversa ganha um selo cinza com o nome da linha (`rotuloDaLinha`), ao lado do selo azul do dono — sem isso "Todas as linhas" vira uma pilha onde não dá para saber por qual número a pessoa falou. `lockInstanceName` com nome de linha Cloud passou a significar "trava no CANAL Cloud", não naquela linha.

**Para adicionar um número** (ex: Prudêncio Advogados, `prudencio_advogados`): (1) linha em `whatsapp_cloud_config` com `instance_name` — pela tela `/whatsapp-cloud`, no seletor "+ Adicionar linha"; (2) linha em `whatsapp_instances` com `instance_token='cloud_api_meta'`; (3) app secret do App daquela WABA acrescentado à lista (vírgula separa, **trocar derruba a outra WABA**); (4) webhook do App apontando pro nosso Railway.

**A tela de config era singleton, e isso era uma armadilha** (corrigido em 02/09/2026). `whatsapp-cloud-admin` tratava `whatsapp_cloud_config` como linha única em três pontos, e cada um quebrava de um jeito diferente assim que existisse um segundo número:

- `overview` lia com `maybeSingle()`. Medido contra o banco real: com mais de uma linha o PostgREST devolve **HTTP 406 / `PGRST116`**, não a primeira linha — o painel receberia `config: null` e apareceria vazio, como se nada estivesse configurado.
- `save_config` **desativava todas as linhas ativas e inseria outra**. Cadastrar a Prudêncio pela tela desligaria a ABRACI, silenciosamente. É o que já tinha acontecido: a tabela guardava 7 linhas para 2 números, 6 delas mortas, cada uma um "Salvar" anterior.
- `check_meta_status` tinha o mesmo `maybeSingle()`.

Hoje: `overview` devolve `configs` (todas as ativas) e mantém `config` só por compatibilidade com o `WhatsAppApiPage`; `save_config` **atualiza a linha** (por `id`, ou pelo `phone_number_id` quando é a primeira vez) e não toca nas vizinhas; desligar virou ação explícita (`deactivate_config`, com confirmação na tela e só quando há mais de uma linha); `check_meta_status` aceita `phone_number_id` e recusa com `ambiguous_config` em vez de escolher sozinho. A tela ganhou seletor de linha, campo **Nome da linha** e o botão vira "Criar linha" quando é nova.

**Estado das WABAs**: a da ABRACI (`458751397321968`) **não** tem o nosso App inscrito — tem "Dashboard de Marketing Digital" (da BM1) e Kommo; o inbound chega porque o webhook do App da BM1 aponta pra cá. A da WhatsJudd (`1495255778900978`) tem o `BussinesMessagerAPI` (nosso).

**Envio**: front → edge `send-whatsapp` (com `channel: 'cloud'` e `instance_name` da conversa) → Railway `send-whatsapp-cloud`. A edge repassa o corpo verbatim, então campo novo no envio **não exige deploy de edge**.

### Janela de 24h — a regra que faz a tela mentir se ignorada

Fora de 24h desde a **última mensagem do cliente**, a Meta só entrega **template aprovado**. Texto livre é **aceito** pela Graph (devolve `wamid`, HTTP 200) e recusado ~1s depois, num webhook de `statuses` separado, com erro `131047`. Sem tratar isso, a bolha diz "enviada" para mensagem que ninguém recebeu.

- `src/lib/whatsapp24hWindow.ts` — `janelaDeAtendimento(instanceName, mensagens)`. Só se aplica às linhas Cloud; canal sem a regra devolve `aberta: true` e não bloqueia nada. Só inbound reabre a janela — o que **nós** mandamos não conta.
- `WhatsAppChat` mostra aviso âmbar + botão "Enviar template" quando a janela fecha, e um aviso discreto quando faltam menos de 2h.
- `src/lib/whatsappDeliveryStatus.ts` traduz o recibo na bolha (`enviada` → `entregue` → `lida`, ou `não entregue` com o motivo em português). `sent` deliberadamente **não** afirma entrega.

### Templates

- **Listagem para a tela**: Railway `whatsapp-cloud-templates` (read-only). Recebe o `instance_name` da conversa e resolve a WABA por ele; **não** aceita `waba_id` do chamador, para usuário logado não conseguir sondar WABA de terceiro. Template é **por WABA**: oferecer a lista da ABRACI numa conversa da Prudêncio faria a Meta recusar no envio. Devolve **todos** com o status: lista vazia porque tudo está `PENDING` é informação que some se filtrar no servidor.
- **Criação/administração**: Railway `whatsapp-cloud-waba-apps` (ações `templates`, `create_template`, `list`/`subscribe`/`unsubscribe`, `users`, `assign_user`). É função administrativa — **não** expor ao front: `unsubscribe` derruba o webhook da WABA.
- **Envio**: `send-whatsapp-cloud` com `template_name`, `template_language`, `template_params` (preenchem `{{1}}`, `{{2}}`… em ordem). `template_body_text` leva o texto **já renderizado**, que é o que fica gravado em `whatsapp_messages.message_text`; o nome do template fica em `metadata.template`. Sem ele, a conversa mostraria `[template: nome]`.
- Template **não** recebe prefixo de remetente: o corpo é o aprovado pela Meta e qualquer texto a mais faria a bolha mentir sobre o que foi entregue.

**Pegadinhas medidas (02/09/2026)**:
- Rodapé do template tem **limite de 60 caracteres** — estourar devolve `100/2388040` "Character Limit Exceeded".
- Corpo com `{{n}}` **exige** `example.body_text` com um valor por variável, senão a Meta rejeita.
- `allow_category_change: true` faz a Meta **reclassificar** em vez de rejeitar quando discorda da categoria; a categoria que valeu volta na resposta.
- A task `MANAGE` do System User na WABA **já basta** para criar template — não precisa de `MANAGE_TEMPLATES`.
- Só `status: APPROVED` pode ser enviado. Templates existentes: `contato_inicial_atendimento` e `retomada_atendimento` (ambos UTILITY, pt_BR, 2 variáveis: nome do cliente, nome do atendente).

---

## Agentes IA do WhatsApp (Configurações → aba "Agentes IA")

**Propósito**: agentes de IA que respondem conversas automaticamente (texto/áudio), fazem follow-up, discam automaticamente e criam leads por campanha.

- "Novo Agente"; por agente: ativar/desativar, editar, arquivar.
- Editor por abas: "⚙️ Geral" (nome, etapas vinculadas, base de conhecimento), "🧠 IA" (modelo, prompt com construtor por chat, voz/áudio, dividir mensagens), "Assistente", "🤝 Handoff", "⚡ Automações", "⏱️ Tempos" (delay, follow-up, janela de horário, pausa quando humano entra), "📞 Chamadas" (discadora), "📢 Campanhas" (criar lead automaticamente no funil).

**Fluxo recomendado**: "Novo Agente" → Geral (nome) → IA (prompt/modelo) → salvar → reabrir pra configurar etapas, tempos, chamadas e campanhas.

### Etiqueta do WhatsApp como gatilho — cuidado com ID reciclado

O vínculo etiqueta→agente (e →etapa, →resultado, →documento) casa pelo **ID numérico** da etiqueta (`558681595991:29`), gravado em `agent_instance_labels`, `stage_instance_labels`, `result_instance_labels` e `label_document_triggers`.

**O WhatsApp recicla esse número.** Ao apagar uma etiqueta no celular, o número fica livre e a próxima etiqueta criada o herda — junto com o vínculo antigo. Incidente 05/08/2026: "Parceiros SP" herdou o ID 29 da "🤖 Raym_assistente" apagada e passou a ativar a IA em quem recebesse a etiqueta nova.

Proteção desde 06/08/2026 (`railway-server/src/lib/label-name-guard.ts`): antes de agir, o webhook confere na UazAPI se aquele ID ainda se chama o que o banco diz (cache de 60s por instância).
- **agent** e **doc_trigger**: bloqueiam quando o nome diverge (mandam mensagem/documento pro cliente).
- **stage** e **result**: só registram `[label-guard][stage] ID reaproveitado` no log do Railway, sem bloquear — para medir antes de ligar.
- Não deu pra verificar (instância desconectada, timeout): **fail-open**, age como antes.

**Regra prática de operação**: criar etiqueta nova é seguro (pega um número inédito). Apagar uma etiqueta com vínculo e depois criar outra é o que morde. Para limpar etiquetas em massa, zerar antes os mapeamentos das 4 tabelas — `wipe-instance-agent-labels` faz isso, mas só para as de agente.

---

## Chat da Equipe (painel lateral, abas "Menções" e "Chat")

**Propósito**: mensageria interna — conversas diretas, grupo Geral e grupos por time, com áudio, menções a pessoas e a entidades (lead/contato/atividade), urgência e sugestão de resposta por IA.

- "Geral" — abre o chat geral; "Nova" — conversa direta por nome, e é de lá que sai **"Novo grupo"**.
- Filtros: busca, "Filtrar por time", "Responder (n)" (esperam resposta sua), "Aguardando".
- Na conversa: mencionar lead/contato/atividade, enviar arquivo, "Marcar como urgente", "Sugerir resposta com IA", `@` menciona pessoas, gravar áudio.
- Por mensagem: "Responder", "Reenviar como urgente", "Marcar como resolvida"; mostra sua média de tempo de resposta (30 dias).
- Na aba **Menções**, a menção que você fez e ficou sem resposta pode ser **cobrada** (❗ Importante / 🚨 Urgente) — popup na tela do outro e "visto" registrado. Ver "Cobrar resposta urgente na menção".

### Grupos criados pela equipe (desde 14/08/2026)

Antes disso todo grupo do chat nascia fora dele: o Chat Geral pela RPC `ensure_team_general_conversation` e os `👥 {time}` no botão "Sincronizar grupos do chat" da aba Times. Quem quisesse juntar 4 pessoas num assunto não tinha caminho — sobrava conversa direta repetida.

- **"Nova" → "Novo grupo"**: nome + seleção múltipla de pessoas. A lista usa o mesmo filtro do seletor de `@menção` (sem desativados do `org_user_status` e sem as contas de teste/duplicadas da `ASSIGNEE_BLOCKLIST`), então não dá pra montar grupo com conta-fantasma.
- **Participantes**: o cabeçalho do grupo mostra quantos são e abre a tela de membros **dentro do painel** (o voltar devolve pra conversa). Lá dá pra renomear, **adicionar**, **remover** e **sair do grupo** — remover e sair pedem confirmação na própria linha.
- Cada ação escreve uma mensagem no grupo ("criou o grupo", "adicionou X", "removeu Y", "saiu do grupo"). É ela que dispara o Web Push: `send-team-push` resolve destinatário por `team_conversation_members` da conversa, então quem entra fica sabendo mesmo com o app fechado.
- **Grupos sincronizados são só-leitura**: `👥` (times), `📊` (relatório diário) e `💬` (Chat Geral) mostram os participantes mas não deixam editar — a composição deles vem da aba Times/relatório e seria desfeita no próximo sync. O nome digitado também perde esses prefixos, pra grupo do usuário não se passar por grupo de time (que é o que alimenta o filtro "Filtrar por time").
- Nada de schema novo: `team_conversations.type='group'` e `team_conversation_members` já existiam, a RLS do Externo dá `ALL` para `authenticated` nas duas e o `UNIQUE (conversation_id, user_id)` é o que sustenta o upsert de "adicionar" contra clique duplo. Código em `useTeamDirectChat` (`createGroupConversation`, `addGroupMembers`, `removeGroupMember`, `leaveGroup`, `renameGroup`) e `components/chat/TeamGroupPanels.tsx`.
- Limite conhecido: sair sendo o último deixa a conversa sem ninguém (fica no banco, invisível pra todos) — não há exclusão de grupo.

### Criar atividade a partir de mensagens (IA) — **já existe**
- Ícone de atividade numa mensagem entra no **modo seleção**: dá pra tocar em outras mensagens pra incluir/remover (o rodapé mostra "n mensagens selecionadas").
- "Criar atividade" manda as mensagens escolhidas pra IA (`chat-to-activity`, Railway) e abre o **formulário completo de atividade já preenchido**: assunto, tipo, prioridade, prazo (se citado), lead citado, assessor sugerido pelo nome, "O que foi feito", "Como está", "Próximo passo" e observações. A conversa original fica registrada nas observações sob "— Origem: chat interno —".
- O usuário revisa e cria de fato — a IA não cria nada sozinha. Áudio entra pela transcrição da mensagem.
- Criada a atividade, as mensagens de origem ficam **marcadas na conversa** com o selo "Virou atividade: {assunto}". Clicar no selo abre a **ficha completa da atividade** sem sair do chat — serve de atalho e de registro de que aquele pedido já virou tarefa (some do "ficou combinado e ninguém abriu"). Fechar o formulário sem criar não marca nada.

**Fluxo recomendado**: usar o filtro "Responder" pra zerar o que espera resposta sua; `@` pra acionar alguém, menção de entidade pra dar contexto de lead/caso. Combinação/pedido que virou tarefa: selecionar as mensagens e "Criar atividade" em vez de redigitar.

### Cobrar resposta urgente na menção (desde 12/08/2026)

Marcar alguém e ficar no vácuo deixou de ser o fim da linha. Na aba **Menções**, toda menção que **você fez** e que ainda não teve resposta ganha dois botões — **❗ Importante** e **🚨 Urgente** — e a cobrança fica registrada, com o "visto", igual à cobrança de atividade atrasada do painel de Feedbacks.

- **Quem pode cobrar**: só quem marcou, e só enquanto ninguém respondeu (menção com status `respondido` não mostra os botões). Na menção que você **recebeu** não há botão — aparece só quem pediu urgência e quando.
- **O que o outro vê**: popup no topo da tela (`TeamNotificationToast`, o mesmo do chat) com o texto da menção, **Abrir** (vai direto pro chat da ficha, sem redirecionar pra fora) e **Responder** ali mesmo. Urgente é vermelho, toca som e **só sai no clique** (`duration: Infinity`); importante é âmbar. Quem está com o sistema fechado é alcançado por **Web Push** (`send-team-push` com `user_ids`).
- **Histórico e "visto"**: a linha embaixo da menção mostra `🚨 Cobrado 11/08 15:57 · ✓ visto 11/08 17:14` ou `aguardando visualização`. **Popup exibido = visto** — mesma regra da cobrança de atividade. O "visto" chega ao vivo por Realtime, sem reabrir o painel.
- **Quem estava offline** vê a cobrança ao voltar (catch-up de 7 dias das não vistas, teto de 5 popups).
- **Onde mora**: tabela `mention_nudges` no **Externo** (`supabase/migrations-external/20260812120000_mention_nudges.sql`). Tabela própria, não coluna em `activity_notifications`, porque lá `activity_id` tem FK pra `lead_activities` (menção em lead/processo/WhatsApp não caberia) e `recipient_id` é UUID do Externo, enquanto menção, chat e push usam o UUID do **Cloud**. Rollback = `drop table` (nada mais depende dela).
- **Como o alvo é descoberto**: a mensagem não guarda o id de quem foi marcado; vem de `team_chat_mentions` por `message_id` (a policy do Externo deixa a equipe ler as menções da casa). Menção com várias pessoas cobra todas de uma vez.
- Código: `useMyMentions.nudgeMention` em `src/hooks/useTeamChat.ts`, `MentionNudgeRow` em `src/components/chat/MentionsPanel.tsx`, popup em `src/components/chat/TeamChatNotifications.tsx`. Testes: `MentionsPanel.urgencia.test.tsx` (7).

### Popup de menção e participação no chat da ficha (desde 12/08/2026)

Duas falhas reais no aviso de menção, corrigidas juntas:

- **A menção em ficha nunca gritava.** O popup do chat direto lia `is_urgent` da mensagem — tocava som e só saía no clique. O da ficha (`branch 2` em `TeamChatNotifications`) nem selecionava a coluna: toda menção virava um toast mudo de 15s, que sumia sozinho se a pessoa estivesse olhando pra outro lado. Agora os dois caminhos têm o mesmo comportamento (som, vermelho e `duration: Infinity` quando urgente, anexo no popup).
- **Menção recebida com o app fechado não aparecia nunca.** Não havia catch-up: só quem estava com a aba aberta no instante do INSERT via o popup. Agora, ao abrir o app, as não lidas desde o último popup aparecem em fila (máx. 5, janela de 3 dias). A marca d'água fica em `localStorage` (`team-mentions-last-popup-at`) — marcar como lida aqui apagaria o badge.
- **Chat aberto não gera popup de si mesmo**: `setActiveTeamChatEntity` em `TeamChatPanel` faz pro chat de ficha o que `teamChatActiveConversation` já fazia pro chat direto.

**Participação (`team_chat_thread_followers`)**: quem é marcado num chat de ficha — ou quem fala nele — passa a receber **todas** as mensagens seguintes daquele chat como popup, não só as que trazem um novo `@`. Antes, a resposta que vinha depois do `@` passava batido e quem marcou não sabia que tinha sido respondido.

- Sai pelo botão **"Finalizar participação"** no rodapé da menção, no painel. Um novo `@` traz a pessoa de volta (`left_at` volta a `null` no upsert).
- Sem popup duplicado: se a mensagem também te marcou, o canal de menções é quem avisa (o de participação consulta `team_chat_mentions` e se cala).
- O canal de participação escuta `team_chat_messages` **sem filtro no servidor** e corta no cliente contra o conjunto que você segue — a chave é `(entity_type, entity_id)`, que o filtro do Realtime não expressa. Volume medido: 15–51 msgs/dia, pico de 24 threads.
- Migration: `supabase/migrations-external/20260812140000_team_chat_thread_followers.sql` (também corrige `mention_nudges` para `replica identity full`, como as demais tabelas do chat).

### O chat da atividade é da CADEIA, não da ficha (desde 17/08/2026)

"Concluir + próxima" cria uma ficha nova, com id novo. O chat interno era ancorado nesse id: a etapa seguinte nascia com a conversa **vazia** e quem respondia na ficha anterior falava com quem já tinha virado o dia. Caso que originou a mudança (cadeia "Manifestar descumprimento e requerer execução do pensionamento"): a resposta caiu às 20:30 de 04/08 na ficha que o responsável tinha deixado para trás às 20:12 — 8 mensagens espalhadas por 3 fichas, e a etapa aberta hoje sem nenhuma.

- **Leitura** = união dos elos da cadeia (`.in('entity_id', ids)`); **escrita** = sempre na **raiz** (`chain_root_id || id`). Nada é movido de lugar — não houve backfill.
- Vale para mensagem, menção (`team_chat_mentions.entity_id`), participação (`team_chat_thread_followers`) e o "responder" do popup: tudo na mesma chave, então concluir a etapa não desliga quem estava acompanhando.
- **Quem acompanhava desde antes** continua avisado: as linhas antigas de `team_chat_thread_followers` guardam o id do ELO, e `resolveActivityChatRoots` traduz para a raiz na carga das notificações.
- **Clicar na notificação abre a etapa VIVA**, não a raiz (que costuma estar concluída) — `resolveOpenActivityOfChain`, usado no popup e no painel de menções. Tanto faz para o conteúdo: qualquer elo mostra o thread inteiro.
- Na conversa: selo **"Conversa contínua · N etapas desta atividade"** e divisor de dia entre as mensagens (Hoje / Ontem / data).
- Web Push: o cliente manda `entity_ids` (os elos) e `send-team-push` procura os participantes na cadeia toda — quem falou só na etapa anterior continua sendo alcançado.
- Banco sem as colunas da cadeia (42703) cai no comportamento antigo — chat da ficha — em vez de quebrar.
- Código: `src/lib/activityChatThread.ts` (+ 12 testes), `useTeamChat`, `TeamChatPanel`, `TeamChatNotifications`, `MentionsPanel`, `railway-server/src/functions/send-team-push.ts`.
- **Pendência conhecida**: cadeias anteriores a 07/08/2026 não têm `parent_activity_id` gravado (a migration da cadeia é dessa data), então nelas o histórico começa no primeiro elo que ficou ligado. Religar exige heurística (mesmo título + processo + conclusão a segundos da criação da filha) e escrita em produção.

### Filtros de origem da menção (desde 12/08/2026)

O painel passou a se chamar **Chat interno** e ganhou duas dimensões de filtro, cruzáveis entre si e com as que já existiam (Todas / Não lidas / Responder / Aguardando):

- **Onde foi dito**: **Privado**, **Grupo**, **Ficha** (atividade, lead, processo, contato, POP). Menção de ficha tem `entity_id`; sem ele, o tipo vem de `team_conversations.type` (`group` → Grupo, senão Privado) — uma query pelas conversas citadas, não uma por menção.
- **Como te chamaram**: **Pelo nome** x **@todos**. O `@todos` é expandido em uma linha por pessoa no envio, então o que distingue "é comigo" de "é com a casa" é o texto da mensagem (`/@(todos|todas|equipe|all)\b/i`) — sem mudança de schema.

**Pendente (decisão de layout)**: unificar Menções e Chat numa lista só. Os três desenhos possíveis (lista única estilo menção · lista de conversas com as menções dentro · duas listas na mesma aba) mudam a rotina de quem usa o chat direto o dia todo, e o compartilhamento do `useTeamDirectChat` entre os dois painéis exige refatorar `TeamDirectChatPanel` (1.800 linhas) pra não duplicar canais de Realtime. Por isso as abas seguem como estão até a escolha.

### Ferramentas de IA e ações na mensagem — paridade com o WhatsApp (desde 06/08/2026)

O que existia só na conversa do WhatsApp passou a existir **em todo chat interno**: o chat da equipe das fichas (lead, caso, processo, atividade, passo do POP e o painel "Equipe" da conversa) e o chat direto/grupo.

- **Menu de IA no campo de texto** (`AITextActions`, ícone ✨ — o mesmo componente do WhatsApp, sem cópia): Resumir, Corrigir erros, Humanizar, Ajude-me a escrever, **Mudar tom** (Formal, Amigável, Engraçado, Cativante, Conciso, Empático), **Traduzir** (inglês, espanhol, português), **Rascunhar como** (e-mail, mensagem, relatório) e **Prompt personalizado**. Devolve opções num diálogo; a escolhida substitui o texto do campo. Roda em `ai-text-editor` (Cloud).
- **Sugerir resposta pela conversa** (`AISuggestReply` com `mode="team"`): usa as últimas 20 falas de texto como contexto, com persona de colega (não de atendente). Quando a última mensagem é sua, em vez de inventar resposta ele lista as **pendências da conversa**.
- **Ações na bolha** (aparecem ao passar o mouse, **abaixo** do conteúdo — nunca por cima): **Copiar**, **Responder c/ IA** (a sugestão foca naquela mensagem, via `targetMessage`), **Citar** (vira bloco `>` no rascunho, mesmo formato do "Comentar" do WhatsApp, com autor e hora) e **Criar atividade** (`chat-to-activity` preenche, `ActivityFullSheet` abre à esquerda para não cobrir a ficha). No chat direto entraram Copiar e Responder c/ IA; responder, encaminhar e criar atividade já existiam.
- **A atividade nasce presa à ficha**: chat de lead → `lead_id`; de caso → `case_id`; de processo → `process_id`. A transcrição usada (a mensagem clicada + até 5 anteriores como contexto) fica nas observações sob "— Origem: chat interno da equipe —".
- **Layout do rodapé**: as ferramentas ficam numa **barra acima do campo**, com quebra de linha; embaixo só o texto (largura inteira) e o enviar. Na primeira versão elas dividiam a linha com o campo e, numa ficha estreita, o placeholder quebrava letra a letra.
- **O que NÃO foi replicado**: o botão "Pendência" do WhatsApp registra compromisso **do cliente** (`lead_client_commitments`) — no chat interno a pendência é a própria atividade, então não existe botão equivalente.
- **Pendente**: selo "Virou atividade" na bolha **do chat de ficha**. O vínculo mora em `team_message_activities`, cuja FK aponta para `team_messages` (chat direto), enquanto o chat de ficha grava em `team_chat_messages` — marcar a bolha lá exige migration no Externo. No chat direto o selo já funciona.
- Código: `src/components/chat/TeamChatPanel.tsx` e `TeamDirectChatPanel.tsx`; componentes de IA em `src/components/ui/AITextActions.tsx` e `AISuggestReply.tsx`; citação em `src/lib/teamChatQuoteEvents.ts` (`formatQuotedMessages`).

### Notificação nativa no celular (Web Push) — sem app de loja (07/08/2026)

O alerta que aparece na barra de notificações do celular e **fica lá até ser tocado** é Web Push, não app nativo. Não existe app na App Store/Play Store e não precisa existir.

**Como funciona**: `usePushNotifications` assina o aparelho e grava em `push_subscriptions` (Externo); o service worker `public/push-sw.js` exibe a notificação e trata o toque; `railway-server/src/functions/send-team-push.ts` envia com a chave privada VAPID. Mensagem de WhatsApp tem caminho próprio (`railway-server/src/lib/whatsapp-push.ts`).

**Regra por sistema operacional** — é aqui que mora quase toda a confusão:
- **Android**: funciona no Chrome **sem instalar nada**. Basta ativar uma vez naquele aparelho.
- **iPhone/iPad**: o iOS **só** entrega Web Push para app **instalado na tela inicial** (Compartilhar → Adicionar à Tela de Início, iOS 16.4+). Fora do standalone o Safari nem expõe `PushManager`. O hook devolve `needsInstall: true` nesse caso e a interface convida a instalar em vez de mentir "não suportado neste navegador" — que era o texto antigo, sem saída nenhuma.
- **Assinatura é por aparelho**: ativar no computador não ativa no celular. Em 07/08/2026 havia 22 assinaturas, 20 delas em desktop, 1 Android e **nenhum iPhone** — era esse o motivo real de "no celular não abre", não falha de envio.

**Onde a pessoa ativa**: faixa `PushNotificationPrompt` no topo (aparece também quando a permissão já foi dada mas **este** aparelho não tem assinatura; dispensar adia 7 dias, não some pra sempre) e o cartão `PushNotificationSettings`, que vive em Configurações → Notificações **e** na página `/install`. Para a equipe, mandar só o link `/install`: ele ensina a instalar e ativa a notificação no mesmo lugar.

**Toque na notificação**: cai na conversa certa via `?openTeamChat=<id>`, lido por `TeamChatDeepLink`. "Reenviar como urgente" também dispara push — antes só gravava no banco e quem estava com o app fechado nunca ficava sabendo.

**Alertas que NÃO chegam com o app fechado**: metas (`useGoalNotifications`), métricas (`useMetricAlerts`), conversão (`useConversionAlerts`) e outbound (`useOutboundNotifications`) são calculados **na aba aberta**. Eles agora aparecem no celular com o app aberto — antes nem isso, porque usavam `new Notification(...)`, que **não é construível no Chrome do Android** (`TypeError: Illegal constructor`). Todos passaram a usar `showNativeNotification` (`src/lib/nativeNotification.ts`), que exibe pelo service worker. Para alcançar celular com o app **fechado**, o cálculo teria que sair da aba e virar rotina no servidor — não foi feito.

#### Abrir a conversa pelo popup — carga com teto de tempo (21/08/2026)

Tocar no popup abre a conversa no mesmo drawer do resto do app (`WhatsAppChatSheetHost` → `DashboardChatPreview`, `direction="top"`). Duas correções nesse caminho:

**O popup atendido sai da tela.** Antes ele ficava até o X, o swipe ou o tempo — cobria o topo do chat e ainda empurrava o drawer pra baixo (`useTopToastStackHeight` reserva a altura da pilha de avisos). Agora `handleOpen` descarta **aquele** popup; os outros da pilha continuam de pé, então nenhum aviso se perde.

**A conversa não fica mais presa no spinner.** O sintoma era carregar por minutos, às vezes nunca. O banco nunca foi o gargalo — medido no Externo em 18/08/2026, a página de mensagens de uma conversa privada roda em **2,5 ms** pelo `idx_whatsapp_messages_phone`, com 1,59 M de linhas na tabela. O problema era o cliente:

- O `fetch` do supabase-js **não tem timeout**. Abrindo pelo popup, a aba costuma estar voltando do segundo plano no celular, com o socket morto: a requisição fica pendurada até o sistema operacional derrubar. Como `setLoading(false)` só existia depois do `await`, o spinner nunca saía.
- `getOurInstancePhones()` entrava num `Promise.all` junto com a página de mensagens e **cacheia a promessa por sessão** — pendurada uma vez, travava toda abertura de conversa dali em diante. Ela só refina a autoria de mensagem de **grupo**; não tem por que segurar a tela.
- Falha de rede aparecia como "Nenhuma mensagem encontrada", que é mentira e não oferece saída.

O que passou a valer: página de mensagens com teto de **12 s** e `getOurInstancePhones` com teto de **8 s** (`withTimeout`, `src/lib/promiseTimeout.ts`), falha não fica cacheada, a lista entra pelo cache síncrono e refina a autoria de grupo depois, e o que falha vira **"Tentar de novo"** na tela — nunca spinner eterno nem "conversa vazia".

#### A sugestão da IA já chega escrita no popup (28/08/2026)

O popup de mensagem de WhatsApp responde sem abrir o chat — e agora a resposta sugerida **nasce pronta**, como no campo do chat: assim que o aviso aparece, uma faixa acima do campo mostra o que a IA responderia. Tocar no texto leva pro campo (revisar e enviar — nada sai sozinho); "Outra" pede de novo; X dispensa. O botão de ✨ continua para quem quer o diálogo completo (tom, reformular).

- **Mesmo cérebro do chat**: `useSugestaoAutomatica` + `gerarSugestaoDeResposta` — e a **mesma preferência** (`wa-sugestao-automatica`): desligar "Sugerir resposta" no chat desliga no popup também. Só pede à IA quando a última fala é do cliente.
- **Custo**: cada popup passa a buscar o histórico (20 msgs) e, havendo pendência, faz **1 chamada** ao `ai-text-editor`. O botão de ✨ seguia o caminho barato (só no clique); a sugestão pronta é o preço de não precisar pedir.
- Código: `WhatsAppSugestaoAutomatica` em `src/components/notifications/WhatsAppToastActions.tsx`, slot `composerHint` em `TeamNotificationToast`, ligado em `PushNotificationBridge`. Testes: `WhatsAppSugestaoAutomatica.test.tsx` (3) e `TeamNotificationToast.popup-actions.test.tsx`.

#### ...e ao abrir a conversa pela notificação, também (01/09/2026)

Faltava o passo seguinte: tocar no aviso abre a conversa no `DashboardChatPreview`, e **ali** a sugestão sumia — quem abria voltava a ter que pedir no botão de ✨. Era o único dos três lugares sem sugestão pronta: o popup tinha (28/08), a conversa completa (`WhatsAppChat`) tinha, o drawer não.

Agora o drawer usa o **mesmo** `useSugestaoAutomatica` da conversa completa, com o mesmo desenho: a sugestão aparece **apagada por baixo do campo** (não é o valor do campo — nada é enviado por acidente), uma linha acima explica o atalho, e vira texto de verdade com **→** ou **Tab**, ou no botão → ao lado do campo. **Esc** dispensa, "Outra" pede outra. Mesma preferência `wa-sugestao-automatica`: desligou no chat, desligou aqui.

- **Só quando há o que responder**: se a última fala da conversa é nossa, `pending` é falso e nada é pedido à IA — abrir uma conversa já respondida continua sem sugestão, de propósito.
- **Não aparece** com o campo já digitado, gravando áudio ou enviando.
- **Custo**: 1 chamada ao `ai-text-editor` por conversa aberta com pendência (o histórico já era carregado pelo drawer). Abrir a mesma conversa de novo sem mensagem nova não repete a chamada — a âncora é a última mensagem.
- Código: `src/components/whatsapp/DashboardChatPreview.tsx` (hook, `usarSugestao`, fantasma sobre o `Textarea`, `handleKeyDown`). O auto-resize do campo passou a considerar a altura da sugestão, senão ela sairia cortada.

---

## Campanhas — `/campanhas`

**Propósito**: visão de todas as campanhas com custo, leads gerados e retorno (ROI).

- Totais: Investido, Honorários, Leads, ROI geral; "Nova campanha"; busca; clique no card abre o detalhe.
- Detalhe: "Editar"; métricas CAC, LTV, ROI; abas "Leads", "Atividades", "Fluxo" ("Abrir fluxo").

---

## Relatórios — `/relatorios`

**Propósito**: relatórios em linguagem natural — pergunta em português, a IA gera a consulta (somente leitura) e mostra a tabela na hora. Acesso restrito a diretoria/gestores; CPF e dados bancários mascarados.

- Exemplos clicáveis (ex.: "Casos abertos por núcleo", "Leads que viraram cliente esse mês").
- Campo de pergunta (Enter envia); follow-up mantém o contexto; "Ver a consulta usada" mostra o SQL.

**Fluxo recomendado**: clicar num exemplo ou perguntar direto → refinar com follow-up.

---

## Equipe — `/team`

**Propósito**: gestão da equipe — produtividade, metas, avaliações, membros, times, férias, permissões e perfis de acesso.

- Pílulas: Produtividade, Métricas, Metas, Metas Processuais, **Foco dos Gerentes**, Avaliações, Tráfego, Membros, Times, Férias, Embaixadores, Carreira, Rotinas, WhatsApp (permissões de instância), Cartões, Contas, Acessos, Perfis.

**Fluxo recomendado**: Membros pra cadastrar pessoa; Acessos/Perfis pra permissões; Produtividade pro acompanhamento diário.

---

## Metas Processuais (Equipe → aba "Metas Processuais")

**Propósito**: meta de time sobre a carteira de processos — a quantos processos o time quer chegar em cada marco processual, e/ou qual o percentual médio de fluxo (POP) concluído.

- "Nova meta" — time, nome, período (Mensal/Trimestral/Personalizado, com calendário nas datas) e a **tabela dos 10 marcos de uma vez**: cada linha traz "Até hoje" (processos que já passaram pelo marco), "Atualmente" (processos em que esse é o marco mais recente) e o campo "Meta". Marco sem meta preenchida não é acompanhado.
- Clicar em qualquer número de "Até hoje" ou "Atualmente" abre o painel lateral com **os processos por trás daquele número** — CNJ, cliente, responsável e data do marco; clique na linha vai para a ficha do caso (`/cases/{case_id}`). Vem da RPC `team_process_marco_processos` (`p_modo` = `acumulado` ou `atual`).
- O alvo é **absoluto**: "hoje temos 42 na conciliação, queremos chegar a 60". O número de hoje é carregado automaticamente ao escolher o time e gravado como ponto de partida da barra. Alvo menor que o número atual é recusado — não existe processo saindo de um marco.
- Card por time/período — uma barra por marco (acumulado × alvo, com "Início", "No período: +N" e "Faltam N") e a barra de "Fluxo médio concluído (hoje)". Rodapé mostra processos do time, quantos têm passos de POP e quantos têm marco.
- "POPs por time" (bloco recolhível) — mapeia cada POP a um time. Serve de fallback: processo sem responsável processual em time entra pelo POP.
- Lixeira arquiva as metas daquele time/período (`is_active = false`); os registros ficam no histórico.

**Como o número sai** (RPCs `team_process_goals_progress` e `team_process_marco_baseline`, Externo):
- Processo → time (view `vw_team_process_assignment`): `leads.processual_responsible_id` presente em `team_members`; se não, o POP do processo (`lead_processes.workflow_id`) mapeado em `team_workflow_boards`.
- `realizado_processos`: processos distintos do time com linha em `process_movements` do marco alvo, **sem recorte de data** (acumulado).
- `realizado_no_periodo`: os que registraram o marco dentro do período — é o ritmo, não a barra.
- Fluxo médio: média simples, por processo, do % de itens marcados nas `lead_checklist_instances` do POP. **É foto do estado atual** — o checklist não guarda data por item, então esse número não é recortado pelo período.

**Limite conhecido (jul/2026)**: marcos processuais dependem do sync de movimentações do Escavador — só 89 de 1.647 processos tinham marco. A causa não é o parser: apenas 782 processos têm número CNJ, 81 têm `escavador_raw` salvo e `process_movement_monitors` está **vazio**, então a `check-process-movements` (que só varre monitores ativos) nunca baixa movimentação nova. O painel avisa quando a meta cai num time sem marco registrado.

---

## Foco dos Gerentes (Equipe → aba "Foco dos Gerentes") — desde 17/08/2026

**Propósito**: cada gerente tem uma **área de foco com piso de porcentagem** — "o de vendas tem que ter pelo menos 80% em vendas" — e, na carteira processual, o resultado que conta: **quantos processos entraram e quantos saíram**, por acordo ou por execução.

Um card por gerente (quem é gestor de time em `team_managers` ou de setor em `org_sectors`), quem está **abaixo do piso primeiro**. Configuração em painel lateral, sem sair da lista.

### Esforço — a % na área

- **Conta por tipo OU pelo assunto/contexto.** A atividade concluída entra no foco se o tipo estiver marcado **ou** se alguma palavra da área aparecer em assunto, descrição, "o que foi feito", "próximo passo", observação de status ou no processo/caso vinculado. Comparação sem acento e sem caixa (`unaccent` + `lower`): "audiencia" acha "AUDIÊNCIA".
- **Por que o texto existe**: o tipo cadastrado erra. Medição de 17/08/2026 na gerente processual (60 dias, 261 concluídas) — **só pelo tipo: 139 = 53%; pelo tipo ou pelo assunto: 226 = 87%**. As 89 de diferença estavam com tipo "Tarefa" genérico e assunto inequívoco: "Prestar esclarecimentos sobre minuta de acordo", "VERIFICAR SENTENÇA", "Cobrar manifestação da juíza após o prazo". O card mostra quantas o assunto resgatou — é o tamanho do erro de tipagem, sem auditar atividade por atividade.
- **A barra tem a marca do piso** e o card lista os tipos **fora da área** (onde o foco vaza).
- **Prévia antes de salvar**: o painel de configuração mostra, ao vivo, o % que aquela combinação de tipos + palavras daria nos últimos 60 dias, quantas vieram pelo tipo e quantas só pelo assunto (RPC `manager_focus_preview`). Há sugestões de palavras por área ("processual", "vendas") como ponto de partida.

### Resultado — entrou × saiu

- **Entrada**: processos da carteira com marco `peticao_inicial` no período. **Saída**: `acordo` (acordo) e `cumprimento_sentenca` / `precatorio_rpv` / `pagamento` (execução).
- **Vazão** = saiu ÷ entrou. Abaixo de 100% a fila cresce — o card diz em quantos. É a tradução de "o que não entra não sai, e se não sai não conseguimos colocar mais para entrar".
- **Piso da carteira** (opcional): % da carteira que precisa sair no período. **Meta de saídas** (opcional): número absoluto.
- Carteira do gerente = processos dos times que ele gerencia, pela view `vw_process_assignment` — **a mesma atribuição das Metas Processuais por Time**, não uma regra paralela.

**Por que a entrada sai do marco e não do cadastro** (medido em 17/08/2026): `lead_processes.created_at` marcou 1.019 de 1.864 processos nos últimos 60 dias — é data de importação, não de entrada, e inflaria a conta; `data_distribuicao` está preenchida em só 171 de 1.864. O marco do tribunal é a única fonte simétrica à da saída.

### Onde mais aparece

- **Telão** (`/tv-atividades`): card "Foco dos Gerentes" na coluna lateral, abaixo do Top de Avaliação — empilha, não cobre nada. Na vista de um time mostra só o gestor daquele time; na vista geral e no grupo gerencial, todos. Atualiza sozinho a cada 60s no modo TV.
- **Relatório diário** (`daily-team-report`, Railway): o foco do mês entra no **parecer sobre a gestão** de cada time (com onde o foco vazou) e vira a seção **"Foco e vazão dos gestores"** do relatório de diretoria. Falha da RPC não derruba o relatório — o bloco simplesmente não aparece.

**Onde mora**: tabela `manager_focus_targets` e RPCs `manager_focus_status` / `manager_focus_activity_types` / `manager_focus_preview` (Externo; migrations `20260817120000` e `20260817140000`). Front: `useManagerFocus.ts`, `ManagerFocusPanel.tsx`, `TvFocoGerentesPanel.tsx`.

**Limite conhecido**: a palavra-chave é literal (`like`), não semântica — "acordo" acha "acordo" e "ACORDO", mas não entende sinônimo que ninguém escreveu. E a entrada/saída herda o limite dos marcos acima: processo sem movimentação baixada não entra nem sai em número nenhum.

---

## Analytics — `/analytics`

**Propósito**: analytics de redes sociais (foco Instagram): contas, comentários, evolução de métricas, engajamento por plataforma/tipo de conteúdo, estratégias e seguidores.

- Abas: Contas, Busca, Comentários, Externos, Evolução, Dashboard, Plataformas, Estratégias, Seguidores (Dashboard/Plataformas com seletor de período).

---

## Finanças — `/finance`

**Propósito**: controle financeiro via Open Finance (Pluggy): cartões, contas, investimentos, empréstimos e lançamentos, com categorização e permissões por cartão.

- "Sincronizar" (24 meses), "Conectar" (Pluggy Connect), "Gerar Link" de autorização.
- Filtro global de período + filtros (Instituição, Conta, Cartão, Contato, Categoria).
- Abas: "Lançamentos" (novo lançamento manual), "Cartão" (subabas Pendentes → Categorizados → Acolhedores → Agrupado → Por Dia → Lista → Config), "Conta", "Invest.", "Emprest."
- Exportação nas visões Por Dia e Lista; Config (admin): permissões de cartão, categorias, contas de custo.

**Fluxo recomendado**: conectar banco → sincronizar → resolver a subaba "Pendentes" (categorizar) → acompanhar e exportar.

---

## Configurações — `/settings`

**Propósito**: central de configurações do WhatsApp e do escritório.

- Abas: Escritório, Instâncias, Agentes IA, Voz (TTS), Notificações, Relatórios, Anúncios, Onboarding, Etiquetas-Gatilho, Automações, Enriquecimento IA, Núcleos, Integração, Logs do Sistema.

**Fluxo recomendado**: Instâncias → Agentes IA → Notificações; usar Integração/Logs pra depurar webhooks.

---

## Notícias — `/noticias`

**Propósito**: triagem de leads captados de notícias — agrupa duplicatas, enriquece com IA (vítima/cidade/UF) e promove a "viável" ou cadastra o caso.

- Stat cards clicáveis (Total, 📰 Notícias, ⭐ Viáveis) filtram a lista.
- "Analisar títulos (n)" — enriquecimento por IA (roda 1x automático por visita).
- Filtros: abas Todos/Notícias/Viáveis, busca, período; seleção múltipla com "Descartar selecionados" (com Desfazer).
- Por linha: expandir duplicatas, "Viável", "Cadastrar" (análise IA + grupo WhatsApp), descartar (vai pra Arquivados, restaurável); clique abre a ficha do lead.

**Fluxo recomendado**: deixar a IA analisar → filtrar "Viáveis" → "Cadastrar" os promissores → descartar em massa o resto.

---

## Ligações — `/calls`

**Propósito**: registro e acompanhamento de ligações (CallFace): histórico, resultado, avaliação, retornos agendados, áudio e resumo por IA.

- Dashboard: Hoje, Esta Semana, Taxa de Contato, Duração Média; alerta de retornos agendados.
- "Registrar" — nova ligação (tipo, resultado, lead, contato, duração, próximo passo).
- Filtros: busca, Período, Resultado, Tipo, Instância, Membro, Avaliação.
- Abas "Lista", "Timeline por Lead", "Fila de discagem" e "Triagem Callface"; detalhe com áudio, "Resumo da IA", avaliação por estrelas e agendamento de retorno.

**Fluxo recomendado**: "Registrar" após cada ligação → no detalhe, ouvir o áudio/ler o resumo IA → avaliar e agendar o retorno.

### Integração Callface (Public Integration API)

A Callface é um app registrado no programa de integrações deles: ao encerrar uma
chamada, ela chama nosso webhook com os insights da ligação. O app foi registrado
via `callface-register` (endpoint de homologação `api.dev.callface.io`), com
`needed_credentials: ["user_id"]`.

- **Webhook**: `callface-webhook`, no **Supabase Externo**. A cópia em
  `supabase/functions/callface-webhook/` é só um proxy retrocompatível do Cloud;
  o handler de verdade está versionado em
  `supabase/functions/_external/callface-webhook/index.ts` e é deployado com
  `--project-ref kmedldlepwiityjsdahz --no-verify-jwt`.
- **Destino do dado**: `call_records` no Externo, com `tags = ['callface','telefone']`.
  O webhook espelha a linha no Cloud (é de lá que as abas "Lista" e o histórico do
  contato leem), traduzindo o uuid pelo `auth_uuid_mapping` — e zerando
  `lead_id`/`contact_id` na cópia, porque são ids do Externo e no Cloud violam a
  FK `call_records_lead_id_fkey` ou apontam para outro lead.
- **Quem ligou**: cascata `credentials.user_id` → `profiles.email` →
  `profiles.full_name` (primeiro%último nome, com `_` no lugar do acento porque
  `ilike` do PostgREST é cego a acento). Sem match, a linha nasce com a sentinela
  `00000000-…` e a tag `sem-atribuicao`. **Não existe fallback para admin** — ele
  jogava 100% das ligações no nome do primeiro admin da tabela `user_roles`.
- **Nome de conta compartilhada** ("Atendimento Previdenciário", "Processual") é
  nome de *instância*, não de pessoa: a instância tem 38-41 usuários com acesso,
  então não dá para atribuir e vai para a sentinela de propósito.
- **Gate de origem**: a Callface não assina o payload; a trava é o token
  `CALLFACE_WEBHOOK_TOKEN` na query (`?k=`) ou no header `x-callface-token`,
  ligado por `CALLFACE_WEBHOOK_ENFORCE=1`. Só passa a barrar depois que a
  `webhook_url` for re-registrada na Callface já com o token.

### Aba "Fila de discagem"

Monta a lista que alimenta o **discador da Callface**. Existe porque a API pública
deles **não expõe endpoint para originar chamada** — conferido na página
`/developers` em 20/08/2026: só há `POST /integrate-app/register` e o webhook de
retorno. Então o CRM entrega a lista e a discagem acontece do lado deles.

Filtros: quadro, origem, chegaram nos últimos 7/15/30/90 dias, e "esconder quem
já recebeu ligação" (cruza por `lead_id` e por telefone, porque 80% das ligações
chegam sem `lead_id`). Um telefone por linha — o mesmo número em dois leads
viraria ligação repetida.

Saídas: **Exportar planilha** (CSV com `;` e BOM, que Excel pt-BR e Google Sheets
abrem direto) e **Copiar números**. O CSV leva `lead_id` de propósito: se um dia a
Callface devolver um identificador nosso no webhook, a ligação volta colada no lead.

**O tamanho real da fila** (medido em 20/08/2026, e o motivo dos filtros serem por
telefone e não por "lead novo"): dos 2.700 leads que chegaram em 30 dias, **94% não
têm telefone nenhum** — 84% do volume é `google_alerts`, que é notícia raspada, não
pessoa. Sobram ~136 discáveis em 30 dias (~7/dia útil), concentrados em BPC-Autismo
e Auxílio Acidente, quase todos de origem `whatsapp`. Outros 21 leads têm telefone
apenas no contato vinculado e **ficam de fora** — contato vinculado pode ser
parente, não o próprio lead.

A via de maior volume era a planilha: `sheet-lead-ingest` (Railway, chamado por
Google Apps Script no `onFormSubmit`) trouxe 3.365 leads **todos com telefone** —
703 em maio, 2.641 em junho, 181 em julho e **zero em agosto**. Só dois quadros têm
`kanban_boards.sheet_webhook_token` configurado: "Acidente de Trabalho" e
"BPC - Autismo". Religar essa via é o que faz a fila voltar a ter volume de discador.

Cada linha tem um botão **Ligar**, e o telefone da linha também é link. Os dois são
`<a href="tel:+55...">`: entregam o número já montado ao discador do aparelho —
celular pareado, softphone instalado, ramal — sem a página navegar nem abrir aba.

### Discagem: `src/lib/dial.ts`

O único lugar do app que transforma telefone de lead em ligação. Existe para ser
**ponto de troca**: se a Callface expuser endpoint de originar chamada, ou se o
Twilio ganhar número brasileiro, muda-se `abrirDiscador` e mais nada.

| função | serve para |
|---|---|
| `normalizarTelefone` | 55 + DDD + assinante, mesma regra do `sheet-lead-ingest` |
| `telefoneDiscavel` | 12 ou 13 dígitos — fora disso o discador só queima tentativa |
| `comNonoDigito` | completa celular antigo de 8 dígitos (mesma regra da edge `twilio-voice-twiml`) |
| `paraE164` / `hrefTel` | `+5586981812709` / `tel:+5586981812709` |
| `exibirTelefone` | `(86) 98181-2709` |
| `abrirDiscador` | disca fora de um clique em link (ação de toast): cria âncora e clica |

Consumidores: a fila de discagem, o alerta de lead novo e o botão CallFace do chat
do WhatsApp — que antes montava `tel:` em formato local e agora usa E.164 como o
resto. Coberto por `src/lib/__tests__/dial.test.ts`.

### Alerta de lead novo para ligar

`NewDialableLeadAlerts`, montado no `SidebarLayout` (rotas autenticadas, dentro do
Router). Escuta `INSERT` em `leads` no **Supabase Externo** por Realtime — é lá que
a tabela mora e é lá que ela está na publicação `supabase_realtime`. Quando entra
lead com telefone discável, mostra toast com nome, telefone formatado, origem e um
botão **Ligar** com o número já pronto.

Regras que valem a pena saber:

- **Não disca sozinho, de propósito.** Medido em 21/08/2026: 3 a 5 leads discáveis
  por dia útil, e **27,5%** dos discáveis dos últimos 60 dias chegaram fora do
  horário comercial. Robô discando nesse cenário entrega chamada sem ninguém na
  linha. O que encurta o tempo até a primeira ligação é a pessoa ver em segundos e
  clicar uma vez.
- **Quem cadastrou não é avisado.** Compara `created_by` contra o uuid do Cloud e o
  do Externo (via `auth_uuid_mapping`), porque a coluna guarda ora um, ora outro.
  Filtrar por `created_by IS NULL` seria erro: **87% dos leads discáveis dos últimos
  30 dias foram criados por pessoa** (origens `referral` e `whatsapp`), não por robô.
- **Não vira enxurrada.** Junta o que chega em 2 s num aviso só e respeita piso de
  15 s entre avisos. Se a ingestão por planilha voltar ao volume de junho
  (~200/dia), o aviso vira "N leads novos para ligar" com ação "Ver fila", que abre
  `/calls?tab=fila`.
- **Som é opt-in**, como todo som da casa: Configurações → Notificações → Sons do
  sistema → "Lead novo para ligar". Nasce desligado.

**Limite conhecido:** ligação feita por `tel:` sai pelo aparelho da pessoa, então a
Callface não registra e o filtro "esconder quem já recebeu ligação" não enxerga.
Ele só cruza `call_records`, que é alimentado pelo webhook da Callface.

**Twilio existe e não está pronto.** As edges `twilio-token` e `twilio-voice-twiml`
estão deployadas no Cloud e o componente `TwilioSoftphone` está escrito, mas o
`TWILIO_CALLER_ID` configurado é **+1 978 (Massachusetts)**. Ligar para celular
brasileiro exibindo número americano derruba a taxa de atendimento e cobra como
internacional. Usar essa via exige comprar número brasileiro no Twilio (bundle
regulatório com CNPJ). Os outros quatro segredos `TWILIO_*` não foram verificados —
o Cloud tem sign-in anônimo desabilitado.

### Aba "Triagem Callface"

Ligação que não encostou em nenhum lead nem contato recebe a tag `triagem`
(em agosto/2026, 37 de 46 — são números de prospecção fria que não existem na base).

**Nada vira lead ou contato automaticamente.** A fila mostra telefone, quem ligou,
duração, gravação e o resumo da IA, e a atendente escolhe uma das três saídas:
vincular a um lead existente (busca por nome/telefone), criar lead a partir da
ligação (o resumo vai para as observações do lead), ou descartar com motivo —
que tira da fila sem apagar nada (tag `descartado`).

A aba lê e escreve no **Externo** (`useCallfaceTriage`); as tags são sincronizadas
também no Cloud para a aba "Lista" não divergir, mas o `lead_id` fica só no Externo.
