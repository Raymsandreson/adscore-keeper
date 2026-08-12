# Módulo Processual

Documentação funcional das telas do módulo processual. Rótulos entre aspas são o texto exato exibido na interface.

---

## Processos — `/processes`

**Propósito**: central de processos judiciais e administrativos. Reúne processos judiciais vinculados a casos, processos administrativos do INSS (alimentados por e-mails do Gmail), e-mails processuais (PJe/PUSH), relatório de processos parados e planilha de datas de perícias.

**Abas**: "Judiciais", "INSS Administrativo", "Processual" (e-mails), "Sem movimento", "Perícias".

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

### Aba Perícias
Planilha transversal de datas (perícia médica/social etc.) lida dos campos personalizados do tipo "Data" dos processos, ordenada por data.

- "Só futuras" — datas de hoje em diante.
- "Atualizar" — recarrega.
- Busca "Buscar por cliente, campo, processo...".

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

## Audiências — `/hearings`

**Propósito**: agenda de audiências com visualizações Semana/Mês/Dia/Lista e sincronização com planilha externa. Cada audiência tem tipo, categoria, data/hora, fuso, status, local, responsável e observações.

- Busca "Buscar por processo, caso, observações...".
- Filtros: Tipo, Categoria, Status.
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
- Teto de 500 linhas por consulta, com aviso na tela quando bate no teto. Sem índice em `protocol_date`: com 891 linhas o planner faz seq scan de qualquer jeito; se a tabela crescer uma ordem de grandeza, criar `idx` parcial (`WHERE deleted_at IS NULL`) com `CONCURRENTLY`.

**Os dois números, e por que não se somam** (levantado em 03/08/2026):

Nada é registrado no ato do protocolo. Todo registro entra pelo `gmail-inss-sync`, que parseia o e-mail do INSS e grava `protocol_date` — não existe outro caminho de escrita. Daí saem duas medidas diferentes:

| Medida | O que é | Comportamento |
|---|---|---|
| `registrados` | Comprovantes que chegaram no dia (`created_at`) | Tem movimento diário. É o número em destaque. |
| `protocolados` | Cuja data de protocolo é o dia (`protocol_date`) | Produção real, mas só se completa depois: 92% dos registros entram após a data do protocolo, atraso mediano ~10 dias. Começa em 0 e sobe. |

Os gráficos plotam **por data de protocolo**, não por chegada: por chegada apareceriam picos artificiais de quando alguém rodou o sync na mão (30/07/2026 tem 174 numa rodada de backfill). Barras tracejadas = dias ainda dentro da janela de atraso.

**Alerta de sync parado**: se o `gmail-inss-sync` não roda há mais de 2h, as telas avisam. Sem isso, sync parado exibe 0 e parece que ninguém protocolou.

**Cron**: `railway-server/src/index.ts` chama o sync a cada `INSS_SYNC_INTERVAL_MIN` (padrão 20), janela de 6h. Até 03/08/2026 esse sync só rodava por clique — a última execução tinha 3 dias.

**O que NÃO existe** (pedido, mas sem dado): ranking de quem protocolou. Nenhuma fonte identifica o operador — `linked_by` é 0% preenchido, responsável do caso cobre 9%, atividade "PROTOCOLAR" casada cobre 24%. Só uma captura no ato do protocolo resolve, e ela não teria histórico.

---

## Conexão com o Gmail — caixas, leitura e envio

**Como funciona**: não há OAuth próprio. Tudo passa pelo gateway de conectores do Lovable (`connector-gateway.lovable.dev/google_mail/gmail/v1`), autenticado com `LOVABLE_API_KEY` + uma `X-Connection-Api-Key` por caixa. Cada connection key equivale a uma conta Google autorizada.

**As caixas** vêm de env vars no Railway, e o rótulo sai do índice da env (numeração herdada, não mexer — as allowlists em produção já falam nesses termos):

| env | label |
|---|---|
| `GOOGLE_MAIL_API_KEY` | `inbox#1` |
| `GOOGLE_MAIL_API_KEY_1` | `inbox#2` |
| `GOOGLE_MAIL_API_KEY_2` | `inbox#3` |
| `GOOGLE_MAIL_API_KEY_3` | `inbox#4` |

Quem lê o quê é decidido por allowlist: `PROCESSUAL_INBOXES` (caixa processual) e `INSS_INBOXES` (caixa adm; vazia = todas). O mapeamento único fica em `railway-server/src/lib/gmail-inboxes.ts` — antes estava copiado em cada função e divergia.

**Diagnóstico** — `POST /functions/gmail-status` (corpo `{}`; `{"probe_send": false}` pula o teste de envio). Responde, caixa por caixa: qual endereço é (mascarado), quantas mensagens tem, se **lê** e se **pode enviar**; e mostra qual caixa o `send-email` usaria para `judicial` e para `administrativo`, com a origem da decisão. É a ferramenta para responder "o Gmail está conectado?" sem adivinhar env var.

O teste de envio **não manda e-mail**: faz `POST /messages/send` com um envelope sem destinatário. `400` = tem escopo de envio (o Gmail recusou o envelope); `403` = a conexão foi autorizada só para leitura e precisa ser reautorizada incluindo `gmail.send`.

**Envio** — `POST /functions/send-email` `{ to, subject, html|text, process_type }`. O remetente é a conta da connection key, então `process_type` decide a caixa: `judicial` → processual, `administrativo` → adm. Até 12/08/2026 o judicial estava hardcodado em `GOOGLE_MAIL_API_KEY_3` (= `inbox#4`, inexistente — as caixas configuradas são `inbox#1..#3`), e todo envio judicial morria em "connection key não configurada". Hoje deriva de `PROCESSUAL_INBOXES`/`INSS_INBOXES`, com override opcional por `COBRANCA_GMAIL_KEY_JUDICIAL`/`COBRANCA_GMAIL_KEY_ADMIN`. Não há tela de envio: o único chamador é o `inss-report`.

**Lição registrada** (migration `20260812010000`): `net.http_post` sem ler `net._http_response` falha em silêncio — foi assim que uma URL errada do Railway deixou a caixa processual parada por dias sem alerta nenhum.

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
