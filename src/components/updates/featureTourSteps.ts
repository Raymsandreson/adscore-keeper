import { type TourStep } from "./FeatureTour";

/**
 * Tour steps for each changelog feature.
 * Keys match the feature title so the dialog can launch the right tour.
 */
export const featureTourMap: Record<string, TourStep[]> = {
  "Criar atividade direto do WhatsApp": [
    {
      selector: '[data-tour="whatsapp-dock-btn"]',
      title: "1. Abra o WhatsApp",
      description: "Clique no botão verde do WhatsApp no dock flutuante para abrir a lista de conversas.",
      position: "top",
    },
    {
      selector: '[data-tour="chat-attach"], [title="Anexar"]',
      title: "2. Clique no menu de anexo",
      description: "Dentro da conversa, clique no ícone de anexo (📎) para ver as opções disponíveis.",
      position: "top",
    },
    {
      selector: '[data-tour="create-activity"], [data-tour="attach-activity"]',
      title: "3. Selecione 'Criar Atividade'",
      description: "Escolha a opção 'Criar Atividade' no menu. A atividade criada aparecerá como registro verde na timeline.",
      position: "bottom",
    },
  ],
  "Chat Interno na conversa": [
    {
      selector: '[title="WhatsApp"], [data-tour="whatsapp-btn"]',
      title: "1. Abra uma conversa",
      description: "Abra qualquer conversa no WhatsApp pelo dock flutuante.",
      position: "top",
    },
    {
      selector: '[data-tour="chat-attach"], [title="Anexar"]',
      title: "2. Menu de anexo",
      description: "Clique no ícone de anexo (📎) para abrir as opções.",
      position: "top",
    },
    {
      selector: '[data-tour="internal-chat"], [data-tour="attach-chat"]',
      title: "3. Chat Interno",
      description: "Selecione 'Chat Interno' e mencione colegas com @nome. A mensagem aparecerá em azul, visível apenas para a equipe.",
      position: "bottom",
    },
  ],
  "Notas internas no WhatsApp": [
    {
      selector: '[title="WhatsApp"], [data-tour="whatsapp-btn"]',
      title: "1. Abra uma conversa",
      description: "Abra qualquer conversa no WhatsApp.",
      position: "top",
    },
    {
      selector: '[data-tour="chat-attach"], [title="Anexar"]',
      title: "2. Menu de anexo",
      description: "Clique no ícone de anexo (📎).",
      position: "top",
    },
    {
      selector: '[data-tour="internal-note"], [data-tour="attach-note"]',
      title: "3. Nota Interna",
      description: "Selecione 'Nota Interna'. A nota aparecerá em amarelo na timeline, visível apenas para a equipe.",
      position: "bottom",
    },
  ],
  "Menu flutuante arrastável": [
    {
      selector: '[data-drag-handle]',
      title: "1. Alça de arraste",
      description: "Segure e arraste este ícone (⠿) para mover o dock flutuante pela tela.",
      position: "top",
    },
    {
      selector: '[data-drag-handle]',
      title: "2. Resetar posição",
      description: "Toque duplo na alça para voltar o dock à posição original no centro inferior.",
      position: "top",
    },
  ],
};
