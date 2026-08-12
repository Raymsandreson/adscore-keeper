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

### Vincular grupo do WhatsApp ao lead — "Buscar grupos" (ago/2026)

Mesmo dialog (`LeadGroupSearchDialog`) na ficha do lead (campo "Grupos WhatsApp") e na tela de Atividades (botão "Vincular WA"). Dois modos:

- **Por nome** — varre TODAS as instâncias conectadas via `whatsapp_groups_index`. **Não precisa de instância definida.**
- **Por participante** (telefone do lead) — precisa de uma instância concreta, que é quem conhece os grupos daquele número.

**A instância é resolvida pelo próprio dialog** (`resolveLeadSearchInstanceName`, `src/lib/leadSearchInstance.ts`), em cascata: instância que espelha o histórico do lead (cobre ~63% dos leads com atividade recente) → `default_instance_id` do perfil (**só 8 de 4.161 perfis têm o campo preenchido** — parar aqui não resolvia) → instância ativa agora, medida pelo espelho global mais recente e preferindo Atendimento Previdenciário 1/2. Nenhuma resolvida não bloqueia: a busca por nome segue funcionando.

Isto é **leitura**. Para decidir por onde ENVIAR em grupo continua valendo `resolveGroupSenderInstanceName` (só quem tem espelho recente no próprio grupo) — nunca a instância pessoal de quem está logado.

**Regressão corrigida em 07/08/2026**: a tela de Atividades montava o dialog com `instanceName={undefined}` fixo, então todo "Buscar" caía em *"Instância WhatsApp não definida para este lead"* (o Enter no campo disparava o erro mesmo com o botão desabilitado). A `find-contact-groups` também exigia `instance_name` na busca por nome, onde ele só serve de desempate; hoje ela roda no Externo (rota `external` no `functionRouter`, fallback → Cloud) e só exige instância na busca por participante.

#### Instância morta no índice de grupos (07/08/2026)

`whatsapp_groups_index` identifica quem viu cada grupo pelo **nome** da instância (`instance_name` é parte da PK), e nome de instância removida ou renomeada fica lá para sempre: eram **504 de 27.924 linhas** — "BRUNO DANTAS" (345, congeladas em 24/05) e "Auxílio Maternidade" (159, ainda regravadas pelo webhook). Escolher um desses grupos na busca levava a `instance not found` e roster vazio.

- `get-group-participants` (Railway) **não aborta mais** quando a instância pedida não está cadastrada: segue sem preferida e usa a varredura entre instâncias que já existia ali. Cache e `chat_details` passam a ser gravados sob quem de fato respondeu — grupo com índice desatualizado refaz a varredura, em vez de espalhar o nome fóssil.
- `whatsapp_groups_index.instance_id` (FK para `whatsapp_instances`) é preenchido por trigger case-insensitive; nem a sync nem o webhook precisaram mudar. **`instance_id IS NULL` é a medida do problema** — 504 linhas hoje.
- `search_whatsapp_groups_by_tokens` devolve o nome **vivo** da instância quando o id resolve, e só cai no texto histórico quando ela não existe mais.

Renomear as linhas órfãs para a instância atual **não** é a correção: "Bruno Wenner" (mesma pessoa, instância recriada em 31/07) não alcança aqueles grupos — quem alcança é "Raym". Quem resolve é a varredura, não o nome.

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

- "Geral" — abre o chat geral; "Nova" — conversa direta por nome.
- Filtros: busca, "Filtrar por time", "Responder (n)" (esperam resposta sua), "Aguardando".
- Na conversa: mencionar lead/contato/atividade, enviar arquivo, "Marcar como urgente", "Sugerir resposta com IA", `@` menciona pessoas, gravar áudio.
- Por mensagem: "Responder", "Reenviar como urgente", "Marcar como resolvida"; mostra sua média de tempo de resposta (30 dias).
- Na aba **Menções**, a menção que você fez e ficou sem resposta pode ser **cobrada** (❗ Importante / 🚨 Urgente) — popup na tela do outro e "visto" registrado. Ver "Cobrar resposta urgente na menção".

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

- Pílulas: Produtividade, Métricas, Metas, Metas Processuais, Avaliações, Tráfego, Membros, Times, Férias, Embaixadores, Carreira, Rotinas, WhatsApp (permissões de instância), Cartões, Contas, Acessos, Perfis.

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
- Abas "Lista" e "Timeline por Lead"; detalhe com áudio, "Resumo da IA", avaliação por estrelas e agendamento de retorno.

**Fluxo recomendado**: "Registrar" após cada ligação → no detalhe, ouvir o áudio/ler o resumo IA → avaliar e agendar o retorno.
