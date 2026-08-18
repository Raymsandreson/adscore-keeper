/**
 * Espelhos de mensagem de grupo — quem falou, de verdade.
 *
 * Em grupo, CADA instância nossa que participa grava a sua própria linha da
 * mesma mensagem em `whatsapp_messages`. Medido em 18/08/2026: 2,6 linhas por
 * mensagem real. A instância que enviou grava `direction = 'outbound'`; as
 * demais gravam a MESMA mensagem como `'inbound'` (elas a receberam).
 *
 * Consequência: `direction` sozinho não diz quem falou — depende de qual
 * espelho sobreviveu ao dedup. Como o menu "Grupo WA" das atividades dedupava
 * na ordem crescente (fica o espelho mais antigo, quase sempre `inbound`) e a
 * aba do WhatsApp na decrescente (fica o mais recente, às vezes `outbound`), a
 * mesma mensagem aparecia de lados opostos nas duas telas. No grupo do
 * PREV 1428, 19 das 24 mensagens tinham `direction` conflitante entre espelhos.
 *
 * Este módulo centraliza as duas decisões que as telas precisam tomar igual:
 *   1. qual chave identifica a mensagem real (tail do `external_message_id`);
 *   2. quem é o autor — olhando TODOS os espelhos, não um só.
 *
 * A linha canônica devolvida continua sendo a PRIMEIRA na ordem de entrada
 * (o que cada tela já fazia): trocar isso desalinharia o selo "Virou atividade",
 * que casa por `whatsapp_message_activities.message_id`.
 */

/** Campos que o dedup precisa. Ambas as telas trazem um superconjunto disto. */
export interface MirroredMessage {
  id: string;
  direction?: string | null;
  created_at?: string | null;
  external_message_id?: string | null;
  instance_name?: string | null;
  message_text?: string | null;
  media_url?: string | null;
  /** Payload cru do webhook. A aba do WhatsApp traz; o menu usa a projeção abaixo. */
  metadata?: unknown;
  /** Projeções de `metadata` (PostgREST `metadata->message->>...`) — evitam baixar o jsonb inteiro. */
  sender_pn?: string | null;
  sender_lid?: string | null;
  sender_name?: string | null;
}

/** O que o dedup acrescenta à linha canônica. */
export interface MirrorAuthorFields {
  /** Sobrescreve o `direction` da linha: veredito de TODOS os espelhos. */
  direction: string;
  /** Nome de quem falou no grupo — null quando a mensagem é nossa. */
  group_sender_name: string | null;
  /** Telefone de quem falou (só dígitos) — null quando é nossa ou quando só há `@lid`. */
  group_sender_phone: string | null;
  /** Ids de todas as linhas espelhadas desta mensagem (a canônica inclusa). */
  mirror_ids: string[];
}

const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/**
 * Chave da mensagem real. O `external_message_id` costuma vir como
 * `<instância>:<id do WhatsApp>` — o tail é igual em todos os espelhos.
 * Sem ele não há como parear: cada linha vira a sua própria mensagem
 * (o `created_at` difere entre espelhos, então não serve de chave).
 */
export function mirrorKey(m: MirroredMessage): string {
  const ext = typeof m.external_message_id === 'string' ? m.external_message_id.trim() : '';
  if (!ext) return `row:${m.id}`;
  const tail = ext.split(':').pop() || ext;
  return `ext:${tail}`;
}

/** Lê o autor do metadata cru (aba do WhatsApp) ou das projeções (menu Grupo WA). */
function readSender(m: MirroredMessage): { name: string | null; phone: string; lid: string } {
  const meta = (m.metadata || null) as any;
  const rawPn =
    m.sender_pn ??
    meta?.message?.sender_pn ?? meta?.sender_pn ??
    meta?.message?.participantPn ?? meta?.participantPn ??
    meta?.key?.participantPn ?? '';
  const rawLid =
    m.sender_lid ??
    meta?.message?.sender_lid ?? meta?.sender_lid ??
    meta?.key?.participant ?? meta?.message?.participant ?? '';
  const name =
    m.sender_name ??
    meta?.message?.senderName ?? meta?.senderName ?? meta?.chat?.pushName ?? null;
  return {
    name: typeof name === 'string' && name.trim() ? name.trim() : null,
    phone: digits(String(rawPn).split('@')[0]),
    // `@lid` é o id anônimo do WhatsApp em grupo — nunca é telefone, não pode ir pra tela.
    lid: String(rawLid).includes('@lid') ? digits(String(rawLid).split('@')[0]) : '',
  };
}

/**
 * Quem falou, olhando o conjunto de espelhos.
 *
 * Dois sinais, nesta ordem:
 *   1. algum espelho gravado como `outbound` ⇒ saiu de uma instância nossa;
 *   2. o autor no metadata é o número de uma instância nossa ⇒ nossa também.
 *
 * O segundo sinal existe porque mensagem digitada no celular (fora do sistema)
 * não gera espelho `outbound` nenhum: no PREV 1428, "Dom-Abraci" e uma da
 * "Atendimento Previdenciário" só foram reconhecidas por aí.
 *
 * @param ourPhones telefones das instâncias (`whatsapp_instances.owner_phone`),
 *                  só dígitos. Vazio degrada para o sinal 1 apenas.
 */
export function resolveMirrorAuthor(
  mirrors: MirroredMessage[],
  ourPhones?: ReadonlySet<string>
): Omit<MirrorAuthorFields, 'mirror_ids'> {
  const senders = mirrors.map(readSender);
  const senderPhone = senders.find(s => s.phone)?.phone || '';
  const senderName = senders.find(s => s.name)?.name || null;

  const hasOutbound = mirrors.some(m => m.direction === 'outbound');
  const fromOurNumber = !!senderPhone && !!ourPhones?.has(senderPhone);

  if (hasOutbound || fromOurNumber) {
    return { direction: 'outbound', group_sender_name: null, group_sender_phone: null };
  }
  return {
    direction: 'inbound',
    group_sender_name: senderName,
    group_sender_phone: senderPhone || null,
  };
}

/**
 * Colapsa os espelhos e carimba o autor em cada mensagem que sobra.
 *
 * Preserva a ordem de entrada: quem passa ASC recebe ASC, quem passa DESC
 * recebe DESC. Linha sem `external_message_id` não tem como ser pareada e
 * passa direto (vira a sua própria mensagem).
 */
export function dedupeMirroredMessages<T extends MirroredMessage>(
  rows: T[],
  options?: { ourPhones?: ReadonlySet<string> }
): Array<T & MirrorAuthorFields> {
  const byKey = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = mirrorKey(row);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else { byKey.set(key, [row]); order.push(key); }
  }

  return order.map(key => {
    const mirrors = byKey.get(key)!;
    const canonical = mirrors[0];
    return {
      ...canonical,
      ...resolveMirrorAuthor(mirrors, options?.ourPhones),
      mirror_ids: mirrors.map(m => m.id),
    };
  });
}
