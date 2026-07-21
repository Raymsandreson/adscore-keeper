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
- Por mensagem: "Copiar texto", "Sugerir resposta a esta mensagem com IA", "Criar atividade a partir desta mensagem".
- Mídia: baixar e "Salvar na pasta do lead no Google Drive" (com classificação por IA).
- Criação de caso pelo WhatsApp: "Preencher com IA a partir da conversa" → "Criar Caso" (cria lead fechado + contato + caso + processos detectados + atividades).

**Fluxo recomendado**: selecionar a instância → abrir a conversa → usar "Sugerir resposta com IA" quando útil → quando o lead avança, "Criar Lead + Contato" e depois "Criar Caso Jurídico"; "Atualizar com IA" completa os campos ao longo do atendimento.

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

**Fluxo recomendado**: usar o filtro "Responder" pra zerar o que espera resposta sua; `@` pra acionar alguém, menção de entidade pra dar contexto de lead/caso.

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

- Pílulas: Produtividade, Métricas, Metas, Avaliações, Tráfego, Membros, Times, Férias, Embaixadores, Carreira, Rotinas, WhatsApp (permissões de instância), Cartões, Contas, Acessos, Perfis.

**Fluxo recomendado**: Membros pra cadastrar pessoa; Acessos/Perfis pra permissões; Produtividade pro acompanhamento diário.

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
