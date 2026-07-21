# Módulo Leads e CRM

Documentação funcional das telas de leads, acolhimento, contatos, casos, funis e mapa. Rótulos entre aspas são o texto exato exibido na interface.

---

## Leads (Kanban) — `/leads`

**Propósito**: board Kanban principal de gestão de leads por funil — arrasta cards entre etapas, abre a ficha completa do lead e dispara os efeitos de fechamento (vira cliente, cria caso jurídico automaticamente).

- Seletor de funil — troca o board; permite criar/editar/excluir quadro.
- "Buscar leads..." — por nome, telefone ou número do caso.
- Filtro de acolhedor; ícone de atualizar; "Relatório" (relatório do funil); filtro por checklists da etapa.
- "Adicionar Lead" — cria lead com seleção de funil e formulário de acidente; inclui extrator de dados por IA (cola a notícia, a IA preenche).
- "Métricas e Funil de Conversão" — expande gráficos de conversão e tempo por etapa.
- Menu do card: "Editar", "Gerenciar Contatos", "Ver perfil Instagram", "Comentário original", "WhatsApp", "Mover para fase" (inclusive outros boards), "Marcar como Fechado/Recusado/Inviável/Cancelado", "Nova Atividade", "Duplicar Lead", "Remover".
- Ficha do lead (abas): Básico, Contatos, Atividades, Acidente, Local, Empresas, Jurídico, Documentos, Histórico, Casos (se fechado), Financeiro, Chat IA, Chat Equipe.

**Efeito de fechamento**: mover o card para "✅ Fechado" marca o lead como cliente, gera o número do caso e cria o caso jurídico automaticamente (e a atividade de onboarding, quando aplicável); a etiqueta do WhatsApp é sincronizada.

**Fluxo recomendado**: escolher o funil → localizar o lead (busca/filtro) → arrastar o card entre etapas. Para lead novo, "Adicionar Lead" usando o extrator de IA.

---

## Gerenciamento Acolhimento — `/acolhimento`

**Propósito**: painel analítico ao vivo da operação de acolhimento de um funil — KPIs, funil, aging e matriz acolhedor × fase, com drill-down até a ficha do lead. Tela de leitura (não move cards).

- Seletor de Funil; KPIs: "No funil", "Conversão real", "Parados +90d", "Sem dono".
- Funil por etapa (com mediana de dias) + raio-x de aging (0-3d até +90d).
- Matriz acolhedor × fase — clique numa célula lista os leads parados.
- Ficha do lead: "Ligar", "WhatsApp", "Abrir no board", link "Abrir notícia".

**Fluxo recomendado**: ler os KPIs → achar o gargalo (etapas com mediana ≥60d) → clicar na célula acolhedor×fase → abrir a ficha de cada lead parado e acionar Ligar/WhatsApp.

---

## Contatos & Transmissão — `/contacts`

**Propósito**: base de contatos, grupos de WhatsApp (com auditoria de vínculo grupo↔lead↔caso) e listas de transmissão com envio de mensagens/mídia e agentes de IA.

**Abas**: "Contatos", "Grupos", "Listas".

- Cabeçalho: "Classificar Clientes", "Resolver duplicados", "Novo Contato", "Mapa"; com seleção ativa: "Nova Lista" e "Enviar".
- Contatos: busca + filtros (Estado, Cidade, Origem, Criado por, Relacionamento, Grupo, Lead); clique abre a ficha do contato.
- Grupos: busca; "Atualizar dados em lote" (data/criador via UazAPI); "Filtrar e ordenar" (escopo, ordenação, vínculo, funil, período, ocultos); **Modo auditoria** (tabela tipo planilha: nº lead, nº caso, nomes, criado em/por; por linha: abrir conversa, abrir/vincular lead, atualizar dados, editar nº do funil — renomeia o grupo no WhatsApp —, ver contatos, excluir).
- Listas: "Nova Lista"; por lista: atribuir Agente IA, adicionar selecionados, "Enviar" transmissão (instância + mídia + mensagem), excluir.

**Fluxo recomendado (auditoria)**: aba Grupos → Modo auditoria → vincular os grupos órfãos e corrigir nº do funil. **Fluxo (transmissão)**: selecionar contatos → "Nova Lista" → na aba Listas, "Enviar".

---

## Casos — `/cases`

**Propósito**: setor processual — lista os casos jurídicos, edita status/dados, gerencia processos e atividades de cada caso, e exporta para Google Sheets.

- "Exportar" — exporta para Google Sheets (respeita o filtro de núcleo).
- "Buscar caso..." — título, nº do caso, descrição, nome do lead e nº CNJ.
- Filtros: Status (Aberto/Em Andamento/Encerrado/Arquivado) e Núcleo.
- Card expandido: "Editar", "Encerrar", "Em Andamento", "Arquivar", "Excluir"; bloco "Lead Vinculado" abre a ficha no board.
- Aba Processos: "Cadastrar Processo"; bloco "Citados em atividades, sem cadastro" com "Cadastrar"/"Cadastrar todos" (cria o processo e atribui a atividade de andamento); quadro de fluxo do caso.
- Aba Atividades: filtros por Status (inclui "⚠ Atrasadas") e por Processo.
- Editar Caso: checkboxes de processos pré-definidos (Indenização, TRCT + Verbas, Benefício INSS etc.) — criam os processos e atribuem responsáveis automaticamente.

**Fluxo recomendado**: filtrar por Núcleo/Status → expandir o caso → regularizar processos citados sem cadastro com "Cadastrar todos" → acompanhar prazos na aba Atividades com o filtro "Atrasadas".

---

## Funis de Vendas — `/sales-funnels`

**Propósito**: gestão dos funis — cria/edita funis e mostra cards com métricas de conversão por funil.

- "Criar Funil"; "Configurar"; busca; cards-resumo (Funis Ativos, Total de Leads, Etapas, Com Leads).
- Por card de funil: filtro de data (cadastro/atualização, presets Hoje/7d/30d/Tudo/Período), expandir/reduzir, gráfico de conversão; em funis BPC: filtro de acolhedores e "Abrir" (painel detalhado).
- Rodapé do card: "Equipe", "Editar", "Abrir Kanban".

**Fluxo recomendado**: ajustar o período no card pra ver a conversão real → "Abrir Kanban" pra operar, ou "Abrir" (painel BPC) pra análise por acolhedor.

### Painel detalhado BPC — `/sales-funnels/bpc/:id`
Cruza os leads do board com a planilha unificada, em tempo real: filtros de período e acolhedores, funil de conversão clicável por etapa, KPIs, "Abrir lista", sync da planilha e "Abrir Kanban".

---

## Mapa de Leads — `/mapa-leads`

**Propósito**: mapa geográfico dos leads com coordenadas, pinos coloridos por status.

- Busca por nome/telefone/cidade; filtros de Status e Cidade; o mapa ajusta o zoom aos resultados.
- Popup do pino: dados do lead + "Abrir lead" (vai à ficha no board).

---

## Busca por Indicação — `/referrals`

**Propósito**: busca contatos por região, produto e classificação (destacando Clientes) para encontrar indicadores/parceiros. Tela de consulta pura.

- Busca por nome/telefone/cidade/bairro/profissão; filtros Estado → Cidade → Produto → Tipo (Clientes/Prospects); "Limpar filtros".

**Fluxo recomendado**: Estado → Cidade → Produto → Tipo "Clientes" → usar a lista como base de indicação na região.
