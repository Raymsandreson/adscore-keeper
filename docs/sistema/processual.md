# Módulo Processual

Documentação funcional das telas do módulo processual. Rótulos entre aspas são o texto exato exibido na interface.

---

## Processos — `/processes`

**Propósito**: central de processos judiciais e administrativos. Reúne processos judiciais vinculados a casos, processos administrativos do INSS (alimentados por e-mails do Gmail), e-mails processuais (PJe/PUSH) e relatório de processos parados. Datas de perícia **não** ficam aqui: a agenda é `/hearings` (lente Perícias).

**Abas**: "Judiciais", "INSS Administrativo", "Régua INSS", "Processual" (e-mails), "Sem movimento".

### Aba Judiciais
- Busca "Buscar por número, título, parte, tribunal..." — filtra a lista (número, título, polo ativo/passivo, tribunal, classe).
- Clique no card — abre o painel lateral de detalhes do processo.
- Link do número do caso — navega para o caso vinculado em `/cases`.
- Ícone de lixeira — exclusão lógica do processo (com confirmação).
- Paginação de 25 por página.

### Aba INSS Administrativo
Processos administrativos do INSS criados a partir de e-mails do Gmail, com foco em vincular cada requerimento ao caso/lead correto e acompanhar o histórico de despachos. Sincroniza automaticamente na primeira carga.

- "Órfãos" (com contagem) — mostra só requerimentos sem caso vinculado.
- "Sincronizar agora" — busca e-mails recentes do INSS (últimas 48h).
- "Backfill completo" — varre todo o histórico de e-mails [INSS] desde jan/2022 (pede confirmação).
- Menu "Vincular": "Vincular órfãos" (match automático), "Vincular por nome (v2)", "Vincular por CPF" (em lote), "Revisar ambíguos" (escolha manual quando bateu em mais de um lead).
- Busca "Buscar por requerimento, CPF, nome...".
- Card vinculado: clique abre o lead; "Ver e-mail completo" mostra o e-mail original; "Histórico (n)" expande status anteriores.
- Card órfão: botão "Vincular" abre dialog com sugestões automáticas (nº do requerimento, CPF, nome) e busca manual; se o lead não tem caso, "(criar caso)" gera o número e cria na hora.
- Ícone "Desvincular" — remove o vínculo (com confirmação).

**Fluxo recomendado**: ativar "Órfãos" → "Vincular" → aceitar sugestão automática; usar o menu "Vincular" para lotes e "Revisar ambíguos" para os duvidosos.

### Aba Processual (e-mails PJe/PUSH)
E-mails processuais capturados do Gmail (intimações/PUSH do PJe), com detecção automática de "Prazo" no texto.

- Busca "Buscar por assunto, remetente, nº de processo...".
- Switch "Apenas PUSH" — filtra só e-mails PUSH.
- "Sincronizar" — busca e-mails dos últimos 7 dias.
- "Buscar mais antigos" — backfill de todo o histórico (pede confirmação).
- Clique no card — abre o e-mail completo.
- Badge "Prazo" — automático quando o texto contém termos de intimação/prazo.

**Fluxo recomendado**: deixar "Apenas PUSH" ligado e revisar os cards com badge "Prazo".

### Aba Sem movimento
Processos judiciais ativos parados há ≥30 dias (fonte Escavador), por faixa e responsável.

- Faixas: "30–59 dias", "60–89 dias", "90+ dias", "Todos ≥30".
- "Atualizar" — recarrega; "Exportar CSV" — baixa a faixa atual.
- Card "Por responsável" — contagem por responsável na faixa.
- Clique no processo — abre na aba Judiciais.

**Fluxo recomendado**: começar por "90+ dias", identificar responsáveis com concentração de atraso, exportar CSV para cobrança.

### Aba Perícias — **não existe mais**
Era uma planilha transversal de datas lida dos campos personalizados do tipo "Data" dos processos ("Só futuras", busca por cliente/campo). Foi removida do código; em 19/08/2026 só sobrevivia como promessa no guia de funcionalidades, que passou a apontar o lugar certo.

Não valia a pena ressuscitar: `process_custom_fields` e `process_custom_field_values` estão **vazias** (zero linhas), e nenhum dos 3 campos de data que existem em `lead_custom_fields` é de perícia — a aba mostraria uma tabela em branco. **A agenda de perícias é `/hearings`, lente Perícias.**

---

## Status do Processo — aba "Status" (painel do processo)

Aba dentro do painel de detalhes do processo (entre "Marcos" e "Movimentações"). Separa o que se **espera** do que já **aconteceu**, e **tira a atualização da mão do usuário**: o status atingido é detectado sozinho, não digitado.

> ⚠️ Grão: o status é **do processo**, não do lead. O lead tem status do **funil de vendas**; cada processo tem o **seu** status, das opções cadastradas no seu POP. Um caso tem vários processos → vários status independentes. Detalhe e regras em `.agents/skills/lead-vs-case-identity`.

**Status esperado (alvo)** — herdado do POP vinculado (`kanban_boards.settings.resultado_esperado_ids`; **pode ser mais de um**, ex.: "Acordo" ou "Procedência"). Cada processo pode **sobrescrever** (override por-processo) e definir uma **data-alvo** (prognóstico). Os status possíveis e o(s) esperado(s) são cadastrados no POP (WorkflowBuilder), onde cada status pode ganhar um **marco gatilho** opcional (liga o marco do Escavador ao status).

**Status atingido (detectado)** — preenchido automaticamente:
- **POP judicial** → das **movimentações do Escavador** (`process_movements`). Marco inequívoco (**trânsito em julgado, acordo, pagamento**) **auto-confirma**; sentença/acórdão viram **sugestão** que o assessor confirma em 1 clique.
- **POP administrativo** → das **intimações por e-mail** (`processual_emails`, casadas pelo nº do processo). As intimações aparecem como evidência; o assessor define o status a partir delas (fonte `email_intimacao`, com a intimação de origem guardada).
- Toda detecção é **auditável** (guarda a movimentação/e-mail de origem). Há "ajustar manualmente" como escape.

**Campos** (Externo, `lead_processes`): `resultado_esperado_id_override`, `resultado_esperado_data_alvo`, `resultado_atingido` (+ `_id`, `_tipo`, `_data`, `_fonte`, `_ref`, `_status`).

**Telão** (`/tv/atividades`, coluna "STATUS ESPERADO"): conta os processos que atingiram o esperado, por **responsável do processo**, no **mês em que o resultado aconteceu** (não quando foi cadastrado). Ver `atividades.md`.

---

## Arquivar POP / funil (ago/2026)

Um quadro (POP **ou** funil — mesmo componente, `BoardsList`/`BoardCard`) pode ser **arquivado** sem apagar nada: o flag vive em `kanban_boards.settings.archived` (jsonb — **sem coluna nova, sem migration**). Ação "Arquivar"/"Desarquivar" no próprio card; helper `isBoardArchived()` e `setBoardArchived()` em `src/hooks/useKanbanBoards.ts`.

Efeitos do arquivado:
- **Some da listagem** de POPs/funis por padrão; botão **"Arquivados (N)"** no topo revela (card esmaecido + badge "Arquivado"). Sumário ("POPs Ativos", leads, etapas) conta só os ativos.
- **Some dos seletores de vínculo**: novo processo (`AddProcessDialog`, `LeadProcessesTab`), troca de POP na ficha (`ProcessDetailSheet` — mantém o POP atual visível com sufixo "(arquivado)"), caso (`CaseWorkflowBoard`), atividades (`ActivitiesPage`, `ActivityFullSheet`), modelos de mensagem, campanhas, onboarding de grupo, campos personalizados, metas processuais (`useTeamProcessGoals`), progresso (`WorkflowProgressPage`) e o seletor do kanban (`UnifiedKanbanManager` — o quadro aberto na tela permanece).
- **Nada muda nos dados**: processos/leads já vinculados continuam apontando pro quadro e abrindo normalmente; desarquivar reverte tudo.

Teste de regressão: `src/components/board/__tests__/BoardsList.archive.test.tsx`.

---

## Revisões do POP — histórico, categoria e impacto

O POP é vivo: o gerente ajusta conforme a prática e os testes do dia a dia. Cada `Salvar` no editor (WorkflowBuilder) que altere algo abre **"Registrar alteração no POP"** e grava uma revisão em `workflow_revisions` (Externo) — snapshot completo + diff + quem/quando.

**Categoria da alteração** (`change_category`) — toda revisão é classificada em uma das três:

| Categoria | Quando |
|---|---|
| **Automação** | passou a ser automático o que era manual (mover fase, definir status, gatilho) |
| **Eliminação** | removeu passo/objetivo/fase/status que não agrega mais |
| **Otimização** | refinou o que já existia (script, ordem, status possíveis ou esperado) |

A IA (Railway `suggest-revision-reason`, Gemini flash) lê o diff e **sugere motivo + categoria** ao abrir o dialog; o gerente edita se quiser ("Sugerir com IA" refaz). O que ele já digitou nunca é sobrescrito. A categoria vai no histórico e no começo da notificação do time.

**Diff cobre também a meta**: mudança de **status possíveis** e de **resultado esperado** entram no diff como alteração do POP — antes mexer no esperado passava invisível.

**Aba "Impacto"** (sheet de histórico) — mede o resultado por vigência: cada revisão vale de `created_at` até a seguinte; dentro dessa janela conta os resultados que aconteceram e quantos caíram no **resultado esperado em vigor naquela época** (o do snapshot, não o de hoje). Mostra a taxa, o delta em pontos percentuais contra a revisão anterior e **quem fez**. Fontes unidas pela RPC `workflow_revision_outcomes`: `lead_pop_result_history` (status do POP no lead) + `lead_processes.resultado_atingido_id` com `status='confirmado'` (resultado do processo).

> ⚠️ É **correlação, não causalidade**: época, time e mix de leads pesam. Abaixo de 5 resultados na janela a aba não dá veredito, só mostra a amostra.

**A revisão chega nos processos que já estão andando.** Os passos que o assessor vê na ficha (`lead_checklist_instances.items`) são uma cópia do POP feita quando o processo entrou na fase — até 31/07/2026 essa cópia nunca era atualizada, então editar o POP não mudava nada em quem já tinha o passo instanciado (o POP Salário Maternidade Urbano renomeou "PEDIDO" para "REGISTRAR RESULTADO DO BENEFÍCIO" e as 92 instâncias seguiram com o texto antigo). Agora, ao abrir a atividade/processo, a instância é reconciliada com o POP atual (`src/lib/syncChecklistInstances.ts`):

- **Passo ainda não marcado** → adota o conteúdo novo (nome, descrição, script, checklist do passo, automação de resposta), preservando a resposta escolhida e os documentos já marcados.
- **Passo já marcado cujo trabalho mudou** (nome, checklist do passo ou respostas) → o registro do que foi feito **continua na lista**, riscado, com o selo **"alterado no POP"**, e o **passo novo entra logo abaixo, desmarcado**, para ser executado. Sem isso a pergunta nova do POP nunca chegaria a quem já tinha marcado o passo antigo.
- **Passo já marcado com mudança que não exige refazer** (script, descrição, modelo de mensagem, destino/status) → fica como está, sem duplicar; só o selo.
- **Passo já marcado que saiu do POP** → fica na lista com o selo **"removido do POP"**.
- **Passo não marcado que saiu do POP** → some da instância.

O registro do passo antigo guarda `supersededBy` (id do passo que o substituiu) — é o único campo do sync que persiste. Ele é histórico: não é marcável, fica fora do "marcar todos" e **não entra no progresso nem na conclusão do objetivo**, para o percentual refletir o POP de hoje. Consequência esperada: um objetivo que estava 100% volta a pendente quando o POP reabre um passo.

Os selos (`popChange`, `popNewLabel`) são calculados a cada abertura, comparando com o template — não ficam gravados no banco.

**Perguntas do POP valem na ficha da atividade.** A barra de progresso da atividade/processo (`LeadFunnelProgressBar`) desenha as respostas configuradas no POP, tanto no passo (`item.answers`) quanto no checklist do passo (`doc.answers`) — antes só mostrava o texto, e as automações ficavam presas na página de fluxo. Cada resposta é um botão com os selos do que ela faz: **fase de destino** e **status do POP**. Escolher a resposta marca o item, grava a escolha (`selectedAnswerId`), loga no ranking, aplica o status (`leads.pop_result_id` + `log_pop_result_change`) e move o lead (em `leads.status` quando é o funil do próprio lead, sempre com registro em `lead_stage_history` no board do POP). Marcar uma pergunta direto no checkbox é bloqueado, e ela fica fora do "marcar todos" — a resposta tem que ser escolhida.

**Item de checklist que repete uma resposta é espelho.** É comum o POP cadastrar a mesma coisa duas vezes: as respostas do passo ("Requerimento Deferido" / "Requerimento Indeferido") e, no checklist de verificação do mesmo passo, itens com esses nomes. Esses itens **não são clicáveis** e ficam fora do "marcar todos": quem os marca (e desmarca) é a resposta escolhida — senão haveria dois lugares para dizer a mesma coisa e só um deles moveria a fase e o status. Itens que existem só no checklist (ex.: "Carta de Concessão/Indeferimento") seguem marcáveis. O casamento é por rótulo normalizado, sem acento/caixa/espaço sobrando (`src/lib/popAnswerMirror.ts`), porque o POP não guarda vínculo entre resposta e item — renomear um dos dois desfaz o espelho. Não há aprovação de gestora envolvida: quem edita o POP grava direto (inclusive por autosave), e a revisão registrada em `workflow_revisions` é histórico, não fila de aprovação.

## Audiências e Perícias — `/hearings`

**Propósito**: agenda de eventos do escritório — audiência **e** perícia — com visualizações Semana/Mês/Dia/Lista e sincronização com planilha externa. Cada evento tem tipo, categoria, data/hora, fuso, status, local, responsável e observações.

- **Lente Audiências | Perícias | Todos** (19/08/2026), com contador de cada uma. Muda o universo da tela, não é mais um filtro: perícia e audiência são trabalhos diferentes. Abre em Audiências; `/hearings?evento=pericia` entra direto na agenda de perícias. A classificação é a mesma da aba Eventos (`categoriaDaAudiencia`): radical "peric" **ou** "avaliação social".
- **De onde vêm as perícias**: da planilha (perícia judicial — `hearing_type` "Perícia Médica"/"Perícia Judicial", `origem='planilha'`) e do **chip no cabeçalho da atividade** (perícia administrativa do INSS — "Perícia Médica (INSS)" / "Avaliação Social (INSS)", `origem='atividade'`). Ver `atividades.md`. O sync da planilha não sobrescreve o que nasceu na atividade.
- Criar a partir da lente Perícias já nasce perícia previdenciária (o formulário abriria em "UNA Virtual"/cível).
- Busca "Buscar por processo, caso, observações...".
- Filtros: Tipo, Categoria, Status. **O filtro Tipo lista o que existe no banco, com a contagem ao lado** (20/08/2026) — e não o catálogo do formulário. Com o catálogo fixo, "Inicial" (122), "UNA" (112), "Pericia" (3), "Homologação", "Julgamento" e "Encerramento" não eram opção: 241 dos 566 eventos ficavam fora do alcance do filtro, e três opções que não existem em linha nenhuma ("UNA Virtual", "UNA Presencial", "Inicial Virtual") esvaziavam o calendário. As opções acompanham a lente, e trocar de lente zera um Tipo que não existe mais ali.
- A tela carrega a tabela **paginada** (`buscarTudo`, `lib/postgrestPaginacao.ts`): sem janela de data, o teto de 1000 linhas do PostgREST cortaria a lista sem erro nenhum — 566 vivas em 20/08/2026, criadas a 37-90 por mês.
- "Sincronizar planilha" — importa novas/atualizadas da planilha sem remover as que só existem no sistema.
- "Nova audiência" — abre o formulário em branco; clicar numa célula de dia cria com data pré-preenchida.
- Setas ‹ › e "Hoje" — navegação de período.
- Clique numa audiência — edita; no formulário: "Salvar", "Excluir" (com confirmação) e "Criar atividade" (gera atividade vinculada à audiência).

**Fluxo recomendado**: visão Semana → "Nova audiência" ou clique no dia → preencher processo/data/responsável → salvar. Usar "Criar atividade" para gerar a tarefa de preparação.

---

## Visitas das assistentes sociais — Leads Trabalhista → visão **Visitas**

**Onde fica**: menu **Leads Trabalhista** (`/leads?cat=trabalhista`), terceiro botão do alternador de visão, ao lado de kanban e lista (`?view=visitas`). O calendário respeita o **funil selecionado** — mostra só as visitas dos leads daquele board, igual ao kanban e à lista ao lado. O botão só aparece no Trabalhista; no Previdenciário a visão nem existe (e quem chegar nela por estado salvo cai de volta no kanban).

A rota `/visitas` continua respondendo para link direto e, sem board, mostra a agenda de todos os funis. Ela não está no menu: o caminho do dia a dia é o botão dentro do Trabalhista.

**Propósito**: calendário das visitas domiciliares feitas pelas assistentes sociais parceiras. Cada agendamento mostra **data e horário**, o **lead a ser visitado** e a **assistente social responsável**, além de local (endereço/cidade/UF), status e observações.

Antes desta tela (ago/2026) a visita só existia como texto em atividade ("direcionar casos para as ass. sociais", "alinhar as visitas do Renan no Paraná"): não havia como ver a semana, saber quem visita quem, nem o que já foi realizado.

- Visões **Semana** (segunda a domingo — visita em fim de semana é comum e não pode ficar fora da grade), **Mês** e **Lista**.
- Cada assistente social recebe uma **cor fixa**, derivada do nome, repetida em todas as visões: a semana é lida por pessoa.
- Busca por lead, assistente social ou cidade. Filtros: assistente social, status e UF.
- Status: Agendada, Confirmada, Realizada, Remarcada, Cancelada. Cancelada aparece riscada, sem sumir da agenda.
- "Agendar visita" abre o formulário; clicar no `+` de um dia (ou na célula do mês) já vem com a data preenchida.
- Clique no card — edita o agendamento. "abrir lead" — abre o lead em painel lateral por cima da agenda, direto na aba Visitas.
- Setas ‹ › e "Hoje" — navegação de período (semana a semana ou mês a mês).

**Assistente social**: são parceiras **externas**, sem perfil no sistema. O seletor busca em Contatos (mostrando primeiro quem tem profissão de serviço social ou classificação de parceira) e grava o vínculo; quem ainda não está cadastrada é agendada digitando o nome ("Usar '<nome>'"), sem travar a operação. O nome fica gravado nos dois casos.

**Dentro do lead**: aba **Visitas** no cadastro do lead lista as visitas daquele lead (mais recente primeiro) e usa o mesmo formulário — o que se edita lá aparece no calendário e vice-versa. O endereço da visita já cadastrado no lead (aba Local) entra pré-preenchido no primeiro agendamento e pode ser trocado.

**Onde ficam os dados**: tabela `social_visits` no Supabase externo (RLS habilitado, acesso só autenticado). Exclusão é soft delete — visita realizada não some do histórico por engano.

**Recorte por funil**: o filtro de board é feito **no banco**, via `select('*, leads!inner(board_id)')` + `eq('leads.board_id', …)`. Não dá para mandar a lista de ids no `in()`: só o board "Acidente de Trabalho" tem ~4,4 mil leads e a URL estouraria.

**Fluxo recomendado**: visão Semana → `+` no dia → escolher lead e assistente social → salvar. Depois da visita, abrir o card e mudar o status para Realizada.

---

## Acompanhamento Processual — `/processual/acompanhamento`

**Propósito**: dashboard de eficiência do fluxo jurídico (dados do WhatsJUD): SLAs de tramitação por fase, latência de atualizações, transições de status, gargalo fechamento→protocolo e atividades atrasadas do dia.

- Abas de período "Hoje" / "Semana" / "Mês".
- "Relatório de Atividades" — produtividade por usuário (Diária/Semanal/Mensal), com relatório detalhado por pessoa.
- Filtros: Responsável, Ação (Petições/Audiências/Despachos/Publicações), Etiqueta.
- Ícone de atualizar — recarrega o dashboard.
- Painel "Atividades atrasadas — hoje": filtro por responsável, "Mostrar mais", clique na linha abre a atividade.
- Bloco "Protocolos administrativos INSS" — número do dia (ver seção abaixo).

**Fluxo recomendado**: período Mês → ler SLAs e gargalo de protocolo por categoria → descer até as atividades atrasadas filtrando por responsável.

---

## Protocolos administrativos INSS do dia

**Onde aparece**: card na Visão Geral (`/`) e bloco em `/processual/acompanhamento`. Saiu do telão em 05/08/2026 (`/tv/atividades` é sobre marcos, não sobre volume de protocolo) — o valor legado `?team=protocolos` na URL é neutralizado no `TvAtividadesPage`.

**Fonte**: RPC `tv_protocolos_dia(p_dias)` no Externo, sobre `inss_admin_processes`. Agregada, sem PII.

**Lista por trás do número** (11/08/2026): o botão "Ver protocolos" no card abre `ProtocolosListaSheet` — painel lateral, por cima da tela atual, sem redirecionar. Traz filtro por período (presets Hoje / 7 / 30 dias / Este mês / Tudo + duas datas), 25 por página, e cada linha mostra data do protocolo, nº do requerimento, segurado, serviço e status, com o caso ou lead vinculado.

- **Clicar na linha abre o lead vinculado** empilhado por cima (`ProtocoloLeadPainel`, carregado por `React.lazy` só no primeiro clique) — fechar devolve pra lista, sem redirecionar. Só é clicável quem tem `lead_id`: na janela de 30 dias são 140 de 179, e **zero** linhas têm caso sem lead, então "tem lead" cobre todo vínculo. O salvamento usa `updateLead` do `useLeads`, não um `db.update()` cru — é ele que sanitiza datas, carimba `updated_by` remapeado e registra `log_lead_result_change` (KPI de resultado por pessoa/mês). O painel só abre depois que a lista do `useLeads` carrega, porque o "de/para" do histórico sai dela.
- Ordena e filtra por **data de protocolo** (`protocol_date`), do mais recente pro mais antigo. Consequência a dizer em voz alta: **só entram as linhas que têm essa data** — 417 de 891 vivas em 11/08/2026. O resto nasceu de e-mail de status puro, sem data no corpo; aparece na aba Processos INSS, mas não tem onde cair numa linha do tempo de protocolo. O rodapé do painel avisa.
- Por isso os totais do painel **não batem** com "na semana"/"no mês" do card: o card conta `registrados` (chegada do e-mail), o painel conta `protocolados`.
- Lê a tabela direto, não a RPC: a RPC devolve só contagens de propósito. Como aqui aparece nome de segurado, o painel fica atrás de um clique e nunca é montado enquanto fechado.
- RLS de `inss_admin_processes`: policy única `TO authenticated` (`qual = true`) — a leitura depende da sessão anônima do Externo (`ensureExternalSession`), não é aberta a `anon`.
- Teto de 3.000 linhas por consulta (páginas de 1.000, o máximo do PostgREST), com aviso na tela quando bate no teto. Sem índice em `protocol_date`: com 918 linhas o planner faz seq scan de qualquer jeito; se a tabela crescer uma ordem de grandeza, criar `idx` parcial (`WHERE deleted_at IS NULL`) com `CONCURRENTLY`.

**Filtro por faixa de nº do caso/PREV** (17/08/2026): responde "quantos protocolos saíram do PREV 1200 ao PREV 1400". Seletor de sequência (Todas / PREV / CASO / Sem prefixo / LEAD / SM / DG) + campos "de" e "até", que aceitam `PREV 1200` ou só `1200` — prefixo digitado no campo manda no seletor.

- O número **não está no protocolo**. Vem de `legal_cases.case_number` quando há caso e de `leads.case_number` quando só há lead (277 dos 918 protocolos vivos têm lead e nenhum caso — sem essa reserva ficariam fora de qualquer faixa). Resolvido em lote, uma consulta por tabela a cada 100 ids.
- Os dois campos são texto digitado à mão e chegaram sujos: `PREV 285`, `✅PREV 2027`, `CASO-0474`, `Caso 322`, e ainda CNJ (`0011351-63.2022.5.15.0031`), NUP (`13621.214680/2024-67`) e dígitos soltos de 10 posições. `src/lib/casoSequencia.ts` normaliza antes de comparar e **recusa** o que não é sequência, em vez de devolver um pedaço — devolver "caso 13621" de um NUP colocaria linha errada dentro da contagem. Medido nos 3.564 `case_number` do Externo: 28 recusados, todos número de processo.
- Cobertura da faixa: 468 dos 918 protocolos têm número legível (291 PREV, 129 sem prefixo, 43 CASO, 4 SM, 1 DG). Os outros 450 não têm caso nem lead com número — o painel diz isso no cabeçalho do filtro.
- **Ligar a faixa desliga o período** e passa a incluir requerimento sem `protocol_date`: mantendo o recorte de data, a contagem sairia truncada sem avisar. O chip "Qualquer data" fica selecionado, e um aviso explica. Clicar num preset depois disso volta a limitar por data.

**Vínculo a partir do painel** (17/08/2026): linha sem `case_id` ganha botão "Vincular caso" (569 das 918 hoje), que abre `VincularCasoDialog` — sugestões automáticas por nº do requerimento, CPF e nome, mais busca manual por caso/lead/contato/telefone/CPF. Lead sem caso aparece como "(criar caso)" e o `legal_case` é criado no clique.

- O diálogo e as buscas são os mesmos da aba Processos INSS: a lógica saiu de dentro do `InssAdminProcessesTab` para `src/lib/inssVinculoCaso.ts` (+ `src/lib/nomeMatch.ts`) e o componente para `src/components/protocolos/VincularCasoDialog.tsx` — 412 linhas a menos no tab, uma implementação só.
- O botão "Vincular automático" do rodapé chama `match-inss-orphans` (Railway), o mesmo robô do cron de 15 min.

**Os dois números, e por que não se somam** (levantado em 03/08/2026):

Nada é registrado no ato do protocolo. Todo registro entra pelo `gmail-inss-sync`, que parseia o e-mail do INSS e grava `protocol_date` — não existe outro caminho de escrita. Daí saem duas medidas diferentes:

| Medida | O que é | Comportamento |
|---|---|---|
| `registrados` | Comprovantes que chegaram no dia (`created_at`) | Tem movimento diário. É o número em destaque. |
| `protocolados` | Cuja data de protocolo é o dia (`protocol_date`) | Produção real, mas só se completa depois: 92% dos registros entram após a data do protocolo, atraso mediano ~10 dias. Começa em 0 e sobe. |

Os gráficos plotam **por data de protocolo**, não por chegada: por chegada apareceriam picos artificiais de quando alguém rodou o sync na mão (30/07/2026 tem 174 numa rodada de backfill). Barras tracejadas = dias ainda dentro da janela de atraso.

**Alerta de sync parado**: se o `gmail-inss-sync` não roda há mais de 2h, as telas avisam. Sem isso, sync parado exibe 0 e parece que ninguém protocolou.

**Responsável da atividade "INSS atualizou …"** (25/08/2026): o `notify-inss-update` grava dono fixo por status — `Protocolado` → **Luana Barros**, todo o resto (Exigência, Em Análise, Concluída, Pendente, Cancelada) → **Jose Francisco Campos de Oliveira**. Antes herdava `leads.assigned_to`, e o lead do requerimento quase nunca tem alguém: 340 das 381 atividades (89%) nasciam sem dono e só andavam quando alguém tropeçava nelas. Backfill aplicado no mesmo dia nas pendentes dos últimos 32 dias; as anteriores ficaram sem dono de propósito.

- O UUID da Luana ali é o `profiles.user_id` (`1589c873…`), **não** o `profiles.id` (`c5284e57…`). O filtro de "minhas atividades" remapeia e casa por `user_id` — o `sync-process-compromissos` grava o `profiles.id` nas audiências, e por isso as 19 criadas por ele não aparecem para ela.
- Essas atividades **não carimbam `action_source`**: entram como `manual`. Medir "quanto o robô cria" por `action_source` deixa as 400 de fora — o que identifica é o título `INSS atualizou %`.

**Mensagem automática no grupo do cliente** (26/08/2026): quando o e-mail do INSS chega, além da atividade sai uma mensagem no grupo do lead. O grupo tem cliente **e** equipe, então o texto fala com o cliente. `railway-server/src/lib/inss-mensagem-cliente.ts` decide o quê; `inss-zap.ts` redige e entrega.

| Status | Mensagem | Por quê |
|---|---|---|
| Protocolado | Template fixo, **sem IA** | Os 296 eventos de protocolo têm zero despacho — não há texto pra reescrever |
| Exigência | Pendências em linguagem simples + prazo | 553 dos 593 têm despacho; a lista sai do `extrairPontosPendentes` |
| Concluída **com** veredito | Deferido / indeferido / arquivado por prazo | O veredito vem de `inss_admin_processes.resultado` ou do despacho |
| Concluída **sem** veredito | Silêncio | 193 de 643. "Seu pedido foi concluído", sem dizer se ganhou, é pior que nada |
| Em Análise, Pendente | Silêncio | O despacho ali é texto **do próprio escritório** no Meu INSS ("Segue procuração assinada em anexo") |
| Cancelada | Silêncio | Dos 25 cancelamentos com despacho, todos são pedido nosso ou do cliente ("DESEJO CANCELAR ESSE REQUERIMENTO") |
| PARSE_FAILED | Silêncio | 1.969 eventos em que nem o status foi lido |

- **Janela 8h–20h de Brasília**: 28% dos e-mails do INSS chegam entre 20h e 8h (572 de 2.039). Fora da janela o texto é redigido na hora e gravado como `zap_status = 'agendado'`; quem entrega é o cron `dispatch-inss-zap` (10 em 10 min, devolve `skipped` fora do horário). O Railway roda em UTC — a hora sai de `Intl` com `timeZone: America/Sao_Paulo`, nunca de `getHours()`.
- **Sem retroatividade**: só evento cujo e-mail chegou depois de `ZAP_CLIENTE_DESDE` (env `INSS_ZAP_CLIENTE_DESDE`). Há 1.480 eventos antigos nunca notificados; sem esse corte, ligar o envio despejaria notícia velha em grupo de cliente.
- **Trava de repetição** por (processo, tipo): 108 pares (processo, status) se repetem no histórico, um deles 7 vezes, e 164 eventos repetem status já visto.
- **Grupo determinístico**: mesma política do `src/lib/leadWhatsAppTarget.ts` — um grupo manda; vários, só se `leads.whatsapp_group_id` desempatar; sem desempate, **recusa**. Antes era `.limit(1)` sem ordenação e 36 leads têm mais de um grupo. Mensagem no grupo errado é dado de cliente vazando para outro cliente.
- **`benefit_type` nunca é ecoado**: de 988 processos, 441 estão vazios e ~55 guardam fragmento do corpo do e-mail — alguns com o número do benefício dentro (`"(NB) 2466847943. Aguarde correspondência..."`). O rótulo sai por whitelist (`beneficioLegivel`) e a saída da IA ainda passa por `mascararDocumentos` (CPF e NB viram `***`).
- **A IA nunca é o único caminho**: sem chave, timeout ou resposta vazia, sai o texto determinístico do `fallbackMensagemCliente`, que já é uma mensagem correta. Modelo: `google/gemini-3.6-flash`, ~19 chamadas/dia.
- Fila e auditoria em `inss_status_history`: `zap_status` (enviado|agendado|silencio|sem_grupo|repetido|retroativo|suprimido|expirado|suspeito|pericia_escritorio|so_escritorio|erro), `zap_tipo`, `zap_texto` (o texto exato que foi ao grupo), `zap_enviado_at`, `zap_erro`. A coluna **não tem CHECK**, valor novo entra sem migration.

**Duas exigências que o cliente não recebe** (27/08/2026, pedido do usuário). Medido sobre as 559 exigências com despacho: 255 viram `pericia_escritorio`, 17 viram `so_escritorio`, 53 saem filtradas e 234 saem iguais a hoje.

1. **Agendamento de perícia é tarefa nossa** — `exigenciaDeAgendamentoDePericia` (`lib/inss-mensagem-cliente.ts`). Quando o INSS manda marcar a perícia, quem liga no 135 ou agenda no Meu INSS é o escritório; o cliente só é avisado da data depois de marcada, por uma pessoa. A atividade muda de cara: título vira `Agendar perícia no INSS — requerimento N` e a descrição abre com `📞 TAREFA DO ESCRITÓRIO`. O evento fica como `zap_status = 'pericia_escritorio'`, e como não conta na trava de repetição (`jaAvisouEsseTipo` só olha enviado/agendado), uma exigência posterior ainda avisa normalmente.
   - O corte é em **"agendar"**, nunca em "135": 495 das 597 exigências citam o 135, mas na maioria ele é só o telefone do rodapé de um pedido de documentos. O gatilho é o imperativo (`Agende`) ou a necessidade (`é preciso/é necessário/deverá agendar`), sempre junto de perícia ou avaliação social — pega os três textos (BPC, Benefício por Incapacidade via Meu INSS, auxílio-acidente pelo 135).
   - **Convocação não é agendamento**: "sua perícia foi remarcada… compareça no dia X" e "COMPARECER NO DIA 02/06/2026… (COMPROVANTE EM ANEXO)" continuam indo para o cliente — faltar à perícia derruba o pedido. Das 9 convocações com data e hora no histórico, o detector não pega nenhuma.

2. **Só o documento do advogado sai da mensagem** — `separarPendencias` (`lib/inss-despacho.ts`). Regra corrigida em **01/09/2026**: até então saía tudo que falasse de procuração, representação ou assinatura (211 fragmentos em 75 exigências), sob o argumento de 27/08 de que "o cliente lê como cobrança e não tem o que fazer". A premissa caiu quando o robô passou a **anexar o PDF da procuração** (bloco abaixo): agora ele tem o que fazer — imprimir, assinar à caneta e devolver. Fica de fora da mensagem uma coisa só: o pedido do **documento pessoal do procurador** ("Documento de Identificação do procurador(a)", "documento de identificação com foto do procurador", RG/CPF/OAB do advogado), que o cliente não tem como providenciar. Vai para o bloco `🏢 PENDÊNCIA DO ESCRITÓRIO` da atividade.
   - Medido sobre as 587 exigências com despacho (01/09/2026): o corte caiu de 75 exigências / 211 fragmentos para **5 / 5**, nenhuma exigência fica sem mensagem (antes 5 ficavam mudas) e **89** passam a falar de procuração com o cliente.
   - O corte segue sendo **pelo contexto, nunca pelo nome do documento**: CNH e OAB aparecem como identidade **do cliente** na exigência de biometria. As regex exigem a palavra da representação (procurador/advogado) perto do nome do documento.
   - **Quando os dois pedidos estão na mesma frase, não se corta**: "-PROCURAÇÃO E DOCUMENTOS DE IDENTIFICAÇÃO DO PROCURADOR" sai inteiro para o cliente, porque cortar levaria a procuração junto. Ali a barreira é a instrução do prompt, não o corte.
   - Dois separadores de fragmento novos, porque o INSS emenda os pedidos: itens em **letra** (`a) procuração b) documento ... do procurador`) e **verbo capitalizado sem pontuação** (`ANEXAR CARTEIRA DA OAB Apresentar ao menos uma prova documental...`). Sem o segundo, remover o item nosso levava junto o pedido principal do cliente.
   - Armadilha que continua valendo: **"procuração ou fiança reciprocamente outorgada"** é prova de união estável do art. 22 §3º do Dec. 3.048/99, papel do casal — fica com o cliente. E **"representante legal"** segue fora da lista (é a mãe ou o tutor, não o advogado).
   - Segunda barreira: `REGRAS_COMUNS` do prompt proíbe pedir o documento do advogado e **autoriza** pedir procuração, mandando falar dela em linguagem simples ("assinar o papel"), nunca "assinatura digital" nem nome de site.
   - Testes: `src/lib/__tests__/inssPendenciaEscritorio.test.ts` (15 casos, todos com texto real de `inss_status_history`).

**Procuração para assinatura manuscrita** (01/09/2026). O INSS deixou de aceitar a assinatura eletrônica do ZapSign: *"favor reenviar o documento acima citado, assinado de forma manuscrita"*, *"deve corrigir o erro ou apresentar nova procuração com consulta de autenticidade válida ou procuração física/original"*, *"consta Assinado por: ZAPSIGN PROCESSAMENTO DE DADOS LTDA, quando na realidade deveria constar assinado por (nome e CPF da Requerente)"*. São **65 exigências, em 58 requerimentos**.

- **Não se gera PDF nenhum.** Todo documento do ZapSign guarda em `zapsign_documents.original_file_url` o PDF **antes da assinatura**: preenchido com a qualificação do cliente, com data e a linha `____ OUTORGANTE` em branco, e **zero ocorrência de "ZapSign"** (o `signed_file_url` é que tem tarja, rodapé e página de assinaturas — o que o INSS recusa). 3.327 dos 3.331 documentos com PDF têm a URL; ela é **pública no S3 e baixa com GET anônimo**, sem token e sem consumir cota da API. Amostra de dez/2025 a mai/2026: todas HTTP 200.
- **Detecção** — `exigeProcuracao` (`lib/inss-despacho.ts`). Pega o pedido nominal (procuração, termo/documento de representação, representação processual) **e** a recusa de assinatura sem nomear o documento (`manuscrit`, `zapsign`, `validar.iti.gov.br`, "assinatura digital/eletrônica"), que é como o INSS escreve em 13 dos casos. Não confunde com a fiança reciprocamente outorgada.
- **Busca só por chave exata** — `buscarProcuracaoDoCliente` (`lib/inss-procuracao.ts`): `lead_id` → `outorgante_cpf` = `cpf_segurado` → nome normalizado idêntico. Acerta **24 dos 58 (41%)**. Sem chave, devolve `null` de propósito.
- **Casar por semelhança de nome está proibido, e é medido**: em BPC e maternidade o `nome_segurado` é a **criança** e quem assina é a **mãe**, então o nome nunca casa. Extrair o nome da mãe do `lead_name` (que é o título do grupo, `✅ PREV 1129 GABRIELY - BENTO`) parece resolver, mas o título também carrega o nome do **acolhedor**: a heurística entregava a procuração de BRENDA KAROLYNE para 5 clientes e a de MATEUS PATRICK para 4 — CPF e endereço de funcionária indo ao INSS no lugar dos do cliente. 10 dos 27 matches eram lixo.
- **Entrega**: achado o PDF, `notify-inss-update` põe o link na atividade e manda o arquivo no grupo **depois** do texto (`enviarDocumentoAoGrupo`, mesmo rodízio de instâncias-membro do texto). Falha no anexo não derruba o aviso. Mensagem que caiu na janela noturna leva o PDF junto quando o `dispatch-inss-zap` a entrega — ele **recalcula** a procuração na hora, o que evitou criar coluna nova em `inss_status_history`.
- **Sem PDF localizado**, a atividade avisa e manda a pessoa ao seletor: WhatsApp → menu ⋮ → **"Procuração para assinar à mão"** (`ProcuracaoPickerSheet`, aberto por evento `procuracao:picker`, hospedado no `WhatsAppInbox` como o do ZapSign). Lista as candidatas **dizendo por que cada uma apareceu**, busca por nome (o da mãe), abre o PDF no `MediaLightbox` e, no "É esta", pede confirmação, **grava o vínculo** (`lead_id`) e envia. O vínculo é o conserto que sobrevive: o próximo caso do mesmo lead resolve sozinho.
- A busca e a escrita moram no Railway (`inss-procuracao-vincular`), não no front: `zapsign_documents` devolve **lista vazia sem erro** para a anon key sem sessão, e a escrita do vínculo exige service role. O CPF sai mascarado para a tela.
- **Pegadinhas das colunas**: `tipo_documento` é nulo em 2.006 dos 3.331 e `template_name` é nulo em **todos**, então "é procuração?" se resolve **excluindo o que sabidamente não é** (`cessao_credito`, `aditamento_quitepay`, `contrato`, `outro` — 69 documentos). Exigir a palavra "procuração" no nome do arquivo descartaria 1.508 procurações boas, que se chamam `NOME DO CLIENTE.BPC LOAS.docx`. `signer_cpf` é **0/3331**: o CPF só vive em `outorgante_cpf`.
- Payload do anexo conforme o spec da UazAPI (`https://docs.uazapi.com/openapi-bundled.json`): legenda em **`text`**, nome do arquivo em **`docName`**. **`caption` não existe** no spec — mas é o que `_shared/zapsign-utils.ts` e `_external_send-whatsapp` mandam, então as legendas desses dois envios de documento nunca apareceram (não corrigido, fora de escopo).
- Testes: `src/lib/__tests__/inssProcuracao.test.ts` (7 casos com despacho real).

**Progresso do caso não sai depois do desfecho** (26/08/2026): a mensagem de conclusão de atividade ("Enviar ao grupo") anexa `📊 Progresso do caso: X%`, calculado pelos checklists do POP em `buildActivityMessage.ts`. O POP mede execução **interna** e continua andando depois de o INSS decidir.

- Medido em 30 dias: **139** requerimentos receberam mensagem de progresso no grupo; em **36** a mensagem saiu depois de o INSS concluir, **33** deles indeferidos, com atraso de 0 a 26 dias. Nada disso era automático — `action_source = manual` nas 1.091 mensagens do período.
- A causa raiz não é a tela: em **31 dos 33** não existia sequer a atividade "INSS atualizou … INDEFERIDO". Quem concluiu a atividade não tinha como saber. É o buraco fechado em 25–26/08 (atividade para requerimento com lead + dono por status).
- Defesa aplicada: `useInssDesfechoCaso(caseId, leadId)` lê `inss_admin_processes` e, quando **todos** os requerimentos do caso têm desfecho (nenhum em andamento), `buildActivityMessage` **omite o percentual na mensagem do cliente** e troca o detalhe do assessor por `⚠️ Requerimento N está INDEFERIDO no INSS`. Caso com um pedido negado e outro em análise continua mostrando progresso — ali ele é real.
- A notícia do desfecho **não** entra nessa mensagem: quem dá é a mensagem automática do INSS, acima. Dar a negativa de esguelha no meio de uma atividade é pior que não dar.
- **Lacuna conhecida**: `ProcessUpdatesBell` monta a mensagem dentro de um `useCallback` por movimentação e não recebe o desfecho — ali o progresso ainda pode sair. É o fluxo de movimentação judicial (CNJ), não o do requerimento administrativo.
- Estoque a tratar: **350** requerimentos indeferidos em **171** casos, e **160 desses casos têm atividade pendente** hoje.

**Cron**: `railway-server/src/index.ts` chama o sync a cada `INSS_SYNC_INTERVAL_MIN` (padrão 20), janela de 6h. Até 03/08/2026 esse sync só rodava por clique — a última execução tinha 3 dias.

**Vínculo automático — duas passadas** (`match-inss-orphans`, cron de 15 min):

1. Protocolo sem lead e sem caso (292 em 17/08/2026) → `findInssOrphanMatch` tenta nº do requerimento, NB, custom field "Nº Requerimento INSS", título de atividade, CPF e nome. Órfão com CPF é raro (16 de 292); o caminho real é o nome.
2. Protocolo **com lead e sem caso** (277) → assume o caso mais recente daquele lead. Antes ninguém religava: o lead ganhava `legal_case` depois do vínculo e o protocolo ficava parado; 30 estavam nesse estado. Não dispara `notify-inss-update` de propósito — notificar manda WhatsApp pro cliente, e aqui não houve novidade do INSS, só arrumamos vínculo interno.

**Gate do `notify-inss-update` — bastava caso, agora basta lead** (27/08/2026): o `gmail-inss-sync` só chamava o notify em `if (caseId && allowNotify)`. O `notify-inss-update` aceita lead sem caso desde 25/08 e o `match-inss-orphans` foi corrigido em 26/08 — o sync do Gmail ficou sendo o último a exigir caso. Resultado: requerimento que o auto-match casa **só com lead** (cliente sem `legal_case` aberto) não virava atividade nem mensagem. Medido no dia da correção: **524 eventos em 244 processos** nunca notificados nesse estado, 53 deles em agosto/2026 — por status, 174 Concluída, 166 Exigência, 91 Pendente, 30 Em Análise, 29 Cancelada, 27 Protocolado. Testemunha: ESTER (req. 477357453), e-mail 27/08 00:26 BRT, lead casado às 00:43, zero atividade. Corrigido para `if ((caseId || leadId) && allowNotify)`, com `leadId` vindo de `existingProc.lead_id` ou do retorno de `applyInssMatch`.

Backfill de agosto executado em 27/08/2026: **33 processos, 33 atividades, 0 mensagens**. Rodou em duas levas — 12 depois da auditoria de nome, e os 21 restantes só depois que a guarda subiu, para que vínculo errado fosse barrado pela máquina e não por planilha. Saldo do dia em `inss_status_history`: 25 `retroativo`, 46 `suprimido`, **10 `suspeito`** e 1 `enviado` (Ellena, PREV 1404). Os 6 vínculos errados foram desfeitos apagando junto o custom field envenenado — sem isso a passada 1 do matcher religa em 15 min. Rollback em `scratchpad/rollback-vinculos-errados.json`.

Backfill dos atrasados é seguro quanto a WhatsApp: `eventoElegivelParaZap` barra tudo anterior a `INSS_ZAP_CLIENTE_DESDE` e marca `retroativo`, então reprocessar histórico **cria atividade sem mandar mensagem nenhuma**. O risco do backfill é outro: 500+ atividades pendentes de uma vez no colo do Jose Francisco.

**Vínculo errado vira mensagem no grupo do cliente errado** (27/08/2026): enquanto o e-mail do INSS só virava atividade interna, um vínculo errado era sujeira. Desde que a atualização virou mensagem no grupo, virou risco de vazar o processo de um cliente para outro. Varredura dos **687 protocolos vinculados**: 67 com nome completo batendo, 399 parciais, 65 sem nome nenhum no lead para comparar, 144 com nome inútil no e-mail e **11 em conflito** — destes, 6 confirmados errados (ESTER no lead da ANA FLÁVIA, VALENTINA ARAUJO FRANCA numa notícia sobre "Valentina Francavilla", ELOA VITORIA no lead de ELOANE, LUIZ EDUARDO no de LUCAS DAVI, SARA RAYANE no de Ana Maria/João Manoel, FRANCISCO JAMES num caso trabalhista) e 1 a conferir (NIVIA × Nívea).

Três defesas, aplicadas juntas:

1. **`lib/inss-nome-confere.ts`** — `conferirNomeDoSegurado` compara o nome do e-mail com `victim_name`, `lead_name` e o nome do grupo. `victim_name` com 2+ tokens é nome estruturado e vale como confronto (um contém o outro, ou são pessoas diferentes); rótulo de funil só carrega o primeiro nome, então ali basta o primeiro nome do segurado aparecer inteiro. Rótulo só com palavra de processo ("✅PREV 1144 - ( ) Acd- -") dá `sem_base`, nunca `conflito` — não há nome ali para contradizer nada. Conflito ⇒ `zap_status = 'suspeito'`, a mensagem **não sai** e a atividade nasce com o aviso `⚠️ VÍNCULO SUSPEITO` dizendo qual nome brigou com qual.
2. **Substring no matcher** — a passada 5 do `findInssOrphanMatch` usava `includes(primeiro) && includes(ultimo)`, e `FRANCA` casa dentro de `FRANCAVILLA`. Passou a comparar **token inteiro**.
3. **A prova do requerimento pode ser circular** — o `applyInssMatch` grava o requerimento no custom field depois de casar por nome, então "o lead já tinha esse número" não prova nada se o campo nasceu junto com o protocolo. No caso da ESTER, protocolo criado 05/08 19:17:04 e custom field 19:17:07: três segundos. Só vale como evidência independente o campo **anterior ao e-mail** — e o campo envenenado ainda faz a passada 1 (`custom_field`) religar no mesmo lead errado, então desvincular sem apagá-lo não adianta.

**Fila de conciliação e vínculo do protocolo ao lead** (26/08/2026): 989 requerimentos, **685 com lead (69%)** e **304 órfãos** — e `linked_by` é nulo nos 685, ou seja, todo vínculo que existe foi feito pelo robô; ninguém nunca usou a tela.

O que o e-mail do INSS oferece como pista, medido nos 304 órfãos: **nome do segurado em 302**, **CPF em 18** (59 na base inteira, 6%), **NB em zero**. A única chave exata é o nº do requerimento anotado no lead antes do e-mail chegar — 158 dos 989.

Por que o nome não fecha sozinho — o INSS identifica pelo **beneficiário** e a base pelo rótulo do funil e pelo **responsável** (`PREV 1630 - EVELYN/BERNARDO` é mãe e criança):

| critério | acha candidato | resolve p/ 1 lead | conflito | nada |
|---|---|---|---|---|
| nome + sobrenome | 82 | 31 | 51 | **220** |
| só primeiro nome | 264 | 34 | **230** | 38 |

Testado contra `leads.lead_name`, `leads.victim_name`, `contacts.full_name`, grupos vinculados e os 29.185 registros de `whatsapp_groups_index`. Exigir nome completo devolve lista vazia; aceitar primeiro nome devolve trinta "Maria". Por isso o desenho é **lista ordenada para uma pessoa escolher**, nunca vínculo automático nessa faixa.

- **`ProtocolosListaSheet` → botão "Sem dono (N)"**: fila dos requerimentos sem caso E sem lead, do mais recente para o mais antigo por `created_at` (não por `protocol_date`, que é justamente o que falta neles). Ligar força "Qualquer data". São ~3 por dia (88 em 30 dias); o acervo parado é 304.
- **`src/lib/inssVinculoScore.ts`**: peso por pista (requerimento 1000 → CPF 900 → nome forte 500 → nome fraco 100) mais desempate por benefício igual (+40) / diferente (−60), lead que entrou perto do protocolo (+30) e lead de outra época (−25). Nenhum bônus faz palpite ultrapassar CPF.
- **`buscarSugestoesDeCaso`** passou a: sugerir **lead sem caso** (`lead:<id>`, "(criar caso)") — antes só entrava lead que já tivesse `legal_case`, e o protocolo previdenciário quase nunca tem; procurar o número também em `protocolo_administrativo` e no campo "Nº Requerimento INSS"; e fazer uma passada **fraca** por primeiro nome **só quando nada forte apareceu**, rotulada "confira".
- **`vincularProtocoloAoCaso`** agora grava `leads.victim_name` com o nome do segurado quando o campo está vazio (fecha o buraco para o próximo requerimento do mesmo cliente) e chama `notify-inss-update` — o e-mail que ficou parado por falta de vínculo vira atividade na hora, e mensagem ao cliente se for posterior ao corte.
- **Caso ilustrativo — PREV 1404** (27/08/2026): lead, caso **e** grupo existiam, e mesmo assim o protocolo ficou órfão. O e-mail do INSS traz só requerimento e nome ("ELLENA DA SILVA MOREIRA"); o lead não tinha nenhuma das chaves — `cpf` nulo, `victim_name` nulo, sem campo "Nº Requerimento INSS", sem `lead_processes` com o número, e o único contato cadastrado era "Nayra" (a responsável). O nome da beneficiária só existia como "Ellena" dentro do `lead_name`, que o matcher ignora de propósito — e `%ELLENA%` casa com 4 leads (duas "Hellena" e a duplicata "Naira - Ellena / 1.404"). Vínculo feito à mão gravando as três coisas que faltavam: `case_id`/`lead_id` no protocolo, `victim_name` no lead e o requerimento no custom field. São essas duas últimas que fazem o **próximo** e-mail do mesmo cliente casar sozinho.
- O que **não** adianta perseguir: extrair CPF do e-mail (54 de 928 despachos), usar NB (nunca vem) ou apertar o matcher automático por nome — cada ponto forçado ali vira risco de mandar mensagem de um cliente no grupo de outro.

**O que NÃO existe** (pedido, mas sem dado): ranking de quem protocolou. Nenhuma fonte identifica o operador — `linked_by` é 0% preenchido, responsável do caso cobre 9%, atividade "PROTOCOLAR" casada cobre 24%. Só uma captura no ato do protocolo resolve, e ela não teria histórico.

---

## Controle Processual — `/process-tracking`

**Propósito**: planilha editável de acompanhamento de processos trabalhistas e previdenciários, com importação por CSV, Google Sheets e PDF (extração por IA). Abas "Trabalhista" e "Previdenciário" (por prefixo do caso: CASO/PREV).

- "Selecionar CSV" — importa CSV local com detecção de conflitos por CPF.
- "Importar Dados" (Google Sheets) — importa por URL da planilha.
- "Selecionar PDF" — IA extrai as linhas do PDF.
- Busca "Buscar por cliente, caso, CPF ou nº processo...".
- "Novo Registro" — cadastro manual (cliente, caso, CPF, nº processo, status, acolhedor etc.).
- Pré-visualização da importação com badges "Atualizar"/"Novo" e seleção por linha; conflitos por CPF com "Sobrescrever"/"Pular".
- Edição inline direto na tabela.

**Fluxo recomendado**: importar via CSV/Sheets/PDF → resolver conflitos → confirmar a pré-visualização → manter os registros com edição inline.

---

## Aux. Acidente / BPC — `/processual/bpc-autista`

**Propósito**: lê a pasta do caso no Google Drive, tria cada documento com IA (favorável/adverso/neutro, com bloqueio de sensíveis) e monta um dossiê em PDF único para protocolo manual no INSS. Não acessa o portal do INSS.

- Campo "Título do caso ou número PREV" — busca o caso com autocomplete.
- "Analisar pasta do Drive" / "Re-analisar pasta" — roda a triagem por IA.
- Desambiguação de pasta quando há várias; "Usar pasta" aceita link/ID manual.
- "Recomendação da triagem" — protocolável ou não, avisos, documentos e campos faltando.
- Checkbox por documento — inclui/exclui do dossiê (sensíveis bloqueados).
- "Baixar dossiê (PDF)" / "Montar dossiê único (PDF)" — gera o PDF combinado.

**Fluxo recomendado**: buscar o caso → "Analisar pasta do Drive" → conferir a recomendação → marcar os documentos favoráveis → "Baixar dossiê (PDF)".

---

## Gerar Procuração — `/gerar-procuracao`

**Propósito**: porta fixa do gerador de procuração — informa-se o telefone do cliente, o sistema localiza a conversa/lead/contato e abre o popup de documento (ZapSign) com a IA preenchendo os campos, para revisão e envio para assinatura via WhatsApp.

- Campo "Telefone (WhatsApp)" + "Abrir" — resolve o cliente pelo telefone e abre o popup.
- Select "Enviar pela instância" — escolhe a instância WhatsApp de envio.
- Aceita parâmetros de URL: `?phone=` (auto-abre), `?instance=`, `?template=`.
- No popup: revisão dos campos extraídos pela IA, edição de signatários, confirmação de envio.

**Fluxo recomendado**: digitar o telefone com DDD → escolher a instância → "Abrir" → revisar campos e signatários → confirmar o envio.

---

## Núcleos Especializados — `/nuclei`

**Propósito**: cadastro de núcleos especializados usados para prefixar/numerar os casos (ex.: AT-0001). Cada núcleo tem nome, prefixo, cor, descrição, status e contador de sequência.

- "Novo" — cria núcleo (Nome, Prefixo até 6 letras, Cor, Descrição).
- Switch por card — ativa/desativa.
- Lápis — edita; lixeira — exclui (casos já vinculados não são afetados).

**Fluxo recomendado**: "Novo" → nome + prefixo + cor → salvar. O prefixo passa a valer na numeração automática de casos novos.

---

## Pipeline de atualizações por e-mail — sync-email-push v13 (30/08/2026)

**Estado**: ATIVO em produção desde 30/08/2026 (migrations aplicadas, `sync-email-push` v13 deployada, Railway no ar). Resultados verificados no dia da ativação: casamento na janela de 7 dias foi de 41% (28/69) para 82% (513/625) — 100% nos e-mails cujo processo está cadastrado; 954 cards v13 em 423 processos; backfill do inbox#3 com filtro de órgãos (jus.br/mp.br/gov.br + assuntos SEI/OS/denúncia/demanda) trouxe 2.066 e-mails de 04/01/2024 até hoje; a aba "Sem vínculo" nasceu com 717 identificadores (567 protocolo INSS, 101 SEI, 47 CNJ, 1 demanda SIT — a 3747657-2 da SRTE/PB — e 1 ordem de serviço — a 11471427-4 do MTE). Fase 2 fechada no mesmo dia: 1.727 anexos capturados (backfill + modo `anexos_retroativos` do gmail-processual-sync), cron `jm-anexos-extrair` (30 min, lote 12) dispara a `jm-ler-peca` modo `{anexo_id}` só para o que é peça (PDF ou imagem ≥100 KB; assinatura de e-mail fica fora) e re-enfileira o e-mail no parser quando o texto chega — foi assim que 8 ordens de serviço (formato "OS:11388013-8" dos PDFs do SFIT, âncora própria) e 2 demandas SIT saíram de dentro dos relatórios de acidente do MTE direto para a aba "Sem vínculo".

**O que muda quando ativar**:

1. **Índice paginado** — o select de `lead_processes` era cortado em 1.000 linhas pelo PostgREST; a base tem 1.645 ativos com número. ~39% da carteira nunca casava. Agora pagina com `.range()` e devolve `indice_processos_carregados` no retorno.
2. **Identificador tipado** (`_shared/identificadorProcessual.ts`) — CNJ exige 20 dígitos + DV módulo 97 (ISO 7064); SEI/demanda SIT/ordem de serviço/protocolo INSS têm tipo próprio pela máscara, nunca por comprimento. Tipo do e-mail tem que bater com o tipo do cadastro. Não-CNJ exige palavra-âncora a ≤40 caracteres.
3. **Parsers novos derivados de e-mails reais** — PJe Push TRF1 (tabela Data/Movimento/Documento, 461 e-mails) e TRF3 (mesmo layout achatado, 93), EPROC em linha corrida TRF6/TJMG/JFs (a movimentação na mesma linha do `Num. Processo:` era pulada), PROJUDI TJAM (prosa com data por extenso), e-SAJ com `Incidente Processual:` e teor curto como complemento. Link do documento vai dentro de `eventos`.
4. **Fallback não inventa data** — layout desconhecido grava `data_movimentacao` nula + `data_presumida = true` (migration `20260830120000`); o card mostra "sem data no e-mail".
5. **Órfãos persistidos** — identificador sem cadastro vira linha em `email_identificadores_orfaos` (RPC `jm_email_orfaos_upsert`); aba **Sem vínculo** no painel do sino ordena por última ocorrência com ações Vincular (busca nº/nome) / Criar processo / Ignorar; ao vincular, a função reprocessa os e-mails daquele identificador (`{ reprocessar: { identificador } }`) para os cards retroativos.
6. **Anexos MTE** (migration `20260830121000`) — `gmail-processual-sync` salva anexos de remetentes de governo no bucket privado `processual-anexos`; `jm-ler-peca` ganhou modo `{ anexo_id }` que extrai o texto (mesma função, mesmo Gemini); a varredura de identificadores roda também sobre o texto extraído.
7. **Backfill restrito do inbox#3** — `gmail-processual-sync` aceita `inbox` + `q` (filtro Gmail) e, em `dry_run`, devolve `por_ano`/`por_remetente` — o relatório que aprova o backfill do adm@ até 01/01/2024 sem despejar a caixa inteira.

**Proveniência**: toda linha nova do feed grava `email_message_id` + `email_recebido_em` — é o que torna o reprocessamento limpo (`apagar_cards` só alcança cards do mesmo e-mail).

### Parser versionado — e-mail lido por parser velho volta para a fila (30/08/2026)

**O furo**: a ficha do processo `1017247-47.2025.4.01.3100` dizia "Nenhuma movimentação capturada neste processo ainda" com **três pushes do TRF1 na base** (17/06, 30/06 e 09/07/2026, `has_movimentacao = true`, `process_number` preenchido). Os três foram lidos em 11-12/08 pelo parser da época — que só copiava o assunto —, e os cards genéricos que ele gerou foram apagados na limpeza de ruído do dia 12 (`zz_process_updates_ruido_bkp_20260812` guarda os 3). Como `vw_email_push_pendentes` era anti-join contra `email_push_processados`, o e-mail ficou marcado como lido para sempre: nenhuma rodada do cron voltava nele, e o parser v13 — que extrai a tabela Data/Movimento do TRF1 — nunca chegou a vê-lo.

**Tamanho**: 155 dos 615 processos com push na base estavam sem um único card; 559 e-mails deles marcados como processados, 462 nos dias 11-12/08. Por layout, 520 desses 559 (93%) têm marcador que o parser corrente sabe ler (303 tabela Data/Movimento, 212 bloco "Eventos:", 5 e-SAJ).

**A correção** (migration `20260830210000_reler_push_apos_parser_novo.sql`): "processado" deixa de ser sim/não e passa a ser **por qual parser**.

- `email_push_processados.parser_versao` guarda a versão que leu o e-mail (linhas antigas ficam em `0`);
- `jm_email_parser_versao()` é a versão corrente — **fonte única**, lida pela edge e pelas views (nasce em `1` = sync-email-push v13);
- `vw_email_push_pendentes` = nunca lido **ou** lido por versão anterior. O `0` das linhas antigas é o que devolve a caixa inteira (9.495 e-mails em 30/08) para a fila uma vez;
- `vw_jm_captura_status` conta "concluído" como "lido pelo parser corrente" — senão o painel diria 0 na fila enquanto a edge relê 9 mil e-mails.

**Reprocessar é seguro e não custa**: a gravação do feed é upsert por `(process_id, conteudo_hash)` com `ignoreDuplicates`, então e-mail relido não duplica card; e a reabertura paga do Escavador (`jm_esc_reabrir_por_cnj`, R$ 0,20/processo) só alcança e-mail recebido dentro de `reabrir_desde_dias` (3), então o passivo antigo passa de graça. Ritmo: cron de hora em hora com `limite: 200` ≈ 48 h para drenar; chamadas manuais com `limite: 1000` encurtam.

**Ordem de aplicação**: deploy da `sync-email-push` primeiro, migration depois. Invertido, a edge antiga marca sem `parser_versao`, as linhas de backfill continuam em `0` e o cron relê o mesmo lote a cada hora até o deploy chegar (não corrompe nada — só desperdício).

**O RITUAL**: mexeu em `_shared/emailPushParser.ts` de um jeito que muda o que ele extrai? Sobe `jm_email_parser_versao()` em +1 numa migration. É isso que faz a melhoria valer para a caixa inteira, e não só para o e-mail que chegar depois dela.

**Na tela** (`SemMovimentacaoNoProcesso.tsx`): o vazio do painel de um processo deixou de ser ponto final e virou detector com caminho clicável — se há e-mail de push na base sem card, diz quantos e oferece "Ler o(s) e-mail(s) agora" (chama `sync-email-push` no modo `reprocessar` por identificador, sem sair do painel); se não há nenhum, diz que o furo é a montante (processo fora do push do tribunal, ou número cadastrado diferente do que o tribunal usa).

---

## Radar de processos quietos — radar-processos-quietos (31/08/2026)

**Estado**: ATIVO. Edge `radar-processos-quietos` (Externo) + tabela `radar_atualizacoes` + funções `radar_processos_quentes`/`radar_mov_mais_nova` + cron `radar-processos-quietos` 2×/dia (09h e 17h UTC). Migration `supabase/migrations-external/20260831120000_radar_processos_quietos.sql`.

**O furo que ele fecha** (caso `1017247-47.2025.4.01.3100`, diagnosticado 31/08/2026): a juntada de réplica de 03/08 só chegou ao banco em **30/08** — 53 dias de atraso no prazo automático. As três fontes falharam juntas: juntada não sai no Diário (e-mail push estruturalmente cego), DataJud sem o processo, e o **cache do próprio Escavador** parado em 08/07 — a consulta de 30/08 aconteceu de verdade (`data_ultima_verificacao` só grava dentro do bloco que salvou o retorno da API) e mesmo assim veio velha, porque nossa consulta lê a cópia do Escavador, não o tribunal, e ninguém nunca pediu `solicitar-atualizacao` (0 linhas em `jm_esc_solicitacoes` para o CNJ). Medido no dia: 591 processos com atividade aberta, 335 com movimentação parada 20+ dias, 254 com prazo ≤7 dias e movimentação velha.

**Como funciona por rodada**: (1) follow-up das solicitações pagas pendentes — re-consulta o cache, quem avançou vira `ATUALIZADO` + `sync-process-compromissos` na hora; (2) lista quente via `radar_processos_quentes`, por urgência: `email_recente` (push nos últimos 2 dias e movimentações salvas mais velhas que o e-mail — o caso Sidiney em 10/07), `prazo_proximo` (atividade vence em ≤7 dias, movimentação >7d), `mov_estagnada` (parada ≥20 dias); (3) re-consulta **gratuita** do cache (`backfill-process-marcos` com `process_ids`, lotes de 20, até 40/rodada); (4) só quem **continua** parado vira solicitação **paga** (`esc-autos` `acao=solicitar`, corpo `{}` = tribunal sem documentos, o modo mais barato), com cooldown por motivo (3/7/30 dias) e teto de 15/rodada. Créditos cobrados ficam na linha (`radar_atualizacoes.creditos`) — custo auditável por `select motivo, count(*), sum(creditos) from radar_atualizacoes group by 1`.

**Knobs** (body do POST): `dry_run`, `max_refetch` (40), `max_solicitacoes` (15), `stale_dias` (20), `prazo_janela_dias` (7). **Rollback <5min**: `select cron.unschedule('radar-processos-quietos')` — nada mais depende da edge.

---

## Ficha do processo: de onde vem a capa (30/08/2026)

**O problema**: 1.175 dos 1.291 processos judiciais estavam sem tribunal, 1.181 sem polo ativo e 896 sem nenhuma data de início — muitos deles com 20 movimentações e a aba "Documentos" cheia. Causa: o endpoint `/processos/{cnj}/movimentacoes` do Escavador **não devolve capa**, e era por ele que a edge `backfill-process-marcos` alimentava a base. Só o botão "Buscar no Escavador" da ficha (`buscar_completo` → `escavador_raw` → `handleReExtract`) traz capa, e ele nunca tinha rodado nesses processos.

**Não afeta a jurimetria.** Conferido em 30/08/2026: nenhuma view `vw_jm_*` lê esses campos. A única que toca `lead_processes` é `vw_jm_conciliacao_acordos`, e só usa `process_number` e `title`. Os valores vêm de `jm_valores`/`jm_decisoes`/`jm_lancamentos`; os prazos, de `jm_processos.data_protocolo` e `jm_movimentos` (DataJud). O que a ficha vazia quebra é a **busca da carteira por UF/cidade/tribunal** (`useCarteiraDoPop.ts`) e o **marco de ajuizamento**, que a régua tira de `data_distribuicao`/`data_inicio`.

**As três fontes, em ordem de precedência** (`src/lib/fichaDoBanco.ts`, botão "Completar do banco" da ficha):
1. publicação guardada em `process_movements` (a capa está na primeira intimação);
2. nota do cadastro (`lead_processes.notes`, do inventário por OAB);
3. DataJud (`vw_estacao_evidencia_datajud`) → órgão julgador, grau, sigla do tribunal;
4. jurimetria (`jm_processos`, `jm_partes`) → polo passivo, cidade, UF, data de protocolo, polo ativo.

Custo zero de API — é tudo junção do que já está no banco.

**Backfill em lote**: `scripts/completar-ficha-do-banco.sql` aplica isso a toda a base (backup → dry-run → update → rollback). Só grava em coluna NULL, é idempotente e não toca `data_ultima_verificacao`. Rodado em 30/08/2026: **1.027 processos preenchidos, 0 sobrescritos**; backup em `lead_processes_ficha_backfill_20260830` (RLS ligada, sem policy).

**Furo fechado na origem**: `_shared/escavadorCapa.ts` (`mapearCapa` + `COLUNAS_DA_CAPA`) traduz a capa do Escavador para as colunas de `lead_processes`. A `backfill-process-marcos` já pagava uma consulta extra em `/processos/{cnj}` quando faltava data de início, mas guardava só três campos; desde a v16 grava a capa inteira e o `escavador_raw`, sem passar por cima de campo já preenchido. Deploy da função: `node _deploy_backfill_process_marcos.mjs` com `SUPABASE_PAT` (ela tem dependências em `_shared/`, então não dá para subir só o `index.ts`).

**Dois defeitos de leitura da nota corrigidos junto**: o valor parava no primeiro ponto e cortava "Copel Distribuicao S.A" em "Copel Distribuicao S" (705 fichas); e parte anonimizada em iniciais ("R. G. M. P.") virava polo passivo "R" (35 fichas, todas desfeitas).
