/**
 * Resolução das caixas do Gmail — fonte única de verdade do mapeamento
 * `label → connection key` e de qual caixa é a processual / administrativa.
 *
 * Por que existe: o mapeamento estava copiado em gmail-inss-sync,
 * gmail-processual-sync e gmail-message-body, e o send-email tinha um quarto,
 * hardcodado. Nenhum deles conseguia responder "qual caixa é qual" sem alguém
 * ir ler env var no Railway — e não dá pra ler env var de fora. Centralizar é
 * o que permite o gmail-status responder isso.
 *
 * CUIDADO ao mexer na resolução do remetente: LER e ENVIAR usam critérios
 * diferentes. PROCESSUAL_INBOXES lista as caixas que o sync varre (inbox#3 e
 * inbox#4), mas o envio judicial sai da inbox#4. Derivar o remetente da ordem
 * da allowlist troca a conta que assina o e-mail sem ninguém pedir.
 *
 * O nome da label vem do índice da env, e a numeração é herdada (não mexer,
 * PROCESSUAL_INBOXES/INSS_INBOXES em produção já falam nesses termos):
 *   GOOGLE_MAIL_API_KEY    → inbox#1
 *   GOOGLE_MAIL_API_KEY_1  → inbox#2
 *   GOOGLE_MAIL_API_KEY_2  → inbox#3
 *   GOOGLE_MAIL_API_KEY_3  → inbox#4   (e assim por diante até _5 → inbox#6)
 */

export interface GmailInbox {
  /** Rótulo estável usado por PROCESSUAL_INBOXES / INSS_INBOXES. */
  label: string;
  /** Nome da env de onde a key veio — útil no diagnóstico, nunca a key em si. */
  envName: string;
  /** Connection key do gateway. Nunca logar/serializar. */
  key: string;
}

/** Todas as caixas com connection key configurada, na ordem das envs. */
export function listGmailInboxes(): GmailInbox[] {
  const out: GmailInbox[] = [];
  const push = (envName: string, label: string) => {
    const key = (process.env[envName] || '').trim();
    if (key) out.push({ label, envName, key });
  };
  push('GOOGLE_MAIL_API_KEY', 'inbox#1');
  push('GOOGLE_MAIL_API_KEY_1', 'inbox#2');
  for (let i = 2; i <= 5; i++) push(`GOOGLE_MAIL_API_KEY_${i}`, `inbox#${i + 1}`);
  return out;
}

/** Labels válidas listadas numa env do tipo allowlist ("inbox#3,inbox#4"). */
function labelsFromEnv(envName: string): string[] {
  return (process.env[envName] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function byLabel(inboxes: GmailInbox[], label: string): GmailInbox | undefined {
  return inboxes.find((i) => i.label === label);
}

/**
 * Caixa apontada por uma connection key crua (env de override). Se a key bate
 * com uma das caixas conhecidas, devolve ela — assim o diagnóstico mostra a
 * label real em vez de "override".
 */
function byRawKey(inboxes: GmailInbox[], key: string, envName: string): GmailInbox {
  return inboxes.find((i) => i.key === key) || { label: 'override', envName, key };
}

export interface InboxResolution {
  inbox: GmailInbox | null;
  /** Como chegamos nessa caixa — vai no erro e no diagnóstico. */
  origem: string;
  /** Preenchido só quando inbox é null. */
  erro?: string;
}

/**
 * Caixa de onde o e-mail deve SAIR, por tipo de processo.
 *
 * judicial/processual → a mesma caixa que o robô lê os e-mails processuais,
 * administrativo      → a caixa adm/INSS.
 *
 * A ordem de resolução prioriza o override explícito, depois deriva da
 * allowlist de leitura (que é o que de fato diz qual caixa é qual), e só então
 * cai no default histórico. Sem chute: se nada resolver, devolve erro listando
 * as caixas que existem.
 */
export function resolveSenderInbox(processType?: string): InboxResolution {
  const inboxes = listGmailInboxes();
  const isAdmin = (processType || '').toLowerCase() === 'administrativo';

  if (inboxes.length === 0) {
    return {
      inbox: null,
      origem: 'nenhuma',
      erro: 'Nenhuma GOOGLE_MAIL_API_KEY* configurada no Railway.',
    };
  }

  const overrideEnv = isAdmin ? 'COBRANCA_GMAIL_KEY_ADMIN' : 'COBRANCA_GMAIL_KEY_JUDICIAL';
  const override = (process.env[overrideEnv] || '').trim();
  if (override) {
    return { inbox: byRawKey(inboxes, override, overrideEnv), origem: overrideEnv };
  }

  // Caixa vigente, e ela vem PRIMEIRO de propósito: judicial sai da inbox#4
  // (GOOGLE_MAIL_API_KEY_3) e adm da inbox#1, que é o que o send-email já fazia.
  // Derivar da allowlist antes disto trocaria o remetente sem ninguém pedir —
  // PROCESSUAL_INBOXES lista inbox#3 e inbox#4, e a primeira da lista não é a
  // caixa de envio. Allowlist define o que se LÊ, não de onde se ENVIA.
  const padraoLabel = isAdmin ? 'inbox#1' : 'inbox#4';
  const padrao = byLabel(inboxes, padraoLabel);
  if (padrao) return { inbox: padrao, origem: `padrão (${padraoLabel})` };

  // A caixa de sempre sumiu. Aí sim a allowlist de leitura é o melhor palpite
  // disponível — melhor que falhar, e a origem no retorno deixa isso explícito.
  const allowEnv = isAdmin ? 'INSS_INBOXES' : 'PROCESSUAL_INBOXES';
  for (const label of labelsFromEnv(allowEnv)) {
    const found = byLabel(inboxes, label);
    if (found) return { inbox: found, origem: `fallback ${allowEnv}=${label} (${padraoLabel} ausente)` };
  }

  const disponiveis = inboxes.map((i) => `${i.label} (${i.envName})`).join(', ');
  return {
    inbox: null,
    origem: 'nenhuma',
    erro:
      `Não deu pra decidir a caixa remetente para "${isAdmin ? 'administrativo' : 'judicial'}": ` +
      `a caixa padrão (${padraoLabel}) não está configurada e ${allowEnv} não aponta pra nenhuma caixa válida. ` +
      `Defina ${overrideEnv} ou ${allowEnv}. Caixas configuradas: ${disponiveis}.`,
  };
}
