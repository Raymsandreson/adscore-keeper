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
- Chips: Assessor, Tipo, Fluxo de trabalho, Lead, Contato, Caso (cada um com busca).
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
- Campos: Assessor* (multi — cada responsável recebe a própria atividade), Tipo* (com sugestão de IA), Fluxo de Trabalho*, Observadores, Situação, Prioridade, campos de texto rico com @menções, notas com anexos.
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

- Ordenação exibida: 1º Passos Dados → 2º Concluídas → 3º Menos Atrasadas → 4º Mais Tempo Ativo → 5º Menos Ocioso → 6º Resposta no Chat.
- Seletor de time, período "Hoje"/"Semana"/"Mês", "Atualizar", "Modo TV" (tela cheia).
- Clique num assessor — abre o coach de desempenho ("Analisar & mandar mensagem").

---

## Campeonato de Engajamento — `/leaderboard`

Ranking semanal de engajamento (Menção = 5 pts; Comentário = 2 pts). Página de consulta, sem ações.

---

## Destaques — `/destaques`

Mural "Top 5 de Avaliação" — ranqueia responsáveis pela média de estrelas dos feedbacks de clientes. Período "Últimos 30 dias"/"Tudo", "Atualizar", "Modo TV" (auto-atualiza a cada 90s).
