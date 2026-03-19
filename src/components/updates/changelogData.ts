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
