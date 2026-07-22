// Fonte única da leitura do Despacho dos e-mails do INSS.
//
// O INSS não manda "deferido/indeferido" no assunto — só "Concluída". O veredito
// real fica no campo "Despacho:" do corpo. Estas funções extraem Serviço/Despacho
// e classificam o resultado a partir dele.
//
// NOTA (dívida a quitar): gmail-inss-sync.ts mantém uma cópia inline destas mesmas
// funções para o caminho incremental do sync. Não foram unificadas aqui ainda por
// conflito de escrita concorrente naquele arquivo (Lovable edita em paralelo).
// Unificar num commit isolado depois, fazendo o sync importar deste módulo.

export type InssResultado = 'deferido' | 'indeferido';

/**
 * Classifica o resultado de um requerimento CONCLUÍDO pelo texto do Despacho.
 * Padrões observados nos e-mails reais:
 *   deferido   → "foi concedido", "requerimento solicitado foi concedido"
 *   indeferido → "não foi reconhecido o direito", "indeferimento", "foi negado"
 * Checa indeferido primeiro: "não foi reconhecido" contém "reconhecido" e
 * enganaria uma checagem de deferido feita antes.
 */
export function classifyResultado(despacho?: string | null): InssResultado | undefined {
  if (!despacho) return undefined;
  const d = despacho.toLowerCase();
  if (/indefer|n[ãa]o foi reconhecid|foi negad|\bnegad[oa]\b/.test(d)) return 'indeferido';
  if (/concedid|\bdeferid[oa]\b|foi reconhecid[oa] o direito/.test(d)) return 'deferido';
  return undefined;
}

/** Extrai o valor do campo "Despacho:" do corpo, até o rodapé do e-mail. */
export function extractDespacho(body: string): string | undefined {
  const m = body.match(
    /despacho\s*:\s*([\s\S]+?)(?:\s*(?:[ÉE] poss[íi]vel acompanhar|Atenciosamente,|https?:\/\/meu\.inss|Instituto Nacional do Seguro Social\s*-\s*INSS\s*$)|$)/i,
  );
  if (!m) return undefined;
  const v = m[1].replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, 4000) : undefined;
}

/** Extrai o campo "Serviço:" (tipo real do benefício) do corpo. */
export function extractServico(body: string): string | undefined {
  const m = body.match(/servi[çc]o\s*:\s*([^\n]+?)(?:\s+Data do Protocolo|\s+Unidade respons|\n|$)/i);
  if (!m) return undefined;
  const v = m[1].replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, 200) : undefined;
}

function decodeBase64Url(s: string): string {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch { return ''; }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return _; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } });
}

/** Achata um payload Gmail (message.format=full) em texto plano legível. */
export function gmailBodyToText(msg: any): string {
  let plain = '';
  let html = '';
  const walk = (parts?: any[]): void => {
    if (!parts) return;
    for (const p of parts) {
      if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = decodeBase64Url(p.body.data);
      else if (p.mimeType === 'text/html' && p.body?.data && !html) html = decodeBase64Url(p.body.data);
      if (p.parts) walk(p.parts);
    }
  };
  if (msg?.payload?.body?.data) {
    const raw = decodeBase64Url(msg.payload.body.data);
    if ((msg.payload.mimeType || '').includes('html')) html = raw; else plain = raw;
  }
  walk(msg?.payload?.parts);
  if (plain && plain.trim()) return decodeEntities(plain);
  if (html) {
    return decodeEntities(
      html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '),
    ).replace(/\s+/g, ' ').trim();
  }
  return '';
}
