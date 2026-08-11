/**
 * Relatos de caso ouvidos em GRUPO de WhatsApp — tipos e regras puras.
 *
 * "Relato" é alguém contando, no meio de um grupo, um acidente, uma morte ou
 * um afastamento negado — dele ou de terceiro. Não é pendência (isso é
 * `clientCommitments`, promessa de cliente nosso) nem notícia (isso é a aba
 * /noticias, manchete de veículo). É gente falando de gente.
 *
 * Quem detecta é `railway-server/src/functions/detect-group-case-reports.ts`.
 * Aqui fica só o que dá para testar sem banco e sem React.
 */

export type ReportKind =
  | 'acidente_trabalho'
  | 'acidente_transito'
  | 'obito'
  | 'doenca_ocupacional'
  | 'outro';

/** 'novo' = esperando alguém olhar. Os outros dois já passaram por gente. */
export type ReportStatus = 'novo' | 'aproveitado' | 'descartado';

export interface GroupCaseReport {
  id: string;
  instance_name: string;
  group_phone: string;
  group_jid: string | null;
  group_name: string | null;
  reporter_phone: string | null;
  reporter_name: string | null;
  kind: ReportKind;
  headline: string;
  quote: string | null;
  details: string | null;
  source_message_id: string | null;
  message_at: string | null;
  victim_name: string | null;
  victim_is_reporter: boolean | null;
  accident_date: string | null;
  city: string | null;
  state: string | null;
  company: string | null;
  damage: string | null;
  dynamics_summary: string | null;
  ai_confidence: number | null;
  status: ReportStatus;
  lead_id: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface GroupWatch {
  id: string;
  instance_name: string;
  group_jid: string;
  group_phone: string;
  group_name: string | null;
  enabled: boolean;
  notify_user_ids: string[];
  created_by_name: string | null;
  created_at: string;
}

export const KIND_LABELS: Record<ReportKind, string> = {
  acidente_trabalho: 'Acidente de trabalho',
  acidente_transito: 'Acidente de trânsito',
  obito: 'Óbito',
  doenca_ocupacional: 'Doença / INSS',
  outro: 'Outro',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as ReportKind] || 'Outro';
}

/**
 * Dígitos do JID — é assim que `whatsapp_messages.phone` guarda grupo (o
 * webhook faz `raw.replace(/\D/g,'')` antes de gravar). Casar a tela com a
 * mensagem exige passar por aqui; comparar JID cru não acha nada.
 */
export function groupPhoneFromJid(jid: string): string {
  return String(jid || '').replace(/\D/g, '');
}

/** Só o que ainda não passou por olho humano aparece na fila. */
export function isReportPending(status: ReportStatus): boolean {
  return status === 'novo';
}

/**
 * Payload do lead criado quando alguém aproveita o relato.
 *
 * Nasce como `viavel` no board Trabalhista de propósito: o relato já foi lido
 * por uma pessoa, que clicou em aproveitar — mandar para `noticias` faria a
 * triagem acontecer duas vezes. Daí em diante é o fluxo normal da aba
 * Notícias, inclusive o "Cadastrar Caso Viável".
 *
 * `news_enriched_at` já vem preenchido porque `enrich-news-leads` julga
 * viabilidade lendo MANCHETE de veículo. Um relato de grupo não tem manchete;
 * deixar o campo vazio faria a IA de notícias reavaliar (e possivelmente
 * arquivar) um caso que uma pessoa acabou de aprovar.
 */
export interface LeadFromReport {
  board_id: string;
  status: 'viavel';
  lead_name: string;
  lead_phone: string | null;
  victim_name: string | null;
  city: string | null;
  state: string | null;
  accident_date: string | null;
  main_company: string | null;
  case_type: string | null;
  damage_description: string;
  source: string;
  notes: string;
  news_enriched_at: string;
}

/** Tipo de caso no vocabulário do formulário de caso viável (`analyze-news-case`). */
const CASE_TYPE_BY_KIND: Partial<Record<ReportKind, string>> = {
  acidente_transito: 'Acidente de Trânsito',
};

export function buildLeadFromReport(
  report: Pick<
    GroupCaseReport,
    | 'headline' | 'kind' | 'victim_name' | 'city' | 'state' | 'accident_date'
    | 'company' | 'damage' | 'dynamics_summary' | 'details' | 'quote'
    | 'group_name' | 'reporter_name' | 'reporter_phone'
  >,
  boardId: string,
  now = new Date().toISOString()
): LeadFromReport {
  const partes = [
    report.details?.trim(),
    report.damage?.trim() ? `Dano: ${report.damage.trim()}.` : '',
    report.dynamics_summary?.trim() ? `Dinâmica: ${report.dynamics_summary.trim()}.` : '',
  ].filter(Boolean);

  // Sem detalhe nenhum a descrição não pode ficar vazia — a manchete é o que
  // sempre existe, e é melhor que um campo em branco na ficha do caso.
  const descricao = partes.length > 0 ? partes.join(' ') : report.headline;

  const origem = [
    `Relato ouvido no grupo "${report.group_name || 'sem nome'}"`,
    report.reporter_name || report.reporter_phone
      ? `por ${report.reporter_name || report.reporter_phone}`
      : '',
  ].filter(Boolean).join(' ');

  const notas = [
    origem + '.',
    report.quote?.trim() ? `Palavras dele: "${report.quote.trim()}"` : '',
  ].filter(Boolean).join('\n');

  return {
    board_id: boardId,
    status: 'viavel',
    lead_name: report.headline,
    // Telefone de quem CONTOU — é por ele que a equipe chega na vítima. Quando
    // o relator é a própria vítima, já é o telefone certo.
    lead_phone: report.reporter_phone || null,
    victim_name: report.victim_name || null,
    city: report.city || null,
    state: report.state || null,
    accident_date: report.accident_date || null,
    main_company: report.company || null,
    case_type: CASE_TYPE_BY_KIND[report.kind] || null,
    damage_description: descricao,
    source: 'grupo_whatsapp',
    notes: notas,
    news_enriched_at: now,
  };
}
