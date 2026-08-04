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
- Mídia: baixar e "Salvar na pasta do lead no Google Drive" (com classificação por IA).
- Criação de caso pelo WhatsApp: "Preencher com IA a partir da conversa" → "Criar Caso" (cria lead fechado + contato + caso + processos detectados + atividades).

### Chat interno da equipe dentro da conversa (botão "Equipe")
- Botão **"Equipe"** no topo da conversa abre/fecha o chat interno sobre aquele cliente — coluna própria no desktop, painel deslizante em tela estreita. O cliente não vê nada do que é escrito ali. O estado (aberto/fechado) fica salvo por navegador; ao fechar, um aviso lembra que a reabertura é nesse mesmo botão.
- `@` no campo lista os membros e traz **"@todos"** no topo (avisa a equipe inteira). Escrever `@todos`, `@equipe` ou `@todas` na mão tem o mesmo efeito.
- **Quem é marcado com `@` ganha acesso a esta conversa do WhatsApp** e é notificado — inclusive quando a instância não é dele. Com "@todos" isso vale para todo mundo, e o sistema avisa quantas pessoas serão liberadas antes do envio. O acesso é revogável no diálogo de compartilhamento.
- **Comentar mensagem do cliente**: "Comentar" numa bolha (ou o checkbox de seleção → "Comentar com a equipe", para várias de uma vez) cola as mensagens citadas no rascunho do chat interno, com autor e hora. Transcrição de áudio entra como texto; citação acima de 400 caracteres é cortada com "…". Na mensagem enviada, o trecho citado aparece em bloco separado com barra lateral.

**Fluxo recomendado**: selecionar a instância → abrir a conversa → usar "Sugerir resposta com IA" quando útil → quando o lead avança, "Criar Lead + Contato" e depois "Criar Caso Jurídico"; "Atualizar com IA" completa os campos ao longo do atendimento. Dúvida interna sobre o que o cliente disse: "Comentar" na mensagem e `@` em quem precisa responder — em vez de printar e mandar em outro canal.

---

## Agentes IA do WhatsApp (Configurações → aba "Agentes IA")

**Propósito**: agentes de IA que respondem conversas automaticamente (texto/áudio), fazem follow-up, discam automaticamente e criam leads por campanha.

- "Novo Agente"; por agente: ativar/desativar, editar, arquivar.
- Editor por abas: "⚙️ Geral" (nome, etapas vinculadas, base de conhecimento), "🧠 IA" (modelo, prompt com construtor por chat, voz/áudio, dividir mensagens), "Assistente", "🤝 Handoff", "⚡ Automações", "⏱️ Tempos" (delay, follow-up, janela de horário, pausa quando humano entra), "📞 Chamadas" (discadora), "📢 Campanhas" (criar lead automaticamente no funil).

**Fluxo recomendado**: "Novo Agente" → Geral (nome) → IA (prompt/modelo) → salvar → reabrir pra configurar etapas, tempos, chamadas e campanhas.

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
