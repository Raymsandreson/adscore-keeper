/**
 * Janela de 24h da WhatsApp Cloud API (regra da Meta, não nossa).
 *
 * Fora dela o WhatsApp só entrega TEMPLATE aprovado. Texto livre é aceito pela
 * Graph — devolve `wamid` e tudo — e recusado ~1s depois, no webhook de status,
 * com o erro 131047. Ou seja: sem esta conta, a tela mostra "enviada" para uma
 * mensagem que o cliente nunca vai ver.
 *
 * A janela conta a partir da ÚLTIMA mensagem que o CLIENTE mandou. Cada nova
 * mensagem dele reabre 24h; o que nós enviamos não conta.
 *
 * Só vale para o canal Cloud API. UazAPI não tem essa regra, e a tela não pode
 * bloquear quem não está sujeito a ela.
 */

export const JANELA_MS = 24 * 60 * 60 * 1000;
export const INSTANCIA_CLOUD = 'cloud_gerencia';

export interface JanelaAtendimento {
  /** O canal está sujeito à regra? Só a Cloud API está. */
  aplicavel: boolean;
  /** Dá pra mandar texto livre agora? Canal sem a regra é sempre `true`. */
  aberta: boolean;
  ultimoInboundEm: string | null;
  expiraEm: string | null;
  /** Milissegundos restantes; 0 quando fechada ou sem inbound. */
  restanteMs: number;
}

export function ehCanalCloud(instanceName: string | null | undefined): boolean {
  return (instanceName || '').trim().toLowerCase() === INSTANCIA_CLOUD;
}

export function janelaDeAtendimento(
  instanceName: string | null | undefined,
  mensagens: Array<{ direction?: string | null; created_at?: string | null }> | null | undefined,
  agora: Date = new Date(),
): JanelaAtendimento {
  const aplicavel = ehCanalCloud(instanceName);
  if (!aplicavel) {
    // Não é a nossa regra: não bloqueia nada e não afirma nada.
    return { aplicavel: false, aberta: true, ultimoInboundEm: null, expiraEm: null, restanteMs: 0 };
  }

  let ultimo = 0;
  for (const m of mensagens || []) {
    if (m?.direction !== 'inbound' || !m.created_at) continue;
    const t = new Date(m.created_at).getTime();
    if (Number.isFinite(t) && t > ultimo) ultimo = t;
  }

  // Sem nenhuma mensagem do cliente a janela nunca abriu — é o caso do primeiro
  // contato, exatamente onde o template é obrigatório.
  if (!ultimo) {
    return { aplicavel: true, aberta: false, ultimoInboundEm: null, expiraEm: null, restanteMs: 0 };
  }

  const expira = ultimo + JANELA_MS;
  const restante = expira - agora.getTime();
  return {
    aplicavel: true,
    aberta: restante > 0,
    ultimoInboundEm: new Date(ultimo).toISOString(),
    expiraEm: new Date(expira).toISOString(),
    restanteMs: restante > 0 ? restante : 0,
  };
}

/** "3h 20min" — quanto ainda dá pra falar sem template. */
export function formatarRestante(restanteMs: number): string {
  if (restanteMs <= 0) return 'expirada';
  const min = Math.floor(restanteMs / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m}min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}
