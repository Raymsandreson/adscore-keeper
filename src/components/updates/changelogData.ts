export interface ChangelogFeature {
  title: string;
  description: string;
  icon: string; // emoji
  howToUse?: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  features: ChangelogFeature[];
}

/**
 * Add new entries at the TOP of this array.
 * The first entry is always shown when an update is available.
 */
export const changelog: ChangelogEntry[] = [
  {
    version: "3.3.0",
    date: "2026-03-28",
    title: "Criação automática de Lead ao assinar documento",
    features: [
      {
        title: "Auto-criação de Lead e Contato na assinatura",
        description: "Quando um documento é assinado via ZapSign e não há lead vinculado, o sistema cria automaticamente o contato e o lead, extraindo dados da conversa via IA. O funil é determinado automaticamente pela campanha CTWA de origem.",
        icon: "📝",
        howToUse: "Funciona automaticamente! O sistema identifica a campanha CTWA da conversa, usa o funil configurado nela, extrai dados via IA e cria lead + contato com todas as informações enriquecidas.",
      },
    ],
  },
  {
    version: "3.2.0",
    date: "2026-03-28",
    title: "Automações de Campanha e Melhorias",
    features: [
      {
        title: "Agente IA por campanha CTWA",
        description: "Vincule um agente de IA a uma campanha Click-to-WhatsApp. O agente responde automaticamente as conversas que chegam pelo anúncio.",
        icon: "🤖",
        howToUse: "Vá em WhatsApp → Agentes IA → aba 'Campanhas CTWA'. Clique em 'Vincular Agente', escolha o agente, a instância e a campanha. O agente passará a responder conversas novas daquela campanha.",
      },
      {
        title: "Pausar/retomar agente na campanha",
        description: "Agora você pode pausar o agente vinculado a uma campanha sem perder o vínculo, e reativá-lo quando quiser.",
        icon: "⏸️",
        howToUse: "Na lista de vínculos de campanha, use o botão de pausar/retomar ao lado de cada vínculo.",
      },
      {
        title: "Agente usa nome da instância",
        description: "O agente de IA agora se identifica automaticamente com o nome do usuário da instância WhatsApp pela qual está respondendo.",
        icon: "👤",
        howToUse: "Configure o nome do usuário na instância WhatsApp. O agente usará esse nome ao se apresentar nas conversas.",
      },
      {
        title: "Rastreabilidade de campanha nas mensagens",
        description: "Cada mensagem e ação agora registra o campaign_id e se foi feita pelo sistema ou por um membro da equipe.",
        icon: "🏷️",
        howToUse: "Ao visualizar mensagens ou histórico de ações, você verá indicadores de origem (sistema vs membro) e qual campanha gerou a conversa.",
      },
      {
        title: "Atualização de conversas ao trocar de chat",
        description: "As conversas do WhatsApp agora atualizam ao abrir ou trocar de chat, em vez de polling a cada 30s.",
        icon: "⚡",
        howToUse: "Basta abrir uma conversa — as mensagens mais recentes serão carregadas automaticamente.",
      },
      {
        title: "Troca de instância corrigida",
        description: "Ao trocar de instância no WhatsApp, as conversas agora atualizam corretamente mostrando os dados da instância selecionada.",
        icon: "🔄",
      },
    ],
  },
  {
    version: "3.1.0",
    date: "2026-03-19",
    title: "WhatsApp: Atividades e Notas no Chat",
    features: [
      {
        title: "Criar atividade direto do WhatsApp",
        description: "Agora você pode criar atividades do CRM sem sair da conversa do WhatsApp.",
        icon: "📋",
        howToUse: "Na conversa do WhatsApp, clique no ícone de anexo (📎) → 'Criar Atividade'. A atividade criada aparecerá como registro verde na timeline do chat.",
      },
      {
        title: "Chat Interno na conversa",
        description: "Converse com a equipe dentro da conversa do WhatsApp, sem que o cliente veja.",
        icon: "💬",
        howToUse: "Na conversa, clique em 'Chat Interno' no menu de anexo. Mencione colegas com @nome para notificá-los.",
      },
      {
        title: "Notas internas no WhatsApp",
        description: "Adicione notas privadas na timeline da conversa, visíveis apenas para a equipe.",
        icon: "📝",
        howToUse: "Clique no ícone de anexo → 'Nota Interna'. A nota aparecerá em amarelo na timeline.",
      },
      {
        title: "Menu flutuante arrastável",
        description: "O menu minimizado agora pode ser reposicionado arrastando-o pela tela.",
        icon: "✋",
        howToUse: "Quando o menu estiver minimizado, segure e arraste pela alça (⠿) para mover. Toque duplo para resetar a posição.",
      },
    ],
  },
  {
    version: "3.0.0",
    date: "2026-03-15",
    title: "Notas de atualização automáticas",
    features: [
      {
        title: "Sistema de changelog automático",
        description: "Agora você será notificado sempre que houver novidades no sistema, com instruções de como usar cada recurso.",
        icon: "🆕",
        howToUse: "Quando o botão 🔄 ficar verde, clique nele. Ou acesse as novidades a qualquer momento pelo menu.",
      },
    ],
  },
  {
    version: "2.9.0",
    date: "2026-03-10",
    title: "Menções em tempo real",
    features: [
      {
        title: "Menções atualizadas instantaneamente",
        description: "As menções no chat da equipe agora aparecem em tempo real, sem precisar recarregar a página.",
        icon: "🔔",
        howToUse: "Quando alguém te mencionar no chat da equipe, a notificação aparecerá automaticamente no painel de menções — sem delay!",
      },
    ],
  },
  {
    version: "2.8.0",
    date: "2026-03-05",
    title: "Melhorias na experiência do Lead",
    features: [
      {
        title: "Chat da Equipe dentro do Lead",
        description: "Agora o chat da equipe é uma aba integrada dentro do lead, sem precisar abrir uma tela separada.",
        icon: "💬",
        howToUse: "Abra qualquer lead → clique na aba 'Chat Equipe' ao lado de 'Chat IA'. Converse com sua equipe diretamente no contexto do lead.",
      },
      {
        title: "Funil de Vendas / Fluxo de Trabalho",
        description: "Visualize todas as etapas do funil ou fluxo de trabalho diretamente dentro do lead, com indicadores de progresso para cada fase.",
        icon: "📊",
        howToUse: "Abra qualquer lead → clique na aba 'Funil de Vendas' (ou 'Fluxo de Trabalho' para casos). Veja as etapas concluídas (✅), a atual (🔵) e as pendentes (⚪).",
      },
      {
        title: "Rascunhos do Chat preservados",
        description: "Ao trocar de aba dentro do lead, o texto que você estava digitando no chat é salvo automaticamente e restaurado quando voltar.",
        icon: "📝",
        howToUse: "Comece a digitar uma mensagem no chat → troque de aba → volte ao chat. Seu texto estará lá!",
      },
      {
        title: "Notas de atualização interativas",
        description: "Agora, antes de atualizar o sistema, você vê exatamente o que mudou e como usar cada novidade.",
        icon: "🆕",
        howToUse: "Quando o botão 🔄 ficar verde, clique nele para ver as novidades antes de atualizar.",
      },
    ],
  },
];
