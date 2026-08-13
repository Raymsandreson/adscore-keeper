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

### Seleção em lote (passar para outro assessor ou excluir)
Botão **"Selecionar"** acima da lista liga o modo de seleção: cada cartão ganha caixa de marcação, o clique passa a marcar em vez de abrir a ficha (shift+clique marca o intervalo) e as ações individuais do cartão somem. Com algo marcado, o rodapé da coluna mostra a contagem e dois botões: **"Excluir"** e **"Passar para…"** — este último abre um painel lateral com a busca de assessor (`BulkReassignSheet.tsx`).

- **Alcance**: só o que está renderizado na tela. "Marcar todas" pega os cartões carregados; se o filtro tiver mais do que o lote atual, o rodapé avisa quantas ficaram de fora e pede "Mostrar mais". Nunca marca o que o usuário não viu.
- **Colisão do índice dedup**: antes de aplicar, o painel varre as pendentes que o destino já tem **nos mesmos leads** (não só o que está na tela) e compara pela chave do `lead_activities_dedup_pending_idx` — `(lead_id, lower(btrim(title)), activity_type)`. O que colidiria é **pulado e listado com o motivo**, em vez de estourar 23505 e derrubar o lote inteiro (mesma política da RPC `aplicar_responsavel_do_caso_nas_atividades`). Também trata a colisão entre duas selecionadas iguais: fica a mais antiga. Medição em 12/08/2026: de 8.133 pendentes vivas com lead, só 9 chaves têm 2+ donos (18 atividades) — a colisão é real mas rara, 0,22%.
- **Prazo no repasse**: três botões — **"Dia original"** (padrão, não toca em data nenhuma), **"Hoje"** e **"Outro dia"** (input de data). Nos dois últimos o lote grava só o `deadline` (coluna **DATE** no Externo, `YYYY-MM-DD`; `notification_date` fica como está, mesmo critério da redistribuição de inativos). O dia exibido na agenda é `deadline || notification_date` — a mesma regra do `getActivityDay` da tela, centralizada em `diaDaAtividade`.
- **Carga do destino por dia**: ao escolher a pessoa, o painel varre a agenda dela (não-concluídas, incluindo onde ela é co-assessora — mesmo critério do filtro da tela, senão a carga aparece menor do que a fila que ela vê) e mostra, por dia envolvido, "já tem N → fica com N+M". Em "Dia original" sai uma linha por dia do lote; em "Hoje"/"Outro dia", uma linha só. Atividade sem data aparece em linha própria como "sem dia na agenda". Cálculo em `resumoCarga` (função pura, testada).
- **Ausência**: se a data escolhida cair em Férias/Folga/Compensação do destino (`member_time_off`, via `getTimeOffConflicts`), o painel avisa em âmbar mas **não bloqueia** — repassar não é criar atividade, e travar o lote inteiro por um dia de folga pararia a operação. Só aparece nos modos com data fixa; "Dia original" não checa.
- **Concluída não é reatribuída**: ela registra quem executou o trabalho. O painel mostra quantas ficaram de fora.
- **Co-assessores**: com `assigned_to_ids` populado, o destino substitui o antigo dentro do array e os demais assessores continuam; se o destino já estava no array, o antigo só é removido.
- **Autoria e aviso**: o lote carimba `updated_by` (sem isso viraria "atualizada por —") e grava audit log `reatribuicao_atividades` com os ids. O destinatário recebe **um** aviso agrupado (`activity_notifications`, tipo `assigned_bulk`, sem `activity_id`), não um popup por atividade; lote de uma atividade usa o `assigned` normal, com botão de abrir.
- **Excluir em lote**: mesmo caminho do "Excluir" da ficha — soft delete (`deleted_at` + `updated_by`) e descarte dos `activity_time_entries` das atividades, para o banco de horas não contar trabalho de registro que sumiu da lista. Não filtra por status: exclui exatamente o que foi marcado, inclusive concluída. Confirmação obrigatória com o número no título e no botão. Diferença em relação ao individual: o audit vai em **uma** linha `exclusao_atividades` com `ids` + `snapshots` do lote (logAudit por atividade custaria 3 requisições ao Cloud cada), então restaurar um item do lote é ler o snapshot desse registro; lote de uma atividade grava no formato individual (`lead_activity`). Se a atividade aberta no painel direito estiver no lote, o painel fecha.
- Para esvaziar a fila de alguém **desativado**, o caminho continua sendo Equipe → "Redistribuir atividades de inativos" (`RedistributeActivitiesDialog`), que divide entre várias pessoas com teto por dia e move também a responsabilidade processual dos leads.

### Ficha da atividade
- Título editável inline; badge com o tempo total dedicado (soma das sessões de cronômetro) e, quando há previsão, no formato `⏱️ 12:40 / 30min` — com o excedente em vermelho quando passa.
- Menu "Vincular": Caso, Processo, Contato, "Últimas movimentações" do processo.
- **Vínculo de processo** — o badge mostra sempre `<nº do processo> - <título>` lido de `lead_processes`, não o texto congelado em `lead_activities.process_title`. O snapshot fica desatualizado quando o número é preenchido depois da atividade nascer, e as atividades auto-criadas junto com o caso gravavam só o título (1.352 assim em 03/08/2026) — era isso que fazia aparecer "INDENIZAÇÃO" onde se espera o nº do processo. "Trocar Processo" abre um sheet próprio com os processos do caso, recarregados na abertura; entre 18/05 e 03/08/2026 o botão não fazia nada (o Popover que ele acionava foi removido e o estado ficou órfão). Rótulo centralizado em `src/lib/processLabel.ts`.
- **O vínculo aparece pelo id, nunca pelo título** — `lead_activities` guarda `case_id`/`process_id` e um *snapshot* `case_title`/`process_title` do momento da criação; as auto-criadas nascem com o id preenchido e o título nulo (40 com processo e 2.189 com caso em 12/08/2026). Enquanto o cabeçalho e as badges condicionavam a exibição ao título, o caso/processo sumia da ficha e o menu "Vincular" (que lê o id) seguia oferecendo "Remover Processo" — e no `ActivityFullSheet` a badge virava o botão "Vincular Caso" numa atividade já vinculada. Hoje a condição é o id e o rótulo vem do dado vivo (`displayCaseLabel`/`displayProcessLabel`), com `useLinkedCaseProcess` buscando caso/processo por id só quando não estão em `leadCases`/`caseProcesses`.
- **Perícia médica e perícia social (Benefício INSS)** — quando o processo vinculado tem o título literal `Benefício INSS` (835 dos 1.864 processos em 13/08/2026), o cabeçalho da ficha ganha dois chips com data **e hora**, no espaço à direita dos vínculos: 🩺 "Perícia médica" e 🤝 "Perícia social". O clique abre um popover com `datetime-local`; a cor diz o estado (cinza sem data, azul futura, âmbar hoje, cinza-escuro passada). Vale na tela de Atividades e no `ActivityFullSheet`, via `PericiaInssChips.tsx`.
  - **A data mora no processo**, não na atividade: `lead_processes.pericia_medica_at` / `pericia_social_at` (migration `20260813120000`, aplicada em 13/08/2026). A perícia é uma só por benefício — preenchida em qualquer atividade, ela aparece em todas as do mesmo processo, inclusive nas criadas depois. Em `lead_activities` seria preciso redigitar a cada atividade e conviver com N versões da mesma data. Por isso o chip **salva na hora**, sem depender do "Salvar" da ficha (que grava outra tabela).
  - **Não é marco processual.** `process_movements` é histórico append-only do que já ocorreu e não separa médica de social; aqui é agendamento, que muda quando o INSS remarca. Ver `marcos-processuais-regras.md`.
  - **O fuso é convertido explicitamente** (`src/lib/periciaInss.ts`): `<input type="datetime-local">` não carrega offset, então gravar a string crua faria o Postgres lê-la como UTC e a perícia das 09:20 apareceria às 06:20 para quem marcou. Verificado ponta a ponta pelo caminho do front (sessão anônima + PostgREST): 09:20 digitado → `12:20Z` no banco → 09:20 de volta no campo.
  - A regra de exibição é o **título exato** (ignorando acento, caixa e espaço extra), não heurística de "INSS" — é a mesma string que `processAssignment` já usa para decidir responsável. `INSS Administrativo — Req. …` e `Auxílio maternidade` seguem sem os campos, porque não são o benefício.
  - **Lacuna conhecida**: o "Preenchimento por Documento" do comprovante do Meu INSS (abaixo) continua jogando a data da perícia no prazo da atividade e no texto — ainda não grava nos dois campos novos.
- Menu "Preencher com": **"Preenchimento por Áudio"** (grava ligação/ditado, IA transcreve e preenche os campos) e "Preenchimento por Documento".
  - Comprovantes do **Meu INSS** (protocolo de requerimento, agendamento de perícia médica/avaliação social, exigência) são detectados automaticamente e preenchem "Como está / O que foi feito / Próximo passo" no modelo padrão da equipe (blocos *Perícia médica:* / *Avaliação social:* com dia, local, endereço e orientações fixas); a data da perícia marcada vira o prazo da atividade.
  - **A IA não sobrescreve o que você escreveu.** Campo vazio ela preenche direto; campo já preenchido abre o diálogo "A IA quer alterar N campo(s)", com o seu texto ao lado da sugestão e um checkbox por campo — só muda o que for marcado. Trocar o **assunto** e **apagar** um campo vêm desmarcados. Motivo: as duas funções (`transcribe-activity-call`, `extract-activity-from-document`) declaram os 6 campos de detalhe como `required` no schema, então a IA devolve todos em toda chamada mesmo sem o áudio/documento falar deles — até 04/08/2026 o front aplicava a resposta inteira calado, e a atividade "trocava de assunto e conteúdo sozinha". Regra em `src/lib/activityAIFields.ts`, diálogo em `AIFieldMergeDialog.tsx` (`e977fe87c`). Metadados objetivos (prazo, notificação, prioridade, situação, assessor, tipo) seguem aplicados direto.
- Campos: Assessor* (multi — cada responsável recebe a própria atividade), Tipo* (com sugestão de IA), POP*, Observadores, Situação, Prioridade, **Previsão**, campos de texto rico com @menções, notas com anexos.
- **Previsão de tempo (⏱️ Previsão)** — quanto se espera gastar na atividade, em `lead_activities.estimated_minutes` (migration `20260812120000`). Antes de 12/08/2026 a previsão só existia por *sessão* de cronômetro (`activity_time_entries.estimated_minutes`) e só dava para definir no relógio flutuante, depois que a contagem já tinha começado — a atividade nascia sem nenhuma.
  - **Ao criar já vem sugerida** pela mediana real do tipo escolhido: RPC `activity_type_time_medians()` (180 dias, sessões > 60s, amostra ≥ 5 — abaixo disso não sugere), arredondada **para cima** na régua de opções. Arredondar para baixo faria metade das atividades nascer estourada e o vermelho do cronômetro viraria ruído. Sem histórico do tipo, 30 min. Medianas medidas em 12/08/2026: `tarefa` 7 min (1.916 execuções), `acompanhamento` 6, os tipos custom entre 7 e 35.
  - **Salvar pede confirmação** — o diálogo "Quanto tempo isso vai levar?" (`useEstimateConfirmPrompt`) abre antes de criar, com a régua de opções, a escolha atual marcada e a origem da sugestão; "Voltar ao formulário" cancela o save. Na **edição** só pergunta quando a atividade ainda está sem previsão (as que nasceram antes do campo) — com o valor definido, salvar não vira interrogatório. O payload lê a escolha do diálogo, não o state: `setState` é assíncrono e a atividade sairia com o valor anterior.
  - **O cronômetro herda** a previsão ao iniciar a sessão (é o gatilho de urgência: avisa perto do fim, mostra o excedente em vermelho depois), e ajustar no relógio grava de volta em `lead_activities` — senão no dia seguinte a atividade voltava com a previsão antiga.
  - **Gasto x previsto** aparece embaixo do campo (`gasto 07:12 de 30min`, âmbar a partir de 80%, vermelho com o excedente quando passa) e como selo ao lado do assunto na aba lateral. O gasto é a soma de `activity_time_entries.active_seconds` da atividade — todas as sessões, todos os dias (`work_date` particiona o dia; o total da atividade é a soma das fatias).
  - Atividade antiga fica **sem previsão** de propósito: não houve backfill, porque preencher retroativo seria inventar meta que ninguém combinou e sujaria o comparativo. Lógica compartilhada em `src/hooks/useActivityTimeEstimate.ts`.
- A ficha também abre **já preenchida por IA** quando a atividade nasce de outra tela: mensagens do **Chat da Equipe**, movimentação do processo, documento, ditado por voz ou ligação. É sempre o mesmo formulário — o usuário revisa e só então cria.
- "Vincular: Campanha" — associa a atividade a uma campanha.
- Envio ao grupo: "Copiar" (mensagem pronta), "Avaliação" (gera link público 0–5⭐), "Enviar ao Grupo / Enviar ao Assessor" (preview editável, escolha de instância, opção "Incluir gravação da ligação").
- Rodapé: "Excluir", "Salvar", "Concluir + próxima", "Concluir"; na criação: "Cancelar", "Chat", "Criar".
- **"Concluir + próxima"** conclui a atividade aberta e cria outra copiando o formulário inteiro (o que foi feito, como está, próximo passo, responsável, prazos, anexos). **O assunto digitado é preservado na filha** — a IA (`generate-activity-title`) só nomeia quando o campo está vazio. Entre 30/07 e 03/08/2026 a IA sobrescrevia o assunto escrito pelo usuário, o que fazia a atividade parecer que "mudava de nome sozinha" ao concluir (a mãe some da lista de Pendentes e a filha ocupa o lugar) e gerava títulos idênticos em casos diferentes; corrigido em `99223b072`. Para renomear de propósito, usar o botão **"Renomear com IA"** no cabeçalho: com o assunto em branco ele preenche direto; com assunto escrito, a sugestão passa pelo diálogo de revisão (o botão fica colado no "Preencher com" e um clique sem querer trocava o título calado).
- **Quando a filha não nasce**: a conclusão da mãe é gravada *antes* do insert da filha. Se o insert não passar, a mãe fica concluída e a cadeia para. O `createActivity` devolve `null` em silêncio em três casos — outro insert igual em voo (dedup de 5s por lead+título+tipo), prazo caindo em ausência registrada na aba Férias, e o índice único `lead_activities_dedup_pending_idx` (uma pendente por lead+título+tipo+responsável) — e lança em erro de banco. Até 04/08/2026 o fluxo não checava o retorno e anunciava "próxima criada" mesmo sem ter criado; desde `85e18a1fa` mostra erro e mantém a ficha aberta.
- **Forense**: "Concluir" e "Concluir + próxima" são **indistinguíveis** no `lead_activity_audit_log` — nenhum dos dois deixa marca própria. O `actor_kind` só diz se `updated_by`/`auth.uid()` casou com um `profiles.full_name` (`system` = não casou), não qual botão foi clicado. Baseline medido em jul-ago/2026: **8,6% a 25,6% das conclusões diárias não geram filha** — é o uso normal do "Concluir" simples, não sinal de falha. Só investigar pico muito acima disso.

- **Rodapé de autoria — "Criado por" e "Última atualização por"**: a data e o autor vêm de campos independentes. O trigger `update_lead_activities_updated_at` carimba `updated_at` em **todo** UPDATE, mas `updated_by` só existe se quem escreveu mandou o valor — e nenhum trigger consegue descobrir isso sozinho, porque a sessão do front no Externo é anônima (ver `identidade-de-usuario.md`). Até 07/08/2026 só o "Salvar" carimbava: concluir, avaliar, vincular processo/caso, reatribuir e migrar tipo subiam a data e deixavam o autor nulo — **18.005 de 25.086 atividades já atualizadas (72%)** ficaram assim, e a ficha exibia "—", que parecia defeito de tela. Desde `3f3a77f3b` os 9 caminhos do app carimbam o autor, e quando ele realmente não existe a ficha diz *sem registro* (com explicação no `title`) em vez do travessão. O histórico não é recuperável.
- **Alteração em massa parece "alguém mexeu"**: manutenção rodada em SQL direto no banco sobe o `updated_at` de centenas de atividades de uma vez e aparece como "atualizada em <hoje>, sem registro". Reconhece-se pelo `updated_at` idêntico ao microssegundo entre as linhas — ex.: 12/06/2026 09:20 BR, 909 atividades num único timestamp (vinculação de `process_id`), e 20/07/2026 13:33, 1.974 linhas. Quem rodou é irrastreável: SQL direto não deixa autoria e o `lead_activity_audit_log` só existe desde 18/07/2026.

### Cronômetro (automático)
Ao abrir uma atividade sua não concluída, o cronômetro inicia sozinho; abrir atividade de outro assessor é só consulta. Concluir encerra o cronômetro.

**Fluxo recomendado**: "Nova Atividade" → vincular Lead/Caso e definir Tipo → **"Preencher com → Preenchimento por Áudio"** (o jeito mais rápido: grava, a IA transcreve e preenche tudo) → revisar → "Criar"; ao terminar, "Concluir + próxima".

---

## Varas e Tribunais — contatos (ícone de tribunal no cabeçalho)

**Propósito**: diretório de contatos para cobrança de andamento processual (`court_contacts`, no Supabase Externo). Sheet lateral aberto pela tela de Atividades.

### Como o contato é descrito
Cada registro é **um ponto de contato**, descrito por atributos independentes — não por uma hierarquia de pastas:

| Campo | Para que serve |
|---|---|
| `branch` | ramo: Trabalhista, Federal, Estadual, Eleitoral, Militar, Superior, Extrajudicial/Administrativo |
| `degree` | instância: 1º grau, JEF/Juizado, Turma Recursal, 2º grau, Superior |
| `court_code` | chave curta do tribunal (TRT22, TJPI, TRF1) ou do órgão (INSS, PGF, CEJUSC, PERITO, CARTORIO) |
| `uf` / `comarca` | localização — comarca na Estadual, subseção na Federal |
| `contact_type` | com quem se fala: Secretaria, Gabinete, Central, Distribuição, Oficial, Perícia |
| `unit_name` / `unit_key` | agrupa pontos do mesmo lugar — a secretaria e o gabinete da 6ª Vara Cível de Teresina aparecem juntos num só card |
| `preferred_channel` | qual canal de fato responde ("só responde por e-mail") |
| `last_confirmed_at` | data da última confirmação |

O campo antigo `court_type` misturava nível e tipo de ponto (vara/tribunal vs. secretaria/outro) e continua na tabela apenas como legado — o app grava os dois desde 06/08/2026.

**Por que atributos e não árvore**: uma árvore ramo→estado→comarca não comporta gabinete de 2º grau, JEF, Turma Recursal nem ponto não-judicial. Dos 6 contatos que existiam quando isso foi desenhado, 4 não cabiam na árvore. A visão hierárquica pode ser gerada a partir dos atributos; o contrário exigiria migração.

### Navegação
- Busca livre (unidade, comarca, tribunal, telefone, e-mail, observação).
- Filtros empilháveis: Ramo, Grau, UF, Tipo — só aparecem os valores que existem na base.
- **Ordem padrão: onde há processo ativo.** A contagem sai do número CNJ dos processos (`src/lib/cnj.ts`), sem cadastro manual de vínculo.
- Gabinete de desembargador sem confirmação há 12+ meses fica esmaecido com o selo "a conferir" e um botão de confirmar. Secretaria de vara não envelhece — contato de gabinete é volátil (promoção, mudança de câmara, aposentadoria), o de secretaria não.

### Contagem de processos e o campo de origem do CNJ
O número CNJ (`NNNNNNN-DD.AAAA.J.TR.OOOO`) dá ramo, tribunal e unidade de origem. **O que `OOOO` identifica muda por ramo** — verificado nos dados em 06/08/2026:
- **Trabalhista**: é a vara (TRT22 `0001` = 1ª VT de Teresina, `0002` = 2ª VT).
- **Estadual**: é a comarca (TJPI `0140` serve a 4ª Vara Cível *e* a Vara de Registros Públicos de Teresina).
- **Federal**: é a subseção (TRF1 `4000` cobre a 6ª, 7ª e 8ª Varas de JEF do PI).

Por isso o rótulo muda: "nesta vara", "nesta comarca", "nesta subseção". Enquanto o contato não conhece nenhum código de origem, a contagem é do tribunal inteiro e mostra "no TJPI" (aproximada). Cobertura: 623 dos 1.758 processos ativos têm CNJ de 20 dígitos; os campos equivalentes vindos do Escavador cobrem só 85.

### Na tela do processo (`ProcessDetailSheet` → aba Tribunal)
Mostra os contatos do tribunal daquele processo, com quem já atende a origem no topo. O botão **"é esta"** grava o código de origem em `court_contacts.origin_codes` — a partir daí a contagem daquela unidade fica exata para todos os processos dela. É o único "cadastro" de vínculo, e acontece durante o trabalho normal.

Arquivos: `CourtContactsSheet.tsx`, `CourtContactsForProcess.tsx`, `src/lib/cnj.ts`, `src/lib/courtCatalog.ts` (catálogo fechado: 24 TRTs, 6 TRFs — incluindo o TRF6/MG instalado em 2022 —, 27 TJs, 27 TREs), `useCourtProcessCounts.ts`.

---

## Cronômetro global e banco de horas (presente em todas as telas)

**Propósito**: badge flutuante arrastável que controla expediente, cronômetro da atividade, ociosidade e pausas.

- "Iniciar expediente" — bate o ponto; nada conta sem expediente aberto.
- Badge da atividade: tempo + título, "Previsão de tempo" (chips 15–120 min; já vem preenchida com a previsão da atividade e mudar aqui grava de volta nela), "Pausar e salvar", menu de Pausa, microfone **"O que faço?"** (registra por voz o que está fazendo — cria atividade e liga o cronômetro), "Time agora" (painel dos cronômetros do time), minimizar.
- Menu de Pausa: pausas rápidas com previsão (café/lanche/descanso), "Entrando em reunião" (um clique, igual ao almoço), "Saída para almoço", "Intervalo (justificar)", "Compensação de banco de horas", "Encerrar expediente (saída)".
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
| Intervalo | pausa justificada (`break_type`) — reunião, almoço, café, banheiro |
| Não iniciou | não entrou no sistema hoje: zero produtivo **e** zero ocioso |

Quem bateu o ponto e já encerrou **não** entra em "Não iniciou" — aparece como "Hoje: HH:MM:SS produtivo · fora do ar". Gestor/diretor ainda podem pausar ou encerrar o expediente do membro pelo menu `⋮`.

**Quem não aparece** (em nenhum filtro, contagem ou no ranking do dia): desligados (`org_user_status.active = false`, 23 em 31/07/2026) e quem está de férias/folga/compensação cobrindo o dia (`member_time_off`). Única exceção: ausente que está com atividade em andamento continua visível, com selo "Férias"/"Folga" — é informação, não cobrança. Ambas as tabelas moram no Externo e são chaveadas pelo **Cloud user_id**. Folga só é filtrada se estiver cadastrada na aba Férias (Gestão de Equipe → `TimeOffManager`).

**Intervalo esticado**: a linha fica vermelha, sobe no topo do grupo e o chip "Intervalo" ganha `⚠ n` quando a pausa passa da previsão que a pessoa deu (`estimated_minutes`) ou, sem previsão, do teto por tipo — reunião 120 min, almoço 90, intervalo 30, café/lanche/descanso 20. Compensação de horas nunca alerta (banco de horas é longo por definição). Na prática o teto é que vale: as pausas registradas hoje (31/07/2026) estavam todas sem previsão.

**Sino de alerta** (`MemberAlertButton`) aparece em três situações — ocioso, intervalo e "não iniciou" — com frases prontas próprias de cada uma. Sai por dois canais:
- `activity_timer_alerts` (Externo) → Realtime toca o prompt 🚨 na tela dele, se a aba estiver aberta; quem está fora vê ao entrar;
- **Web Push nativo** via `send-team-push` (Railway), que passou a aceitar `user_ids` direto, sem thread de chat. É o único canal que alcança quem não iniciou o expediente. Chega só a quem ativou notificações — o toast diz qual dos dois casos aconteceu.

### Aviso sem expediente aberto (ShiftGate)

Sem ponto batido, `src/components/activities/ShiftGate.tsx` cobre a tela (montado no `SidebarLayout`, em `App.tsx`) com o **POP "Início de expediente"** — os 6 passos do procedimento — e o botão "Iniciar expediente", que chama o mesmo `startShift()` do cronômetro.

**Desde 11/08/2026 é aviso, não bloqueio**: o POP tem um **X** no canto superior direito e, fechado, o sistema fica utilizável sem o ponto batido — o botão flutuante "Iniciar expediente" do `ActivityTimerOverlay` (canto inferior esquerdo, arrastável) segue à mão. Era porteiro absoluto até então, e isso prendia quem entrava fora de hora só pra uma coisa pontual — gerar procuração pelo WhatsApp era o caso real: a rota `/gerar-procuracao` é isenta desde 04/08, mas **não há item de menu pra ela**, então quem abria o app pela home ficava preso na tela cheia e nem chegava lá; só passava quem clicava no link da etiqueta. O que **não** mudou: fora do expediente nada é cronometrado — nem produtivo, nem ocioso, nem pausas.

O dispensar vale **pelo resto do dia**: o X grava a data local em `localStorage` (`shiftGate:dismissedOn`) e a montagem seguinte compara com hoje — recarregar a página ou abrir outra aba não traz o aviso de volta. No dia seguinte a chave não bate mais e o POP aparece uma vez, pedindo o ponto de novo. Guardar a data (e não um booleano) faz a marca expirar sozinha, sem precisar de limpeza.

Quem **não** vê o aviso:
- **quem já encerrou o expediente hoje** (`shiftEndedToday`) — depois da saída batida a pessoa volta livremente para uma consulta pontual. Nada é cronometrado nesse estado, e o cronômetro flutuante segue mostrando "Iniciar expediente" se ela for retomar o trabalho (o clique reabre um `work_shifts` novo). O aviso vale só para **quem ainda não bateu a entrada** no dia;
- **diretoria** (`org_directors`, via `useTeamLeadership`) — gestores continuam vendo;
- **visitante sem sessão** — senão a própria tela de login ficaria coberta;
- **telão `/tv/atividades` e páginas públicas** (booking, revisar, avaliar, landing) — ficam fora do `SidebarLayout`;
- **`/gerar-procuracao`** (`SHIFT_FREE_PATHS`) — trabalho pontual e fora de hora, chega pelo link `?phone=…&instance=…` que a etiqueta dispara (`railway-server/src/functions/prepare-label-document-trigger.ts`).

`shiftEndedToday` vem do `ActivityTimerContext`: na carga ele lê o **último** `work_shifts` de hoje (antes filtrava só `ended_at IS NULL`, e por isso não distinguia "não iniciou" de "já encerrou") — com `ended_at` preenchido, o dia está encerrado. `endShift()` liga a flag, `startShift()` desliga. O encerramento remoto da gestão (`command = 'end_shift'`) passa pelo mesmo `endShift()`, então quem foi encerrado à distância também não fica trancado.

Enquanto o ponto (`onShift === null`) ou a liderança ainda carregam, nada aparece — evita flash de tela cheia em quem tem passe livre. Regressão coberta em `src/components/activities/__tests__/ShiftGate.test.tsx` (11 casos, incluindo o fechar no X e a marca do dia).

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

**Propósito**: relatório de tempo cronometrado por membro e tipo de atividade, separando ativo, ocioso e pausas justificadas (reunião/almoço/intervalo/compensação não contam como ocioso; cada tipo aparece como linha `Pausa · <tipo>`).

- "Atualizar", "Exportar CSV".
- Filtros: período "De"/"Até" + "Aplicar período"; multifiltros Time, Assessor, Tipo de atv; "Limpar".
- Totais: Tempo ativo, Trabalho avulso, Tempo ocioso, Atividades, Membros; tabela por membro com subtotais.

**Fluxo recomendado**: definir período → filtrar por Time/Assessor → "Exportar CSV" pro fechamento do banco de horas.

---

## Telão de Atividades — `/tv/atividades`

**Propósito**: ranking ao vivo do time (auto-atualiza a cada 45s), feito pra rodar em TV/fullscreen.

- Ordenação exibida: 1º Status Esperado → 2º Fases → 3º Objetivos → **4º Qualidade ⭐ (3+ notas)** → 5º Passos → 6º Itens do Checklist → 7º Concluídas → 8º Menos Atrasadas → **9º Mais Pendências do Cliente Feitas** → **10º Menos Pendências Faltando** → 11º Média ⭐ (desempate) → 12º Menos Feedbacks sem Avaliar → 13º Mais Tempo Ativo → 14º Menos Ocioso → 15º Resposta no Chat.
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

**Coluna "cliente" — pendências do cliente entram no ranking** (desde 06/08/2026, migration `20260806190000`):
- **cliente (8º critério)** = o que o **cliente** ficou de fazer e continua em aberto (`lead_client_commitments` com status `combinado`/`cobrado`) nos casos sob responsabilidade da pessoa. Menos é melhor, e é **backlog total** — sem filtro de período, igual a "atrasadas" e "s/ avaliar". Entra como desempate logo **depois de atrasadas**, que foi onde o Raym pediu.
- **A quem a pendência é creditada** (cascata, o primeiro que existir): responsável do processo mais recente do lead (`lead_processes.responsible_user_id`) → responsável processual do lead (`leads.processual_responsible_id`) → último assessor que trabalhou o lead (`lead_activities.assigned_to`). **Pendência sem nenhum dos três não conta para ninguém.**
- **Limite medido antes de aplicar (06/08/2026)**: das 179 pendências abertas, só **40 (22%)** chegam a ter dono por essa cascata — 7 pelo responsável processual, o resto pelo assessor da atividade. O critério é conservador por construção: só desempata onde o caso tem responsável definido, e passa a medir mais conforme o cadastro de responsável melhorar, sem precisar mexer na função.
- O chip é **clicável** e abre o `RankDetailSheet` (`p_criterio = 'pend_cliente'`) com cliente, o que ficou de fazer, há quantos dias foi combinado, quantas cobranças e o trecho em que ele prometeu. Conferido em 06/08/2026: o painel da Maria Lydia trouxe 14 itens, o mesmo número do chip.

**"pend feitas" e "pend faltam" — as duas pontas da pendência** (desde 07/08/2026, migration `20260807200000`):
- O card passa a mostrar **dois números logo depois de "atr"**: `pend feitas` (verde) e `pend faltam` (ciano). Antes só o backlog aparecia — e no **Modo Corrida** nem isso.
- **pend feitas (9º critério)** = pendências marcadas como cumpridas (`status = 'feito'`) com `done_at` **dentro do período** do telão. Mais é melhor. **pend faltam (10º critério)** = o backlog em aberto de sempre, sem filtro de período. Menos é melhor. Os dois entram na ordenação logo depois de "menos atrasadas".
- **O dono das duas contagens agora sai de `vw_client_commitments_owner`** (a mesma view da caixa de pendências), não mais da cascata inline de 3 degraus: `assigned_to` (troca manual) → responsável do processo → responsável processual do lead → último assessor → dono da conversa → dono da instância. Consequência prática: **trocar o responsável de uma pendência na caixa agora move a contagem no telão**. Medido em 07/08/2026: das 441 pendências abertas, 87 tinham dono pela cascata antiga e **162 têm pela view**.
- **Por que o crédito é do dono do caso e não de `done_by`**: das 325 pendências cumpridas, **315 foram marcadas pela IA** ao ver a conversa (`done_by_name = 'IA (visto na conversa)'`, `done_by` nulo). Creditar por quem clicou zeraria o critério.
- O chip novo abre o `RankDetailSheet` (`p_criterio = 'pend_feitas'`) com o que o cliente cumpriu, em quantos dias, quantas cobranças foram precisas, quem deu a baixa e o trecho da conversa.
- Conferido em 07/08/2026 com os dois lados na mesma query: chip e lista batem 1:1 em todas as pessoas (Maria Lydia 17 feitas / 52 faltando, Natasha 10/6, Vanessa 9/12, Abderaman 8/5…).

**Colunas "⭐" e "s/ avaliar" — o feedback entra no ranking** (desde 05/08/2026, migration `20260805120000`):
- **⭐ (8º critério)** = média das notas que a pessoa **recebeu como responsável** (`lead_activities.feedback_rating`), creditadas por `feedback_rated_at` **dentro do período** do telão — mesmo filtro que o `aprov_pct` já usava. Não é a nota que ela deu nos outros. Sem nota no período mostra "—" e o critério não desempata (`nulls last`), então ninguém é penalizado por ainda não ter sido avaliado.
- **s/ avaliar (9º critério)** = feedbacks que **ela deveria avaliar e não avaliou**: atividade com retorno preenchido (`feedback`), ainda sem `feedback_outcome`, em que ela é **observadora ou criadora**. É **backlog total**, sem filtro de período (igual a "atrasadas") — dívida velha não some quando vira o dia. **Autofeedback não conta**: se ela é a própria responsável, aquela pendência fica de fora (mesma regra do `FeedbackFunnel`, que esconde "as minhas" por padrão). Efeito medido: o João Manoel tinha 21 pendências brutas, 17 delas de atividades dele mesmo → o telão mostra **4**.
- Os dois chips são **clicáveis** e abrem o `RankDetailSheet` (`p_criterio` = `estrelas` / `fb_pendentes`): no ⭐ vêm nota, desfecho, quem avaliou e a justificativa; em s/ avaliar vêm o responsável pelo retorno, há quantos dias está parado e o texto do retorno.
- Quem entra no ranking **não mudou**: o filtro do `ranked` continua exigindo entrega no período — ninguém aparece só por ter pendência de feedback.

**Painel "Top de Avaliação" ao lado do ranking** (desde 06/08/2026, `TvAvaliacaoPanel.tsx`) — o telão divide a tela: ranking/corrida à esquerda, avaliação à direita, sempre **do mesmo time** que o rodízio está mostrando (em telas < xl o painel empilha embaixo; nunca por cima).
- **Janela fixa de 30 dias**, não o período do telão. Medido antes de decidir: 1 nota avaliada no dia contra 10 em 30 dias — seguindo o seletor, o painel ficaria vazio quase o tempo todo.
- Lê `lead_activities` **direto**, não a RPC do ranking. Motivo medido: o filtro `nome ~ '\s'` do `by_name` derruba quem tem `profiles.full_name` igual ao login (2 dos 4 avaliados sumiam). O painel usa `assigned_to_name`, igual ao mural `/destaques`. Escopo do time vem de `team_members` (já gravado com UUID do Externo pelo `sync_teams_snapshot`); a vista Gerencial usa `team_managers` + `org_directors` mapeados por `auth_uuid_mapping`.
- Cada linha traz os **quatro desfechos** em número grande: ⭐ Elogio (nota 5) · ✅ Satisfeito · ⚠️ Incompleto · ❌ Insatisfeito — cores e ícones iguais aos do `FeedbackFunnel`. Desfecho zerado fica apagado, mas continua na tela. Cada número é **clicável** e abre o `AvaliacaoDetailSheet` com as avaliações que o compõem (nota, elogio do sanduíche, justificativa, retorno avaliado, quem avaliou e quando). Elogio é recorte da nota, não desfecho concorrente: uma atividade 5⭐ satisfeito aparece nos dois.

**Qualidade acima do volume, com piso de amostra** (desde 06/08/2026, migration `20260806230000`):
- Campo `qualidade` na `tv_atividades_ranking` = média das estrelas **do período** (mesmo `p_since` do resto), só para quem tem **≥ 3 notas**. Decisão do Raym: nada de histórico — "história não garante futuro".
- Ordena logo **depois de status/fases/objetivos** e **acima** de passos/checklist/concluídas. Quem não tem amostra recebe a **média do grupo** (valor neutro): não perde posição, e a disputa dele continua sendo decidida pelo volume. Sem ninguém com amostra, todos empatam e a ordem fica idêntica à anterior.
- **Por que o piso**: cobertura de avaliação medida em 06/08/2026 era de **10 notas contra 7.097 atividades criadas em 30 dias (0,14%)**, com **0 das 32 pessoas** do ranking tendo nota no dia. Sem piso, quem tivesse 1 nota antiga fixaria o topo todo dia e a corrida congelaria. Verificação antes/depois: ordem de "Hoje" e do "Mês" **idênticas** à anterior.
- A média ⭐ **sem** piso continua como desempate fino, agora em 10º.
- **Medalha 🏅** ao lado do nome (corrida, pódio e lista): melhor média do período entre quem tem ≥ 3 notas **e** média ≥ 4. Sem candidato, ninguém leva.
- Rollback: reaplicar `supabase/migrations/20260806190000_tv_ranking_pendencias_cliente.sql`, que tem a versão anterior inteira da função.

**Avaliar o feedback direto do telão** (desde 06/08/2026) — no painel "Feedbacks sem avaliar" (`RankDetailSheet`, `p_criterio = 'fb_pendentes'`) cada item traz estrelas, o campo do porquê, o do ponto positivo e os três botões (Satisfeito / Incompleto / Insatisfeito) — `FeedbackAvaliarInline.tsx`.
- A regra é **única**: validação, gravação e aviso ao responsável saíram do `FeedbackFunnel` e viraram `src/lib/feedbackEvaluation.ts` (nota obrigatória; justificativa obrigatória no 5 e no ≤2; sanduíche obrigatório no insatisfeito; sem autofeedback). As duas telas chamam a mesma função. Quando quem chama só tem o nome do responsável (caso do telão, que recebe o detalhe pela RPC), a lib busca o `assigned_to` da atividade para poder notificar.
- Diferença consciente entre as telas: no funil, "Insatisfeito" abre na hora a atividade de melhoria; no telão não abre (a pessoa está acompanhando, não trabalhando) — o responsável recebe o aviso com o que melhorar e a atividade sai na aba Avaliar. Está escrito no próprio painel.
- **O card do detalhe não é clicável**: só o título abre a ficha. Enquanto o card inteiro tinha `onClick`, clicar numa estrela do formulário abria a atividade junto.

**Nada de redirecionar** — clique que abre alguma coisa no telão (atividade, processo) abre em painel **ao lado** (`ActivityFullSheet` com `side="left"`, `ProcessQuickSheet`), empilhado, nunca em aba nova ou trocando de página. Regra permanente do produto: `CLAUDE.md` → "Princípios permanentes de interface" e skill `.agents/skills/ui-sem-redirecionar`.

**Passo retroativo (não conta no ranking)** — ao marcar passo/objetivo, a caixa pergunta "Esse passo foi executado HOJE?" (`askStepTiming`). A janela é o **dia**, não o instante: quem executou de manhã e marca à tarde responde "Sim, foi hoje". "Não, foi em outro dia" grava `metadata.retroactive = true` no `user_activity_log` e o passo fica só no histórico.
- Retroativo é ignorado em **PASSOS**, **ITENS DO CHECKLIST** e, desde 31/07/2026, também em **FASES** e **OBJETIVOS** (`inst_last` só considera passo não-retroativo dentro do período — migration `20260731180000`). Antes disso o mesmo clique não valia passo mas fechava fase e objetivo, que pesam mais na ordenação.
- Sintoma clássico de "marquei tudo e aparece 0 PASSOS": os logs do dia estão com `retroactive = true`. Confere com `select metadata->>'retroactive', count(*) from user_activity_log where action_type='checklist_item_checked' and created_at >= current_date group by 1`.

**A caixa de timing não fecha mais o painel** (07/08/2026) — `askStepTiming` monta o diálogo direto no `document.body`, fora do portal do `Sheet` aberto por baixo. O `DismissableLayer` do Radix escuta `pointerdown`/`focusin` no document e tratava o clique nos botões como "clique fora": responder "Não, foi em outro dia" recolhia a aba da atividade (e o `pointer-events: none` que o modal põe no body ainda fazia o clique atravessar). O host agora tem `pointer-events: auto` e barra a propagação desses eventos. Mesmo padrão da isenção do toast do sonner em `src/components/ui/sheet.tsx`.

**Régua "onde você está" + atualizar passos com IA** (desde 07/08/2026) — no bloco de fases (`LeadFunnelProgressBar`):
- **Régua**: uma linha diz quantos passos foram marcados **hoje** (com os rótulos) ou, quando não houve nenhum, quantos são de outro dia e a data do último. Fonte: RPC `pop_steps_log` no Externo (migration `20260807120000`), porque a policy de `user_activity_log` é por `auth.uid()` e a sessão do app é anônima — select direto voltaria 0 linhas em silêncio. Se a RPC não existir no ambiente, a régua **não aparece** (nunca mostra "nenhum passo hoje" mentindo).
- **"Atualizar passos"** (`PopCatchUpSheet`): a IA lê as movimentações do processo (`lead_processes.movimentacoes`), as atividades anteriores e o que a pessoa escreve ("já foi feito acordo em 12/06") e devolve quais passos em aberto já podem ser marcados, **cada um com a evidência e a data**. A pessoa confere, desmarca o que não vale e grava o lote de uma vez — sem responder "foi hoje?" passo a passo. Endpoint `suggest-step-completion` (Railway).
- **Ranking**: passo marcado pelo lote entra como **retroativo**, exceto quando a data da evidência é a de hoje. Sem essa regra, atualizar o POP de um processo antigo viraria pontuação do dia no telão.
- Ficam **fora** da sugestão: passo-pergunta (a resposta é que roteia fase/status) e passo com checklist em aberto (`src/lib/stepSubitems.ts`) — o painel diz quantos ficaram de fora.

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
