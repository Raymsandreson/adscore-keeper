# Módulo Atividades e Produtividade

Documentação funcional das telas de atividades, cronômetro/banco de horas e telões. Rótulos entre aspas são o texto exato exibido na interface.

---

## Atividades — `/` (tela inicial)

**Propósito**: central de trabalho diário do assessor — cria, gerencia, cronometra e conclui atividades vinculadas a Lead/Caso/Processo/Contato (ou internas de equipe), com preenchimento por voz/áudio/IA e integração ao WhatsApp.

### Cabeçalho
- "Blocos" / "Lista" — alterna a visualização (blocos agrupados ou lista de cartões).
- "Telão" (troféu) — abre o ranking ao vivo `/tv/atividades`.
- "💬 Feedbacks" — feedbacks das atividades que você observa.
- Ícone de tribunal — "Varas e Tribunais — contatos".
- Ícone Play — inicia o Workflow (sessão sequencial de atividades, uma por vez).
- "Chat IA" — cria atividade conversando com a IA.
- "Nova Atividade" — abre a ficha em modo criação.

### Filtros
- Chips: Assessor, **Criado por**, Tipo, POP, Lead, Contato, Caso (cada um com busca).
- **Criado por** (`created_by`) responde "o que fulano cadastrou", diferente de Assessor (`assigned_to`), que é quem executa. Multi-seleção + opção "Sem registro". Ressalva: ~9.090 atividades antigas não têm criador gravado e caem em "Sem registro" — a cobertura melhorou com o tempo (mai/26 49% sem criador → ago/26 1,8%), então o filtro é confiável para o período recente. `DynamicKanbanBoard.tsx` ainda cria atividade sem gravar o campo.
- "Com documentação" e "Cronômetro ativo" (só atividades com cronômetro rodando agora).
- Busca "Buscar nas atividades…" e "Limpar" (zera tudo).
- Calendário lateral — selecionar dias vira filtro; botão de compartilhar resumo do dia.

### Cartão de atividade
- Clique — abre a ficha; ícone verde — "Concluir"; duplicar; lixeira — excluir.
- Indicador de cronômetro rodando mostra quem está executando e há quanto tempo.

### Ficha da atividade
- Título editável inline; badge com o tempo total dedicado (soma das sessões de cronômetro).
- Menu "Vincular": Caso, Processo, Contato, "Últimas movimentações" do processo.
- **Vínculo de processo** — o badge mostra sempre `<nº do processo> - <título>` lido de `lead_processes`, não o texto congelado em `lead_activities.process_title`. O snapshot fica desatualizado quando o número é preenchido depois da atividade nascer, e as atividades auto-criadas junto com o caso gravavam só o título (1.352 assim em 03/08/2026) — era isso que fazia aparecer "INDENIZAÇÃO" onde se espera o nº do processo. "Trocar Processo" abre um sheet próprio com os processos do caso, recarregados na abertura; entre 18/05 e 03/08/2026 o botão não fazia nada (o Popover que ele acionava foi removido e o estado ficou órfão). Rótulo centralizado em `src/lib/processLabel.ts`.
- Menu "Preencher com": **"Preenchimento por Áudio"** (grava ligação/ditado, IA transcreve e preenche os campos) e "Preenchimento por Documento".
  - Comprovantes do **Meu INSS** (protocolo de requerimento, agendamento de perícia médica/avaliação social, exigência) são detectados automaticamente e preenchem "Como está / O que foi feito / Próximo passo" no modelo padrão da equipe (blocos *Perícia médica:* / *Avaliação social:* com dia, local, endereço e orientações fixas); a data da perícia marcada vira o prazo da atividade.
  - **A IA não sobrescreve o que você escreveu.** Campo vazio ela preenche direto; campo já preenchido abre o diálogo "A IA quer alterar N campo(s)", com o seu texto ao lado da sugestão e um checkbox por campo — só muda o que for marcado. Trocar o **assunto** e **apagar** um campo vêm desmarcados. Motivo: as duas funções (`transcribe-activity-call`, `extract-activity-from-document`) declaram os 6 campos de detalhe como `required` no schema, então a IA devolve todos em toda chamada mesmo sem o áudio/documento falar deles — até 04/08/2026 o front aplicava a resposta inteira calado, e a atividade "trocava de assunto e conteúdo sozinha". Regra em `src/lib/activityAIFields.ts`, diálogo em `AIFieldMergeDialog.tsx` (`e977fe87c`). Metadados objetivos (prazo, notificação, prioridade, situação, assessor, tipo) seguem aplicados direto.
- Campos: Assessor* (multi — cada responsável recebe a própria atividade), Tipo* (com sugestão de IA), POP*, Observadores, Situação, Prioridade, campos de texto rico com @menções, notas com anexos.
- A ficha também abre **já preenchida por IA** quando a atividade nasce de outra tela: mensagens do **Chat da Equipe**, movimentação do processo, documento, ditado por voz ou ligação. É sempre o mesmo formulário — o usuário revisa e só então cria.
- "Vincular: Campanha" — associa a atividade a uma campanha.
- Envio ao grupo: "Copiar" (mensagem pronta), "Avaliação" (gera link público 0–5⭐), "Enviar ao Grupo / Enviar ao Assessor" (preview editável, escolha de instância, opção "Incluir gravação da ligação").
- Rodapé: "Excluir", "Salvar", "Concluir + próxima", "Concluir"; na criação: "Cancelar", "Chat", "Criar".
- **"Concluir + próxima"** conclui a atividade aberta e cria outra copiando o formulário inteiro (o que foi feito, como está, próximo passo, responsável, prazos, anexos). **O assunto digitado é preservado na filha** — a IA (`generate-activity-title`) só nomeia quando o campo está vazio. Entre 30/07 e 03/08/2026 a IA sobrescrevia o assunto escrito pelo usuário, o que fazia a atividade parecer que "mudava de nome sozinha" ao concluir (a mãe some da lista de Pendentes e a filha ocupa o lugar) e gerava títulos idênticos em casos diferentes; corrigido em `99223b072`. Para renomear de propósito, usar o botão **"Renomear com IA"** no cabeçalho: com o assunto em branco ele preenche direto; com assunto escrito, a sugestão passa pelo diálogo de revisão (o botão fica colado no "Preencher com" e um clique sem querer trocava o título calado).
- **Quando a filha não nasce**: a conclusão da mãe é gravada *antes* do insert da filha. Se o insert não passar, a mãe fica concluída e a cadeia para. O `createActivity` devolve `null` em silêncio em três casos — outro insert igual em voo (dedup de 5s por lead+título+tipo), prazo caindo em ausência registrada na aba Férias, e o índice único `lead_activities_dedup_pending_idx` (uma pendente por lead+título+tipo+responsável) — e lança em erro de banco. Até 04/08/2026 o fluxo não checava o retorno e anunciava "próxima criada" mesmo sem ter criado; desde `85e18a1fa` mostra erro e mantém a ficha aberta.
- **Forense**: "Concluir" e "Concluir + próxima" são **indistinguíveis** no `lead_activity_audit_log` — nenhum dos dois deixa marca própria. O `actor_kind` só diz se `updated_by`/`auth.uid()` casou com um `profiles.full_name` (`system` = não casou), não qual botão foi clicado. Baseline medido em jul-ago/2026: **8,6% a 25,6% das conclusões diárias não geram filha** — é o uso normal do "Concluir" simples, não sinal de falha. Só investigar pico muito acima disso.

### Cronômetro (automático)
Ao abrir uma atividade sua não concluída, o cronômetro inicia sozinho; abrir atividade de outro assessor é só consulta. Concluir encerra o cronômetro.

**Fluxo recomendado**: "Nova Atividade" → vincular Lead/Caso e definir Tipo → **"Preencher com → Preenchimento por Áudio"** (o jeito mais rápido: grava, a IA transcreve e preenche tudo) → revisar → "Criar"; ao terminar, "Concluir + próxima".

---

## Cronômetro global e banco de horas (presente em todas as telas)

**Propósito**: badge flutuante arrastável que controla expediente, cronômetro da atividade, ociosidade e pausas.

- "Iniciar expediente" — bate o ponto; nada conta sem expediente aberto.
- Badge da atividade: tempo + título, "Previsão de tempo" (chips 15–120 min), "Pausar e salvar", menu de Pausa, microfone **"O que faço?"** (registra por voz o que está fazendo — cria atividade e liga o cronômetro), "Time agora" (painel dos cronômetros do time), minimizar.
- Menu de Pausa: pausas rápidas com previsão (café/lanche/descanso), "Saída para almoço", "Intervalo (justificar)", "Compensação de banco de horas", "Encerrar expediente (saída)".
- Prompts automáticos: "Ainda está nessa atividade?", "Você saiu da atividade", "Você está ocioso / vai se ausentar?", "Sua pausa passou do previsto" (+5/+10 min, virar intervalo, "Voltei ao trabalho"), 🚨 "Chamado da gestão".
- "Qual atividade você está fazendo agora?" — troca a atividade em execução.

**Fluxo recomendado**: "Iniciar expediente" → abrir a atividade (cronômetro liga sozinho) → nos vazios, usar o microfone "O que faço?" pra documentar por voz → registrar pausas pelo menu → "Encerrar expediente" ao sair.

### Trabalho sem atividade aberta — guarda-chuvas do dia

Sem atividade vinculada, todo segundo cai na linha de gap e conta como **ocioso** (regra do `ActivityTimerContext`). Duas frentes de trabalho não têm atividade própria e ganham uma **atividade guarda-chuva por dia** — interna (`is_management`), atribuída a quem executou, uma linha reaproveitada o dia todo:

| Guarda-chuva | O que liga o cronômetro | Onde |
|---|---|---|
| `Atendimento WhatsApp — DD/MM/AAAA` | cada mensagem enviada a cliente | `useWhatsAppTimeTracker` (chat do WhatsApp) |
| `Controle Financeiro — DD/MM/AAAA` | cada registro gravado: categorizar transação (pendentes, banco, cartão, investimentos, empréstimos) e salvar lançamento financeiro — na página Financeiro ou na aba Financeiro da ficha do lead | `useFinanceTimeTracker` (`trackFinanceEntry`, gatilhos em `useExpenseCategories.setTransactionOverride`, `FinancialEntryForm` e `LeadFinancialsTab`) |

Regras iguais nas duas: atividade específica aberta (um caso) tem prioridade e não é interrompida; pausa/almoço é respeitada; **5 min sem nenhuma ação da frente → o watchdog pausa a guarda-chuva e a pessoa volta a ocioso**, mesmo que continue mexendo no sistema. Os dois watchdogs ficam montados no `ActivityTimerOverlay`. Excluir lançamento não conta como registro.

### Painel "Time agora" (`TeamTimersPanel`)

Abre pelo badge do cronômetro; agrupa por time (Gestão no topo) e atualiza a cada 20s lendo `activity_time_entries` do dia (`work_date`). Filtros por status:

| Chip | Quem aparece |
|---|---|
| Fazendo | atividade em andamento (`status='running'` com `activity_id`, batimento < 2 min) |
| Ocioso | cronômetro rodando sem atividade |
| Intervalo | pausa justificada (`break_type`) — almoço, café, banheiro |
| Não iniciou | não entrou no sistema hoje: zero produtivo **e** zero ocioso |

Quem bateu o ponto e já encerrou **não** entra em "Não iniciou" — aparece como "Hoje: HH:MM:SS produtivo · fora do ar". Gestor/diretor ainda podem pausar ou encerrar o expediente do membro pelo menu `⋮`.

**Quem não aparece** (em nenhum filtro, contagem ou no ranking do dia): desligados (`org_user_status.active = false`, 23 em 31/07/2026) e quem está de férias/folga/compensação cobrindo o dia (`member_time_off`). Única exceção: ausente que está com atividade em andamento continua visível, com selo "Férias"/"Folga" — é informação, não cobrança. Ambas as tabelas moram no Externo e são chaveadas pelo **Cloud user_id**. Folga só é filtrada se estiver cadastrada na aba Férias (Gestão de Equipe → `TimeOffManager`).

**Intervalo esticado**: a linha fica vermelha, sobe no topo do grupo e o chip "Intervalo" ganha `⚠ n` quando a pausa passa da previsão que a pessoa deu (`estimated_minutes`) ou, sem previsão, do teto por tipo — almoço 90 min, intervalo 30, café/lanche/descanso 20. Compensação de horas nunca alerta (banco de horas é longo por definição). Na prática o teto é que vale: as pausas registradas hoje (31/07/2026) estavam todas sem previsão.

**Sino de alerta** (`MemberAlertButton`) aparece em três situações — ocioso, intervalo e "não iniciou" — com frases prontas próprias de cada uma. Sai por dois canais:
- `activity_timer_alerts` (Externo) → Realtime toca o prompt 🚨 na tela dele, se a aba estiver aberta; quem está fora vê ao entrar;
- **Web Push nativo** via `send-team-push` (Railway), que passou a aceitar `user_ids` direto, sem thread de chat. É o único canal que alcança quem não iniciou o expediente. Chega só a quem ativou notificações — o toast diz qual dos dois casos aconteceu.

### Bloqueio sem expediente aberto (ShiftGate)

Sem ponto batido o sistema **não é utilizável**: `src/components/activities/ShiftGate.tsx` cobre a tela inteira (montado no `SidebarLayout`, em `App.tsx`) com o **POP "Início de expediente"** — os 6 passos do procedimento — e o botão "Iniciar expediente", que chama o mesmo `startShift()` do cronômetro. Só há duas saídas: bater o ponto ou "Sair da conta".

Quem **não** é bloqueado:
- **quem já encerrou o expediente hoje** (`shiftEndedToday`) — depois da saída batida a pessoa volta livremente para uma consulta pontual. Nada é cronometrado nesse estado, e o cronômetro flutuante segue mostrando "Iniciar expediente" se ela for retomar o trabalho (o clique reabre um `work_shifts` novo). O bloqueio vale só para **quem ainda não bateu a entrada** no dia;
- **diretoria** (`org_directors`, via `useTeamLeadership`) — gestores continuam bloqueados;
- **visitante sem sessão** — senão a própria tela de login travaria;
- **telão `/tv/atividades` e páginas públicas** (booking, revisar, avaliar, landing) — ficam fora do `SidebarLayout`.

`shiftEndedToday` vem do `ActivityTimerContext`: na carga ele lê o **último** `work_shifts` de hoje (antes filtrava só `ended_at IS NULL`, e por isso não distinguia "não iniciou" de "já encerrou") — com `ended_at` preenchido, o dia está encerrado. `endShift()` liga a flag, `startShift()` desliga. O encerramento remoto da gestão (`command = 'end_shift'`) passa pelo mesmo `endShift()`, então quem foi encerrado à distância também não fica trancado.

Enquanto o ponto (`onShift === null`) ou a liderança ainda carregam, nada é bloqueado — evita flash de tela cheia em quem tem passe livre. Regressão coberta em `src/components/activities/__tests__/ShiftGate.test.tsx` (6 casos).

---

## Registro rápido por voz — "O que você está fazendo?"

Cria uma atividade interna por ditado: "Iniciar gravação" → falar → "Parar e processar" → a IA transcreve, estrutura (título, tipo, prioridade, prazo, o que está fazendo, próximo passo) → revisar → "Salvar atividade" (cronômetro já inicia nela). Também é acionado pelo prompt de ociosidade.

---

## Visão Geral — `/dashboard`

**Propósito**: portal que lista dashboards por funil/processo; cada painel carrega sob demanda.

- Cartões de Funis: Acidente de Trabalho, BPC - Autismo, Auxílio Maternidade, Auxílio Acidente, Auxílio Doença, Seguro de Vida.
- Cartões de Processos: Acompanhamento Processual, Gerenciamento Acolhimento.
- Dentro do funil: "Abrir Kanban", "Time", "Editar"; "Voltar" retorna à grade.

### Relatório de Leads (dentro do funil) — `FunnelLeadsReport.tsx`

Cadastros e movimentações do funil por período. Conta só cadastro genuíno — `source` em `CADASTRO_SOURCES` (`src/lib/leadCadastroSources.ts`), excluindo `google_alerts`.

- **Períodos são âncoras de calendário**: "Esta semana" = a partir de segunda (numa segunda-feira, é igual a "Hoje"); "Este mês" = dia 1º. Os botões "Últimos 7/30 dias" são janelas móveis. Por isso os valores diferem legitimamente entre si e do card do Relatório do Kanban (03/08/26 no Trabalhista: semana 5, mês 6, 7 dias 27, 30 dias 102).
- **Dedup por `whatsapp_group_id`**: cadastros que compartilham o mesmo grupo contam 1 (30 dias: 102 → 99). O card do Relatório do Kanban não deduplica — divergência esperada em janelas longas.
- **"Cadastros por acolhedor"**: usa o campo texto `acolhedor`; sem ele, cai no nome de quem criou (`created_by`), e só então em "— sem acolhedor —". Cadastro vindo das Notícias grava `acolhedor` e deixa `created_by` nulo; cadastro vindo do WhatsApp faz o inverso.
- **Nome de quem criou/moveu sai do `profiles` do EXTERNO por `user_id`** (ago/2026): `leads.created_by` e `lead_stage_history.changed_by` guardam o uuid do Externo (`remapToExternal`), então o `profiles` do Cloud não casa nenhum uuid e todos caíam em "— sem acolhedor —". Conferido: 28 de 28 uuids distintos casam em `profiles.user_id` do Externo, 0 em `profiles.id` — nunca juntar por `profiles.id`. A mesma armadilha já apareceu no filtro de Assessor de Atividades.

---

## Banco de Horas — `/banco-horas`

**Propósito**: relatório de tempo cronometrado por membro e tipo de atividade, separando ativo, ocioso e pausas justificadas (almoço/intervalo/compensação não contam como ocioso).

- "Atualizar", "Exportar CSV".
- Filtros: período "De"/"Até" + "Aplicar período"; multifiltros Time, Assessor, Tipo de atv; "Limpar".
- Totais: Tempo ativo, Trabalho avulso, Tempo ocioso, Atividades, Membros; tabela por membro com subtotais.

**Fluxo recomendado**: definir período → filtrar por Time/Assessor → "Exportar CSV" pro fechamento do banco de horas.

---

## Telão de Atividades — `/tv/atividades`

**Propósito**: ranking ao vivo do time (auto-atualiza a cada 45s), feito pra rodar em TV/fullscreen.

- Ordenação exibida: 1º Status Esperado → 2º Fases → 3º Objetivos → 4º Passos → 5º Itens do Checklist → 6º Concluídas → 7º Menos Atrasadas → 8º Melhor Média de Estrelas ⭐ → 9º Menos Feedbacks sem Avaliar → 10º Mais Tempo Ativo → 11º Menos Ocioso → 12º Resposta no Chat.
- Seletor de time, período "Hoje"/"Semana"/"Mês", "Atualizar", "Modo TV" (tela cheia).
- Clique num assessor — abre o coach de desempenho ("Analisar & mandar mensagem"). No cabeçalho do coach os seis números também são clicáveis e abrem o detalhe (abaixo).

**Detalhe por critério — o que entrou naquele número** (desde 04/08/2026) — clicar em **status · fases · obj · passos · concl · atr · ⭐ · s/ avaliar** (na lista, no pódio, no Modo Corrida ou no cabeçalho do coach) abre o `RankDetailSheet` com a lista itemizada. Fonte: RPC `tv_ranking_detalhe(p_nome, p_criterio, p_since)` no Externo, que replica os filtros do `tv_atividades_ranking` — a soma do painel bate com o número do telão (conferido em 12 pessoas × 6 critérios).
- Cada item mostra em chips **cliente · processo · objetivo · fase · POP**. O processo é resolvido pelo POP do checklist (`lead_processes.workflow_id = lci.board_id`) e, se não houver, só quando o lead tem exatamente um processo — senão fica em branco em vez de chutar (`passo_processo_rotulo`). Nome da fase vem de `kanban_boards.stages` (jsonb, não existe tabela de stages — `board_stage_nome`).
- **Atalho pra origem da marcação**: marcou dentro da ficha da **atividade** → atalho da atividade; dentro da ficha do **processo** → atalho do processo (`/processes?openProcess=<id>`, e o chip "processo" some pra não repetir). Objetivo e fase herdam a origem do **último passo**, o que fechou o conjunto. Isso exigiu passar a **gravar** a origem: `log_checklist_step` ganhou `p_activity_id` e `p_process_id` (sobrecargas de 5 e 6 args, **sem default** — default criaria ambiguidade com a de 4, que segue existindo e delega), preenchidos pelo `LeadFunnelProgressBar` conforme onde ele está montado (`ActivityFullSheet`/`ActivitiesPage` → atividade; `ProcessDetailSheet` → processo). Dentro da atividade quem manda é ela.
- Marcação pelo funil/kanban/WhatsApp não tem origem, e **passos anteriores a 04/08/2026 também não** — o painel diz "origem não registrada" em vez de inventar. Não dá pra reconstruir: título de atividade nunca bate com o do passo (0 de 865) e correlação por horário casava só ~67%.
- Migrations: `20260804180000`, `20260804193000`, `20260804203000`, `20260804220000`.

**Modo Corrida — posição do carro = posição no ranking** (desde 04/08/2026) — a pista lê o **índice** da lista que a RPC devolve (a mesma ordenação de 10 critérios acima), não uma métrica isolada. Antes o carro andava por `passos/recorde`, então o 1º do ranking (3 status, 0 passos) aparecia parado na largada enquanto a 4ª colocada (47 passos) liderava a pista. Como a posição vem do índice, mudar a ordenação na RPC muda a corrida sozinho — nada de replicar critério no front (`computeTrackPositions`, `WackyRaceTrack.tsx`).
- Quem **não pontuou** nada no período (status/fases/objetivos/passos/checklist/concluídas todos zerados) fica na **largada** — tempo logado não anda o carro. Empate real (todos os critérios iguais) divide a mesma marca na pista.
- O **recorde** do período (`meta.passos`) deixou de ser a linha de chegada e virou selo: o troféu 🏆 ao lado do nome de quem iguala/supera. A chegada agora é a liderança do ranking.
- Regressão coberta em `src/components/tv/__tests__/WackyRaceTrack.position.test.ts`.

**Coluna "STATUS ESPERADO"** (1º critério) — conta no **grão de processo**, por **responsável**, pela data em que o resultado aconteceu (`resultado_atingido_data`), não quando foi cadastrado:
- Time de execução (POP): processos cujo status atingido (`lead_processes.resultado_atingido_id`, `status='confirmado'`) está entre os esperados do POP (`settings.resultado_esperado_ids` — pode ser mais de um).
- Time comercial (funil): resultado do lead no funil de vendas (como antes).
- Os dois somam por pessoa. Fonte: função `tv_atividades_ranking`. O status do processo é detectado das movimentações/e-mail — ver "Status do Processo" em `processual.md`. Grão (processo ≠ lead): `.agents/skills/lead-vs-case-identity`.
- **Respeita o período desde 04/08/2026** (migration `20260804211000`). Até então era o único critério que ignorava o `p_since` e contava sempre o **mês corrente**: com o telão em "Hoje" um assessor liderava com 3 status batidos no dia anterior. Agora "Hoje" é hoje, igual aos outros. **Atrasadas é o único que segue fora do período** — é backlog total, e o painel de detalhe avisa isso no cabeçalho.

**Colunas "⭐" e "s/ avaliar" — o feedback entra no ranking** (desde 05/08/2026, migration `20260805120000`):
- **⭐ (8º critério)** = média das notas que a pessoa **recebeu como responsável** (`lead_activities.feedback_rating`), creditadas por `feedback_rated_at` **dentro do período** do telão — mesmo filtro que o `aprov_pct` já usava. Não é a nota que ela deu nos outros. Sem nota no período mostra "—" e o critério não desempata (`nulls last`), então ninguém é penalizado por ainda não ter sido avaliado.
- **s/ avaliar (9º critério)** = feedbacks que **ela deveria avaliar e não avaliou**: atividade com retorno preenchido (`feedback`), ainda sem `feedback_outcome`, em que ela é **observadora ou criadora**. É **backlog total**, sem filtro de período (igual a "atrasadas") — dívida velha não some quando vira o dia. **Autofeedback não conta**: se ela é a própria responsável, aquela pendência fica de fora (mesma regra do `FeedbackFunnel`, que esconde "as minhas" por padrão). Efeito medido: o João Manoel tinha 21 pendências brutas, 17 delas de atividades dele mesmo → o telão mostra **4**.
- Os dois chips são **clicáveis** e abrem o `RankDetailSheet` (`p_criterio` = `estrelas` / `fb_pendentes`): no ⭐ vêm nota, desfecho, quem avaliou e a justificativa; em s/ avaliar vêm o responsável pelo retorno, há quantos dias está parado e o texto do retorno.
- Quem entra no ranking **não mudou**: o filtro do `ranked` continua exigindo entrega no período — ninguém aparece só por ter pendência de feedback.

**Passo retroativo (não conta no ranking)** — ao marcar passo/objetivo, a caixa pergunta "Esse passo foi executado HOJE?" (`askStepTiming`). A janela é o **dia**, não o instante: quem executou de manhã e marca à tarde responde "Sim, foi hoje". "Não, foi em outro dia" grava `metadata.retroactive = true` no `user_activity_log` e o passo fica só no histórico.
- Retroativo é ignorado em **PASSOS**, **ITENS DO CHECKLIST** e, desde 31/07/2026, também em **FASES** e **OBJETIVOS** (`inst_last` só considera passo não-retroativo dentro do período — migration `20260731180000`). Antes disso o mesmo clique não valia passo mas fechava fase e objetivo, que pesam mais na ordenação.
- Sintoma clássico de "marquei tudo e aparece 0 PASSOS": os logs do dia estão com `retroactive = true`. Confere com `select metadata->>'retroactive', count(*) from user_activity_log where action_type='checklist_item_checked' and created_at >= current_date group by 1`.

**Checklist do passo é condição, não pontuação** (desde 31/07/2026) — o passo **não fecha** enquanto sobrar item do seu checklist em aberto. Não existe critério novo no telão: requisito/pergunta/verificação continuam somando em ITENS DO CHECKLIST, e o que mudou é que o **PASSO** (e, por consequência, objetivo e fase) só conta com o procedimento conferido. Motivo: 1.690 dos 2.506 passos com sub-item (67%) estavam sendo concluídos sem nenhum item conferido.
- Regra única em `src/lib/stepSubitems.ts`, aplicada nos quatro caminhos de marcação (ficha da atividade, visão de fluxo, board do caso e `useChecklists`). "Marcar todos os passos" pula o passo travado e avisa quantos ficaram de fora.
- **"Não se aplica"** (`notApplicable` no sub-item): escape para o item que não cabe naquele caso — destrava o passo sem afirmar que foi feito e **não** entra no ranking. Clicar de novo desfaz.
- **Não existe botão "Marcar todos" de sub-item**: era o atalho que anulava a leitura item a item.
- Fora da conta de pendência: o **espelho de resposta** (item cujo rótulo repete uma resposta do passo — quem o marca é a resposta escolhida; ver `src/lib/popAnswerMirror.ts`).

**Cascata ao concluir o passo** (desde 05/08/2026, só no painel do POP dentro da atividade — `LeadFunnelProgressBar`) — marcar a bolinha do passo marca junto os sub-itens que ainda estão em aberto, em vez de recusar a marcação. Ficam de fora: **"não se aplica"** (já resolvido — dizer que foi feito seria mentira), **espelho de resposta** e **item-pergunta** (a resposta escolhida é que define fase e status; com pergunta em aberto o passo **continua travado** e o selo do bloco segue "trava o passo").
- Os ids marcados assim ficam em `autoCheckedDocIds` no passo: **desmarcar o passo desfaz exatamente esses** e preserva o que foi conferido item a item antes.
- **Não entra no ranking**: só o passo é logado (`log_checklist_step`); os sub-itens da cascata não geram `log_checklist_doc_item`. Um clique não vale como N conferências — é o que a medição de 31/07/2026 protege.
- `configOf()` em `syncChecklistInstances.ts` ignora `autoCheckedDocIds`: sem isso, todo passo concluído por cascata voltaria selado como "alterado no POP" no load seguinte.
- **Não mudou**: `/workflow-progress` (`WorkflowProgressView`) segue travando o passo, e "Marcar todos" do objetivo segue pulando passo com sub-item em aberto.

---

## Campeonato de Engajamento — `/leaderboard`

Ranking semanal de engajamento (Menção = 5 pts; Comentário = 2 pts). Página de consulta, sem ações.

---

## Destaques — `/destaques`

Mural "Top 5 de Avaliação" — ranqueia responsáveis pela média de estrelas dos feedbacks de clientes. Período "Últimos 30 dias"/"Tudo", "Atualizar", "Modo TV" (auto-atualiza a cada 90s).
