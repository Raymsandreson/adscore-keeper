# Módulo Atividades e Produtividade

Documentação funcional das telas de atividades, cronômetro/banco de horas e telões. Rótulos entre aspas são o texto exato exibido na interface.

---

## Atividades — `/` (tela inicial)

**Propósito**: central de trabalho diário do assessor — cria, gerencia, cronometra e conclui atividades vinculadas a Lead/Caso/Processo/Contato (ou internas de equipe), com preenchimento por voz/áudio/IA e integração ao WhatsApp.

### Cabeçalho
- "Blocos" / "Lista" / "Eventos" — alterna a visualização (blocos agrupados, lista de cartões, ou a agenda de audiências/perícias/prazos do dia seguinte).
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
- **Símbolo do robô** (01/09/2026) — 🤖 roxo ao lado do tipo quando a atividade foi criada por robô, com o nome do robô no tooltip ("Criada automaticamente por: Robô do INSS"). Aparece em todas as listas de atividade: tela de Atividades (lista e blocos), aba Atividades do caso, aba do lead, atividades do contato, ficha do processo, "Atrasadas de hoje", pendentes do membro e o histórico de continuidade. Componente único: `src/components/activities/RobotBadge.tsx`.

#### Como se sabe que foi robô (`src/lib/activityRobot.ts`)
A marca vem do banco, **nunca de heurística na tela**:

| Sinal em `lead_activities` | Significa |
|---|---|
| `action_source = 'system'` | robô nosso; qual robô está em `action_source_detail` |
| `action_source = 'escavador_compromissos'` | sync de prazos/audiências do Escavador |
| `created_by_ai = true` | a IA gerou (`generate-case-activities`) |
| `action_source = 'manual'` | pessoa criou pelo formulário |
| nada preenchido | linha antiga — **não** ganha símbolo, e é isso mesmo: sem marca no banco a tela não inventa uma |

`is_system` ficou **de fora de propósito**: no formulário ele é o botão **"Interna"** (demanda de membro para membro), marcado por gente. Usá-lo como sinal de robô carimbaria de robô atividade digitada por pessoa. Por isso o chip da barra de filtros que era "Do sistema" virou **"Internas"** (`is_system`) e nasceu um chip separado **"Do robô"**, que lê o mesmo carimbo do símbolo.

Robôs que passaram a carimbar a origem (01/09/2026, antes nasciam sem marca nenhuma): `notify-inss-update` ("Robô do INSS"), `zapsign-webhook` e `zapsign-backfill-from-2026` ("Robô do ZapSign"), `wjia-followup-processor` ("Follow-up automático"), `whatsapp-handoff-dispatch` ("Handoff IA"), `create-whatsapp-group` ("Abertura automática do caso"), `onboarding-checkpoint-execute`, `sheet-lead-ingest`, `whatsapp-webhook` (etiqueta) e `whatsapp-command-processor` ("Assistente do WhatsApp" — o texto é do membro, mas quem cria é o assistente). Já carimbavam antes: `sync-process-compromissos` e `execute-agent-automations`.

**A coluna tem `DEFAULT 'manual'`** — descoberta ao medir o banco em 01/09/2026, e ela muda o quadro: robô que não preenchia `action_source` não ficava nulo, ficava marcado como **pessoa**. Não era omissão, era um dado errado afirmando autoria humana.

**Backfill aplicado em 01/09/2026 — 6.257 atividades** reclassificadas de `manual` para `system`, cada lote pela assinatura determinística do robô (título **e** descrição gerados em código):

| Lote (`action_source_detail`) | Linhas |
|---|---|
| Etiqueta do WhatsApp | 4.133 |
| Robô do ZapSign | 666 |
| Robô do INSS | 544 |
| Follow-up automático | 530 |
| Onboarding automático | 323 |
| Follow-up automático (assinatura) | 61 |

- **138 linhas ficaram de fora de propósito**: têm o título do robô mas não a descrição dele (clone feito por uma pessoa a partir de uma atividade de robô). Continuam `manual` — na dúvida, não carimba.
- **Os dois triggers foram desligados dentro da transação**: `update_lead_activities_updated_at` (o painel "Atrasadas de hoje" lê `updated_at >= hoje` e mostraria 6.257 atrasadas como "atualizadas hoje" — mentira na tela) e `trg_activity_audit` (6.257 linhas de auditoria de um UPDATE que não é ação de ninguém). Conferido depois: `updated_at` do dia continuou em 134 linhas e a auditoria em 169; os seis triggers voltaram LIGADOS.
- **Rollback id a id** em `backfill.action_source_20260901` (schema `backfill`, fora da API — tabela nova em `public` sem RLS seria bug crítico). Scripts: `scratchpad/backfill-action-source-20260901.sql` e `scratchpad/rollback-backfill-action-source-20260901.sql`. Recorte por data foi descartado: as linhas que o robô já carimbou sozinho depois do deploy cairiam junto no rollback.

**O `action_source_detail` do Escavador é hash, não nome** — `sync-process-compromissos` guarda ali o hash de dedupe do compromisso (`1gnyxtwbqje3h`). Por isso `robotActivityLabel` só usa o detail quando o carimbo é `'system'`; no Escavador cai no nome fixo do mapa, senão o tooltip mostraria o hash.

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

### Eventos — audiências, perícias e prazos do dia seguinte (`EventsAgenda.tsx`)

Terceira visão da tela, entregue em 17/08/2026. Pedido do escritório: *"uma atividade que tem perícia pro dia 12.08 aparece na aba de perícias do dia 11.08, para a pessoa saber as prioridades"*. Por isso o seletor mostra **a véspera** e o cabeçalho da tabela repete a data real do evento.

**Abas e de onde cada uma lê** (regras puras e testadas em `src/lib/eventAgenda.ts`):
- **Audiências** e **Perícias** saem da MESMA tabela `hearings`, separadas por `hearing_type` (perícia é reconhecida pelo radical "peric" e por "avaliação social", que é a perícia social do BPC).
- **Prazos** = atividade do **tipo "Prazo"**, nas duas famílias de chave (a seed `prazo` e as `custom_*` com o mesmo rótulo). Não é "toda atividade com deadline amanhã": em 20/08/2026 seriam 337 linhas contra 8 — uma tela de prioridade com 337 linhas não é uma tela de prioridade.
- Atividade de tipo Audiência/Perícia **não** vira linha de evento: o `HearingActivityDialog` cria atividade a partir da audiência (o mesmo evento apareceria duas vezes) e o `deadline` dessas atividades é quando **preparar**, não quando o evento acontece — "Audiência Instrução 06/08/2026" tem deadline 28/08.

**Véspera e período.** O padrão é véspera: mostra D+1. Na sexta a janela vai até a **segunda**, inclusive sábado e domingo — a segunda também precisa de véspera, e prazo cai em fim de semana (audiência não). Feriado não é considerado: não existe tabela de feriado forense aqui. O botão de data (o que mostra "Véspera", com o chevron) é um **menu**: além da véspera, oferece **Próximos 7/15/30 dias** e **"Intervalo de datas (do dia X ao dia Y)…"**, que abre dois campos de data — `diasDoIntervalo`, teto de 92 dias, pontas trocadas são aceitas. Em período com mais de um dia a tabela ganha cabeçalho por dia, o botão passa a exibir o intervalo escolhido ("12/08 → 15/08") e as setas andam com a janela inteira preservando o tamanho (de um intervalo de 4 dias para os 4 seguintes). Medido em 19/08/2026: 12→15/08 devolve 10 eventos (3/2/3/2 por dia).

**Identificação da linha** (ago/2026, resolvendo *"muitos não têm processo nem cliente"*): a coluna mostra o código do caso como badge (**"PREV 704"**, **"CASO 341"**) e o número do processo embaixo. A sequência é procurada em cascata — `hearings.case_ref` → `case_title` → `lead_name` → título —, o que classifica **89%** das atividades contra 67% se só o caso fosse consultado. A coluna Cliente passa pelo `nomeDoCliente`, que tira selo, código e separador do nome do grupo ("✅PREV 704 | ADRIANA" → "ADRIANA"), com o texto original no `title`; quando o corte não deixa nome, o bruto continua. Linha sem processo, caso e cliente mostra **"sem vínculo"** — é assim que ela existe no banco.

**Filtros.** Até 19/08/2026 a barra de filtros da página aparecia nesta aba **sem filtrar nada**. Agora:
- Valem aqui: **Assessor**, **Lead**, **Caso** e a **busca**; os demais (tipo, situação, POP, contato, criado por, com documentação, cronômetro ativo) **somem** na aba, em vez de ficarem inertes.
- Dois filtros próprios: **Caso/Prev** (família da sequência, via `casoSequencia.ts`) e **Área** (`hearings.category` — trabalhista, previdenciário, cível), que só aparece quando a janela tem mais de uma.
- **Assessor casa com qualquer responsável do processo**, titular ou co-responsável de qualquer atividade viva — não só a atividade que aparece na coluna. As 3 audiências de 20/08/2026 tinham 4, 1 e 2 atividades vivas com donos diferentes; casar pela "mais próxima" faria a audiência sumir para o outro dono.
- **Evento sem responsável continua visível** mesmo com filtro de assessor ligado, marcado com "sem dono". `hearings.assigned_user_id` estava preenchido em 6 de 74 futuras: esconder o órfão tiraria da tela de toda a equipe justamente o evento que ninguém pode perder. O subtítulo diz quantos são.

**Seleção em lote**: as linhas com atividade ganham caixa de marcação e as mesmas duas ações da lista (Excluir / Passar para…). Como a agenda alcança atividade que **não** está no lote carregado pelos filtros da página, o lote daqui trabalha por id — `handleBulkDelete` aceita ids explícitos e o "Passar para…" busca os objetos completos antes de abrir o painel; sem isso o lote sairia parcial e em silêncio.

**Desempenho**: o filtro de prazo acontece no servidor (`in` nas chaves de tipo) e toda busca é paginada de 1000 em 1000 — o PostgREST corta em 1000 sem avisar, e um período de 30 dias sem esse cuidado mostraria "nenhum evento" em dias que têm.

### Ficha da atividade
- **Quem criou** (01/09/2026) — primeira linha do formulário, nas duas fichas (`ActivityFullSheet` e a da tela de Atividades, que compartilham o `ActivityFormCompact`): "Criada por Fulano em dd/mm/aaaa", ou o selo do robô com o nome do robô. A ficha nunca mostrou isso: existia só o filtro "Criado por" na barra da tela de Atividades, então quem abria a atividade dentro do caso não tinha como saber a autoria. Sem `created_by` e sem carimbo de robô, diz "autor não registrado" — não chuta.
- **Clicar no nº do processo abre a ficha do processo** por cima desta (01/09/2026). O chip do processo tinha só lápis (trocar) e X (remover); o nome não abria nada, enquanto na tela de Atividades o mesmo processo já abria a aba lateral. A ficha do processo é carregada com a linha completa de `lead_processes` — o objeto que a atividade tem em memória é parcial e abriria o formulário do processo vazio.
- Título editável inline; badge com o tempo total dedicado (soma das sessões de cronômetro) e, quando há previsão, no formato `⏱️ 12:40 / 30min` — com o excedente em vermelho quando passa.
- Menu "Vincular": Caso, Processo, Contato, "Últimas movimentações" do processo.
- **Vínculo de processo** — o badge mostra sempre `<nº do processo> - <título>` lido de `lead_processes`, não o texto congelado em `lead_activities.process_title`. O snapshot fica desatualizado quando o número é preenchido depois da atividade nascer, e as atividades auto-criadas junto com o caso gravavam só o título (1.352 assim em 03/08/2026) — era isso que fazia aparecer "INDENIZAÇÃO" onde se espera o nº do processo. "Trocar Processo" abre um sheet próprio com os processos do caso, recarregados na abertura; entre 18/05 e 03/08/2026 o botão não fazia nada (o Popover que ele acionava foi removido e o estado ficou órfão). Rótulo centralizado em `src/lib/processLabel.ts`.
- **O vínculo aparece pelo id, nunca pelo título** — `lead_activities` guarda `case_id`/`process_id` e um *snapshot* `case_title`/`process_title` do momento da criação; as auto-criadas nascem com o id preenchido e o título nulo (40 com processo e 2.189 com caso em 12/08/2026). Enquanto o cabeçalho e as badges condicionavam a exibição ao título, o caso/processo sumia da ficha e o menu "Vincular" (que lê o id) seguia oferecendo "Remover Processo" — e no `ActivityFullSheet` a badge virava o botão "Vincular Caso" numa atividade já vinculada. Hoje a condição é o id e o rótulo vem do dado vivo (`displayCaseLabel`/`displayProcessLabel`), com `useLinkedCaseProcess` buscando caso/processo por id só quando não estão em `leadCases`/`caseProcesses`.
- **Atividade gerada pelo sistema nasce vinculada** (17/08/2026) — quatro geradores server-side criavam a atividade só com `lead_id`, apesar de terem o caso em mãos, e ela caía na lista "só com título", invisível para o filtro de Caso e para a aba de atividades do caso. O pior era `notify-inss-update` (Railway): ele **exige** `case_id` para rodar e mandava o caso como *texto na descrição* — 205 das 252 atividades nasceram órfãs (198 nunca editadas depois), 200 ainda pendentes. Agora carimba `case_id`/`case_title` e resolve `process_id` pelo número do requerimento, que já está no próprio título (`INSS atualizou <req>: <status>`) — `inss_admin_processes` e `lead_processes` só se ligam por esse número, comparado **por dígitos** porque `process_number` não tem formato garantido. Mesmo carimbo em `create-whatsapp-group` (o caso é o que ele acabou de criar), `generate-case-activities` e `zapsign-webhook` (assinatura). Nestes três o caso sai do lead e **só quando há exatamente um vivo**: com dois casos abertos não há como saber a qual a atividade pertence, e chutar é pior que deixar em branco. Referência do padrão certo, que sempre carimbou os quatro campos: `sync-process-compromissos`. Ficou de fora o log de etiqueta do WhatsApp (`whatsapp-webhook`): 4.088 sem caso, mas são registros já concluídos e só 37 teriam caso.
  - **Backfill aplicado**: 206 atividades do INSS ganharam o vínculo retroativo (161 também com `process_id`). Rollback pronto em `scratchpad/rollback-backfill-inss-20260817.sql`. Como lote SQL não carimba `updated_by`, elas aparecem como "atualizada por —".
  - **O processo continua manual** em todos eles: um caso costuma ter vários itens em `lead_processes` e a maioria nem é processo de verdade (823 de 1.532 são itens de checkbox do POP).
- **Escolher o lead vincula o caso quando ele é único** — na tela de Atividades e no `ActivityFullSheet`. Antes a lista de casos era carregada e nada era selecionado, e vincular dependia de o assessor lembrar: 1.116 atividades vivas ficaram sem vínculo apesar de o lead ter caso. Dois ou mais casos: segue em branco.
- **Perícia médica e avaliação social** — o cabeçalho da ficha ganha dois chips com data **e hora**, à direita dos vínculos: 🩺 "Perícia médica" e 🤝 "Avaliação social". O clique abre um popover com `datetime-local`; a cor diz o estado (cinza sem data, azul futura, âmbar hoje, cinza-escuro passada). Vale na tela de Atividades e no `ActivityFullSheet`, via `PericiaInssChips.tsx`.
  - **Marcar aqui cria o evento no calendário** (`/hearings`, lente Perícias) e na aba Eventos. Desde 19/08/2026 a data mora em `hearings` — a mesma tabela da audiência —, não mais em `lead_processes.pericia_*_at` (migration `20260819110000`). O caminho antigo ficou com **1 linha em dois meses**: o chip só aparecia em processo `Benefício INSS` e 35% das atividades de perícia não têm processo nenhum.
  - **Quando aparece** (duas regras, basta uma): processo vinculado com título literal `Benefício INSS`, **ou** atividade que fala de perícia no título/tipo (`ehAtividadeDePericia`). A segunda usa fronteira de palavra (`\bpericias?\b`): "Peticionar cobrando a juntada do **laudo pericial**" é trabalho sobre perícia já realizada e não ganha chip de marcar data.
  - **A perícia é do benefício, não da atividade.** A linha é achada por uma âncora que degrada — **processo → caso → lead** —, a mesma expressão do índice único parcial no banco (`coalesce(process_id, legal_case_id, lead_id), hearing_type` where `origem='atividade'`). Medido em 19/08/2026 nas 326 atividades vivas de perícia: 203 ancoram no processo, 30 no caso, 79 só no lead e 14 (4,3%) não têm âncora — nessas o chip não aparece, porque não haveria onde salvar. `activity_id` é gravado como rastro, nunca como chave: a atividade é concluída ou clonada, a perícia fica.
  - Preenchida em qualquer atividade, a data aparece em **todas** as do mesmo processo/caso, inclusive nas criadas depois. O chip **salva na hora**, sem depender do "Salvar" da ficha (que grava `lead_activities`, outra tabela). Remarcar reaproveita a linha e devolve `status='ativa'` — "REMARCAR PERÍCIA" é título recorrente na base. Remover é soft delete.
  - **Sem conversão de fuso** (`src/lib/periciaInss.ts`): `hearings` guarda `hearing_date` (date) + `hearing_time` (time **sem** fuso) + `timezone_label`, ou seja hora local como a convocação diz. Era o caminho antigo (timestamptz) que exigia converter — e onde a hora escorregava.
  - **Não é marco processual.** `process_movements` é histórico append-only do que já ocorreu e não separa médica de social; aqui é agendamento, que muda quando o INSS remarca. Ver `marcos-processuais-regras.md`.
  - **A planilha não sobrescreve.** O sync diário de audiências casa linhas por `nº do processo|data`; desde 19/08 ele pula o que tem `origem='atividade'` (`railway-server/src/functions/sync-hearings-from-sheet.ts`).
  - **O que já está no calendário aparece no chip** (20/08/2026). A busca também vai pelo **número do processo** e não filtra por origem, porque as 564 linhas da planilha não têm `process_id` (1 de 566 tem). Antes disso o chip dizia "marcar" em **9 processos que já tinham perícia marcada**, e marcar criava um segundo cartão para o mesmo exame. A linha da planilha é **mostrada, não editada**: a chave com que o sync casa a linha é "número + data", então remarcar aqui faria o sync seguinte reinserir a data antiga. O popover diz de onde a data veio e oferece "Marcar outra data" — que cria linha nova, para quando a perícia do INSS é mesmo outra. Desmarcar só vale para o que nasceu no chip. `hearing_type` é texto livre ("Perícia Médica", "Pericia", "Perícia Judicial"), então a classificação é por `tipoDaPericia`, não por igualdade.
  - **O cartão nasce identificado**: o chip grava `case_ref` (título do caso, ou nome do cliente) junto com a data. Sem isso, a perícia marcada em atividade sem processo virava um cartão com só "Perícia Médica (INSS)" e a hora — e na aba Eventos a coluna Cliente ficava vazia, porque a resolução era só pelo número do processo. A agenda passou a resolver o cliente também pelo `lead_id` da própria linha (30 das 93 atividades vivas de perícia têm só o caso ou só o cliente).
  - **Lacuna conhecida**: o "Preenchimento por Documento" do comprovante do Meu INSS (abaixo) continua jogando a data da perícia no prazo da atividade e no texto — ainda não cria o evento no calendário.
  - **Lacuna conhecida**: as 326 atividades de perícia que já existiam **não** foram backfilladas. A data real delas está em texto livre no título ("Audiência Perícia Médica 14/08/2026 14:00", cujo `deadline` é 21/08 — o dia de preparar, não o da perícia) e adivinhar erraria. O calendário enche conforme a equipe usa o chip.
- Menu "Preencher com": **"Preenchimento por Áudio"** (grava ligação/ditado, IA transcreve e preenche os campos) e "Preenchimento por Documento".
  - Comprovantes do **Meu INSS** (protocolo de requerimento, agendamento de perícia médica/avaliação social, exigência) são detectados automaticamente e preenchem "Como está / O que foi feito / Próximo passo" no modelo padrão da equipe (blocos *Perícia médica:* / *Avaliação social:* com dia, local, endereço e orientações fixas); a data da perícia marcada vira o prazo da atividade.
  - **Quando a transcrição falha, o erro diz o motivo** (17/08/2026). O STT tem duas pernas — ElevenLabs **Scribe v2** como primária e **Gemini** como reserva (`railway-server/src/lib/stt.ts`) — e o `transcribeAudio` engolia o erro das duas e devolvia `null`, virando *"Não foi possível transcrever o áudio (inaudível ou vazio)"* na tela. A mensagem **acusa o microfone de quem gravou** justamente quando o problema é do provedor: no incidente a gravação estava íntegra (WebM/Opus, 29,4s, mean −19,7 dB) e falhava em 100% das tentativas, em qualquer formato. Hoje `transcribeAudioDetailed` devolve `{ text, reason }`, acumulando status **e corpo** da ElevenLabs, resposta 2xx sem campo `text`, e o `finish_reason` do Gemini quando volta vazio; os 4 chamadores (`transcribe-activity-call`, `transcribe-team-audio`, `dictate-activity`, `call-to-activities`) repassam o motivo. `transcribeAudio` continua existindo como wrapper de quem só quer o texto.
  - **A causa era a chave**: `ELEVENLABS_API_KEY` guardava o **ID** da chave, não a chave. A ElevenLabs responde `400` (não 401) com `status: api_key_id_used_as_api_key` — *"API keys start with 'sk_' and are shown when the key is created or rotated"*. Chave **inexistente** dá 401, então **não dá para deduzir estado de credencial pelo status**: tem que ler o corpo. Enquanto isso o "Preenchimento por Áudio" vive só do Gemini — marcador de que é ele respondendo: o mesmo áudio devolve contagens de caracteres diferentes a cada rodada (121 vs 117); a Scribe devolveria idêntico. Para separar as pernas sem acesso ao log do Railway: `POST /functions/telao-narrar` com `{"modo":"vozes"}` (→ `sem_api_key` vs `listagem_falhou` + `detalhe`) e com `{"texto":"…"}` (→ `elevenlabs_<status>` + `detalhe` + modelo + voz).
  - **Cota "desconhecida" não é cota zerada.** `checkElevenLabsCredits` fazia `character_limit ?? 0` com `has_credits: remaining > 0`: se o `/v1/user/subscription` parar de informar o limite — e a conta passou a ser medida em **créditos** —, a ElevenLabs inteira (STT primário e TTS) se desligava sozinha, logando *"sem créditos (0/0)"*. Corrigido nas duas cópias (`railway-server/src/lib/` e `supabase/functions/_shared/`); **as edges só pegam isso num redeploy**. Modelos: `eleven_turbo_v2_5` foi aposentado (→ `eleven_flash_v2_5`); `eleven_multilingual_v2` e `scribe_v2` seguem válidos.
  - **A IA não sobrescreve o que você escreveu.** Campo vazio ela preenche direto; campo já preenchido abre o diálogo "A IA quer alterar N campo(s)", com o seu texto ao lado da sugestão e um checkbox por campo — só muda o que for marcado. Trocar o **assunto** e **apagar** um campo vêm desmarcados. Motivo: as duas funções (`transcribe-activity-call`, `extract-activity-from-document`) declaram os 6 campos de detalhe como `required` no schema, então a IA devolve todos em toda chamada mesmo sem o áudio/documento falar deles — até 04/08/2026 o front aplicava a resposta inteira calado, e a atividade "trocava de assunto e conteúdo sozinha". Regra em `src/lib/activityAIFields.ts`, diálogo em `AIFieldMergeDialog.tsx` (`e977fe87c`). Metadados objetivos (prazo, notificação, prioridade, situação, assessor, tipo) seguem aplicados direto.
- Campos: Assessor* (multi — cada responsável recebe a própria atividade), Tipo* (com sugestão de IA), POP*, Observadores, Situação, Prioridade, **Previsão**, campos de texto rico com @menções, notas com anexos.
- **Previsão de tempo (⏱️ Previsão)** — quanto se espera gastar na atividade, em `lead_activities.estimated_minutes` (migration `20260812120000`). Antes de 12/08/2026 a previsão só existia por *sessão* de cronômetro (`activity_time_entries.estimated_minutes`) e só dava para definir no relógio flutuante, depois que a contagem já tinha começado — a atividade nascia sem nenhuma.
  - **Ao criar já vem sugerida** pela mediana real do tipo escolhido: RPC `activity_type_time_medians()` (180 dias, sessões > 60s, amostra ≥ 5 — abaixo disso não sugere), arredondada **para cima** na régua de opções. Arredondar para baixo faria metade das atividades nascer estourada e o vermelho do cronômetro viraria ruído. Sem histórico do tipo, 30 min. Medianas medidas em 12/08/2026: `tarefa` 7 min (1.916 execuções), `acompanhamento` 6, os tipos custom entre 7 e 35.
  - **Salvar pede confirmação** — o diálogo "Quanto tempo isso vai levar?" (`useEstimateConfirmPrompt`) abre antes de criar, com a régua de opções, a escolha atual marcada e a origem da sugestão; "Voltar ao formulário" cancela o save. Na **edição** só pergunta quando a atividade ainda está sem previsão (as que nasceram antes do campo) — com o valor definido, salvar não vira interrogatório. O payload lê a escolha do diálogo, não o state: `setState` é assíncrono e a atividade sairia com o valor anterior.
  - **O cronômetro herda** a previsão ao iniciar a sessão (é o gatilho de urgência: avisa perto do fim, mostra o excedente em vermelho depois), e ajustar no relógio grava de volta em `lead_activities` — senão no dia seguinte a atividade voltava com a previsão antiga.
  - **Gasto x previsto** aparece embaixo do campo (`gasto 07:12 de 30min`, âmbar a partir de 80%, vermelho com o excedente quando passa) e como selo ao lado do assunto na aba lateral. O gasto é a soma de `activity_time_entries.active_seconds` da atividade — todas as sessões, todos os dias (`work_date` particiona o dia; o total da atividade é a soma das fatias).
  - Atividade antiga fica **sem previsão** de propósito: não houve backfill, porque preencher retroativo seria inventar meta que ninguém combinou e sujaria o comparativo. Lógica compartilhada em `src/hooks/useActivityTimeEstimate.ts`.
  - **Sair do diálogo cancela o save — e agora avisa.** Entre 12/08 e 14/08/2026 fechar o "Quanto tempo isso vai levar?" com ESC, clique fora ou "Voltar ao formulário" descartava a edição **em silêncio**: sem toast, e sem rastro no `lead_activity_audit_log` (o UPDATE nunca acontecia, então forense por audit não enxerga). O formulário continuava na tela com o valor novo — inclusive um Prazo recém-trocado —, então parecia salvo. Como **8.697 das 8.728** atividades abertas estão sem previsão (medido em 14/08/2026), o diálogo aparece em praticamente todo Salvar. Sintoma que chegava da equipe: *"mudei a data da atividade e ela continua no mesmo dia"* — no incidente do PREV 180 a assessora, sem conseguir adiar pelo Salvar, recorreu ao "Concluir + próxima" **8 vezes em 10 minutos**, gerando 7 conclusões falsas. Hoje os 4 pontos (criar/salvar da `ActivitiesPage` e do `ActivityFullSheet`) mostram toast de aviso deixando claro que **nada** foi gravado.
- **Notificação (🔔) tem data e hora** (25/08/2026) — uma caixa `datetime-local` ao lado do Prazo. A data continua em `lead_activities.notification_date` (**DATE**, quem alimenta agenda, Google Calendar, BulkReassign e a contagem de carga do dia) e a hora vai para a coluna nova `notification_at` (**timestamptz**, migration `20260825120000` no Externo). Coluna nova em vez de `ALTER TYPE`: a `notification_date` é lida como string `yyyy-MM-dd` em três caminhos (o `.eq()` do `ConfirmDialogDateFields`, o regex do autoApply e o `slice(0,10)` do `diaDaAtividade`), e trocar o tipo reescreveria as 39.523 linhas mexendo em todos de uma vez. Helpers e testes em `src/lib/notificationDateTime.ts`.
  - **Meia-noite é "sem hora"**. As 22.247 atividades com data de aviso anteriores à coluna não têm hora nenhuma para exibir, e "às 00:00" numa mensagem ao cliente seria pior que não dizer nada. Elas abrem com a hora vazia e a mensagem segue dizendo *"até o final do dia"*; com hora, passa a *"às HH:mm"*.
  - **O estado do formulário segue partido** em `formNotificationDate` (`yyyy-MM-dd`) e `formNotificationTime` (`HH:mm`) de propósito — assim nenhuma das gravações de `notification_date` que já existiam mudou de forma. `notification_at` entrou na **whitelist do insert** do `createActivity`; fora dela a hora sumiria na criação e só apareceria numa edição posterior, o mesmo defeito que já engoliu Solicitação, Resposta do juízo e a previsão de tempo.
  - O `ConfirmDialogDateFields` (o "Confirmar nova atividade" do chat de IA) **já era** `datetime-local` desde sempre, mas mandava o instante para a coluna DATE e o Postgres truncava calado. Agora grava a hora de verdade. O campo **Prazo** desse mesmo diálogo continua com o defeito — é `datetime-local` sobre a `deadline`, que também é DATE.
- **Retorno agendado (↩️) foi removido** (25/08/2026). Existiu de 14/08 a 25/08/2026 em `lead_activities.callback_at` (timestamptz, migration `20260814190000`): data e hora de voltar a falar com o cliente/parte, campo opcional abaixo de Prazo/Notificação. Em onze dias com input na tela foi preenchido **8 vezes em 39.523 atividades** — e nem ele nem a Notificação disparavam coisa alguma, então eram duas caixas de data e hora lado a lado com o mesmo poder: nenhum. A hora foi para a Notificação, que é o campo que todo mundo já preenchia (22.247 linhas).
  - **A coluna e as 8 linhas ficam no banco**, e o `keyDate` do `SwitchActivityDialog` continua lendo (`meeting_at > callback_at > deadline > notification_date`), então as 7 pendentes com valor não mudam de ordem no minicalendário. Se em 30 dias ninguém sentir falta, derrubar com `alter table public.lead_activities drop column callback_at;`.
  - Nasceu **quebrado pela metade** entre jul/2026 e 17/08/2026: o front lia, hidratava, resetava e mandava `callback_at`, mas **nenhum input existia** (a prop `formCallbackAt` chegava ao `ActivityFormCompact` e nada a usava) e **a coluna nem estava criada** no Externo — `select` pedindo por ela derrubava a query inteira no PostgREST (`42703`) e a lista de pendentes aparecia **vazia em silêncio**. Coluna criada em 14/08 (`70de00332`), input em 17/08 (`f125cd1b5`), campo removido em 25/08 (`cb2611ece`).
- **Os popups de atividade têm X** (25/08/2026). Os avisos em tempo real do `ActivityNotificationsListener` — feedback, cobrança, atribuição, avaliação, @menção — ficam de 15s (padrão) a 30s (cobrança, incompleto, insatisfeito) na tela e chegam empilhados, até 9 pelo `visibleToasts` do Toaster. Não havia como dispensá-los antes da hora: clicar no corpo não fecha, e o único botão é "Abrir atividade", que dá `preventDefault()` de propósito para o popup **continuar** aberto depois de abrir a ficha. Agora esses toasts pedem `closeButton: true`. Fica só neles, não no Toaster inteiro — o resto do app são toasts curtos de sucesso, que não precisam de X. A classe `closeButton` entrou no `src/components/ui/sonner.tsx` para o botão herdar o tema; sem ela ele usa as variáveis próprias do sonner e destoa do `bg-background` que já sobrescrevemos ali.
- **Nem Notificação nem Prazo notificam ninguém** (medido em 25/08/2026). Não existe job, cron ou push varrendo essas datas: os pushes (`send-team-push`) saem de chat, menção e cronômetro, e os popups de `activity_notifications` são por **evento** (atribuição, feedback, avaliação, cobrança), nunca por data chegar. As datas servem para ordenar a agenda, contar a carga do dia e compor a mensagem ao cliente. Um lembrete de verdade precisaria de um job novo (pg_cron → Railway), com índice parcial sobre as não concluídas e marca de "já avisei".
- A ficha também abre **já preenchida por IA** quando a atividade nasce de outra tela: mensagens do **Chat da Equipe**, movimentação do processo, documento, ditado por voz ou ligação. É sempre o mesmo formulário — o usuário revisa e só então cria.
- "Vincular: Campanha" — associa a atividade a uma campanha.
- Envio ao grupo: "Copiar" (mensagem pronta), "Avaliação" (gera link público 0–5⭐), "Enviar ao Grupo / Enviar ao Assessor" (preview editável, escolha de instância, opção "Incluir gravação da ligação").
  - **O "🔗 Ver atividade" só vai na mensagem ao assessor** (25/08/2026). O link é `/?openActivity=`, que exige sessão: no grupo do cliente ele nunca abriu — era ruído e ainda expunha o id interno da atividade. Saiu do Copiar-com-lead, do Enviar ao Grupo e do áudio TTS; nos modelos salvos, `{{link_atividade}}` renderiza vazio nesses casos e a auto-injeção antes do "Estamos à disposição" não acontece. Regra em `buildActivityMessage.ts`, amarrada ao `audience`.
  - **O texto da IA agora sai junto com a mensagem** (01/09/2026). O menu ✨ do campo (Resumir, Corrigir erros, Humanizar, Mudar tom, Traduzir…) devolve opções em card; clicar numa delas trocava o conteúdo do `RichTextEditor` **sem avisar o formulário**. O editor não propaga HTML a cada tecla — por performance, só gera no `blur`/expandir —, e o clique no card não tira o foco do campo, então `onChange` nunca disparava. Resultado: a tela mostrava o texto novo e **Copiar**, **Enviar ao Grupo**, o áudio (TTS), a revisão por IA e o próprio **Salvar** liam o anterior. Uma assessora gravou a tela (31/08) mandando "Em resposta à nossa cobrança" quando na ficha já estava "Em atenção à nossa cobrança"; quem clicava dentro do campo depois de aplicar não via o problema, porque o blur sincronizava. O `handleSelectOption` passou a marcar o `editor.update` com a tag `ai-apply`, tratada no `handleEditorChange` igual à `voice-input` (ditado, que tinha o mesmo buraco e já fora fechado): flush imediato. Regressão em `src/components/ui/__tests__/RichTextEditor.aiApply.test.tsx` — renderiza o editor de verdade, aplica a sugestão e cobra `onChange` sem nenhum blur.
  - **Negrito e companhia também não chegavam ao formulário** (01/09/2026, mesmo dia e mesma causa raiz). O `ToolBtn` da barra não prevenia o foco no `mousedown`, então o clique em **Negrito/Itálico/Sublinhado/Tachado/link** levava o foco pro botão *antes* do `onClick`: o editor sofria blur, o `handleBlur` emitia o HTML de **antes** da formatação e zerava o `dirtyRef`; o comando aplicava em seguida (o Lexical guarda a seleção mesmo sem foco no DOM) e o resultado **nunca mais era emitido**, porque não havia um segundo blur. Tela em negrito, estado sem — medido no teste: `activeElement` virava `BUTTON "Negrito"`, o DOM ficava `<strong class="lexical-bold">` e o único `onChange` saía com `<span>`. Quem clicava de volta no campo antes de sair sincronizava e não via nada; quem formatava e ia direto no Copiar/Enviar/**Salvar** perdia a formatação. Fix: `onMouseDown={(e) => e.preventDefault()}` no `ToolBtn` — de brinde, o cursor não sai mais do texto ao formatar. Regressão em `src/components/ui/__tests__/RichTextEditor.toolbarFocus.test.tsx`.
- Rodapé: "Excluir", **"Adiar"**, "Salvar", "Concluir + próxima", "Concluir"; na criação: "Cancelar", "Chat", "Criar".
- **A ficha em aba lateral tem as MESMAS ações da tela cheia** (17/08/2026). Quem abria a atividade pela lista de **Atividades do caso** (`CasesPage`, `ProcessDetailSheet`), pelas abas do lead, pelo chat ou pelo relatório diário caía no `ActivityFullSheet`, cuja barra de ações só tinha Excluir/Cancelar/Adiar/Concluir/Salvar. Para **Copiar** a mensagem, **Enviar** ao grupo, gerar link de **Avaliação**, **Duplicar**, abrir **Chat Equipe**/**Chat IA**, **Reabrir** uma concluída ou usar **"Concluir + próxima"** era preciso clicar em "Tela cheia" e recomeçar na `ActivitiesPage` — a mesma atividade, outra tela. Hoje o rodapé do `ActivityFullSheet` monta o **mesmo** `SendToGroupSection` (Copiar / Avaliação / Enviar / Áudio / ⚙ campos / Modelos) e o mesmo menu "Mais", e o cabeçalho ganhou **"Próximos passos"** (`ActivityNextStepsAgent`) e **"WhatsApp"** (conversa do lead no `DashboardChatPreview`, painel de baixo pra cima — nunca aba nova). Em duas fileiras, não uma: no celular a fileira única jogava os botões primários pra fora da tela. Paridade travada por `ActivityFullSheet.action-bar.test.tsx`.
  - O envio ao grupo do "Concluir + próxima" saiu da `ActivitiesPage` para `src/lib/activityGroupNotification.ts` (`sendActivityGroupNotification`), porque o `CompleteAndNotifyDialog` aberto pela aba lateral oferecia notificar o grupo e **nada saía** — a função vivia dentro da página. As duas telas usam agora o mesmo caminho, com a mesma resolução de instância remetente para texto e áudio.
  - O **carry-over de anexos** do "Concluir + próxima" também vale na aba lateral, com a mesma regra do `f1e75f4`: a fonte é o **banco** (`activity_attachments` da mãe), não o que foi anexado naquela abertura da ficha. Aqui não existe fila pendente a descarregar antes de concluir — em modo edição o `ActivityNotesField` já grava cada anexo na hora, porque tem `activity_id`.
- **"Adiar"** (`PostponeActivityPopover`, 14/08/2026) — troca `deadline` **e** `notification_date` para a data escolhida e para por aí: não conclui, não cria filha e **não passa pelo diálogo de previsão de tempo**. Opções rápidas calculadas em `src/lib/postponeDates.ts` a partir de HOJE (próximo dia útil, em 3 dias úteis, próxima segunda, em 1 semana — datas repetidas caem fora, porque numa sexta "próximo dia útil" e "próxima segunda" são o mesmo dia), mais um seletor de data com mínimo em hoje. Está no rodapé da ficha, no rodapé do `ActivityFullSheet` e como submenu do **botão direito no cartão** da lista (no cartão só as opções rápidas; data específica é na ficha). Prazo e notificação andam juntos de propósito: quem adia quer a atividade inteira no dia novo. O bloqueio de **ausência registrada** (aba Férias) continua valendo — mora no `updateActivity`, que agora devolve `boolean` e aceita `{ successMessage }` para quem dá o próprio retorno ("Adiada para 18/08"). Existe porque até então não havia caminho nenhum de adiar: era Prazo + Salvar, e quando o Salvar falhava calado no pop-up de previsão a equipe recorria ao "Concluir + próxima", que conclui a atividade na data velha e deixa um clone na nova.
- **"Concluir + próxima"** conclui a atividade aberta e cria outra copiando o formulário inteiro (o que foi feito, como está, próximo passo, responsável, prazos, anexos). **O assunto digitado é preservado na filha** — a IA (`generate-activity-title`) só nomeia quando o campo está vazio. Entre 30/07 e 03/08/2026 a IA sobrescrevia o assunto escrito pelo usuário, o que fazia a atividade parecer que "mudava de nome sozinha" ao concluir (a mãe some da lista de Pendentes e a filha ocupa o lugar) e gerava títulos idênticos em casos diferentes; corrigido em `99223b072`. Para renomear de propósito, usar o botão **"Renomear com IA"** no cabeçalho: com o assunto em branco ele preenche direto; com assunto escrito, a sugestão passa pelo diálogo de revisão (o botão fica colado no "Preencher com" e um clique sem querer trocava o título calado).
  - **A mãe passa a guardar o que foi digitado** (17/08/2026, `src/lib/activityChainMother.ts`). Até então o clique concluía a mãe sem gravar o formulário — o `completeActivity` mexe só em `status`/`completed_at`/`completed_by`/`updated_by` — e o texto ia **só para a filha**: medido nos 1.000 elos de cadeia mais recentes, **56** mães com "O que foi feito" vazio e a filha cheia, mais **151** guardando versão divergente da digitada (~20% da cadeia com o relato do trabalho parado na etapa que ainda não começou). Agora, antes de concluir, a mãe recebe um UPDATE com os **6 campos de texto** (o que foi feito, como está, próximo passo, notas, solicitação, resposta do juízo) e a filha segue levando a mesma cópia. Fora do patch de propósito: `deadline`/`notification_date`/`callback_at` (são da próxima etapa — **a mãe fica concluída na data em que venceu, a filha nasce na data nova**, e sem `deadline` no patch o bloqueio de ausência registrada do `updateActivity` não é acionado) e `title` (assunto trocado no formulário costuma ser o nome da próxima etapa; gravar na mãe reabriria o "muda de nome sozinha" de jul/2026). Duas regras: campo igual ao banco não entra no patch, e **campo vazio nunca apaga** texto que a mãe tem — formulário vazio com banco cheio é o que uma ficha meio-carregada parece, e o "vazio" chega como `<p><br></p>` do Lexical (por isso a comparação stripa as tags). Para esvaziar de propósito, usar o Salvar. Se esse UPDATE falhar, **nada é concluído** (mesma postura do flush de anexos). Vale nas duas telas, coberto por `activityChainMother.test.ts`.
- **Pop-up "Concluir e Criar Próxima Atividade"** (`CompleteAndNotifyDialog`): antes de concluir, pergunta se quer **notificar o grupo do WhatsApp** e, opcionalmente, **enviar áudio junto** — a IA (`ai-text-editor`) *explica* a atualização em um dos 7 tons em vez de ler o texto, e o áudio sai pelo `elevenlabs-tts`. Texto e áudio saem pela **mesma instância**, resolvida por `resolveGroupSenderInstanceName` (até 04/08/2026 cada um saía por uma, incidente FAMÍLIA 250). Sem grupo vinculado o pop-up aparece do mesmo jeito, com a opção desabilitada e o rótulo *(nenhum grupo vinculado)* — notificar é opcional, o caminho que a equipe mais usa é o "Copiar"/"Enviar" da própria ficha. O pop-up foi removido em 13/08/2026 por lentidão e **restaurado no dia seguinte** (`0ca1be716`) a pedido.
  - **O aviso de prazo alterado foi removido** (17/08/2026, viveu de 14 a 17/08 em `e35e37ecb`). O pop-up passou a mostrar um alerta amarelo — *"Você mudou o prazo de 14/08 para 18/08…"* — mais o atalho **"Só adiar — não concluir"** sempre que o prazo do formulário diferia do gravado. Saiu por não distinguir nada: medido nos **1.000 elos de cadeia mais recentes**, **946 (94,6%)** nascem com prazo **maior** que o da mãe, contra 53 que repetem a data e 1 para trás. Mudar a data **é** o caminho normal — a data do formulário é a da próxima etapa —, então o aviso aparecia em 19 de cada 20 cliques legítimos e só ensinava a clicar por cima. O motivo original (usar o botão como adiar, na falta de um Adiar) foi resolvido no mesmo dia pelo próprio **"Adiar"**, que fica no rodapé ao lado deste botão: a saída certa não precisa ser reoferecida dentro do pop-up. **O fluxo é este e está correto**: a mãe fica concluída com a data em que venceu, a próxima nasce na data nova. `CompleteAndNotifyDialog.prazo.test.tsx` virou o teste de regressão que tranca a decisão (nada de aviso, nada de atalho de adiar).
- **Por que o pop-up demorava a abrir** (corrigido em `edff7c6a9`): ele buscava os grupos do lead **no clique**, com o conteúdo inteiro escondido atrás do spinner — 1 ida ao banco quando o lead tem grupo e **2 em série** quando não tem, que é o caso mais comum (~55ms por ida com conexão quente, ~235ms na primeira), repetido a cada atividade da fila do modo workflow. Não era falta de índice (`idx_lead_whatsapp_groups_lead_id` já existia). Agora a ficha **pré-carrega** os grupos junto com o resto do lead, nos 3 pontos que já o carregam, e o pop-up abre sem nenhuma requisição. O preload é carimbado com `lead_id` e conferido contra o lead aberto — mesma proteção do `leadPreview`, para grupo de um lead nunca virar destino de mensagem de outro. Sem preload (falha, ou grupo vinculado com a ficha já aberta) o dialog volta a buscar no clique.
  - **O preload calou o áudio do grupo por 3 dias** (17/08/2026). A policy do `lead_whatsapp_groups` é `lwg_all_authenticated` (`TO authenticated`): **sem sessão o PostgREST devolve zero linha, não erro** — e o `fetchLeadGroupOptions` ainda descartava o `error` (`const { data } = await …`). As duas coisas juntas faziam qualquer falha chegar ao dialog como *(nenhum grupo vinculado)*, que **desliga a notificação em silêncio**: nem toast, nem log, e o "Mensagem enviada ao grupo!" do texto nem chegava a aparecer porque o rádio ficava em "não". Enquanto a busca só rodava no clique o problema não existia (a sessão já estava de pé); o pré-carregamento junto da ficha a pôs correndo com o bootstrap. Medido no banco: áudio TTS chegando em grupo todo dia útil até **14/08** (dia em que o preload subiu) e **zero em 15, 16 e 17/08** — sendo 17/08 uma segunda cheia, com 160 áudios outbound no total. Correção: `await ensureExternalSession()` antes da query (mesmo idioma do `leadWhatsAppTarget.ts` e do `whatsappVoiceSend.ts`) e erro propagado como exceção — falha vira `null` no preload, e o dialog volta a buscar no clique em vez de mentir "sem grupo". Coberto por `CompleteAndNotifyDialog.preload.test.tsx`.
  - **O envio do áudio parou de ser silencioso** (`activityGroupNotification.ts`): o `error` do `elevenlabs-tts` era descartado e, sem `audio_url`, o bloco inteiro era pulado **sem aviso nenhum**; o `send_media` seguinte nem era conferido, então o "Áudio enviado ao grupo!" saía mesmo quando o envio falhava. Hoje cada etapa diz o que houve ("Áudio não enviado: …", "Áudio gerado, mas não foi ao grupo: …") e o motivo vai para o console.
- **Quando a filha não nasce**: a conclusão da mãe é gravada *antes* do insert da filha. Se o insert não passar, a mãe fica concluída e a cadeia para. O `createActivity` devolve `null` em silêncio em três casos — outro insert igual em voo (dedup de 5s por lead+título+tipo), prazo caindo em ausência registrada na aba Férias, e o índice único `lead_activities_dedup_pending_idx` (uma pendente por lead+título+tipo+responsável) — e lança em erro de banco. Até 04/08/2026 o fluxo não checava o retorno e anunciava "próxima criada" mesmo sem ter criado; desde `85e18a1fa` mostra erro e mantém a ficha aberta.
- **Forense**: "Concluir" e "Concluir + próxima" são **indistinguíveis** no `lead_activity_audit_log` — nenhum dos dois deixa marca própria. O `actor_kind` só diz se `updated_by`/`auth.uid()` casou com um `profiles.full_name` (`system` = não casou), não qual botão foi clicado. Baseline medido em jul-ago/2026: **8,6% a 25,6% das conclusões diárias não geram filha** — é o uso normal do "Concluir" simples, não sinal de falha. Só investigar pico muito acima disso.

- **Rodapé de autoria — "Criado por" e "Última atualização por"**: a data e o autor vêm de campos independentes. O trigger `update_lead_activities_updated_at` carimba `updated_at` em **todo** UPDATE, mas `updated_by` só existe se quem escreveu mandou o valor — e nenhum trigger consegue descobrir isso sozinho, porque a sessão do front no Externo é anônima (ver `identidade-de-usuario.md`). Até 07/08/2026 só o "Salvar" carimbava: concluir, avaliar, vincular processo/caso, reatribuir e migrar tipo subiam a data e deixavam o autor nulo — **18.005 de 25.086 atividades já atualizadas (72%)** ficaram assim, e a ficha exibia "—", que parecia defeito de tela. Desde `3f3a77f3b` os 9 caminhos do app carimbam o autor, e quando ele realmente não existe a ficha diz *sem registro* (com explicação no `title`) em vez do travessão. O histórico não é recuperável.
- **Alteração em massa parece "alguém mexeu"**: manutenção rodada em SQL direto no banco sobe o `updated_at` de centenas de atividades de uma vez e aparece como "atualizada em <hoje>, sem registro". Reconhece-se pelo `updated_at` idêntico ao microssegundo entre as linhas — ex.: 12/06/2026 09:20 BR, 909 atividades num único timestamp (vinculação de `process_id`), e 20/07/2026 13:33, 1.974 linhas. Quem rodou é irrastreável: SQL direto não deixa autoria e o `lead_activity_audit_log` só existe desde 18/07/2026.

### Cronômetro (automático)
Ao abrir uma atividade sua não concluída, o cronômetro inicia sozinho; abrir atividade de outro assessor é só consulta. Concluir encerra o cronômetro.

**Fluxo recomendado**: "Nova Atividade" → vincular Lead/Caso e definir Tipo → **"Preencher com → Preenchimento por Áudio"** (o jeito mais rápido: grava, a IA transcreve e preenche tudo) → revisar → "Criar"; ao terminar, "Concluir + próxima".

---

## Painel "💬 Feedbacks" (`FeedbackFunnel.tsx`)

Aba lateral aberta pelo botão "💬 Feedbacks" do cabeçalho das Atividades. Mostra **só as atividades em que você é observador ou criador** — nunca as suas como responsável (autofeedback fica fora; a caixa "Incluir as minhas (sou o responsável)" liga isso quando você quiser).

**Chips do topo são clicáveis** (desde 21/08/2026, confirmado em uso pelo Raym), em dois blocos (01/09/2026): o que está **em aberto** — ⏰ atrasadas · 🔁 reagendadas — e, dentro de uma moldura tracejada, o que já **concluiu**: 🏁 **N concluídas** (a soma) seguida do detalhamento ✅ satisfeito · ⚠️ incompleto · ❌ insatisfeito · 📥 a avaliar. A soma é `a_avaliar + satisfeito + incompleto + insatisfeito` — tudo que voltou com retorno, avaliado ou não — e também é atalho: clicar lista as concluídas com as que faltam avaliar na frente. Antes "a avaliar" aparecia solto no meio dos desfechos e o total das concluídas não existia em lugar nenhum. Clicar num chip abre a **relação daquelas atividades** (mesmos cartões do funil, com cobrança ❗/🚨 nas atrasadas e o formulário de avaliação nos retornos); o chip em foco fica com anel, e "Voltar" devolve à visão anterior. Antes eram números decorativos — dava para ver "40 atrasadas" sem ter como listá-las.

**Três visões**: "Funil" (kanban das 6 colunas), "Calendário" (padrão, por data de prazo/reagendamento) e **"Por assessor"** (desde 21/08/2026) — tabela com a **quantidade de cada status por assessor responsável**, ordenada por quem tem mais atrasadas, depois maior total, depois nome. As colunas seguem a mesma leitura dos chips (01/09/2026): ⏰ · 🔁 · **🏁 Concluídas** (a soma, com divisa à esquerda) · ✅ · ⚠️ · ❌ · 📥 · Total. Cada número é clicável: leva à relação daquele status **daquele assessor** (fixa o filtro de assessor) — inclusive o da soma, que abre as concluídas daquele assessor. Rodapé com o total geral. A tabela respeita o filtro de período e ignora o de assessor por construção (ela **é** a quebra por assessor).

A contagem vive em `src/lib/feedbackFunnelStats.ts` (`contarPorAssessor`, `totalGeral`, `concluidasDe` — a soma das concluídas mora lá, não na tela, para o chip do topo e a coluna da tabela nunca discordarem) — mesma classificação das colunas do funil (reagendada pelo status; sem `feedback_outcome` = a avaliar; sem responsável cai em "—"). Testes: `src/lib/__tests__/feedbackFunnelStats.test.ts` e `src/components/activities/__tests__/FeedbackFunnel.chips.test.tsx`.

**Avaliou → "A situação da atividade continua essa?"** (desde 02/09/2026). Avaliar um retorno como ⚠️ Incompleto e deixar a atividade em ✅ Concluída era a contradição que o painel deixava passar: o funil cobrava o que faltava e o quadro de atividades dizia que estava pronta — sem ninguém para reabrir. Agora, **depois de gravar qualquer avaliação** (satisfeito, incompleto ou insatisfeito), abre um diálogo que mostra a **situação atual** da atividade (com a cor e o ícone dela, e o prazo/reagendamento que vale hoje) e pergunta **para qual mudar** e **com que data**:
- Incompleto e Insatisfeito já abrem com 🔄 **Em Andamento** sugerido; Satisfeito abre na própria situação atual (a pergunta é de conferência, não de mudança).
- A data acompanha a escolha: em 🔁 Reagendada é **obrigatória** e grava em `rescheduled_to` (é o que o funil e o calendário passam a cobrar); nas demais grava em `deadline`. Em branco, o prazo atual continua valendo.
- "Manter <situação>" fecha sem tocar em nada. Nada mudou (mesma situação, mesma data) = botão desabilitado.
- Concluir carimba `completed_at/by/by_name`; **sair** de concluída limpa os três — igual ao "Reabrir" da ficha. Situação e carimbo de conclusão não podem discordar.
- O responsável recebe o aviso `status` ("🔄 Situação da atividade alterada — ✅ Concluída → 🔄 Em Andamento · 05/09/2026"), pela mesma porta dos avisos de avaliação. Nunca a si mesmo.
- Vale nas **duas telas que avaliam**: o funil (`FeedbackFunnel`) e o painel do telão (`FeedbackAvaliarInline`). Regra em `src/lib/activityStatusChange.ts` (`lerSituacaoAtual`, `alterarSituacaoAtividade`), diálogo em `src/components/activities/useStatusChangePrompt.tsx` (mesma mecânica assíncrona do `useKeepAsObserverPrompt`: a Promise só resolve quando a pessoa decide). No telão a situação atual é **lida do banco** — lá só existe o `activity_id`. Testes: `src/lib/__tests__/activityStatusChange.test.ts`.

**A situação ficou visível** (02/09/2026). Antes ela era um `<select>` cinza igual a todos os outros, lá no meio do formulário: para saber se a atividade estava pendente ou concluída era preciso procurar e **ler**. Agora:
- o gatilho do select tem a **cor da situação**, ícone e texto maior (`ActivityFormCompact`);
- o cabeçalho da ficha mostra a situação **ao lado do assunto**, do mesmo jeito que já mostrava o cronômetro — inline, sem cobrir o título (`ActivityFullSheet`);
- rótulo, ícone e cor de cada situação vivem em `src/lib/activityStatus.ts` (as mesmas cores dos cards da `ActivitiesPage`), não mais copiados tela a tela.

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
- **Nenhum prompt apita por padrão** (19/08/2026). Os avisos sonoros viraram opção por dispositivo em **Configurações → Notificações → "Sons do sistema"** (`SoundSettings.tsx`), todos desmarcados de fábrica: ocioso, "ainda está fazendo?", pausa estourada, previsão estourada, mensagem urgente do chat interno e chamado da gestão. Cada linha tem botão **Testar**. A preferência mora no `localStorage` (`sound-settings`) e é lida direto no instante do disparo (`isSoundEnabled()` em `src/lib/soundSettings.ts`), então desligar numa aba vale na outra sem recarregar; os três geradores de áudio ficam em `src/lib/sounds.ts`. Motivo da mudança: o apito de 5 min disparava com a pessoa trabalhando (lendo processo no PJe), e aviso que toca no caminho normal vira ruído.

**Fluxo recomendado**: "Iniciar expediente" → abrir a atividade (cronômetro liga sozinho) → nos vazios, usar o microfone "O que faço?" pra documentar por voz → registrar pausas pelo menu → "Encerrar expediente" ao sair.

### Ativo x ocioso com a atividade aberta (28/08/2026, revisto em 31/08/2026)

Quem decide cada segundo é `activityTickMode()` em `src/contexts/ActivityTimerContext.tsx` (função pura, testada em `__tests__/ActivityTimerContext.away.test.ts`):

| Situação | Conta como | Pergunta | Volta pro ativo se confirmar? |
|---|---|---|---|
| Na aba, mexendo no sistema | **Ativo** | — | — |
| **Fora da aba** (PJe, Word, e-mail, telefone) até 45 min | **Ativo** | — | — |
| Fora da aba passando de 45 min | Ocioso | "Ainda está nessa atividade?" | **Sim** — até 4h por ausência |
| Fora da aba com **previsão** declarada ainda cobrindo | **Ativo** até o teto da previsão | no estouro | **Sim** |
| Na aba, sem tocar em nada por 15 min (saiu do computador) | Ocioso | "Ainda está nessa atividade?" | **Não** |
| Tela bloqueada | Ocioso | — | **Não** |
| Máquina suspensa, sem previsão e com o app em foco | Ocioso | uma vez, ao voltar | **Não** |
| Máquina suspensa **com previsão em andamento ou app fora de foco** | Ocioso | uma vez, ao voltar | **Sim** |
| Pergunta pendente, mas a pessoa mexendo na aba | **Ativo** | — | — |

"Fora da aba" = `document.visibilityState !== 'visible' || !document.hasFocus()` — vale para outra aba, outro programa e janela minimizada. A carência é `AWAY_GRACE_MS` (45 min); o teto do que uma ausência devolve ao ativo é `RECLAIM_MAX_SEC` (4h), para aba esquecida aberta a noite toda não virar jornada produtiva com um clique. O que é reatribuível fica em `TimerEntry.reclaimableIdle` (só na memória da aba; o banco guarda o resultado já em `active_seconds`/`idle_seconds`) e o "Sim, continuar contando" faz a transferência em `confirmStillWorking()`.

Motivo da primeira rodada (28/08/2026): até 27/08 bastavam 5 min sem tocar na aba para **tudo** virar ocioso, e o "Sim" não devolvia nada — o resgate só existia depois do estouro de uma previsão, e só 11,7% das sessões tinham previsão. Placar de 01/08 a 28/08: 1.642h ativas contra **690h ociosas**, 97% delas concentradas em 807 sessões com 5 min ou mais de ocioso (uma delas com 23,8h).

#### O falso "computador suspenso" (31/08/2026)

A carência de 10 min não resolveu: em 31/08 o dia ainda fechou com 19,8% de ocioso e as queixas continuaram, com print da notificação **"O computador ficou suspenso 6 min (contado como ocioso)"** aparecendo enquanto a pessoa redigia no PJe, com os minutos já declarados na atividade. Três defeitos, todos corrigidos:

1. **O detector de suspensão era só um buraco de tempo.** `machineSuspended` era `deltaSec >= 120` (2 min entre ticks), e a única defesa contra falso positivo era o evento `freeze` da Page Lifecycle API — que é Chrome/Edge e nem sempre dispara. Aba estrangulada em segundo plano (o que acontece com a janela minimizada enquanto se redige no PJe/Word) batia no detector. Agora só é declarada suspensão quando o **relógio monotônico parou junto**: `performance.now()` não anda com a máquina dormindo, mas anda normalmente com a aba só estrangulada. O salto mínimo para cogitar subiu de 2 para 10 min (`SUSPEND_JUMP_SEC`), e a diferença exigida entre os dois relógios é `SUSPEND_CLOCK_GAP_MS` (60s). Se a heurística errar, erra para o lado seguro: cai na regra de ausência, que devolve o tempo.
2. **A suspensão passava por cima da previsão.** `machineSuspended` é testado antes dos ramos de ausência e de previsão, então declarar os minutos não protegia — e o tempo era `reclaimable: false`, ou seja, não voltava nem confirmando. Agora, suspensão com previsão em andamento **ou** com o app fora de foco vira ocioso **reatribuível**.
3. **Estourar a previsão congelava o cronômetro.** Ao bater a previsão o código armava `awaitingConfirm`, e pergunta pendente jogava tudo em ocioso — inclusive de quem seguia digitando na tela, até alguém clicar num diálogo que podia nem estar visível. Em 11–31/08 foram **102h de ocioso** (16% do total do período) em sessões que bateram a previsão, com o ativo grudado no valor declarado: 45,4 min de ativo para 45 de previsão e 189,8 de ocioso; 90,0 para 90 e 72,2 de ocioso. Agora o estouro **só notifica**, e a pergunta pendente não congela quem está com o dedo no teclado nesta aba — ela classifica o tempo, não para a contagem.

**Pendência conhecida**: a previsão ainda funciona como **teto** do tempo fora da aba (`over` no loop de contagem subtrai do ativo o que passar dela). O excedente vira ocioso reatribuível, não some, mas cria o incentivo torto de declarar previsão curta e ficar pior do que quem não declarou nada (que tem 45 min de carência cheios). Não foi mexido nesta rodada.

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

**A barra diz de qual POP ela é, e de onde ele veio** (01/09/2026) — a linha embaixo da barra mostrava só `<fase> · fase 3 de 24 · <marco>`, sem dizer a qual POP aquela fase pertence; e o formulário dizia "(herdado do lead)" sem dizer herdado de quê. Agora a linha começa com `POP: <nome>` e, quando não é POP escolhido na própria atividade, diz a origem: **(do processo)** ou **(herdado do lead)**. Quem sabe a origem é quem monta a barra — a barra só recebe um `boardId` —, então ela ganhou a prop `origemDoPop` (`'atividade' | 'processo' | 'lead'`), preenchida nos três ramos do `ActivityFullSheet`/`ActivitiesPage` (POP próprio da atividade → POP do processo → funil/POP do lead) e no `ProcessDetailSheet`.

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

## Uma medida só: progresso, etapa e passo atual da mensagem (30/08/2026)

A mensagem gerada na atividade (`buildActivityMessage`) e a barra do POP na ficha (`LeadFunnelProgressBar`) leem o mesmo checklist e **têm que dizer o mesmo**. Caso que abriu a correção — processo `1017247-47.2025.4.01.3100`, POP "BPC JUDICIAL": a tela mostrava a fase de contestação com 16 dos 27 passos marcados e a mensagem ao cliente saiu com *"estamos no comecinho (0% concluído)"*, *Etapa: FASE 1*, *Passo atual: Análise do Indeferimento Administrativo*.

Eram três divergências, todas estruturais:

1. **Contexto congelado.** `useActivityStepContext` lia os passos uma vez, na montagem. Marcar passo acontece na barra, que é outro componente com estado próprio — nada avisava o contexto. A mensagem saía com a foto de quando a ficha abriu. Agora a barra emite `adscore:pop-steps-changed` (`src/lib/popStepsEvent.ts`) a cada gravação e o contexto recarrega.
2. **Fase atual vinha do funil comercial.** `fetchLeadSteps` usava `leads.status` como fase atual. Em board de POP esse status nunca casa (era `procuracao_assinada`, fase do funil do lead), então a regra "1º não-concluído da fase atual" morria e caía no 1º não-concluído da lista inteira. A fase agora sai de `lead_processes.workflow_stage_id` (a mesma que a barra usa e que a régua de marcos escreve) e só vale se for fase **deste** board; `leads.status` é a segunda opção, sob a mesma condição.
3. **Ordem dos passos era a de criação das instâncias.** Instâncias criadas no mesmo milissegundo saem em ordem arbitrária e objetivo adicionado depois ia para o fim. Agora vale a ordem projetada — fase (`kanban_boards.stages`) → objetivo (`checklist_stage_links.display_order`) → passo. Junto: instância de fase que não existe mais no board fica de fora, duplicata de (fase, objetivo) é resolvida pela mais avançada e passo `supersededBy` (histórico do POP antigo) não conta.

**Percentual**: a mensagem contava passo no plano (16/27 = 59%) enquanto a barra pesa fase → objetivo → passo (61%). Agora as duas chamam `calculateHierarchicalProgress`, com o mesmo denominador — as fases do board, que passam a viajar no `stepContext.phases` (inclusive no aviso do sino, `ProcessUpdatesBell`). Fase sem objetivo instanciado continua pesando: sumir passo não pode subir percentual.

Testes: `src/lib/__tests__/leadStepContext.ordem.test.ts` (ordem, dedupe, escolha do passo) e `src/components/activities/__tests__/buildActivityMessage.progresso.test.ts` (os passos reais do caso acima).

---

## O percentual da mensagem é o da régua de marcos (30/08/2026)

Correção da entrega anterior. A decisão de 12/08/2026 — *"o percentual do processo atualizar só pelos marcos, não depender de marcar os passos, pq isso pode ser falho"* — valia para a barra da ficha e **não** tinha alcançado a mensagem: ela anunciava progresso de passo marcado à mão. No caso `1017247-47.2025.4.01.3100` a barra mostrava **40%** (régua: 2 de 5 marcos previstos, atual = Perícia em 28/04/2026, fonte `escavador_texto`) e a mensagem, 61% pelos passos. Dois números certos que, juntos, fazem a tela mentir.

Agora `buildActivityMessage` recebe `regua` (`useProcessoMarcos` / RPC `pop_processo_regua`) e a ordem é:

1. Requerimento encerrado no INSS → nenhum percentual (regra de 26/08/2026, intacta);
2. **Régua com marco** → `📊 Andamento do processo: N% concluído` + `Marco atual: <rótulo> em <data>`;
3. Sem marco nenhum → progresso por passos, como antes.

A linha `*Etapa:* / *Objetivo:* / *Passo atual:*` continua sendo a do POP: **andamento** (onde o processo está) e **trabalho** (o que a equipe executou) são duas medidas com dois nomes, e por isso a linha da régua se chama `Marco atual`, não `Etapa`. Vale nas três telas que montam mensagem: `ActivityFullSheet`, `ActivitiesPage` e o sino (`ProcessUpdatesBell`, via `fetchProcessoRegua`).

### A barra da tela de Atividades ficou sem a régua (02/09/2026)

A correção acima chegou ao `ActivityFullSheet` e ao `ProcessDetailSheet`, mas **não** à tela gêmea `ActivitiesPage` — a barra era montada lá sem a prop `processId`. Sem ela, `useProcessoMarcos(null)` volta vazio e a barra faz duas coisas erradas de uma vez (`src/components/activities/LeadFunnelProgressBar.tsx:226-228`, `:259-262`, `:283-286`, `:1094-1095`):

1. cai no percentual de **passos marcados à mão** em vez da régua;
2. deixa de ler `lead_processes.workflow_stage_id` e volta para a **1ª fase do POP**.

Caso 60 (`0100419-74.2021.5.01.0281`, POP "Trabalhistas judicial — marcos"): a tela de Atividades dizia *"Pré-Processual · fase 1 de 24 · 3%"* e a ficha do processo, *"Embargos de declaração (2º grau) · fase 10 de 24 · 80%"*. Os dois números estavam certos para o motor que os produziu — 2,58% pelos 8 passos vivos marcados de 184, e 80% pelos 8 marcos cumpridos de 10 previstos (`pop_processo_regua`).

Alcance medido no Externo em 02/09/2026: dos **1.290** processos com esse POP, **1.290** têm régua com percentual e **999** têm `workflow_stage_id` diferente da 1ª fase — todos exibiam a fase errada nessa tela. Não é backfill: nada de errado estava gravado, era render.

Regressão coberta por `src/components/activities/__tests__/LeadFunnelProgressBar.processId-obrigatorio.test.ts`, que varre o `src/` e exige `processId` em todo ponto de montagem da barra que não seja o funil do lead (`origemDoPop="lead"`).

**Não são bug** (conferidos no mesmo caso, para não virarem chamado de novo): o chip *"há N sem andamento efetivo"* lê `lead_processes.data_ultima_movimentacao` (`ActivitiesPage.tsx:6136-6139`) e o *"Atualizado dd/MM HH:mm"* lê `leads.updated_at` (`:6239`) — nenhum dos dois é o progresso do POP, e por isso não mudam quando ele muda.

### A faixa de marcos do cabeçalho lia a régua errada

`ProcessMarcosInline` (só usado no cabeçalho da atividade) lia `process_movements` — as **12 estações**, a régua antiga, que na prática só cobre o trabalhista. Em previdenciário ela está vazia: o cabeçalho dizia *"Nenhum marco registrado neste processo ainda"* no mesmo lugar em que a barra logo abaixo mostrava 40% pela régua do POP. Passou a ler `useProcessoMarcos` primeiro (marcos previstos: obrigatório sempre, eventual só quando aconteceu, estado que `atravessa_fases` fora) e só cai nas 12 estações quando a régua do POP não tem nada.

### O que a captura automática já cobre neste POP

Conferido no banco em 30/08/2026 — a régua previdenciária **já é** preenchida sozinha, como no trabalhista (migration `20260814130000`):

| sinal | BPC JUDICIAL | POP - BPC - Administrativo |
|---|---|---|
| `tpu` (DataJud) | 33 | 33 |
| `texto` (Escavador) | 10 | 10 |
| `documento` (título em `jm_documentos`) | 7 | 7 |
| `grau` | 2 | 2 |
| `email` (INSS) | — | 6 |

O caminho do documento anexado à mão existe ponta a ponta: `usePecasDoProcesso.anexar` grava em `jm_documentos`, `vincularAMarco` escreve `marco_chave`, e `vw_pop_marcos_detectados` casa por `d.marco_chave = pm.chave` (ou pelo padrão do título quando `marco_chave` é null) — `useProcessoMarcos.rematerializar` atualiza a régua na hora, sem esperar o tick.

**Limites medidos, não estimados** (30/08/2026):
- `jm_documentos` tem 5.113 `escavador_publico` + 559 `escavador_autos` + **1 `manual`**, e **0 linhas com `marco_chave`** — o vínculo manual nunca foi usado em produção.
- O processo acima tem **0 documentos** baixados: por isso só o sinal de texto disparou.
- A régua previdenciária **não tem marco de contestação/réplica nem de liquidação** (planilha, comprovante). Os sinais de `documento` cobrem laudo pericial, sentença, acórdão, certidão de trânsito, IDPJ, recuperação judicial e penhora negativa. Enquanto não existir marco para elas, anexar a planilha de liquidação não move percentual nenhum — é configuração de POP a decidir, não código.

---

## Só marcos, só Escavador, percentual por posição (02/09/2026)

Três decisões do usuário, tomadas sobre o caso 60 (`0100419-74.2021.5.01.0281`), que mudam a régua de todos os POPs. Todas medidas no banco antes de aplicar; migrations `20260902140000` a `20260902170000` no Externo.

**1. O DataJud saiu da régua.** A régua dizia "Embargos de declaração (2º grau) · 15/12/2025" enquanto o Escavador mostrava RR juntado em 17/07, concluso para admissibilidade em 12/08 e remessa à CREC em 24/08. O DataJud daquele processo tinha parado em 12/06 e a cadeia recursal só tinha sinal `tpu`. Decisão: *"retire o DataJud, ele só atrapalha, é mais informação só fazendo zoada"*. `vw_pop_marcos_detectados` passou a ler só documento; os 354 sinais `tpu` foram removidos (backup `zz_pop_marco_sinais_tpu_bkp_20260902`). Medido: 73 trabalhistas ficariam sem régua e 126 voltariam de marco — o usuário aceitou. Para compensar entrou o **feed `process_updates`** como fonte de texto (`vw_pop_marcos_feed`: monitoramento do Escavador + push por e-mail do tribunal, sem o teto de 20 movimentações): 73 processos ganharam marco por ele. Resultado líquido: processos com marco foram de 1.341 para 1.330. `jm_movimentos` continua alimentado — a jurimetria (`vw_jm_*`) lê de lá.

**2. Percentual = posição do marco atual ÷ marcos posicionais do POP.** Antes era "cumpridos ÷ previstos" (obrigatório + eventual que aconteceu), e 184 processos trabalhistas mostravam 80%+ sem ter transitado — o dinheiro está depois do trânsito. Agora *"todos os marcos são obrigatórios; o que não se aplica conta como superado"*: `pop_processo_regua` devolve `previstos` = total posicional e `cumpridos` = posição, terminal atingido = 100, nenhum marco = null (a ficha cai nos passos). Média do trabalhista caiu de 44,1% para 37,0%. A barra, a faixa do cabeçalho e a mensagem ao cliente dizem **"marco 11 de 24"** e os segmentos são todos os marcos posicionais (`LeadFunnelProgressBar.tsx`, `ProcessMarcosInline.tsx`, `buildActivityMessage.ts`).

**3. Não existem mais fases, só marcos.** Objetivos e passos moram no marco. Trabalhista: saíram `pericia` (o usuário não a quis na régua de 24), `remessa_stf` e `decisao_stf` → 24 marcos = 24 stages. BPC: 5 fases viraram **26 stages, um por marco posicional** (`m_<chave>`), com dois marcos novos sem detecção automática (`triagem`, `saneamento_cadunico`); os 21 objetivos foram redistribuídos pelo marco que o trâmite pede (mapa em `zz_bpc_mapa_objetivos_20260902`) e as 9.486 instâncias de checklist acompanharam por UPDATE — passo marcado continua marcado. Os 13 marcos que ficaram sem objetivo ganharam objetivo e passos de boas práticas (conferir a decisão → agir no prazo → comunicar o cliente → atualizar o recebível), e "Definição da Estratégia" do trabalhista deixou de ter zero passos. `kanban_boards.stages` continua existindo porque ranking, telão e checklists leem dele, mas é **gerado dos marcos** — ninguém edita fase.

**Junto**: sinais de texto para `admissibilidade_rr` e `agravo_instrumento` (RR juntado, concluso para admissibilidade, remessa à CREC — calibrados contra 553 processos, a admissibilidade do Recurso *Ordinário* ficou de fora de propósito); a carteira judicial inteira (1.083 trabalhistas + 367 BPC com número) foi reconsultada no Escavador por uma fila temporária em pg_cron (`zz_backfill_escavador_fila_20260902`, um lote de 25 a cada 2 min pela edge `backfill-process-marcos`).

Caso 60 depois de tudo: **Admissibilidade do RR · 17/07/2026 · marco 11 de 24 · 46%**.

## Prazo se cumpre, não se reagenda (31/08/2026)

Três regras nascidas do caso `1017247-47.2025.4.01.3100` (prazo real 16/07 no título da atividade, deadline manual em 31/07, réplica protocolada 03/08 — e o prazo do robô criado 53 dias depois com título errado):

1. **Detector de prazo consertado** (`_shared/escavadorCompromissos.ts`, testes em `src/lib/__tests__/escavadorCompromissos.test.ts`): reconhece o formato `Prazo: 5 dias` / `Prazo: 5 (cinco) dias úteis` dos atos ordinatórios do PJe (antes só "prazo **de** N dias"); e o alvo do título é o que a intimação **manda fazer** (o trecho após "manifestar/impugnar"), nunca a lista genérica "ato ordinatório / despacho / decisão / sentença" do cabeçalho da secretaria — era ela que rotulava intimação de contestação como "providência sobre sentença".
2. **Deadline = compromisso − 3 dias** (`sync-process-compromissos` v24, substitui a regra de 29/07): a tarefa nasce datada três dias antes do fim do prazo (dias corridos — piso conservador) ou da audiência/perícia, nunca antes de hoje; `notification_date` continua hoje. **Prazo que chega já estourado (até 15 dias) vira tarefa urgente** com aviso 🚨, em vez de ser descartado — prazo vencido calado é o pior caso. Audiência/perícia passada segue descartada. Dedupe por hash não mudou: nada recriado retroativamente.
3. **Trava no banco** (trigger `lead_activities_prazo_nao_reagenda`, migration `20260831130000`): atividade `activity_type='prazo'` (robô ou manual) só aceita deadline andando **para trás**; adiar ou apagar a data levanta exceção com a mensagem da regra. Prazo novo de verdade (nova intimação) = atividade nova. Rollback: drop do trigger.

Junto com o radar de processos quietos (`docs/sistema/processual.md`), é a resposta ao "como não perder mais prazo": capturar cedo (radar), datar certo e cedo (−3 dias), nunca adiar (trigger), e nunca morrer calado (vencido vira urgente).

---

## Campeonato de Engajamento — `/leaderboard`

Ranking semanal de engajamento (Menção = 5 pts; Comentário = 2 pts). Página de consulta, sem ações.

---

## Destaques — `/destaques`

Mural "Top 5 de Avaliação" — ranqueia responsáveis pela média de estrelas dos feedbacks de clientes. Período "Últimos 30 dias"/"Tudo", "Atualizar", "Modo TV" (auto-atualiza a cada 90s).
