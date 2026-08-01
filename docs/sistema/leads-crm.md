# Módulo Leads e CRM

Documentação funcional das telas de leads, acolhimento, contatos, casos, funis e mapa. Rótulos entre aspas são o texto exato exibido na interface.

---

## Leads (Kanban) — `/leads`

**Propósito**: board Kanban principal de gestão de leads por funil — arrasta cards entre etapas, abre a ficha completa do lead e dispara os efeitos de fechamento (vira cliente, cria caso jurídico automaticamente).

- Seletor de funil — troca o board; permite criar/editar/excluir quadro. Lista os funis; um POP só aparece nele quando é o quadro aberto no momento.
- **Abrir por link** (`/leads?board=<id>`) — o "Abrir Kanban" dos cards de funil e de POP, as notificações do chat, o MetricDetailSheet e o checklist do dashboard abrem o quadro do link (antes o param era ignorado e caía sempre no padrão). Id inexistente avisa e cai no padrão; o param é consumido depois de aplicado, como o `?openLead`. Regressão coberta em `src/components/kanban/__tests__/UnifiedKanbanManager.board-param.test.tsx`.
- "Buscar leads..." — por nome, telefone ou número do caso.
- Filtro de acolhedor; ícone de atualizar; "Relatório" (relatório do funil); filtro por checklists da etapa.
- "Adicionar Lead" — cria lead com seleção de funil e formulário de acidente; inclui extrator de dados por IA (cola a notícia, a IA preenche).
- "Métricas e Funil de Conversão" — expande gráficos de conversão e tempo por etapa.
- Menu do card: "Editar", "Gerenciar Contatos", "Ver perfil Instagram", "Comentário original", "WhatsApp", "Mover para fase" (inclusive outros boards), "Marcar como Fechado/Recusado/Inviável/Cancelado", "Nova Atividade", "Duplicar Lead", "Remover".
- Avatar do card: mostra a foto do acolhedor quando o lead tem `acolhedor` atribuído (mapa nome→foto em `src/lib/acolhedorPhotos.ts` + `src/assets/acolhedores/`; jul/2026: João Manoel, Analyne, Bruno Dantas, Juliana Pimentel, Luiz Ricardo, Grazielle). Sem acolhedor mapeado, cai nas iniciais do nome do lead. Acolhedor novo = adicionar foto + entrada no mapa. A mesma foto aparece no título do dialog "Editar Lead" (canto superior esquerdo), refletindo na hora a troca no campo Acolhedor.
- Campo Acolhedor (Editar Lead e Adicionar Lead): combobox com busca por digitação e foto ao lado do nome. No board Trabalhista (Acidente de Trabalho) as opções são só os 6 acolhedores oficiais (lista canônica em `src/lib/trabalhistaAcolhedores.ts`); nos demais boards, lista completa de perfis. Leads antigos com acolhedor fora da lista mantêm o valor até alguém trocar. O dialog "Cadastrar Caso Viável" (Notícias) tem lista restrita própria por user_id, separada desta.
- Ficha do lead (abas): Básico, Contatos, Atividades, Acidente, Local, Empresas, Jurídico, Documentos, Histórico, Casos (se fechado), Financeiro, Chat IA, Chat Equipe.

### Desvincular grupo do caso → documentos saem do Drive — ago/2026

Remover um grupo de WhatsApp da ficha do lead e salvar agora **limpa também os documentos que vieram daquele grupo**. Antes, grupo colado errado saía do vínculo mas o RG/procuração do outro cliente continuava na pasta do caso no Drive.

- Alvo: `process_documents` do lead com `source = 'whatsapp_group'` e `metadata.group_jid` = o grupo removido (documento antigo sem `group_jid` é resolvido pelo `external_message_id` em `whatsapp_messages.phone`).
- Arquivo do Drive vai pra **lixeira** (`trashed=true`), não delete definitivo — recuperável ~30 dias. Só quem for pra lixeira tem a linha em `process_documents` apagada; falha no Drive mantém a linha (nada de arquivo órfão sem registro).
- O backup em Storage (`whatsapp-media`) **não** é apagado — é ele que permite reimportar se o grupo voltar a ser vinculado.
- Roda fora do await do salvar (cada arquivo custa ~1s no Drive); resultado vem em toast. Também dispara ao "excluir" um grupo em Contatos → Grupos (limpa para cada caso que estava vinculado).
- Arquivos: `supabase/functions/unlink-group-docs/index.ts`, ação `trash` em `supabase/functions/lead-drive/index.ts`, `src/lib/unlinkGroupDocs.ts`, chamada em `LeadEditDialog.handleSave` e `ContactsListPage.handleDeleteGroup`.

### Visualização em lista (toggle colunas | lista) — jul/2026

Toggle no header (ícones colunas/lista) alterna kanban ↔ lista **sem resetar** busca, filtro de acolhedor, filtros avançados nem filtro de checklist (mesmo estado compartilhado). Visualização e ordenação vão pra URL (`?view=list&sort=tempo_estagio.desc`); a última escolha fica em localStorage. O kanban não foi alterado.

- **Dados server-side** via view `lead_list_view` (Supabase Externo): ordenação com `.order()`, páginas de 50 com `.range()`, contagens com `count: exact`. A view espelha a visibilidade do kanban (exclui `noticias`/`viavel` e deletados; inclui Fechado/Recusado/Inviável/Cancelado por `lead_status`).
- **Tempo no estágio** = último `lead_stage_history.changed_at` com `to_stage = status`, fallback `updated_at` — mesma semântica do badge do kanban. Aging: âmbar ≥30d, vermelho + alerta ≥90d. Cabeçalho mostra "N leads · M parados +90d".
- **Colunas**: seleção, avatar do acolhedor (tabela `acolhedores`: foto → iniciais com cor determinística → cinza "sem dono"), Vítima (fallback `LEAD<numero>` cinza itálico + alerta "Vítima não identificada"), Empresa e Local ("—" quando vazios), Estágio (badge com a cor da coluna), Tempo no estágio, Data do acidente, ações (compartilhar, etiquetar, visualizar, mais).
- **Chips rápidos**: "Sem acolhedor", "Parado +90 dias", "Sem vítima identificada" — combináveis com os demais filtros.
- **Seleção múltipla**: barra fixa no rodapé com "Mover para estágio…" (mesmos efeitos do kanban: histórico, checklists, etiqueta WhatsApp), "Atribuir acolhedor…" (tabela `acolhedores`, só ativos), "Aplicar etiqueta…" (mapeamentos etapa↔etiqueta do board) e "Exportar CSV" (respeita filtros e ordenação). "Selecionar todos os N filtrados" é distinto de "todos da página".
- **Mobile (<768px)**: blocos de 2 linhas (~72px), ordenação/filtros em bottom sheet, seleção por long-press, "Carregar mais" de 50 em 50.
- Clique na linha abre a mesma ficha do lead (`LeadEditDialog`).
- Arquivos: `src/components/kanban/LeadListView.tsx`, `src/hooks/useLeadListView.ts`, `src/hooks/useAcolhedores.ts`, migration `supabase/migrations/20260730120000_acolhedores_lead_list_view.sql`.

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
- Grupos: busca; "Atualizar dados em lote" (data/criador via UazAPI); "Filtrar e ordenar" (escopo, ordenação, vínculo, funil, período, ocultos); **Modo auditoria** (tabela tipo planilha: nº lead, nº caso, nomes, criado em/por; por linha: abrir conversa, abrir/vincular lead, atualizar dados, editar nº do funil — renomeia o grupo no WhatsApp —, ver contatos, excluir — "excluir" também manda pra lixeira do Drive os documentos que esse grupo levou para os casos vinculados).
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
