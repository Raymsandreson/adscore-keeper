import { externalSupabase, ensureExternalSession } from './external-client';
import { isWhatsAppGroupId } from '@/lib/whatsappPhone';

/**
 * Vínculo lead ↔ grupo de WhatsApp para a sidebar do Inbox.
 *
 * `conversations.lead_id` (fonte do get_conversation_summaries) só é preenchido
 * quando alguém vincula o lead pela própria conversa. Quem vincula pela aba
 * Contatos → Grupos grava apenas em `lead_whatsapp_groups`, então o grupo
 * aparecia "com lead" em Contatos e "sem lead" no WhatsApp. Aqui resolvemos o
 * lead do grupo pela tabela de vínculo, que é a fonte usada pelas demais telas.
 *
 * `group_jid` está gravado em duas formas na base (com e sem o sufixo `@g.us`),
 * então a busca consulta as duas variantes e a chave do cache é sempre a versão
 * só-dígitos — a mesma que `normalizeWhatsAppConversationPhone` produz.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
// Cache negativo curto: grupo vinculado em outra tela (ou por outra pessoa)
// aparece na sidebar no minuto seguinte, sem esperar os 5 min do TTL normal.
const CACHE_MISS_TTL_MS = 60 * 1000;
const CHUNK_SIZE = 150;

const cache = new Map<string, { leadId: string | null; at: number }>();

function normalizeGroupJid(raw: string | null | undefined): string {
  return String(raw || '').trim().replace(/@g\.us$/, '').replace(/\D/g, '');
}

/** Invalida o cache de um grupo (usar após vincular/desvincular na UI). */
export function invalidateGroupLeadCache(jid?: string | null): void {
  if (!jid) {
    cache.clear();
    return;
  }
  cache.delete(normalizeGroupJid(jid));
}

/**
 * Resolve lead_id por JID de grupo. Retorna só os que têm vínculo.
 * Quando o mesmo grupo aparece em mais de um lead (260 casos hoje), vence o
 * vínculo mais recente.
 */
export async function getGroupLeadIds(jids: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const result = new Map<string, string>();
  const wanted = Array.from(new Set(
    jids.map(normalizeGroupJid).filter(j => j && isWhatsAppGroupId(j))
  ));
  if (wanted.length === 0) return result;

  const missing: string[] = [];
  for (const jid of wanted) {
    const hit = cache.get(jid);
    const ttl = hit?.leadId ? CACHE_TTL_MS : CACHE_MISS_TTL_MS;
    if (hit && now - hit.at < ttl) {
      if (hit.leadId) result.set(jid, hit.leadId);
    } else {
      missing.push(jid);
    }
  }
  if (missing.length === 0) return result;

  try {
    await ensureExternalSession();
  } catch (error: any) {
    console.warn('[getGroupLeadIds] sessão externa indisponível:', error?.message);
    return result;
  }

  for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
    const slice = missing.slice(i, i + CHUNK_SIZE);
    const variants = slice.flatMap(jid => [jid, `${jid}@g.us`]);
    const { data, error } = await externalSupabase
      .from('lead_whatsapp_groups')
      .select('group_jid, lead_id, created_at')
      .in('group_jid', variants)
      // ASC de propósito: o último a escrever no map é o vínculo mais recente.
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[getGroupLeadIds] falha ao ler lead_whatsapp_groups:', error.message);
      continue;
    }

    for (const row of (data || []) as any[]) {
      const jid = normalizeGroupJid(row.group_jid);
      if (!jid || !row.lead_id) continue;
      result.set(jid, String(row.lead_id));
    }
    for (const jid of slice) {
      cache.set(jid, { leadId: result.get(jid) ?? null, at: now });
    }
  }

  return result;
}

/**
 * Preenche `lead_id` das conversas de grupo que vieram sem lead na
 * `conversations`. Não sobrescreve vínculo já existente na conversa.
 */
export async function attachGroupLeadIds<T extends { phone: string; lead_id: string | null }>(
  rows: T[]
): Promise<T[]> {
  const pending = rows.filter(r => !r.lead_id && isWhatsAppGroupId(r.phone));
  if (pending.length === 0) return rows;

  const byJid = await getGroupLeadIds(pending.map(r => r.phone));
  if (byJid.size === 0) return rows;

  return rows.map(row => {
    if (row.lead_id || !isWhatsAppGroupId(row.phone)) return row;
    const leadId = byJid.get(normalizeGroupJid(row.phone));
    return leadId ? { ...row, lead_id: leadId } : row;
  });
}
