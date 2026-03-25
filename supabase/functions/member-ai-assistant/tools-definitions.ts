export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "get_overdue_tasks",
      description: "Busca tarefas/atividades atrasadas do membro ou de toda a equipe",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["mine", "all"], description: "mine = apenas do membro, all = toda equipe" },
          limit: { type: "number", description: "Quantidade máxima de resultados" },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_daily_summary",
      description: "Gera um resumo de produtividade do dia (atividades criadas, concluídas, leads novos)",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["mine", "all"], description: "mine = apenas do membro, all = toda equipe" },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_leads_summary",
      description: "Retorna informações sobre leads recentes, contagem por etapa, ou detalhes de um lead específico",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["mine", "all"] },
          search: { type: "string", description: "Nome do lead para buscar (opcional)" },
          limit: { type: "number" },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_activity",
      description: "Cria uma nova atividade/tarefa no sistema",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título da atividade" },
          description: { type: "string", description: "Descrição detalhada" },
          activity_type: { type: "string", description: "Tipo da atividade (ex: tarefa, audiencia, prazo, reuniao)" },
          priority: { type: "string", enum: ["baixa", "normal", "alta", "urgente"] },
          deadline: { type: "string", description: "Data limite no formato YYYY-MM-DD" },
          notification_date: { type: "string", description: "Data da notificação no formato YYYY-MM-DDTHH:mm (opcional)" },
          lead_name: { type: "string", description: "Nome do lead associado (opcional)" },
          notes: { type: "string", description: "Observações gerais da atividade" },
          what_was_done: { type: "string", description: "O que foi feito até agora" },
          next_steps: { type: "string", description: "Próximo passo planejado" },
          current_status_notes: { type: "string", description: "Observação de status atual" },
          media_url: { type: "string", description: "URL da mídia anexada pelo membro (imagem ou documento) para vincular à atividade" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_goals_progress",
      description: "Consulta o progresso das metas (comissões) ativas",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["mine", "all"] },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_lead",
      description: "Cria um novo lead no sistema. Precisa de pelo menos o nome e o board_id (quadro/funil). Use list_boards para descobrir os quadros disponíveis.",
      parameters: {
        type: "object",
        properties: {
          lead_name: { type: "string", description: "Nome do lead (pessoa ou empresa)" },
          board_id: { type: "string", description: "ID do quadro/funil onde criar o lead" },
          stage_id: { type: "string", description: "ID da etapa inicial (opcional, usa a primeira do quadro se não informado)" },
          lead_value: { type: "number", description: "Valor estimado do lead em R$" },
          phone: { type: "string", description: "Telefone do lead" },
          email: { type: "string", description: "Email do lead" },
          notes: { type: "string", description: "Observações sobre o lead" },
        },
        required: ["lead_name", "board_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_lead",
      description: "Atualiza informações de um lead existente. Use get_leads_summary para encontrar o lead primeiro.",
      parameters: {
        type: "object",
        properties: {
          lead_id: { type: "string", description: "ID do lead a atualizar" },
          lead_name: { type: "string", description: "Novo nome do lead" },
          lead_value: { type: "number", description: "Novo valor do lead em R$" },
          notes: { type: "string", description: "Novas observações" },
          assigned_to: { type: "string", description: "ID do novo responsável" },
        },
        required: ["lead_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_lead_stage",
      description: "Move um lead para outra etapa/fase do funil. Use list_board_stages para ver as etapas disponíveis.",
      parameters: {
        type: "object",
        properties: {
          lead_id: { type: "string", description: "ID do lead" },
          new_stage: { type: "string", description: "Nome ou ID da nova etapa" },
          board_id: { type: "string", description: "ID do quadro (necessário se informar nome da etapa)" },
        },
        required: ["lead_id", "new_stage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_boards",
      description: "Lista todos os quadros/funis disponíveis no sistema (funis de vendas e fluxos de trabalho)",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_board_stages",
      description: "Lista todas as etapas/fases de um quadro/funil específico",
      parameters: {
        type: "object",
        properties: {
          board_id: { type: "string", description: "ID do quadro" },
        },
        required: ["board_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_contact",
      description: "Cria um novo contato no sistema",
      parameters: {
        type: "object",
        properties: {
          full_name: { type: "string", description: "Nome completo do contato" },
          phone: { type: "string", description: "Telefone do contato" },
          email: { type: "string", description: "Email do contato" },
          city: { type: "string", description: "Cidade" },
          state: { type: "string", description: "Estado (UF)" },
          classification: { type: "string", description: "Classificação do contato (ex: cliente, parceiro, indicação)" },
          notes: { type: "string", description: "Observações" },
        },
        required: ["full_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "link_contact_to_lead",
      description: "Vincula um contato existente a um lead existente. Use get_leads_summary e search_contacts para encontrar os IDs.",
      parameters: {
        type: "object",
        properties: {
          contact_id: { type: "string", description: "ID do contato" },
          lead_id: { type: "string", description: "ID do lead" },
          relationship_to_victim: { type: "string", description: "Relação com a vítima (opcional)" },
          notes: { type: "string", description: "Notas sobre o vínculo" },
        },
        required: ["contact_id", "lead_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_contacts",
      description: "Busca contatos por nome, telefone ou email",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Termo de busca (nome, telefone ou email)" },
          limit: { type: "number", description: "Máximo de resultados" },
        },
        required: ["search"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_team_members",
      description: "Lista membros da equipe para poder atribuir leads e atividades",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_leads_by_location",
      description: "Busca leads próximos por cidade e/ou estado. Use quando o membro informar uma localização ou pedir leads próximos.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "Nome da cidade para filtrar" },
          state: { type: "string", description: "Sigla do estado (UF) para filtrar" },
          limit: { type: "number", description: "Máximo de resultados (padrão 10)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_lead_details",
      description: "Retorna detalhes completos de um lead específico incluindo campos customizados, valor, etapa, responsável e informações de contato",
      parameters: {
        type: "object",
        properties: {
          lead_id: { type: "string", description: "ID do lead" },
          lead_name: { type: "string", description: "Nome do lead para buscar (alternativa ao ID)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_lead_contacts_summary",
      description: "Retorna um resumo dos contatos vinculados a um lead, incluindo histórico de relacionamento e informações de cada contato",
      parameters: {
        type: "object",
        properties: {
          lead_id: { type: "string", description: "ID do lead" },
          lead_name: { type: "string", description: "Nome do lead para buscar (alternativa ao ID)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manage_conversation_agent",
      description: "Ativa ou desativa o agente de IA em uma conversa WhatsApp. Use quando o membro pedir para parar, desativar, ativar ou pausar o assistente/agente em uma conversa específica. Busque o contato pelo nome para encontrar o telefone.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["activate", "deactivate", "status"], description: "Ação: activate (ativar), deactivate (desativar), status (verificar status)" },
          contact_name: { type: "string", description: "Nome do contato/conversa para buscar o telefone" },
          phone: { type: "string", description: "Telefone da conversa (alternativa ao nome)" },
          instance_name: { type: "string", description: "Nome da instância WhatsApp (opcional, busca automaticamente se não informado)" },
        },
        required: ["action"],
      },
    },
  },
]
