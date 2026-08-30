/**
 * Montagem da mensagem da atividade (WhatsApp: "Copiar" / "Enviar ao Grupo" /
 * "Enviar ao Assessor" / áudio TTS).
 *
 * Vivia dentro da ActivitiesPage, o que deixava o `ActivityFullSheet` (usado por
 * chat, lead, caso, processo) SEM os botões de mensagem — dois comportamentos
 * pro mesmo formulário. Agora é uma função pura, com a mesma lógica, usada pelos
 * dois. Regra do projeto: formulário de atividade é UM só, completo em toda tela.
 */
import { format, parseISO } from 'date-fns';
import { detectClientPolo } from '@/utils/clientPoloDetection';
import { calculateHierarchicalProgress } from './progress/calculateHierarchicalProgress';

type StepContextLike = {
  stageId?: string | null;
  templateId?: string | null;
  stepId?: string | null;
  stepLabel?: string | null;
  phaseLabel?: string | null;
  objectiveLabel?: string | null;
  allSteps?: { stepId: string; phaseId: string; templateId: string; stepLabel: string; checked: boolean }[];
  /** Fases do board na ordem projetada — denominador do progresso hierárquico. */
  phases?: { id: string; name: string }[];
} | null | undefined;

/**
 * Desfecho do requerimento INSS do caso — o que o POP não sabe.
 *
 * O progresso da mensagem sai dos checklists do POP, que medem execução
 * INTERNA e seguem andando depois de o INSS decidir. Medição de 26/08/2026:
 * em 30 dias, 36 dos 139 requerimentos que receberam "Progresso do caso: X%"
 * no grupo já estavam concluídos no INSS quando a mensagem saiu — 33 deles
 * indeferidos, com atraso de até 26 dias. Em 31 dos 33 não existia nem
 * atividade avisando o indeferimento: quem mandou não tinha como saber.
 */
export interface InssDesfechoCaso {
  /** Há desfecho no INSS e nenhum requerimento em andamento. */
  encerrado: boolean;
  resultado: 'deferido' | 'indeferido' | 'arquivado_decurso' | null;
  requerimento: string | null;
  /** Requerimentos do caso ainda sem desfecho. */
  emAndamento: number;
}

export interface ActivityMessageContext {
  formTitle: string;
  formDeadline: string;
  formNotificationDate: string;
  /** `HH:mm` da notificação. Vazio ou '00:00' = sem hora definida. */
  formNotificationTime?: string;
  formWhatWasDone: string;
  formCurrentStatus: string;
  formNextSteps: string;
  formSolicitacao: string;
  formRespostaJuizo: string;
  formNotes: string;
  formAssignedToName: string;
  formCoAssignees: { user_id: string; full_name: string }[];
  formIsSystem: boolean;
  formClientNameOverride: string;
  formLeadName: string;
  formCaseTitle: string;
  formProcessId: string;
  formProcessTitle: string;
  fieldSettings: { field_key: string; label: string; include_in_message?: boolean }[];
  selectedActivity: any;
  caseProcesses: any[];
  stepContext: StepContextLike;
  /**
   * Fallback de fase/progresso para caso SEM POP (linha do trem do processo —
   * src/lib/processFaseAtual.ts). Só é usado quando stepContext não trouxe
   * etapa nem passos; nunca sobrepõe o POP.
   */
  faseProcessual?: { faseLabel: string | null; posicao: number; total: number } | null;
  /**
   * Régua de marcos do processo (hook useProcessoMarcos / RPC
   * `pop_processo_regua`) — a MESMA que a barra da ficha mostra.
   *
   * Andamento e trabalho são duas medidas com donos diferentes: a régua diz
   * onde o processo está, lida das movimentações, dos documentos e do e-mail;
   * o checklist diz o que a equipe executou. Quem vai ao cliente é o
   * andamento — foi a decisão de 12/08/2026 para a ficha, e a mensagem tinha
   * ficado de fora dela, anunciando percentual de passo marcado à mão.
   */
  regua?: {
    percentual: number | null; atualRotulo: string | null; atualData: string | null;
    previstos: number; cumpridos: number;
    /** Marcos já atingidos, na ordem da régua — vira o "O que foi feito" quando o campo está vazio. */
    atingidos?: { rotulo: string; data: string | null }[];
    /** Próximo marco obrigatório pendente — vira o "Próximo passo" quando o campo está vazio. */
    proximoRotulo?: string | null;
  } | null;
  leadPreview: { board_id?: string | null } | null;
  systemOabs: any;
  currentUserId: string | null;
  /** Resolve nome do usuário (cloud ou ext) — cada tela tem sua lista de membros. */
  resolveUserName: (userId: string | null) => string | null;
  /** Template salvo pro board/fluxo (hook useActivityMessageTemplates). */
  getTemplateForContext: (boardId?: string) => string | undefined;
  /** Desfecho do requerimento INSS do caso (hook useInssDesfechoCaso). */
  inssDesfecho?: InssDesfechoCaso | null;
}

export function extractClientFirstName(raw: string): string {
  if (!raw) return '';
  const titleCase = (w: string) =>
    w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '';
  const lower = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  const formatTokens = (tokens: string[]) =>
    tokens
      .map((w, i) => (i > 0 && lower.has(w.toLowerCase()) ? w.toLowerCase() : titleCase(w)))
      .join(' ')
      .trim();
  const isMeaningful = (str: string) => /\p{L}{2,}/u.test(str);

  let s = raw.trim().replace(/^[^\p{L}\p{N}]+/u, '');

  // Padrão esperado: "Cidade/Estado | Vítima x Empresa | (data) - lesão"
  // Procura o segmento que contém " x " (vítima x empresa) e pega a parte antes do " x ".
  if (s.includes('|')) {
    const segments = s.split('|').map(p => p.trim()).filter(Boolean);
    const victimSeg = segments.find(seg => / x /i.test(seg));
    if (victimSeg) {
      s = victimSeg.split(/ x /i)[0].trim();
    } else {
      // Sem "x": tenta o segundo segmento (após cidade/estado), senão o primeiro com letras
      s = segments[1] && isMeaningful(segments[1]) ? segments[1] : (segments.find(isMeaningful) || segments[0] || '');
    }
  }

  // Limpa códigos iniciais tipo "PREV", "123", "PREV291"
  let tokens = s.split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    const t = tokens[0];
    const looksLikeCode = /^[A-Z]{2,}$/.test(t) || /^\d+$/.test(t) || /^[A-Z]{2,}\d+$/.test(t);
    if (looksLikeCode) tokens.shift(); else break;
  }

  const result = formatTokens(tokens);
  // Se sobrou algo sem letras (ex: ".", "-"), retorna vazio para o caller decidir o fallback
  return isMeaningful(result) ? result : '';
}

/** Texto limpo pra mensagem: preserva quebras de <br>/<p>/<li> e decodifica entidades. */
export function stripHtmlForMessage(html: string): string {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
}

/**
 * Marco → linguagem de gente. O rótulo do marco é vocabulário de advogado
 * ("réplica", "trânsito em julgado", "RPV") e a mensagem do CLIENTE precisa
 * ser entendida por qualquer leigo (pedido do usuário, 30/08). O assessor
 * continua recebendo o rótulo técnico. Chave = rótulo normalizado (minúsculo);
 * rótulo fora do mapa sai como está — nunca inventa tradução.
 */
const MARCO_HUMANO: Record<string, string> = {
  'pré-processual': 'preparação do processo',
  'ajuizamento': 'o processo deu entrada na Justiça',
  'ajuizamento / distribuição': 'o processo deu entrada na Justiça',
  'saneamento': 'o juiz organizou o processo para julgamento',
  'audiência inicial': 'audiência de conciliação',
  'audiência inicial / conciliação': 'audiência de conciliação',
  'audiência de conciliação': 'audiência de conciliação',
  'perícia': 'avaliação com o perito da Justiça',
  'perícia médica': 'avaliação com o médico perito da Justiça',
  'estudo social': 'visita da assistente social da Justiça',
  'audiência de instrução': 'audiência com o juiz',
  'contestação do inss': 'o INSS apresentou a defesa dele',
  'contestação do réu': 'a outra parte apresentou a defesa dela',
  'réplica à contestação': 'nossa resposta à defesa foi protocolada',
  'sentença': 'decisão do juiz (sentença)',
  'sentença (1º grau)': 'decisão do juiz (sentença)',
  'embargos de declaração': 'pedido de esclarecimento da decisão',
  'embargos de declaração (1º grau)': 'pedido de esclarecimento da decisão',
  'embargos de declaração (2º grau)': 'pedido de esclarecimento da decisão',
  'remessa ao 2º grau': 'o processo subiu para a 2ª instância',
  'subida ao 2º grau': 'o processo subiu para a 2ª instância',
  'acórdão (2º grau)': 'decisão da 2ª instância',
  'remessa à instância superior': 'o processo subiu para um tribunal superior',
  'subida ao tst / stj': 'o processo subiu para um tribunal superior',
  'remetido ao tst': 'o processo subiu para o TST',
  'remetido ao stj': 'o processo subiu para o STJ',
  'remetido ao stf': 'o processo subiu para o STF',
  'decisão superior (stj/tnu/stf)': 'decisão de tribunal superior',
  'decisão tst / stj': 'decisão de tribunal superior',
  'decisão do stj (resp)': 'decisão do STJ',
  'decisão do stf': 'decisão do STF',
  'acórdão do tst': 'decisão do TST',
  'admissibilidade do recurso de revista': 'recurso em análise no tribunal',
  'admissibilidade do rr': 'recurso em análise no tribunal',
  'agravo de instrumento em rr': 'recurso em análise no tribunal',
  'agravo interno': 'recurso em análise no tribunal',
  'recurso extraordinário (stf)': 'recurso em análise no STF',
  'trânsito em julgado': 'decisão final — não cabe mais recurso',
  'execução / cumprimento': 'começou a fase de receber o que foi ganho',
  'execução iniciada': 'começou a fase de receber o que foi ganho',
  'execução / cumprimento iniciado': 'começou a fase de receber o que foi ganho',
  'liquidação': 'cálculo dos valores a receber',
  'liquidação / cálculos': 'cálculo dos valores a receber',
  'liquidação iniciada': 'cálculo dos valores a receber',
  'implantação do benefício': 'o benefício foi ativado pelo INSS',
  'rpv / precatório expedido': 'o pagamento foi requisitado à Justiça',
  'alvará expedido': 'a autorização de saque foi emitida',
  'levantamento / pagamento': 'pagamento recebido',
  'pagamento espontâneo': 'pagamento recebido',
  'constrição / penhora': 'bloqueio de bens do devedor',
  'arquivamento definitivo': 'processo encerrado e arquivado',
  'requerimento protocolado (inss)': 'o pedido foi protocolado no INSS',
  'em análise no inss': 'o pedido está em análise no INSS',
  'benefício concedido pelo inss': 'o benefício foi aprovado pelo INSS',
  'indeferimento do inss': 'o pedido foi negado pelo INSS',
  'exigência do inss': 'o INSS pediu documentos complementares',
};

/** Versão leiga do marco para a mensagem do cliente. Fora do mapa, sai o rótulo. */
export function humanizaMarco(rotulo: string | null | undefined): string {
  if (!rotulo) return '';
  return MARCO_HUMANO[rotulo.trim().toLowerCase()] || rotulo;
}

// audience: 'client' (grupo do lead — padrão) ou 'assessor' (mensagem interna,
// endereçada ao(s) assessor(es) responsável(is) — usado quando não há lead).
const RESULTADO_INSS_LABEL: Record<string, string> = {
  deferido: 'DEFERIDO',
  indeferido: 'INDEFERIDO',
  arquivado_decurso: 'ARQUIVADO por prazo',
};

export function buildActivityMessage(
  ctx: ActivityMessageContext,
  audience: 'client' | 'assessor' = 'client',
): string {
  const {
    formTitle, formDeadline, formNotificationDate, formNotificationTime,
    formWhatWasDone, formCurrentStatus, formNextSteps, formSolicitacao, formRespostaJuizo, formNotes,
    formAssignedToName, formCoAssignees, formIsSystem, formClientNameOverride, formLeadName,
    formCaseTitle, formProcessId, formProcessTitle,
    fieldSettings, selectedActivity, caseProcesses, stepContext, faseProcessual, regua, leadPreview, systemOabs,
    currentUserId, resolveUserName, getTemplateForContext, inssDesfecho,
  } = ctx;
  const stripHtml = stripHtmlForMessage;
    const joinNames = (names: string[]) =>
      names.length <= 1 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
    // Hora do aviso: '00:00' é a convenção de "sem hora" (as 22.247 linhas
    // anteriores a 25/08/2026 não tinham como guardar hora nenhuma).
    const notifHora = formNotificationTime && formNotificationTime !== '00:00'
      ? formNotificationTime.slice(0, 5)
      : '';
    // Só a data por extenso — usada na frase de retorno, que emenda a hora (ou
    // "até o final do dia") logo depois e não pode repetir o horário.
    const notifDateOnly = formNotificationDate ? (() => {
      const d = parseISO(formNotificationDate.slice(0, 10));
      const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
      return `${format(d, 'dd/MM/yyyy')} ${dias[d.getDay()]}`;
    })() : '';
    // Data completa para exibição (linha "*Notificação:*" e {{data_retorno}}).
    const notifDate = notifDateOnly
      ? (notifHora ? `${notifDateOnly}, às ${notifHora}` : notifDateOnly)
      : '';
    const valueMap: Record<string, string> = { what_was_done: stripHtml(formWhatWasDone), current_status: stripHtml(formCurrentStatus), next_steps: stripHtml(formNextSteps), solicitacao: stripHtml(formSolicitacao), resposta_juizo: stripHtml(formRespostaJuizo), notes: stripHtml(formNotes) };
    // Campo vazio não vira seção sumida: quando há régua, "Como está?",
    // "O que foi feito?" e "Próximo passo" saem dos MARCOS detectados
    // (movimentações e documentos reais — nada inventado). Texto digitado pelo
    // assessor sempre vence; isto só cobre o vazio (pedido do usuário, 30/08:
    // atividade automática saía sem nenhuma das três seções).
    if (regua && regua.percentual != null) {
      const dataBR = (d?: string | null) => (d ? format(parseISO(d.slice(0, 10)), 'dd/MM/yyyy') : '');
      const marcoAtualTxt = regua.atualRotulo
        ? `"${regua.atualRotulo}"${regua.atualData ? ` em ${dataBR(regua.atualData)}` : ''}`
        : '';
      if (!valueMap.current_status.trim() && regua.atualRotulo) {
        valueMap.current_status = `O processo está andando normalmente. A novidade mais recente: ${humanizaMarco(regua.atualRotulo)}${regua.atualData ? `, em ${dataBR(regua.atualData)}` : ''}.`;
      }
      if (!valueMap.what_was_done.trim() && (regua.atingidos?.length || 0) > 0) {
        const lista = (regua.atingidos || [])
          .map(a => `${humanizaMarco(a.rotulo)}${a.data ? ` (${dataBR(a.data)})` : ''}`)
          .join('; ');
        valueMap.what_was_done = `Até aqui o processo já passou por: ${lista}.`;
      }
      if (!valueMap.next_steps.trim()) {
        valueMap.next_steps = regua.proximoRotulo
          ? `Agora aguardamos a próxima etapa: ${humanizaMarco(regua.proximoRotulo)}. Estamos de olho em cada movimentação e avisamos assim que houver novidade.`
          : 'Seguimos de olho em cada movimentação e avisamos assim que houver novidade.';
      }
    }
    // Campos que NUNCA vão pra mensagem copiada/enviada, mesmo que o usuário marque include_in_message.
    // resposta_juizo é conteúdo interno (uso da equipe), não deve ir pro cliente.
    const EXCLUDED_FROM_MESSAGE = new Set(['resposta_juizo']);
    const fieldLines = fieldSettings
      .filter(f => f.include_in_message && !EXCLUDED_FROM_MESSAGE.has(f.field_key))
      .map(f => ({ label: f.label, value: (valueMap[f.field_key] || '').trim() }))
      .filter(({ value }) => value.length > 0)
      .map(({ label, value }) => `*${label}:* ${value}`)
      .join('\n\n');
    const createdByName = selectedActivity ? resolveUserName(selectedActivity.created_by) : resolveUserName(currentUserId);
    const createdAtFmt = selectedActivity ? format(parseISO(selectedActivity.created_at), "dd/MM/yyyy 'às' HH:mm") : format(new Date(), "dd/MM/yyyy 'às' HH:mm");
    const updatedByName = selectedActivity ? resolveUserName((selectedActivity as any).updated_by) : null;
    const updatedAtFmt = selectedActivity?.updated_at && selectedActivity.updated_at !== selectedActivity.created_at ? format(parseISO(selectedActivity.updated_at), "dd/MM/yyyy 'às' HH:mm") : null;
    // Tempo dedicado NÃO vai mais em nenhuma mensagem (copiada ou enviada) —
    // decisão jul/2026. O tempo continua visível no editor (badge da ficha).
    // Link SÓ na mensagem ao assessor. Na mensagem de cliente (Copiar com lead,
    // Enviar ao Grupo e áudio TTS) ele não abre — /?openActivity= exige sessão —
    // então virava ruído no grupo do cliente e ainda expunha o id interno da
    // atividade. Decisão do usuário em 25/08/2026. Nos ramos abaixo isto deixa
    // `{{link_atividade}}` renderizando vazio e desliga a auto-injeção do link.
    const activityLink = (audience === 'assessor' && selectedActivity)
      ? `🔗 Ver atividade: ${window.location.origin}/?openActivity=${selectedActivity.id}`
      : '';
    const updatedInfo = updatedByName && updatedAtFmt ? `\n*Última atualização por:* ${updatedByName} em ${updatedAtFmt}` : '';
    const buildReturnDateLine = (responsavelDr: string) => {
      if (!notifDateOnly) return '';
      const subject = responsavelDr ? `${responsavelDr} voltará` : 'Retornaremos';
      const quando = notifHora ? `às ${notifHora}` : 'até o final do dia';
      return `*${subject} com mais informações no dia ${notifDateOnly}, ${quando}.*`;
    };

    // Linked process info — "Referente ao processo n° "X" de "Y""
    // Cai para formProcessTitle quando caseProcesses ainda não carregou (atividade sem case_id).
    const linkedProcessForMsg = formProcessId ? caseProcesses.find(p => p.id === formProcessId) : null;
    const procNumberForMsg = linkedProcessForMsg?.process_number || '';
    const procTitleForMsg = linkedProcessForMsg?.title || formProcessTitle || '';
    const processInfo = (procNumberForMsg || procTitleForMsg)
      ? `Referente ao processo n° "${procNumberForMsg || '—'}" de "${procTitleForMsg || '—'}"`
      : '';

    const envolvidos = (linkedProcessForMsg?.envolvidos as any[]) || [];
    // Qual polo é o NOSSO cliente:
    //   1) marcação manual no cadastro (cliente_polo)
    //   2) auto-detecção: advogado de uma parte tem OAB de um usuário do sistema
    //   3) padrão ATIVO (autor) — caso mais comum.
    const clientePolo = (linkedProcessForMsg as any)?.cliente_polo
      || detectClientPolo(envolvidos, systemOabs)
      || 'ATIVO';
    // Nomes das PARTES (não advogados) do polo do cliente.
    const isParte = (e: any) => e && e.nome && !/advog/i.test(String(e.tipo || e.tipo_normalizado || ''));
    let processClientNames: string[] = envolvidos
      .filter((e: any) => isParte(e) && e.polo === clientePolo)
      .map((e: any) => String(e.nome));
    // Sem envolvidos estruturados: cai para o título do polo (polo_ativo/polo_passivo).
    if (processClientNames.length === 0) {
      const poloTitle = clientePolo === 'PASSIVO'
        ? (linkedProcessForMsg as any)?.polo_passivo
        : (linkedProcessForMsg as any)?.polo_ativo;
      if (poloTitle) processClientNames = [String(poloTitle)];
    }

    // Nome exibido na saudação ao CLIENTE: só o PRIMEIRO NOME da parte cliente.
    // Prioridade: override manual > 1ª parte do polo do cliente > nome do lead.
    // NUNCA cai no nome do assessor — se nada retornar, deixa vazio e a saudação
    // renderiza sem nome (evita o bug de "Bom dia, Dr(a). <nome do acolhedor>").
    const rawClientCandidate = formClientNameOverride
      || (processClientNames.length > 0 ? processClientNames[0] : '')
      || formLeadName
      || '';
    const clientDisplayName = extractClientFirstName(rawClientCandidate);

    // Workflow do processo (etapa / objetivo / passo atual) — vem do checklist do lead (stepContext).
    const wfPhase = stepContext?.phaseLabel || '';
    const wfObjective = stepContext?.objectiveLabel || '';
    const wfStep = stepContext?.stepLabel || '';
    // Sem POP (nem etapa, nem objetivo, nem passo): cai na fase da linha do trem
    // do processo, quando houver marco. Sem marco nenhum, o bloco some inteiro —
    // linha "Etapa: —" nunca vai pro cliente.
    const workflowInfo = (wfPhase || wfObjective || wfStep)
      ? [
          wfPhase && `*Etapa:* ${wfPhase}`,
          wfObjective && `*Objetivo:* ${wfObjective}`,
          wfStep && `*Passo atual:* ${wfStep}`,
        ].filter(Boolean).join('\n')
      : (faseProcessual?.faseLabel ? `*Fase processual:* ${faseProcessual.faseLabel}` : '');

    // Progresso em 3 níveis a partir do checklist do fluxo:
    //   Fase (stage do kanban) → Objetivo (template de checklist) → Passo (item).
    // headline = só a % geral (mensagem do CLIENTE — evita jargão interno).
    // full = quebra completa (mensagem ao ASSESSOR e painel). Vazio sem checklist.
    const progress = (() => {
      // O INSS já decidiu: nenhum número de progresso vai pro cliente. Dizer
      // "Progresso do caso: 29%" a quem teve o pedido negado é informar o
      // contrário do que aconteceu — e o desfecho tem mensagem própria, não se
      // dá essa notícia de esguelha no meio de uma atividade. O assessor recebe
      // o alerta no lugar do detalhe.
      if (inssDesfecho?.encerrado) {
        const rotulo = RESULTADO_INSS_LABEL[inssDesfecho.resultado || ''] || 'concluído';
        const req = inssDesfecho.requerimento ? ` ${inssDesfecho.requerimento}` : '';
        return {
          headline: '',
          full: `*⚠️ Requerimento${req} está ${rotulo} no INSS* — progresso do POP omitido na mensagem ao cliente.`,
        };
      }
      // ANDAMENTO vem primeiro: é a régua de marcos, a mesma medida da barra da
      // ficha. Só quando ela não tem marco nenhum a mensagem cai no que a
      // equipe executou. Nunca as duas — "40% pela régua" e "61% pelos passos"
      // são dois números certos que, juntos, viram uma tela mentindo.
      if (regua && regua.percentual != null) {
        const dataMarco = regua.atualData ? ` em ${format(parseISO(regua.atualData.slice(0, 10)), 'dd/MM/yyyy')}` : '';
        // Cliente lê a versão leiga; o detalhe do assessor fica técnico.
        const marcoCliente = regua.atualRotulo ? `${humanizaMarco(regua.atualRotulo)}${dataMarco}` : null;
        const marco = regua.atualRotulo ? `${regua.atualRotulo}${dataMarco}` : null;
        const linha = `*📊 Andamento do processo: ${Math.round(Number(regua.percentual))}% concluído*`;
        return {
          // "Marco atual", não "Etapa": a linha de *Etapa:* logo abaixo é a fase
          // do POP (o que a equipe faz). São duas coisas e têm dois nomes.
          headline: marcoCliente ? `${linha}\n*Marco atual:* ${marcoCliente}` : linha,
          full: [
            linha,
            marco && `• Marco atual: ${marco}`,
            `• Marcos: ${regua.cumpridos}/${regua.previstos} previstos para este processo`,
          ].filter(Boolean).join('\n'),
        };
      }

      const steps = stepContext?.allSteps || [];
      if (steps.length === 0) {
        // Sem checklist: usa a régua de marcos do processo, com rótulo próprio —
        // "andamento processual" não é a mesma medida que "progresso do caso".
        if (faseProcessual && faseProcessual.total > 0) {
          const linha = `*📊 Andamento processual: ${faseProcessual.posicao} de ${faseProcessual.total} etapas*`;
          return { headline: linha, full: linha };
        }
        return { headline: '', full: '' };
      }
      const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

      // MESMA CONTA DA BARRA da ficha (calculateHierarchicalProgress): cada
      // fase pesa igual, dentro dela cada objetivo pesa igual, dentro dele cada
      // passo pesa igual. Contar passo no plano dava outro número — fase com um
      // objetivo de um passo valia o mesmo que fase com três objetivos de três
      // passos — e o cliente lia um percentual que não batia com o da tela.
      const instanciasDoProgresso = (() => {
        const porObjetivo = new Map<string, { id: string; stage_id: string; items: { id: string; checked?: boolean }[] }>();
        for (const s of steps) {
          const chave = `${s.phaseId}|${s.templateId}`;
          if (!porObjetivo.has(chave)) porObjetivo.set(chave, { id: chave, stage_id: s.phaseId, items: [] });
          porObjetivo.get(chave)!.items.push({ id: s.stepId, checked: s.checked });
        }
        return Array.from(porObjetivo.values());
      })();
      // Fase sem objetivo instanciado também conta no denominador; sem a lista
      // de fases do board sobra só o que tem passo (mensagem antiga/salva).
      const phaseIdsDoBoard = stepContext?.phases?.length
        ? stepContext.phases.map((f) => f.id)
        : [...new Set(steps.map((s) => s.phaseId))];
      const overallPct = Math.round(
        calculateHierarchicalProgress(phaseIdsDoBoard, instanciasDoProgresso).globalPercent,
      );

      // Mesmo denominador do percentual: fase do board sem passo instanciado
      // conta como fase não concluída, não como fase inexistente.
      const phaseIds = phaseIdsDoBoard;
      const phasesDone = phaseIds.filter((pid) => {
        const ps = steps.filter((s) => s.phaseId === pid);
        return ps.length > 0 && ps.every((s) => s.checked);
      }).length;

      const curPhase = stepContext?.stageId;
      const phaseSteps = steps.filter((s) => s.phaseId === curPhase);
      const objIds = [...new Set(phaseSteps.map((s) => s.templateId))];
      const objDone = objIds.filter((tid) => {
        const os = phaseSteps.filter((s) => s.templateId === tid);
        return os.length > 0 && os.every((s) => s.checked);
      }).length;

      const curObj = stepContext?.templateId;
      const objSteps = phaseSteps.filter((s) => s.templateId === curObj);
      const objStepsDone = objSteps.filter((s) => s.checked).length;

      // "0% concluído" logo abaixo da saudação soa a caso parado. É o começo do
      // caminho, e o cliente merece ler isso em vez de um zero seco.
      const headline = overallPct === 0
        ? '*📊 Progresso do caso: estamos no comecinho (0% concluído)*'
        : `*📊 Progresso do caso: ${overallPct}% concluído*`;
      const full = [
        headline,
        `• Fases: ${pct(phasesDone, phaseIds.length)}% (${phasesDone}/${phaseIds.length})`,
        `• Objetivos (fase atual): ${pct(objDone, objIds.length)}% (${objDone}/${objIds.length})`,
        `• Passos (objetivo atual): ${pct(objStepsDone, objSteps.length)}% (${objStepsDone}/${objSteps.length})`,
      ].join('\n');
      return { headline, full };
    })();
    // Cliente vê só a manchete; assessor/painel veem o detalhe completo.
    const progressInfo = progress.headline;      // usado nas mensagens do cliente
    const progressDetail = progress.full;        // usado na mensagem ao assessor

    // Mensagem endereçada ao(s) ASSESSOR(es) responsável(is) — não usa template de cliente.
    if (audience === 'assessor') {
      const allAssessorNames = [formAssignedToName, ...formCoAssignees.map(c => c.full_name)].filter(Boolean);
      const assessorGreet = joinNames(allAssessorNames.map(n => `Dr(a). ${String(n).split(' ').slice(0, 2).join(' ')}`));
      const hourA = new Date().getHours();
      const saudA = hourA < 12 ? 'Bom dia' : hourA < 18 ? 'Boa tarde' : 'Boa noite';
      const header = `*${saudA}${assessorGreet ? `, ${assessorGreet}` : ''}!*`;
      const sysTag = formIsSystem ? '🤖 *Atividade interna (de equipe)* — sob sua responsabilidade.' : '';
      const prazoLine = formDeadline ? `*Prazo:* ${format(parseISO(formDeadline), 'dd/MM/yyyy')}` : '';
      const notifLine = notifDate ? `*Notificação:* ${notifDate}` : '';
      // Rastreabilidade: quem criou (e quando), última atualização e assinatura de
      // quem criou — para o assessor saber de onde veio a atividade.
      const authoriaLine = createdByName
        ? `*Atividade criada por:* ${createdByName} em ${createdAtFmt}${updatedInfo}`
        : (updatedInfo ? updatedInfo.trimStart() : '');
      const signature = createdByName ? `Com carinho,\n${createdByName} 💚` : '';
      return [
        header,
        sysTag,
        processInfo,
        `*Assunto da atividade:* ${formTitle.toUpperCase()}`,
        fieldLines,
        [prazoLine, notifLine].filter(Boolean).join('\n'),
        workflowInfo,
        progressDetail,
        authoriaLine,
        activityLink,
        signature,
      ].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    // Try to use a saved template for this board/workflow
    const boardId = leadPreview?.board_id || undefined;
    const template = getTemplateForContext(boardId);

    // Check if template has mustache-style variables
    if (template && template.includes('{{')) {
      // Build a context object for evaluating conditional expressions
      const responsavelDr = formAssignedToName
        ? `Dr. ${formAssignedToName.split(' ').slice(0, 2).join(' ')}`
        : '';
      const returnDateLine = buildReturnDateLine(responsavelDr);
      const _hour = new Date().getHours();
      const saudacao = _hour < 12 ? 'Bom dia' : _hour < 18 ? 'Boa tarde' : 'Boa noite';
      const tplVars: Record<string, string> = {
        saudacao,
        titulo: formTitle.toUpperCase(),
        lead_name: clientDisplayName,
        clientes_processo: processClientNames.join(', '),
        campos_dinamicos: fieldLines,
        responsavel: [formAssignedToName, ...formCoAssignees.map(c => c.full_name)].filter(Boolean).join(', '),
        responsavel_dr: responsavelDr,
        data_retorno: notifDate,
        linha_retorno: returnDateLine,
        criado_por: createdByName || '—',
        criado_em: createdAtFmt,
        atualizado_info: updatedInfo,
        // Mantido vazio (não removido) pra templates salvos com {{tempo_dedicado}}
        // renderizarem sem a linha em vez de cair no avaliador de expressão.
        tempo_dedicado: '',
        link_atividade: activityLink,
        what_was_done: valueMap.what_was_done || '—',
        current_status: valueMap.current_status || '—',
        next_steps: valueMap.next_steps || '—',
        notes: valueMap.notes || '—',
        case_number: formCaseTitle || '—',
        process_number: procNumberForMsg || formProcessTitle || '—',
        process_info: processInfo,
        etapa: wfPhase || faseProcessual?.faseLabel || '—',
        objetivo: wfObjective || '—',
        passo_atual: wfStep || '—',
        workflow_info: workflowInfo,
      };

      // Replace simple {{var}} first
      let result = template;
      for (const [key, val] of Object.entries(tplVars)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
      }

      // Evaluate conditional expressions like {{var ? 'text' + var : ''}}
      result = result.replace(/\{\{(.+?)\}\}/g, (_match, expr: string) => {
        try {
          // Create a function with template variables in scope
          const keys = Object.keys(tplVars);
          const values = Object.values(tplVars);
          const fn = new Function(...keys, `return (${expr});`);
          const evaluated = fn(...values);
          return evaluated != null ? String(evaluated) : '';
        } catch {
          return '';
        }
      });

      // Auto-inject processInfo if template doesn't reference it but a process is linked
      if (processInfo && !template.includes('process_info') && !result.includes('Referente ao processo')) {
        const lines = result.split('\n');
        // Insert after first non-empty line (greeting)
        let insertAt = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim()) { insertAt = i + 1; break; }
        }
        lines.splice(insertAt, 0, '', processInfo);
        result = lines.join('\n');
      }

      // Workflow (fase/objetivo/passo atual — o passo logo após o último concluído):
      // auto-injeta após o "Referente ao processo" quando o template não o referencia.
      if (workflowInfo && !template.includes('workflow_info')
          && !result.includes('*Passo atual:*') && !result.includes('*Fase processual:*')) {
        const lines = result.split('\n');
        const afterProc = lines.findIndex(line => line.includes('Referente ao processo'));
        const at = afterProc >= 0 ? afterProc + 1 : (() => {
          for (let i = 0; i < lines.length; i++) if (lines[i].trim()) return i + 1;
          return 0;
        })();
        lines.splice(at, 0, '', workflowInfo);
        result = lines.join('\n');
      }

      // Progresso (3 níveis): auto-injeta após o workflow/processo quando o
      // template não referencia {{progresso}} e há checklist.
      if (progressInfo && !template.includes('progresso')
          && !result.includes('Progresso do caso') && !result.includes('Andamento processual')) {
        const lines = result.split('\n');
        const anchor = lines.findIndex(line =>
          line.includes('*Passo atual:*') || line.includes('*Fase processual:*') || line.includes('Referente ao processo'));
        const at = anchor >= 0 ? anchor + 1 : (() => { for (let i = 0; i < lines.length; i++) if (lines[i].trim()) return i + 1; return 0; })();
        lines.splice(at, 0, '', progressInfo);
        result = lines.join('\n');
      }

      // Link da atividade: auto-injeta antes de "Estamos à disposição" quando a
      // atividade já existe e o template não referencia {{link_atividade}}.
      if (activityLink && !template.includes('link_atividade') && !result.includes('openActivity=')) {
        const lines = result.split('\n');
        const beforeSupport = lines.findIndex(line => line.includes('Estamos à disposição'));
        if (beforeSupport >= 0) lines.splice(beforeSupport, 0, activityLink, '');
        else lines.push('', activityLink);
        result = lines.join('\n');
      }

      // Assinatura carinhosa com o nome de quem CRIOU a atividade, ao final.
      if (createdByName && !result.includes('Com carinho')) {
        const lines = result.split('\n');
        const digiteIdx = lines.findIndex(line => line.includes('Digite 1'));
        const sig = `Com carinho,\n${createdByName} 💚`;
        if (digiteIdx >= 0) lines.splice(digiteIdx, 0, sig, '');
        else lines.push('', sig);
        result = lines.join('\n');
      }

      // Linha de retorno ("Dr. X voltará com mais informações no dia Y…"):
      // se há data de notificação, garante que ela apareça sempre — mesmo que o
      // template salvo não referencie {{linha_retorno}} nem {{data_retorno}}.
      // Injeta antes de "Estamos à disposição" (ou da assinatura, se não houver).
      if (returnDateLine && !result.includes(notifDateOnly)) {
        const lines = result.split('\n');
        const anchorIdx = lines.findIndex(line =>
          line.includes('Estamos à disposição') ||
          line.includes('Com carinho') ||
          line.includes('Digite 1'),
        );
        if (anchorIdx >= 0) lines.splice(anchorIdx, 0, '', returnDateLine, '');
        else lines.push('', returnDateLine);
        result = lines.join('\n');
      }

      return result
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // Fallback: hardcoded default
    const responsavelDrFb = formAssignedToName ? `Dr. ${formAssignedToName.split(' ').slice(0, 2).join(' ')}` : '';
    const clientFirstName = clientDisplayName;
    const hourFb = new Date().getHours();
    const saudacaoFb = hourFb < 12 ? 'Bom dia' : hourFb < 18 ? 'Boa tarde' : 'Boa noite';
    const greetingLine = clientFirstName
      ? `*${saudacaoFb} Sr(a). ${clientFirstName}*`
      : `*${saudacaoFb}*`;
    const linkLineFb = activityLink ? `\n\n${activityLink}` : '';
    const workflowLineFb = workflowInfo ? `\n\n${workflowInfo}` : '';
    const progressLineFb = progressInfo ? `\n\n${progressInfo}` : '';
    const signatureFb = createdByName ? `\n\nCom carinho,\n${createdByName} 💚` : '';
    return `${greetingLine}${processInfo ? `\n\n${processInfo}` : ''}${workflowLineFb}${progressLineFb}\n\n*Assunto da atividade:* ${formTitle.toUpperCase()}\n\n${fieldLines}\n\n${buildReturnDateLine(responsavelDrFb)}\n${linkLineFb}\n\nEstamos à disposição para quaisquer dúvidas.\n\n🚀Avante!${signatureFb}\n\nTem alguma dúvida ou precisa de uma explicação mais detalhada? Digite 1 . Se tudo está claro, digite 2.`;
}
