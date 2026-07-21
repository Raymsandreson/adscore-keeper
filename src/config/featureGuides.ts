// Guias de funcionalidades por seção do sistema.
// Cada guia é exibido automaticamente quando o usuário entra na seção,
// até ele clicar em "Não exibir mais" (persistido por seção no localStorage).
// O conteúdo descreve os botões reais da tela — ao mudar uma tela, atualizar o guia junto.
// Documentação completa por módulo: docs/sistema/

export interface FeatureGuideItem {
  /** Nome do botão/recurso como aparece na tela */
  label: string;
  /** O que ele faz, em 1 linha */
  description: string;
  /**
   * Seletor CSS opcional pro tour destacar o elemento exato.
   * Sem seletor, o tour tenta achar o botão pelo texto do label;
   * se não achar, mostra o balão centralizado.
   */
  selector?: string;
  /**
   * Texto alternativo pra localizar o elemento (quando o label do passo
   * não é o texto literal do botão — ex.: label "Pílulas de navegação",
   * anchor "Produtividade"). Também casa com placeholder/aria-label/title.
   */
  anchor?: string;
}

export interface FeatureGuideDef {
  /** Chave única — usada pra persistir o "não exibir mais" */
  id: string;
  /** Prefixos de rota que ativam este guia ("/" casa só a rota exata) */
  paths: string[];
  title: string;
  /** Frase curta do propósito da seção */
  intro: string;
  items: FeatureGuideItem[];
  /** Jeito mais prático recomendado de usar a seção */
  tip?: string;
}

export const featureGuides: FeatureGuideDef[] = [
  {
    id: "atividades",
    paths: ["/"],
    title: "Atividades",
    intro: "Sua central de trabalho diário: criar, cronometrar e concluir atividades vinculadas a Lead, Caso, Processo ou Contato.",
    items: [
      { label: "Nova Atividade", description: "abre a ficha de criação; vincule Lead/Caso e defina Tipo e Assessor" },
      { label: "Preencher com → Preenchimento por Áudio", description: "grava a ligação ou seu ditado e a IA transcreve e preenche os campos sozinha" },
      { label: "Chat IA", description: "cria a atividade conversando com a IA" },
      { label: "Blocos / Lista", description: "alterna a visualização das atividades" },
      { label: "Telão (troféu)", description: "abre o ranking ao vivo do time (/tv/atividades)" },
      { label: "Play (Workflow)", description: "sessão sequencial: o sistema apresenta uma atividade por vez com cronômetro" },
      { label: "💬 Feedbacks", description: "feedbacks das atividades que você observa" },
      { label: "Chips de filtro", anchor: "Assessor", description: "Assessor, Tipo, Fluxo, Lead, Contato, Caso, 'Cronômetro ativo' e busca; 'Limpar' zera tudo" },
      { label: "Calendário lateral", description: "selecionar dias vira filtro; tem botão de compartilhar o resumo do dia" },
      { label: "Concluir / Concluir + próxima", description: "encerra a atividade (e o cronômetro) e já abre a seguinte" },
      { label: "Enviar ao Grupo / Assessor", description: "monta a mensagem da atividade e envia no WhatsApp, com preview editável" },
      { label: "Cronômetro automático", description: "abrir uma atividade sua liga o cronômetro sozinho; abrir a de outro assessor é só consulta" },
    ],
    tip: "O jeito mais fácil de registrar é gravar a atividade por áudio: Nova Atividade → \"Preencher com → Preenchimento por Áudio\" → fale o que foi feito → a IA preenche tudo → revise e clique em Criar. Nos vazios do dia, use o microfone \"O que faço?\" do cronômetro flutuante.",
  },
  {
    id: "dashboard",
    paths: ["/dashboard"],
    title: "Visão Geral",
    intro: "Portal de dashboards por funil e por processo — cada painel carrega quando você abre.",
    items: [
      { label: "Cartões de Funis", anchor: "Acidente de Trabalho", description: "Acidente de Trabalho, BPC - Autismo, Auxílio Maternidade/Acidente/Doença, Seguro de Vida — clique pra abrir o dashboard" },
      { label: "Cartões de Processos", anchor: "Acompanhamento Processual", description: "Acompanhamento Processual e Gerenciamento Acolhimento" },
      { label: "Abrir Kanban", description: "dentro do funil, vai direto pro board de leads" },
      { label: "Voltar", description: "retorna à grade de seleção" },
    ],
    tip: "Use como ponto de partida do gestor: abra o funil do dia, veja os números e pule pro Kanban só quando precisar operar.",
  },
  {
    id: "leads",
    paths: ["/leads"],
    title: "Leads (Kanban)",
    intro: "Board principal de leads por funil: arraste os cards entre etapas e abra a ficha completa.",
    items: [
      { label: "Seletor de funil", description: "troca o board ativo; também cria/edita/exclui quadros" },
      { label: "Buscar leads...", description: "filtra por nome, telefone ou número do caso" },
      { label: "Adicionar Lead", description: "cria lead; o extrator de IA preenche os dados a partir da notícia" },
      { label: "Arrastar o card", description: "muda a etapa; soltar em '✅ Fechado' vira cliente e cria o caso jurídico automaticamente" },
      { label: "Menu do card (⋮)", description: "Editar, Contatos, WhatsApp, Mover para fase, Marcar Fechado/Recusado/Inviável, Nova Atividade, Duplicar, Remover" },
      { label: "Ficha do lead", description: "abas Básico, Contatos, Atividades, Acidente, Jurídico, Documentos, Financeiro, Chat IA e Chat Equipe" },
      { label: "Relatório", description: "relatório do funil selecionado" },
      { label: "Métricas e Funil de Conversão", description: "expande gráficos de conversão e tempo por etapa" },
      { label: "Filtro de acolhedor", anchor: "Todos os acolhedores", description: "mostra só os cards de um acolhedor" },
    ],
    tip: "Trabalhe arrastando os cards — o fechamento é automático: soltar em \"✅ Fechado\" já gera número de caso, cria o caso jurídico e sincroniza a etiqueta do WhatsApp. Pra lead novo, use o extrator de IA no \"Adicionar Lead\".",
  },
  {
    id: "acolhimento",
    paths: ["/acolhimento"],
    title: "Gerenciamento Acolhimento",
    intro: "Painel ao vivo da operação de acolhimento: KPIs, funil, aging e matriz acolhedor × fase.",
    items: [
      { label: "Seletor de Funil", description: "escolhe o funil analisado" },
      { label: "KPIs", anchor: "No funil", description: "No funil, Conversão real, Parados +90d, Sem dono" },
      { label: "Funil + aging", anchor: "Raio-x de aging", description: "barras por etapa com mediana de dias e heatmap de tempo parado" },
      { label: "Matriz acolhedor × fase", anchor: "KPI por acolhedor", description: "clique numa célula pra listar os leads parados daquela interseção" },
      { label: "Ficha do lead", description: "botões Ligar, WhatsApp e 'Abrir no board'" },
    ],
    tip: "Vá direto na matriz: clique na célula com mais leads parados, abra a ficha de cada um e acione Ligar ou WhatsApp na hora.",
  },
  {
    id: "contacts",
    paths: ["/contacts"],
    title: "Contatos & Transmissão",
    intro: "Base de contatos, grupos de WhatsApp (com auditoria) e listas de transmissão.",
    items: [
      { label: "Abas", anchor: "Grupos", description: "Contatos, Grupos e Listas" },
      { label: "Novo Contato", description: "cadastro manual de contato" },
      { label: "Resolver duplicados", description: "busca e mescla contatos duplicados" },
      { label: "Classificar Clientes", description: "marca contatos de grupos de leads fechados como cliente" },
      { label: "Modo auditoria (aba Grupos)", anchor: "Filtrar e ordenar", description: "tabela tipo planilha pra conferir vínculo grupo↔lead↔caso; lápis corrige o nº do funil e renomeia o grupo no WhatsApp" },
      { label: "Vincular lead (grupos órfãos)", description: "liga o grupo ao lead certo, ou cria um lead novo já vinculado" },
      { label: "Atualizar dados em lote", description: "busca data de criação e criador dos grupos na UazAPI" },
      { label: "Nova Lista + Enviar", anchor: "Listas", description: "selecione contatos → crie a lista → envie transmissão (instância + mídia + mensagem); dá pra atribuir Agente IA à lista" },
    ],
    tip: "Pra auditar grupos: aba Grupos → Modo auditoria → resolva os divergentes e órfãos. Pra transmissão: selecione os contatos na aba Contatos → Nova Lista → Enviar.",
  },
  {
    id: "cases",
    paths: ["/cases"],
    title: "Casos",
    intro: "Setor processual: lista de casos jurídicos com processos e atividades de cada um.",
    items: [
      { label: "Buscar caso...", description: "por título, nº do caso, nome do lead ou nº CNJ do processo" },
      { label: "Filtros Status e Núcleo", description: "Aberto/Em Andamento/Encerrado/Arquivado e núcleos ativos" },
      { label: "Exportar", description: "exporta os casos filtrados pra Google Sheets" },
      { label: "Ações do caso", description: "Editar, Encerrar, Em Andamento, Arquivar, Excluir" },
      { label: "Aba Processos", anchor: "Processos", description: "'Cadastrar Processo' e 'Cadastrar todos' pros processos citados em atividades sem cadastro" },
      { label: "Aba Atividades", anchor: "Atividades", description: "filtro por Status (inclui '⚠ Atrasadas') e por Processo" },
      { label: "Editar Caso → processos automáticos", description: "checkboxes (Indenização, TRCT, Benefício INSS…) criam os processos e atribuem responsáveis" },
      { label: "Lead Vinculado", description: "clique abre a ficha do lead no board" },
    ],
    tip: "Rotina prática: filtre pelo seu Núcleo → expanda o caso → regularize os processos citados sem cadastro com \"Cadastrar todos\" → confira a aba Atividades com o filtro \"Atrasadas\".",
  },
  {
    id: "sales-funnels",
    paths: ["/sales-funnels"],
    title: "Funis de Vendas",
    intro: "Gestão dos funis: métricas de conversão por funil e acesso ao Kanban.",
    items: [
      { label: "Criar Funil", description: "abre o construtor de funil (etapas, checklists)" },
      { label: "Filtro de data no card", anchor: "Hoje", description: "presets Hoje/7d/30d/Tudo/Período, por data de cadastro ou de atualização" },
      { label: "Abrir Kanban", description: "vai pro board de leads daquele funil" },
      { label: "Abrir (painel BPC)", description: "painel detalhado com funil clicável por etapa, KPIs e filtro de acolhedores, em tempo real" },
      { label: "Equipe / Editar", description: "gerencia o time do funil e edita as etapas" },
    ],
    tip: "Ajuste o período no card pra ver a conversão real do mês antes de decidir onde atuar; daí \"Abrir Kanban\" pra operar.",
  },
  {
    id: "mapa-leads",
    paths: ["/mapa-leads"],
    title: "Mapa de Leads",
    intro: "Mapa geográfico dos leads com coordenadas, pinos coloridos por status.",
    items: [
      { label: "Busca e filtros", description: "nome/telefone/cidade + filtros de Status e Cidade; o zoom se ajusta aos resultados" },
      { label: "Popup do pino", description: "dados do lead e botão 'Abrir lead' pra ir à ficha no board" },
    ],
    tip: "Filtre por cidade pra planejar deslocamento/visitas e abra o lead direto do pino.",
  },
  {
    id: "referrals",
    paths: ["/referrals"],
    title: "Busca por Indicação",
    intro: "Encontra contatos por região, produto e classificação — ideal pra achar indicadores e parceiros.",
    items: [
      { label: "Filtros encadeados", description: "Estado → Cidade → Produto → Tipo (Clientes/Prospects)" },
      { label: "Busca livre", description: "nome, telefone, cidade, bairro ou profissão" },
    ],
    tip: "Estado → Cidade → Produto → Tipo \"Clientes\": a lista vira sua base de indicação naquela região.",
  },
  {
    id: "processes",
    paths: ["/processes"],
    title: "Processos",
    intro: "Central de processos judiciais e administrativos, com e-mails do PJe/INSS e planilha de perícias.",
    items: [
      { label: "Aba Judiciais", anchor: "Judiciais", description: "busca por número/parte/tribunal; clique no card abre os detalhes; lixeira exclui" },
      { label: "Aba INSS Administrativo", anchor: "INSS Administrativo", description: "requerimentos vindos do Gmail; botão 'Órfãos' mostra os sem caso; menu 'Vincular' faz match automático por nome/CPF" },
      { label: "Vincular (card órfão)", description: "sugestões automáticas por requerimento/CPF/nome; '(criar caso)' gera o caso na hora" },
      { label: "Aba Processual", anchor: "Processual", description: "e-mails PJe/PUSH com badge automático 'Prazo'; switch 'Apenas PUSH'" },
      { label: "Aba Sem movimento", anchor: "Sem movimento", description: "processos parados ≥30 dias por faixa e responsável, com 'Exportar CSV'" },
      { label: "Aba Perícias", anchor: "Perícias", description: "todas as datas de perícia em ordem; 'Só futuras' mostra as próximas" },
      { label: "Sincronizar agora / Sincronizar", description: "puxa os e-mails recentes do INSS/PJe manualmente" },
    ],
    tip: "Rotina diária: aba INSS → \"Órfãos\" → vincular com as sugestões automáticas; aba Processual com \"Apenas PUSH\" ligado pra caçar os badges \"Prazo\"; semanalmente, \"Sem movimento\" na faixa 90+ dias.",
  },
  {
    id: "hearings",
    paths: ["/hearings"],
    title: "Audiências",
    intro: "Agenda de audiências com visões Semana/Mês/Dia/Lista e sincronização com a planilha.",
    items: [
      { label: "Nova audiência", description: "abre o formulário; clicar numa célula de dia já cria com a data preenchida" },
      { label: "Sincronizar planilha", description: "importa novas/atualizadas da planilha sem apagar as que só existem aqui" },
      { label: "Filtros", anchor: "Todos os tipos", description: "Tipo, Categoria, Status + busca por processo/caso/observações" },
      { label: "Criar atividade", description: "dentro da audiência, gera a atividade de preparação vinculada" },
      { label: "‹ › e Hoje", anchor: "Hoje", description: "navegação de período" },
    ],
    tip: "Visão Semana → clique no dia → preencha processo/hora/responsável → salve e já clique em \"Criar atividade\" pra gerar a tarefa de preparação.",
  },
  {
    id: "acompanhamento",
    paths: ["/processual/acompanhamento"],
    title: "Acompanhamento Processual",
    intro: "Dashboard de eficiência do fluxo jurídico: SLAs por fase, latência, gargalos e atrasos do dia.",
    items: [
      { label: "Período", anchor: "Semana", description: "abas Hoje / Semana / Mês" },
      { label: "Cards de SLA", anchor: "Tempo médio de tramitação", description: "tempo médio de tramitação por fase, com tendência" },
      { label: "Fechamento → Protocolo", anchor: "Fechamento do caso", description: "gargalo de protocolo por categoria (fechados/protocolados/pendentes)" },
      { label: "Atividades atrasadas — hoje", description: "filtro por responsável; clique na linha abre a atividade" },
      { label: "Relatório de Atividades", description: "produtividade por usuário (diária/semanal/mensal)" },
    ],
    tip: "Período Mês → leia o gargalo fechamento→protocolo por categoria → desça até as atrasadas filtrando por responsável pra cobrar na hora.",
  },
  {
    id: "process-tracking",
    paths: ["/process-tracking"],
    title: "Controle Processual",
    intro: "Planilha editável de processos trabalhistas e previdenciários, com importação por CSV, Sheets e PDF (IA).",
    items: [
      { label: "Selecionar CSV / Importar (Sheets) / Selecionar PDF", description: "3 formas de importar; o PDF é extraído por IA" },
      { label: "Conflitos por CPF", description: "na importação, escolha Sobrescrever ou Pular por linha" },
      { label: "Abas Trabalhista / Previdenciário", description: "separadas pelo prefixo do caso (CASO/PREV)" },
      { label: "Novo Registro", description: "cadastro manual completo" },
      { label: "Edição inline", description: "clique na célula e edite direto na tabela" },
    ],
    tip: "Importe pela planilha (CSV/Sheets) e mantenha o dia a dia com edição inline — só use \"Novo Registro\" pra caso avulso.",
  },
  {
    id: "bpc-autista",
    paths: ["/processual/bpc-autista"],
    title: "Dossiê INSS (Aux. Acidente / BPC)",
    intro: "Lê a pasta do caso no Drive, tria os documentos com IA e monta o dossiê em PDF único pra protocolar no INSS.",
    items: [
      { label: "Busca do caso", anchor: "Título do caso ou número PREV", description: "digite o título ou número PREV" },
      { label: "Analisar pasta do Drive", description: "a IA classifica cada documento (favorável/adverso/neutro) e bloqueia os sensíveis" },
      { label: "Recomendação da triagem", description: "diz se está protocolável e o que falta (documentos e campos)" },
      { label: "Checkbox por documento", description: "monte o dossiê só com os favoráveis" },
      { label: "Baixar dossiê (PDF)", description: "gera o PDF combinado pronto pro protocolo manual" },
    ],
    tip: "Buscar o caso → \"Analisar pasta do Drive\" → conferir a recomendação → marcar os favoráveis → \"Baixar dossiê (PDF)\".",
  },
  {
    id: "gerar-procuracao",
    paths: ["/gerar-procuracao"],
    title: "Gerar Procuração",
    intro: "Gera a procuração pelo telefone do cliente: a IA preenche os campos e envia pra assinatura (ZapSign) via WhatsApp.",
    items: [
      { label: "Telefone (WhatsApp) + Abrir", anchor: "Telefone", description: "localiza a conversa/lead/contato pelo telefone e abre o popup do documento" },
      { label: "Enviar pela instância", description: "escolhe de qual número o documento sai" },
      { label: "Popup do documento", description: "revise os campos extraídos pela IA e os signatários antes de confirmar o envio" },
    ],
    tip: "Digite o telefone com DDD → \"Abrir\" → revise os campos → confirme. A IA preenche a partir dos dados do lead/conversa.",
  },
  {
    id: "nuclei",
    paths: ["/nuclei"],
    title: "Núcleos Especializados",
    intro: "Cadastro dos núcleos que prefixam a numeração dos casos (ex.: AT-0001).",
    items: [
      { label: "Novo", description: "cria núcleo com nome, prefixo (até 6 letras) e cor" },
      { label: "Switch por card", description: "ativa/desativa o núcleo pra casos novos" },
      { label: "Lápis / lixeira", description: "edita ou exclui (casos já vinculados não são afetados)" },
    ],
  },
  {
    id: "whatsapp",
    paths: ["/whatsapp", "/whatsapp-api"],
    title: "WhatsApp",
    intro: "Inbox unificada: conversas de todas as instâncias e do número oficial (WhatsJUD API), com IA de apoio.",
    items: [
      { label: "Abas WhatsApp / WhatsJUD API", description: "alternam entre as instâncias e o número oficial Meta" },
      { label: "Seletor de instância", anchor: "Todas conectadas", description: "filtra as conversas por número; bolinha verde = conectada" },
      { label: "QR / Código / Reconectar", description: "pareia ou reconecta uma instância caída" },
      { label: "Sugerir resposta com IA", description: "em qualquer mensagem, a IA propõe a resposta pra você revisar" },
      { label: "Criar Lead + Contato", description: "a IA extrai os dados da conversa e cria o lead" },
      { label: "Criar Caso Jurídico", description: "'Preencher com IA a partir da conversa' monta título, descrição e detecta processos (CNJ/INSS)" },
      { label: "Atualizar com IA", description: "completa os campos do lead/contato com o que apareceu na conversa" },
      { label: "Mudar etiqueta / etapa", description: "sincroniza a etiqueta do WhatsApp com a etapa do Kanban" },
      { label: "Criar atividade a partir da mensagem", description: "transforma a mensagem em atividade vinculada" },
      { label: "Salvar mídia no Drive", description: "guarda o arquivo na pasta do lead, classificado por IA" },
      { label: "Lote", description: "seleção em massa de conversas → 'Criar Leads em Lote'" },
    ],
    tip: "Deixe a IA trabalhar: responda com \"Sugerir resposta com IA\", e quando o lead evoluir use \"Criar Lead + Contato\" → \"Criar Caso Jurídico\" — tudo preenchido a partir da própria conversa.",
  },
  {
    id: "campanhas",
    paths: ["/campanhas"],
    title: "Campanhas",
    intro: "Todas as campanhas com custo, leads gerados e retorno (ROI, CAC, LTV).",
    items: [
      { label: "Nova campanha", description: "cadastra a campanha com investimento" },
      { label: "Card da campanha", description: "status, leads/casos/processos, investido, honorários e ROI; clique abre o detalhe" },
      { label: "Detalhe", description: "métricas CAC/LTV/ROI + abas Leads, Atividades e Fluxo" },
    ],
    tip: "Acompanhe o ROI geral no topo e entre no detalhe só das campanhas fora da curva.",
  },
  {
    id: "relatorios",
    paths: ["/relatorios"],
    title: "Relatórios IA",
    intro: "Pergunte em português e a IA monta o relatório na hora (somente leitura; CPF mascarado).",
    items: [
      { label: "Exemplos clicáveis", anchor: "Casos abertos por núcleo", description: "ex.: 'Casos abertos por núcleo', 'Leads que viraram cliente esse mês'" },
      { label: "Campo de pergunta", description: "Enter envia; o follow-up mantém o contexto da conversa" },
      { label: "Ver a consulta usada", description: "mostra o SQL que gerou a tabela" },
    ],
    tip: "Pergunte do jeito que você falaria (\"atividades atrasadas do João\") e refine com follow-up em vez de reescrever a pergunta.",
  },
  {
    id: "team",
    paths: ["/team"],
    title: "Equipe",
    intro: "Gestão da equipe: produtividade, metas, avaliações, membros, times, férias e permissões.",
    items: [
      { label: "Pílulas de navegação", anchor: "Produtividade", description: "Produtividade, Métricas, Metas, Avaliações, Tráfego, Membros, Times, Férias, Embaixadores, Carreira, Rotinas, WhatsApp, Cartões, Contas, Acessos, Perfis" },
      { label: "Membros", description: "cadastro e edição de pessoas" },
      { label: "Acessos / Perfis", description: "permissões por módulo e perfis de acesso" },
      { label: "Férias", description: "registra folgas — atividades não são atribuídas a quem está de folga" },
    ],
    tip: "Produtividade pro acompanhamento do dia; Membros + Acessos/Perfis quando entrar gente nova.",
  },
  {
    id: "analytics",
    paths: ["/analytics"],
    title: "Analytics",
    intro: "Analytics de redes sociais (Instagram): contas, comentários, evolução, engajamento e seguidores.",
    items: [
      { label: "Abas", anchor: "Dashboard", description: "Contas, Busca, Comentários, Externos, Evolução, Dashboard, Plataformas, Estratégias, Seguidores" },
      { label: "Seletor de período", description: "nas abas Dashboard e Plataformas" },
    ],
  },
  {
    id: "finance",
    paths: ["/finance"],
    title: "Finanças",
    intro: "Controle financeiro via Open Finance (Pluggy): cartões, contas, lançamentos e categorização.",
    items: [
      { label: "Conectar / Sincronizar", description: "conecta o banco via Pluggy e puxa até 24 meses de transações" },
      { label: "Filtro de período + filtros", description: "instituição, conta, cartão, contato, categoria" },
      { label: "Aba Cartão → Pendentes", anchor: "Pendentes", description: "fila de transações a categorizar — o coração da rotina" },
      { label: "Por Dia / Lista", description: "visões com exportação" },
      { label: "Config (admin)", description: "permissões de cartão, categorias e contas de custo" },
      { label: "Lançamentos", description: "lançamento manual avulso" },
    ],
    tip: "Rotina: Sincronizar → aba Cartão → \"Pendentes\" → categorizar tudo → conferir na visão Por Dia e exportar.",
  },
  {
    id: "settings",
    paths: ["/settings"],
    title: "Configurações",
    intro: "Central de configurações do WhatsApp e do escritório.",
    items: [
      { label: "Instâncias", description: "cria e gerencia os números de WhatsApp" },
      { label: "Agentes IA", description: "agentes que respondem conversas sozinhos (prompt, voz, follow-up, discadora, campanhas)" },
      { label: "Voz (TTS)", description: "configuração de voz das respostas em áudio" },
      { label: "Notificações / Relatórios", description: "push e relatórios automáticos" },
      { label: "Onboarding / Etiquetas-Gatilho / Automações", description: "fluxos automáticos por etiqueta e etapa" },
      { label: "Integração / Logs do Sistema", description: "guia de setup e depuração de webhooks" },
    ],
    tip: "Ordem de configuração: Instâncias → Agentes IA → Notificações. Quando algo não chegar, vá direto em Logs do Sistema.",
  },
  {
    id: "noticias",
    paths: ["/noticias"],
    title: "Notícias",
    intro: "Triagem de leads captados de notícias: a IA enriquece, você promove a viável ou cadastra o caso.",
    items: [
      { label: "Analisar títulos (n)", description: "IA extrai vítima/cidade/UF e arquiva estrangeiras (roda 1x automático por visita)" },
      { label: "Cards Total / 📰 Notícias / ⭐ Viáveis", description: "clicáveis, filtram a lista" },
      { label: "Viável", description: "promove a notícia pra fila de viáveis" },
      { label: "Cadastrar", description: "abre a análise IA e cria o caso + grupo WhatsApp" },
      { label: "Seleção múltipla + Descartar", description: "limpa em massa (com Desfazer no toast)" },
      { label: "Chip de grupo", description: "expande as fontes duplicadas da mesma notícia" },
    ],
    tip: "Deixe a IA analisar → filtre \"⭐ Viáveis\" → \"Cadastrar\" os promissores → descarte o resto em massa.",
  },
  {
    id: "calls",
    paths: ["/calls"],
    title: "Ligações",
    intro: "Registro e acompanhamento de ligações: histórico, resultado, áudio, resumo por IA e retornos.",
    items: [
      { label: "Registrar", description: "nova ligação: tipo, resultado, lead, contato, duração e próximo passo" },
      { label: "Cards do topo", anchor: "Taxa de Contato", description: "Hoje, Esta Semana, Taxa de Contato, Duração Média + alerta de retornos agendados" },
      { label: "Abas Lista / Timeline por Lead", description: "tabela geral ou histórico agrupado por lead" },
      { label: "Detalhe da ligação", description: "player de áudio, Resumo da IA, avaliação por estrelas e agendamento de retorno" },
    ],
    tip: "Registre logo após desligar e use o detalhe pra ouvir o áudio e ler o resumo da IA antes do retorno agendado.",
  },
  {
    id: "banco-horas",
    paths: ["/banco-horas"],
    title: "Banco de Horas",
    intro: "Tempo cronometrado por membro e tipo de atividade: ativo, ocioso e pausas justificadas.",
    items: [
      { label: "De / Até + Aplicar período", anchor: "Aplicar período", description: "define o intervalo do relatório" },
      { label: "Filtros Time / Assessor / Tipo", anchor: "Assessor", description: "multi-seleção com busca" },
      { label: "Totais", anchor: "Tempo ativo", description: "Tempo ativo, Trabalho avulso, Tempo ocioso, Atividades, Membros" },
      { label: "Exportar CSV", description: "baixa o detalhamento pro fechamento do banco de horas" },
    ],
    tip: "Período do mês → filtrar o time → \"Exportar CSV\" pro fechamento. Pausas justificadas (almoço/intervalo) não contam como ocioso.",
  },
  {
    id: "leaderboard",
    paths: ["/leaderboard"],
    title: "Campeonato de Engajamento",
    intro: "Ranking semanal de engajamento no chat interno.",
    items: [
      { label: "Ranking", description: "top 3 com medalhas; cada linha mostra menções, comentários e pontos" },
      { label: "Regra de pontos", description: "Menção = 5 pts; Comentário = 2 pts" },
    ],
  },
  {
    id: "destaques",
    paths: ["/destaques"],
    title: "Destaques",
    intro: "Top 5 de avaliação dos clientes (média de estrelas dos feedbacks).",
    items: [
      { label: "Período", anchor: "Últimos 30 dias", description: "Últimos 30 dias ou Tudo" },
      { label: "Modo TV", description: "tela cheia com atualização automática a cada 90s — feito pra telão" },
    ],
  },
];

/** Resolve o guia da rota atual: "/" só casa exato; demais por prefixo, prefixo mais longo vence. */
export function findGuideForPath(pathname: string): FeatureGuideDef | undefined {
  let best: FeatureGuideDef | undefined;
  let bestLen = -1;
  for (const guide of featureGuides) {
    for (const p of guide.paths) {
      const match = p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/");
      if (match && p.length > bestLen) {
        best = guide;
        bestLen = p.length;
      }
    }
  }
  return best;
}
