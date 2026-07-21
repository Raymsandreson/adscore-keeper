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

## Acompanhamento Processual — `/processual/acompanhamento`

**Propósito**: dashboard de eficiência do fluxo jurídico (dados do WhatsJUD): SLAs de tramitação por fase, latência de atualizações, transições de status, gargalo fechamento→protocolo e atividades atrasadas do dia.

- Abas de período "Hoje" / "Semana" / "Mês".
- "Relatório de Atividades" — produtividade por usuário (Diária/Semanal/Mensal), com relatório detalhado por pessoa.
- Filtros: Responsável, Ação (Petições/Audiências/Despachos/Publicações), Etiqueta.
- Ícone de atualizar — recarrega o dashboard.
- Painel "Atividades atrasadas — hoje": filtro por responsável, "Mostrar mais", clique na linha abre a atividade.

**Fluxo recomendado**: período Mês → ler SLAs e gargalo de protocolo por categoria → descer até as atividades atrasadas filtrando por responsável.

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
