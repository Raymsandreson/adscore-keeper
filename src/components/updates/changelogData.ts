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
    version: "3.4.1",
    date: "2026-07-24",
    title: "Status do POP: definido pelo passo concluído",
    features: [
      {
        title: "Cada passo pode definir o status do lead",
        description:
          "No Editar POP, cada passo ganhou a opção 'Definir status': ao concluir o passo, o lead recebe esse status automaticamente (com a data de hoje) e conta no ranking. O 'Mover para' ficou só com as FASES — o '✅ Finalizar' saiu de lá (finalizar virou status). E o campo agora se chama STATUS (antes 'Resultado'), porque há estados intermediários tipo 'Em andamento'.",
        icon: "🎯",
        howToUse:
          "1) Editar POP → em cada passo, escolha 'Definir status' (ex.: passo 'Perícia deferida' → status 'No Deferimento'). Quem marcar esse passo no lead já move o status sozinho. 2) Também dá pra setar à mão na tela do lead em '🎯 Status do POP', com a data. Os status possíveis e o esperado (✅) você cadastra no próprio POP.",
      },
    ],
  },
  {
    version: "3.4.0",
    date: "2026-07-24",
    title: "Novo Ranking do Telão: o que faz o processo AVANÇAR conta mais",
    features: [
      {
        title: "Nova ordem do ranking (Corrida Maluca)",
        description:
          "O telão passa a priorizar o que realmente faz o processo avançar. Nova ordem: 1º Resultado esperado do POP · 2º Fases fechadas · 3º Objetivos concluídos · 4º Passos · depois itens do checklist, concluídas, menos atrasadas, mais tempo ativo, menos ocioso e resposta no chat. Marcar muitos passos soltos não sobe mais no ranking — fechar objetivos, fases e o resultado esperado, sim.",
        icon: "🏁",
        howToUse:
          "Nada a fazer: o ranking já ordena assim. Fase = todos os checklists de uma etapa do lead fechados; objetivo = um checklist concluído; ambos creditados a quem marcou o último passo. Passos viram o 4º critério.",
      },
      {
        title: "Resultado esperado por POP (1º critério)",
        description:
          "Cada funil/POP define seus próprios resultados possíveis e marca qual é o ESPERADO (= sucesso / objetivo final). O ranking conta, no mês, quantos leads cada pessoa levou ao resultado esperado do seu funil — é o critério nº 1, e cada time é medido pelo resultado do seu POP.",
        icon: "🎯",
        howToUse:
          "1) Funis de Vendas → Editar funil → role até '🎯 Resultados possíveis do POP': cadastre os resultados (ex.: Fechado, Recusado) e marque o esperado. 2) Na tela do lead, use o campo '🎯 Resultado do POP' pra registrar o resultado de cada lead. Vale deste mês em diante.",
      },
      {
        title: "Recorde por time + selo no canto",
        description:
          "O recorde do telão agora respeita o time selecionado (acabou o recorde de um time aparecendo em outro) e virou um selo em destaque no canto superior direito. O rótulo é 'Recorde por dia/semana/mês' — a melhor marca de um único período, não o de hoje.",
        icon: "🏆",
        howToUse:
          "Abra o telão e filtre por time: o recorde mostrado é sempre daquele time. Quem supera o recorde ao vivo ganha o som e o troféu.",
      },
    ],
  },
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
        title: "Funil de Vendas / POP",
        description: "Visualize todas as etapas do funil ou POP diretamente dentro do lead, com indicadores de progresso para cada fase.",
        icon: "📊",
        howToUse: "Abra qualquer lead → clique na aba 'Funil de Vendas' (ou 'POP' para casos). Veja as etapas concluídas (✅), a atual (🔵) e as pendentes (⚪).",
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
