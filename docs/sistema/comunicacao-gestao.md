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
  - **Caminho de volta**: a ficha da atividade traz "Ver mensagem de origem", que abre `/whatsapp?openChat={phone}&msg={message_id}`, rola até a bolha e a destaca por 2s. Em grupo, a mesma mensagem chega replicada em cada instância conectada (ids e `external_message_id` diferentes); quando o id do link não é o da instância aberta, a cópia visível é encontrada pelo próprio vínculo com a atividade.
  - **Não é retroativo**: o vínculo nasce no momento da criação. Atividades criadas antes de 06/08/2026 não têm selo e não há backfill possível — a nota interna antiga não guardava `message_id` nem `activity_id`.
- **O formulário vem preenchido pela IA** (desde 06/08/2026): criar atividade a partir de mensagem usa `chat-to-activity` (Railway) e abre o **formulário completo** (`ActivityFullSheet`) — o mesmo caminho do chat interno da equipe. Antes abria o formulário reduzido do WhatsApp com o texto no campo de ditado (`parse-activity-dictation`), e só o assunto vinha preenchido.
  - Vêm da IA: assunto, tipo, prioridade, "O que foi feito", "Como está" e "Próximo passo" (este nunca fica vazio — no mínimo descreve a própria tarefa). A conversa de origem fica nas observações sob "— Origem: conversa do WhatsApp —".
  - **Assessor**: o sugerido pela conversa vence ("fulano, faz isso"); sem sugestão, fica **quem está criando**. **Prazo**: o citado na conversa vence; sem citação, **hoje**.
  - O formulário reduzido (`WhatsAppActivitySheet`) continua nos caminhos **sem** mensagem de origem — menu do topo da conversa, preview do lead — e como rede de segurança se a IA falhar (aí abre com o texto no ditado, como antes).
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
- Por item: **Feito**, **Cobrar**, **Desistiu**, **Não era**, **Reabrir**, excluir. **"Cobrar" não envia nada**: grava a cobrança (`reminder_count+1`, "cobrado 2x") e **escreve o texto no campo de mensagem** pro assessor revisar e enviar. O texto é escolhido por palavra-chave do título/kind, já que o tipo é livre.
- **Registro manual continua**, escondido atrás de "Adicionar à mão" — é exceção, não o caminho principal. Na bolha, o botão "Pendência" abre esse formulário já com a mensagem citada.
- **Prazo é opcional e sem prazo nunca vence** — a maioria das promessas do WhatsApp não tem data. Vencida = em aberto com prazo anterior a hoje.
- Tabela `lead_client_commitments` (Externo, RLS + realtime): conversa sem lead também controla pendência (`lead_id` OU `phone`+`instance_name`, garantido por CHECK). Marcação feita por outro assessor aparece na hora via Realtime.
- Código: função `railway-server/src/functions/detect-client-commitments.ts`; regras puras em `src/lib/clientCommitments.ts` (13 testes); dados em `src/hooks/useClientCommitments.ts`; UI em `ClientCommitmentsBar.tsx` / `ClientCommitmentsPanel.tsx`. Migrations `20260805140000`, `20260806120000` e `20260806140000`.
- **Ainda não existe** (fase 2): pendência vencida virando atividade de cobrança do responsável, e varredura em segundo plano das conversas que ninguém abriu.

**Fluxo recomendado**: selecionar a instância → abrir a conversa → usar "Sugerir resposta com IA" quando útil → quando o lead avança, "Criar Lead + Contato" e depois "Criar Caso Jurídico"; "Atualizar com IA" completa os campos ao longo do atendimento. Dúvida interna sobre o que o cliente disse: "Comentar" na mensagem e `@` em quem precisa responder — em vez de printar e mandar em outro canal. Promessa do cliente ("vou avaliar", "vou gravar o vídeo") a IA já registra sozinha na barra "Cliente ficou de" — o assessor só marca **Feito**, **Cobra** ou corrige com **"Não era"**.

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

### Criar atividade a partir de mensagens (IA) — **já existe**
- Ícone de atividade numa mensagem entra no **modo seleção**: dá pra tocar em outras mensagens pra incluir/remover (o rodapé mostra "n mensagens selecionadas").
- "Criar atividade" manda as mensagens escolhidas pra IA (`chat-to-activity`, Railway) e abre o **formulário completo de atividade já preenchido**: assunto, tipo, prioridade, prazo (se citado), lead citado, assessor sugerido pelo nome, "O que foi feito", "Como está", "Próximo passo" e observações. A conversa original fica registrada nas observações sob "— Origem: chat interno —".
- O usuário revisa e cria de fato — a IA não cria nada sozinha. Áudio entra pela transcrição da mensagem.
- Criada a atividade, as mensagens de origem ficam **marcadas na conversa** com o selo "Virou atividade: {assunto}". Clicar no selo abre a **ficha completa da atividade** sem sair do chat — serve de atalho e de registro de que aquele pedido já virou tarefa (some do "ficou combinado e ninguém abriu"). Fechar o formulário sem criar não marca nada.

**Fluxo recomendado**: usar o filtro "Responder" pra zerar o que espera resposta sua; `@` pra acionar alguém, menção de entidade pra dar contexto de lead/caso. Combinação/pedido que virou tarefa: selecionar as mensagens e "Criar atividade" em vez de redigitar.

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
