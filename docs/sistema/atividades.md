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
- Chips: Assessor, Tipo, POP, Lead, Contato, Caso (cada um com busca).
- "Com documentação" e "Cronômetro ativo" (só atividades com cronômetro rodando agora).
- Busca "Buscar nas atividades…" e "Limpar" (zera tudo).
- Calendário lateral — selecionar dias vira filtro; botão de compartilhar resumo do dia.

### Cartão de atividade
- Clique — abre a ficha; ícone verde — "Concluir"; duplicar; lixeira — excluir.
- Indicador de cronômetro rodando mostra quem está executando e há quanto tempo.

### Ficha da atividade
- Título editável inline; badge com o tempo total dedicado (soma das sessões de cronômetro).
- Menu "Vincular": Caso, Processo, Contato, "Últimas movimentações" do processo.
- Menu "Preencher com": **"Preenchimento por Áudio"** (grava ligação/ditado, IA transcreve e preenche os campos) e "Preenchimento por Documento".
  - Comprovantes do **Meu INSS** (protocolo de requerimento, agendamento de perícia médica/avaliação social, exigência) são detectados automaticamente e preenchem "Como está / O que foi feito / Próximo passo" no modelo padrão da equipe (blocos *Perícia médica:* / *Avaliação social:* com dia, local, endereço e orientações fixas); a data da perícia marcada vira o prazo da atividade.
- Campos: Assessor* (multi — cada responsável recebe a própria atividade), Tipo* (com sugestão de IA), POP*, Observadores, Situação, Prioridade, campos de texto rico com @menções, notas com anexos.
- A ficha também abre **já preenchida por IA** quando a atividade nasce de outra tela: mensagens do **Chat da Equipe**, movimentação do processo, documento, ditado por voz ou ligação. É sempre o mesmo formulário — o usuário revisa e só então cria.
- "Vincular: Campanha" — associa a atividade a uma campanha.
- Envio ao grupo: "Copiar" (mensagem pronta), "Avaliação" (gera link público 0–5⭐), "Enviar ao Grupo / Enviar ao Assessor" (preview editável, escolha de instância, opção "Incluir gravação da ligação").
- Rodapé: "Excluir", "Salvar", "Concluir + próxima", "Concluir"; na criação: "Cancelar", "Chat", "Criar".

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
- **diretoria** (`org_directors`, via `useTeamLeadership`) — gestores continuam bloqueados;
- **visitante sem sessão** — senão a própria tela de login travaria;
- **telão `/tv/atividades` e páginas públicas** (booking, revisar, avaliar, landing) — ficam fora do `SidebarLayout`.

Enquanto o ponto (`onShift === null`) ou a liderança ainda carregam, nada é bloqueado — evita flash de tela cheia em quem tem passe livre. Regressão coberta em `src/components/activities/__tests__/ShiftGate.test.tsx` (5 casos).

---

## Registro rápido por voz — "O que você está fazendo?"

Cria uma atividade interna por ditado: "Iniciar gravação" → falar → "Parar e processar" → a IA transcreve, estrutura (título, tipo, prioridade, prazo, o que está fazendo, próximo passo) → revisar → "Salvar atividade" (cronômetro já inicia nela). Também é acionado pelo prompt de ociosidade.

---

## Visão Geral — `/dashboard`

**Propósito**: portal que lista dashboards por funil/processo; cada painel carrega sob demanda.

- Cartões de Funis: Acidente de Trabalho, BPC - Autismo, Auxílio Maternidade, Auxílio Acidente, Auxílio Doença, Seguro de Vida.
- Cartões de Processos: Acompanhamento Processual, Gerenciamento Acolhimento.
- Dentro do funil: "Abrir Kanban", "Time", "Editar"; "Voltar" retorna à grade.

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

- Ordenação exibida: 1º Status Esperado → 2º Fases → 3º Objetivos → 4º Passos → 5º Itens do Checklist → 6º Concluídas → 7º Menos Atrasadas → 8º Mais Tempo Ativo → 9º Menos Ocioso → 10º Resposta no Chat.
- Seletor de time, período "Hoje"/"Semana"/"Mês", "Atualizar", "Modo TV" (tela cheia).
- Clique num assessor — abre o coach de desempenho ("Analisar & mandar mensagem").

**Coluna "STATUS ESPERADO"** (1º critério) — conta no **grão de processo**, por **responsável**, no **mês em que o resultado aconteceu** (`resultado_atingido_data`), não quando foi cadastrado:
- Time de execução (POP): processos cujo status atingido (`lead_processes.resultado_atingido_id`, `status='confirmado'`) está entre os esperados do POP (`settings.resultado_esperado_ids` — pode ser mais de um).
- Time comercial (funil): resultado do lead no funil de vendas (como antes).
- Os dois somam por pessoa. Fonte: função `tv_atividades_ranking`. O status do processo é detectado das movimentações/e-mail — ver "Status do Processo" em `processual.md`. Grão (processo ≠ lead): `.agents/skills/lead-vs-case-identity`.

**Passo retroativo (não conta no ranking)** — ao marcar passo/objetivo, a caixa pergunta "Esse passo foi executado HOJE?" (`askStepTiming`). A janela é o **dia**, não o instante: quem executou de manhã e marca à tarde responde "Sim, foi hoje". "Não, foi em outro dia" grava `metadata.retroactive = true` no `user_activity_log` e o passo fica só no histórico.
- Retroativo é ignorado em **PASSOS**, **ITENS DO CHECKLIST** e, desde 31/07/2026, também em **FASES** e **OBJETIVOS** (`inst_last` só considera passo não-retroativo dentro do período — migration `20260731180000`). Antes disso o mesmo clique não valia passo mas fechava fase e objetivo, que pesam mais na ordenação.
- Sintoma clássico de "marquei tudo e aparece 0 PASSOS": os logs do dia estão com `retroactive = true`. Confere com `select metadata->>'retroactive', count(*) from user_activity_log where action_type='checklist_item_checked' and created_at >= current_date group by 1`.

---

## Campeonato de Engajamento — `/leaderboard`

Ranking semanal de engajamento (Menção = 5 pts; Comentário = 2 pts). Página de consulta, sem ações.

---

## Destaques — `/destaques`

Mural "Top 5 de Avaliação" — ranqueia responsáveis pela média de estrelas dos feedbacks de clientes. Período "Últimos 30 dias"/"Tudo", "Atualizar", "Modo TV" (auto-atualiza a cada 90s).
