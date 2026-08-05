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

type StepContextLike = {
  stageId?: string | null;
  templateId?: string | null;
  stepId?: string | null;
  stepLabel?: string | null;
  phaseLabel?: string | null;
  objectiveLabel?: string | null;
  /** De onde o fluxo veio: POP do processo, POP da própria atv ou funil do lead. */
  source?: 'processo' | 'atv' | 'funil' | null;
  allSteps?: { stepId: string; phaseId: string; templateId: string; stepLabel: string; checked: boolean }[];
} | null | undefined;

export interface ActivityMessageContext {
  formTitle: string;
  formDeadline: string;
  formNotificationDate: string;
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
  leadPreview: { board_id?: string | null } | null;
  systemOabs: any;
  currentUserId: string | null;
  /** Resolve nome do usuário (cloud ou ext) — cada tela tem sua lista de membros. */
  resolveUserName: (userId: string | null) => string | null;
  /** Template salvo pro board/fluxo (hook useActivityMessageTemplates). */
  getTemplateForContext: (boardId?: string) => string | undefined;
  /**
   * Tempo total cronometrado na atv (soma de active_seconds de todas as sessões,
   * hook useActivityTimeTotal). 0/undefined = não mostra a linha.
   */
  timeSpentSeconds?: number;
}

/**
 * Barra de progresso em 10 blocos para WhatsApp. Emoji quadrado em vez de
 * `█`/`░`: o WhatsApp não garante fonte monoespaçada e os blocos unicode saem
 * desalinhados (ou sem glifo) em parte dos Androids; emoji renderiza igual em
 * todo lugar. Arredonda pra cima a partir de 1% pra nunca mostrar barra vazia
 * em fluxo já iniciado.
 */
export function progressBar(pct: number): string {
  const CELLS = 10;
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = p === 0 ? 0 : Math.max(1, Math.round((p / 100) * CELLS));
  return '🟩'.repeat(filled) + '⬜'.repeat(CELLS - filled);
}

/** "1h 23min" / "45min" / "" quando não há tempo cronometrado. */
export function formatTempoDedicado(totalSeconds?: number | null): string {
  const s = Math.floor(totalSeconds || 0);
  if (s < 60) return '';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  return `${m}min`;
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

// audience: 'client' (grupo do lead — padrão) ou 'assessor' (mensagem interna,
// endereçada ao(s) assessor(es) responsável(is) — usado quando não há lead).
export function buildActivityMessage(
  ctx: ActivityMessageContext,
  audience: 'client' | 'assessor' = 'client',
): string {
  const {
    formTitle, formDeadline, formNotificationDate,
    formWhatWasDone, formCurrentStatus, formNextSteps, formSolicitacao, formRespostaJuizo, formNotes,
    formAssignedToName, formCoAssignees, formIsSystem, formClientNameOverride, formLeadName,
    formCaseTitle, formProcessId, formProcessTitle,
    fieldSettings, selectedActivity, caseProcesses, stepContext, leadPreview, systemOabs,
    currentUserId, resolveUserName, getTemplateForContext, timeSpentSeconds,
  } = ctx;
  const stripHtml = stripHtmlForMessage;
    const joinNames = (names: string[]) =>
      names.length <= 1 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
    const notifDate = formNotificationDate ? (() => {
      const d = parseISO(formNotificationDate);
      const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
      return `${format(d, 'dd/MM/yyyy')} ${dias[d.getDay()]}`;
    })() : '';
    const valueMap: Record<string, string> = { what_was_done: stripHtml(formWhatWasDone), current_status: stripHtml(formCurrentStatus), next_steps: stripHtml(formNextSteps), solicitacao: stripHtml(formSolicitacao), resposta_juizo: stripHtml(formRespostaJuizo), notes: stripHtml(formNotes) };
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
    // Tempo dedicado à atv (soma de todas as sessões do cronômetro). Voltou às
    // mensagens em ago/2026 a pedido do usuário — a decisão de jul/2026 tinha
    // tirado de todas. Sem tempo cronometrado (< 1min) a linha some.
    const tempoDedicado = formatTempoDedicado(timeSpentSeconds);
    const tempoLine = tempoDedicado ? `*⏱️ Tempo dedicado a esta atividade:* ${tempoDedicado}` : '';
    const activityLink = selectedActivity ? `🔗 Ver atividade: ${window.location.origin}/?openActivity=${selectedActivity.id}` : '';
    const updatedInfo = updatedByName && updatedAtFmt ? `\n*Última atualização por:* ${updatedByName} em ${updatedAtFmt}` : '';
    const buildReturnDateLine = (responsavelDr: string) => {
      if (!notifDate) return '';
      const subject = responsavelDr ? `${responsavelDr} voltará` : 'Retornaremos';
      return `*${subject} com mais informações no dia ${notifDate}, até o final do dia.*`;
    };

    // Processo vinculado. O nº vem SEMPRE do dado vivo (`lead_processes` via
    // caseProcesses); `formProcessTitle` é snapshot do momento da criação e em
    // 47% das atividades com processo não tem número nenhum (medido 05/08/2026:
    // 3.519 de 7.554 em 90 dias) — usar o snapshot como fonte do número fazia
    // sair `n° "—"`. E 52% dos processos (901 de 1.728) não têm número
    // cadastrado: aí a linha sai só com o título, sem o `n° "—"` que não
    // informa nada e assusta o cliente.
    const linkedProcessForMsg = formProcessId ? caseProcesses.find(p => p.id === formProcessId) : null;
    const procNumberForMsg = linkedProcessForMsg?.process_number?.trim() || '';
    const procTitleForMsg = (linkedProcessForMsg?.title || formProcessTitle || '').trim();
    const processInfo = procNumberForMsg
      ? `*Processo n° ${procNumberForMsg}*${procTitleForMsg ? ` — ${procTitleForMsg}` : ''}`
      : (procTitleForMsg ? `Referente ao processo "${procTitleForMsg}"` : '');

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
    const workflowInfo = (wfPhase || wfObjective || wfStep)
      ? [
          wfPhase && `*Etapa:* ${wfPhase}`,
          wfObjective && `*Objetivo:* ${wfObjective}`,
          wfStep && `*Passo atual:* ${wfStep}`,
        ].filter(Boolean).join('\n')
      : '';

    // Progresso em 3 níveis a partir do checklist do fluxo:
    //   Fase (stage do kanban) → Objetivo (template de checklist) → Passo (item).
    // headline = só a % geral (mensagem do CLIENTE — evita jargão interno).
    // full = quebra completa (mensagem ao ASSESSOR e painel). Vazio sem checklist.
    const progress = (() => {
      const steps = stepContext?.allSteps || [];
      if (steps.length === 0) return { headline: '', full: '' };
      const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

      const doneSteps = steps.filter((s) => s.checked).length;
      const overallPct = pct(doneSteps, steps.length);

      const phaseIds = [...new Set(steps.map((s) => s.phaseId))];
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

      // O rótulo segue a ORIGEM do fluxo (regra do usuário: "progresso do
      // processo ou do lead"). "atendimento" no lugar de "lead" porque a
      // mensagem do cliente não usa jargão interno.
      const label = stepContext?.source === 'processo' ? 'Progresso do processo'
        : stepContext?.source === 'atv' ? 'Progresso do POP'
        : 'Progresso do atendimento';
      const headline = [
        `*📊 ${label}*`,
        `${progressBar(overallPct)} ${overallPct}% concluído`,
      ].join('\n');
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

    // Atv com POP próprio e SEM processo vinculado: ela é a referência de
    // acompanhamento do passo a passo do POP, então o nº dela vai na mensagem
    // (mesmo código do link curto /atv/:code — 8 primeiros hex do UUID).
    const isPopReferenceActivity = stepContext?.source === 'atv' && !formProcessId;
    const atvRefNumber = selectedActivity ? String(selectedActivity.id).slice(0, 8) : '';
    const referenceInfo = isPopReferenceActivity && atvRefNumber && progressInfo
      ? `*🔖 Atividade de referência do POP:* nº ${atvRefNumber}`
      : '';

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
        progressDetail,
        workflowInfo,
        referenceInfo,
        tempoLine,
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
        tempo_dedicado: tempoLine,
        link_atividade: activityLink,
        what_was_done: valueMap.what_was_done || '—',
        current_status: valueMap.current_status || '—',
        next_steps: valueMap.next_steps || '—',
        notes: valueMap.notes || '—',
        case_number: formCaseTitle || '—',
        process_number: procNumberForMsg || formProcessTitle || '—',
        process_info: processInfo,
        etapa: wfPhase || '—',
        objetivo: wfObjective || '—',
        passo_atual: wfStep || '—',
        workflow_info: workflowInfo,
        // {{progresso}} existia na auto-injeção mas não como variável — template
        // salvo que a usasse caía no avaliador de expressão e vinha vazio.
        progresso: progressInfo,
        progresso_detalhado: progressDetail,
        atv_referencia: referenceInfo,
        atv_numero: atvRefNumber,
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

      // Detectores das linhas já presentes no resultado. O texto do processo e
      // do progresso é variável (com/sem nº, rótulo conforme a origem do
      // fluxo), então a âncora é por padrão, não por string fixa.
      const isProcLine = (l: string) => /^\*Processo n°|Referente ao processo/.test(l.trim());
      const isProgressTitle = (l: string) => /Progresso do (processo|POP|atendimento|caso)/.test(l);
      const isProgressBar = (l: string) => /[🟩⬜]{10}/.test(l);
      const firstContentIdx = (lines: string[]) => {
        for (let i = 0; i < lines.length; i++) if (lines[i].trim()) return i + 1;
        return 0;
      };
      /** Fim do bloco de progresso (a barra fica na linha seguinte ao título). */
      const progressEndIdx = (lines: string[]) => {
        const t = lines.findIndex(isProgressTitle);
        if (t < 0) return -1;
        return lines[t + 1] !== undefined && isProgressBar(lines[t + 1]) ? t + 1 : t;
      };

      // Processo: auto-injeta logo após a saudação.
      if (processInfo && !template.includes('process_info') && !result.split('\n').some(isProcLine)) {
        const lines = result.split('\n');
        lines.splice(firstContentIdx(lines), 0, '', processInfo);
        result = lines.join('\n');
      }

      // Progresso (título + barra) vem primeiro: visão macro antes do detalhe.
      if (progressInfo && !template.includes('progresso') && !result.split('\n').some(isProgressTitle)) {
        const lines = result.split('\n');
        const afterProc = lines.findIndex(isProcLine);
        const at = afterProc >= 0 ? afterProc + 1 : firstContentIdx(lines);
        lines.splice(at, 0, '', progressInfo);
        result = lines.join('\n');
      }

      // Fluxo (fase/objetivo/passo atual): detalha o que a barra resume, então
      // entra depois dela — e depois do processo quando não há progresso.
      if (workflowInfo && !template.includes('workflow_info') && !result.includes('*Passo atual:*')) {
        const lines = result.split('\n');
        const end = progressEndIdx(lines);
        const at = end >= 0
          ? end + 1
          : (() => { const i = lines.findIndex(isProcLine); return i >= 0 ? i + 1 : firstContentIdx(lines); })();
        lines.splice(at, 0, '', workflowInfo);
        result = lines.join('\n');
      }

      // Nº da atv de referência: cola logo abaixo da barra de progresso.
      if (referenceInfo && !template.includes('atv_referencia') && !result.includes('Atividade de referência')) {
        const lines = result.split('\n');
        const end = progressEndIdx(lines);
        if (end >= 0) {
          lines.splice(end + 1, 0, referenceInfo);
          result = lines.join('\n');
        }
      }

      // Tempo dedicado: depois do bloco de fluxo (ou do progresso/processo).
      if (tempoLine && !template.includes('tempo_dedicado') && !result.includes('Tempo dedicado')) {
        const lines = result.split('\n');
        const stepIdx = lines.findIndex(line => line.includes('*Passo atual:*'));
        const end = progressEndIdx(lines);
        const anchor = stepIdx >= 0 ? stepIdx + 1
          : end >= 0 ? end + 1
          : (() => { const i = lines.findIndex(isProcLine); return i >= 0 ? i + 1 : firstContentIdx(lines); })();
        lines.splice(anchor, 0, '', tempoLine);
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
      if (returnDateLine && !result.includes(notifDate)) {
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
    const referenceLineFb = referenceInfo ? `\n${referenceInfo}` : '';
    const tempoLineFb = tempoLine ? `\n\n${tempoLine}` : '';
    const signatureFb = createdByName ? `\n\nCom carinho,\n${createdByName} 💚` : '';
    return `${greetingLine}${processInfo ? `\n\n${processInfo}` : ''}${progressLineFb}${referenceLineFb}${workflowLineFb}${tempoLineFb}\n\n*Assunto da atividade:* ${formTitle.toUpperCase()}\n\n${fieldLines}\n\n${buildReturnDateLine(responsavelDrFb)}\n${linkLineFb}\n\nEstamos à disposição para quaisquer dúvidas.\n\n🚀Avante!${signatureFb}\n\nTem alguma dúvida ou precisa de uma explicação mais detalhada? Digite 1 . Se tudo está claro, digite 2.`;
}
