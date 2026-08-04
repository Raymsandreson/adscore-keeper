// Helper compartilhado do POST /chat/details da UazAPI.
// ============================================================
// Antes existiam TRÊS parsers independentes deste mesmo endpoint
// (get-group-participants railway, get-group-participants edge e
// whatsapp-webhook), cada um lendo um subconjunto diferente dos campos. Dois
// bugs nasceram exatamente dessa duplicação:
//
//   1. `common_groups` não existe no payload — o campo real é
//      `wa_common_groups`, e vem como STRING no formato
//      "Nome do grupo(120363...@g.us), Outro grupo(1203...@g.us)".
//      Quem lia `d.common_groups` recebia undefined e gravava [] sempre.
//   2. `lead_field12..16` eram gravados numa tabela que não tinha essas
//      colunas. PostgREST rejeita a linha inteira (PGRST204), então o cache
//      simplesmente parou de ser escrito.
//
// Este módulo é a única implementação. Os nomes de campo abaixo vêm de duas
// fontes: a doc do endpoint (modelo Chat) e os payloads reais já gravados em
// `whatsapp_chat_details_cache.raw` em produção.
//
// O endpoint é de LEITURA. Ele atualiza o banco da própria UazAPI quando
// encontra dado desatualizado, mas não escreve na agenda do celular — para
// isso é preciso um endpoint de escrita, que não está implementado aqui.
// ============================================================
import { supabase } from './supabase';

const DEFAULT_BASE = 'https://abraci.uazapi.com';
const UAZ_TIMEOUT_MS = 10000;

/** Idade máxima do cache antes de considerar o registro velho. */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Chamadas simultâneas à UazAPI num lote. Acima disso a API começa a recusar. */
export const DEFAULT_CONCURRENCY = 6;

/** Depois de N falhas seguidas, o número para de ser retentado pelo varredor. */
export const MAX_SYNC_ATTEMPTS = 5;

export interface CommonGroup {
  name: string;
  jid: string;
}

/** Modelo Chat normalizado — snake_case, igual às colunas do cache. */
export interface ChatDetails {
  wa_id: string | null;
  wa_fastid: string | null;
  wa_chatid: string | null;
  wa_chatlid: string | null;
  owner: string | null;
  name: string | null;
  phone: string | null;

  image: string | null;
  image_preview: string | null;
  wa_name: string | null;
  wa_contact_name: string | null;
  wa_archived: boolean | null;
  wa_is_blocked: boolean | null;
  wa_is_pinned: boolean | null;
  wa_unread_count: number | null;
  wa_mute_end_time: number | null;
  wa_labels: string[];

  is_group: boolean;
  wa_is_group: boolean | null;
  wa_is_group_admin: boolean | null;
  wa_is_group_announce: boolean | null;
  wa_is_group_community: boolean | null;
  wa_is_group_locked: boolean | null;

  chatbot_summary: string | null;
  chatbot_last_trigger_id: string | null;
  chatbot_disable_until: string | null;
  chatbot_status: string | null;

  lead_name: string | null;
  lead_full_name: string | null;
  lead_email: string | null;
  lead_personalid: string | null;
  lead_status: string | null;
  lead_notes: string | null;
  lead_tags: string[] | null;
  lead_assigned_attendant_id: string | null;
  lead_is_ticket_open: boolean | null;
  lead_fields: Record<string, string | null>;

  common_groups: CommonGroup[];
  raw: Record<string, unknown>;
}

// ============================================================
// Leitores tolerantes
// ============================================================
// O payload mistura camelCase (lead_fullName, wa_contactName, wa_isGroup) com
// snake_case, e alguns campos vêm em `data.chat` em vez da raiz. Ler por lista
// de aliases evita que uma variação de nome vire dado perdido em silêncio.

function pick(src: any, ...keys: string[]): any {
  for (const k of keys) {
    const v = src?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function asText(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

// `false` é resposta válida — por isso não dá pra usar `pick`, que descarta
// valores falsy junto com os ausentes.
function asBool(src: any, ...keys: string[]): boolean | null {
  for (const k of keys) {
    const v = src?.[k];
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return null;
}

function asInt(src: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = src?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  }
  return null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asText(x)).filter((x): x is string => !!x);
}

// A UazAPI manda timestamps ora em ISO, ora em epoch (s ou ms). Um epoch em
// segundos interpretado como ms cai em 1970 e o registro parece "sempre
// expirado" — daí a checagem de magnitude.
function asTimestamp(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/**
 * `wa_common_groups` chega como string, não array:
 *   "PREV 780 | MATERNIDADE Carla(120363423727605835@g.us), ✅Prev 445 Rayllane(1203634055...@g.us)"
 * O nome do grupo pode conter vírgula e barra vertical, então o separador
 * confiável é o par de parênteses com o JID dentro — não a vírgula.
 */
export function parseCommonGroups(value: unknown): CommonGroup[] {
  if (Array.isArray(value)) {
    return value
      .map((g: any) => {
        if (typeof g === 'string') return { name: g, jid: '' };
        const jid = asText(pick(g, 'jid', 'JID', 'id', 'group_jid')) || '';
        const name = asText(pick(g, 'name', 'Name', 'subject')) || '';
        return { name, jid };
      })
      .filter((g) => g.name || g.jid);
  }
  if (typeof value !== 'string' || !value.trim()) return [];

  const out: CommonGroup[] = [];
  const re = /([^,(]+)\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const name = m[1].replace(/^[\s,]+/, '').trim();
    const jid = m[2].trim();
    if (name || jid) out.push({ name, jid });
  }
  return out;
}

/** Extrai lead_field01..20 aceitando tanto `lead_field01` quanto `lead_field1`. */
function extractLeadFields(chat: any): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (let i = 1; i <= 20; i++) {
    const padded = String(i).padStart(2, '0');
    fields[`lead_field${padded}`] =
      asText(pick(chat, `lead_field${padded}`, `lead_field${i}`, `leadField${padded}`, `leadField${i}`)) ?? null;
  }
  return fields;
}

/**
 * Payload bruto do /chat/details → modelo Chat normalizado.
 * A resposta às vezes vem envelopada em `chat`/`data`; aceita as três formas.
 */
export function normalizeChatDetails(payload: any): ChatDetails {
  const chat = payload?.chat || payload?.data?.chat || payload?.data || payload || {};

  const waChatid = asText(pick(chat, 'wa_chatid', 'chatid', 'chatId', 'jid'));
  const isGroupFlag = asBool(chat, 'wa_isGroup', 'wa_is_group', 'isGroup');
  const isGroup = isGroupFlag ?? /@g\.us\b/i.test(waChatid || '');

  return {
    wa_id: asText(pick(chat, 'id', 'chat_id')),
    wa_fastid: asText(pick(chat, 'wa_fastid', 'fastid', 'fastId')),
    wa_chatid: waChatid,
    wa_chatlid: asText(pick(chat, 'wa_chatlid', 'chatlid', 'lid')),
    owner: asText(pick(chat, 'owner', 'wa_owner')),
    name: asText(pick(chat, 'name', 'Name')),
    phone: asText(pick(chat, 'phone', 'number', 'Phone')),

    image: asText(pick(chat, 'image', 'imageUrl', 'profilePicUrl')),
    image_preview: asText(pick(chat, 'imagePreview', 'image_preview', 'previewImage')),
    wa_name: asText(pick(chat, 'wa_name', 'waName', 'pushName', 'verifiedName')),
    wa_contact_name: asText(pick(chat, 'wa_contactName', 'wa_contact_name', 'contactName')),
    wa_archived: asBool(chat, 'wa_archived', 'archived'),
    wa_is_blocked: asBool(chat, 'wa_isBlocked', 'wa_is_blocked', 'isBlocked'),
    wa_is_pinned: asBool(chat, 'wa_isPinned', 'wa_is_pinned', 'isPinned'),
    wa_unread_count: asInt(chat, 'wa_unreadCount', 'wa_unread_count', 'unreadCount'),
    wa_mute_end_time: asInt(chat, 'wa_muteEndTime', 'wa_mute_end_time', 'muteEndTime'),
    // `wa_label` (singular) é o nome no payload; itens podem vir como
    // "instancia:labelid" — só o id interessa.
    wa_labels: asStringArray(pick(chat, 'wa_label', 'wa_labels', 'labels')).map((raw) =>
      raw.includes(':') ? String(raw.split(':').pop()).trim() : raw,
    ),

    is_group: isGroup,
    wa_is_group: isGroupFlag,
    wa_is_group_admin: asBool(chat, 'wa_isGroup_admin', 'wa_is_group_admin', 'isGroupAdmin'),
    wa_is_group_announce: asBool(chat, 'wa_isGroup_announce', 'wa_is_group_announce', 'isGroupAnnounce'),
    wa_is_group_community: asBool(chat, 'wa_isGroup_community', 'wa_is_group_community', 'isCommunity'),
    wa_is_group_locked: asBool(chat, 'wa_isGroup_locked', 'wa_is_group_locked', 'isGroupLocked'),

    chatbot_summary: asText(pick(chat, 'chatbot_summary', 'chatbotSummary')),
    chatbot_last_trigger_id: asText(pick(chat, 'chatbot_lastTrigger_id', 'chatbot_last_trigger_id')),
    chatbot_disable_until: asTimestamp(pick(chat, 'chatbot_disableUntil', 'chatbot_disable_until')),
    chatbot_status: asText(pick(chat, 'chatbot_status', 'chatbotStatus')),

    lead_name: asText(pick(chat, 'lead_name', 'leadName')),
    lead_full_name: asText(pick(chat, 'lead_fullName', 'lead_full_name', 'leadFullName')),
    lead_email: asText(pick(chat, 'lead_email', 'leadEmail')),
    lead_personalid: asText(pick(chat, 'lead_personalid', 'lead_personalId', 'leadPersonalId')),
    lead_status: asText(pick(chat, 'lead_status', 'leadStatus')),
    lead_notes: asText(pick(chat, 'lead_notes', 'leadNotes')),
    lead_tags: Array.isArray(pick(chat, 'lead_tags', 'leadTags'))
      ? asStringArray(pick(chat, 'lead_tags', 'leadTags'))
      : null,
    lead_assigned_attendant_id: asText(
      pick(chat, 'lead_assignedAttendant_id', 'lead_assigned_attendant_id'),
    ),
    lead_is_ticket_open: asBool(chat, 'lead_isTicketOpen', 'lead_is_ticket_open'),
    lead_fields: extractLeadFields(chat),

    common_groups: parseCommonGroups(pick(chat, 'wa_common_groups', 'common_groups', 'commonGroups')),
    raw: (chat && typeof chat === 'object' ? chat : {}) as Record<string, unknown>,
  };
}

/**
 * Melhor nome disponível, em ordem de confiança:
 * o que a operação preencheu no CRM > o nome salvo na agenda do chip >
 * o nome público do WhatsApp.
 */
export function pickBestName(d: ChatDetails): string | null {
  return d.lead_full_name || d.lead_name || d.wa_contact_name || d.wa_name || d.name || null;
}

/** Alguma informação útil veio, ou é só um esqueleto vazio? */
export function hasUsefulData(d: ChatDetails): boolean {
  return !!(
    pickBestName(d) ||
    d.image ||
    d.image_preview ||
    d.lead_email ||
    d.lead_personalid ||
    d.common_groups.length ||
    d.wa_labels.length
  );
}

// ============================================================
// Chamada HTTP
// ============================================================

export interface FetchOptions {
  /** true = imagem menor (listagens). false = resolução original. */
  preview?: boolean;
  timeoutMs?: number;
}

export async function fetchChatDetailsRaw(
  baseUrl: string,
  token: string,
  number: string,
  opts: FetchOptions = {},
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? UAZ_TIMEOUT_MS);
  try {
    const r = await fetch(`${(baseUrl || DEFAULT_BASE).replace(/\/$/, '')}/chat/details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number, preview: opts.preview ?? false }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      // 400 = número inválido; 401 = token; 500 = sessão não iniciada.
      throw new Error(`/chat/details ${r.status}: ${text.slice(0, 160)}`);
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface InstanceRow {
  instance_name: string;
  instance_token: string;
  base_url?: string | null;
  is_active?: boolean | null;
}

export interface ResolvedDetails {
  details: ChatDetails;
  source_instance: string;
}

/**
 * Um número só é visível pela instância que tem o chat aberto. Tenta a
 * instância preferida primeiro e cai para as demais — sem isso, um contato que
 * conversa com outro chip volta vazio.
 */
export async function fetchDetailsAcrossInstances(
  instances: InstanceRow[],
  preferredName: string | null,
  number: string,
  opts: FetchOptions = {},
): Promise<ResolvedDetails | null> {
  const usable = instances.filter((i) => i?.instance_token && i.is_active !== false);
  const preferred = (preferredName || '').toLowerCase();
  const ordered = [
    ...usable.filter((i) => String(i.instance_name || '').toLowerCase() === preferred),
    ...usable.filter((i) => String(i.instance_name || '').toLowerCase() !== preferred),
  ];

  let lastError: string | null = null;
  for (const inst of ordered) {
    try {
      const raw = await fetchChatDetailsRaw(inst.base_url || DEFAULT_BASE, inst.instance_token, number, opts);
      const details = normalizeChatDetails(raw);
      if (hasUsefulData(details)) return { details, source_instance: inst.instance_name };
    } catch (e) {
      lastError = (e as Error)?.message || String(e);
    }
  }
  if (lastError) {
    // Sem telefone no log: só o motivo. O número é dado pessoal (LGPD).
    console.warn(`[chat-details] nenhuma instância resolveu o número: ${lastError}`);
  }
  return null;
}

// ============================================================
// Cache
// ============================================================

/** ChatDetails → linha de `whatsapp_chat_details_cache`. */
export function toCacheRow(
  instanceName: string,
  phone: string,
  d: ChatDetails,
  sourceInstance?: string | null,
): Record<string, unknown> {
  return {
    instance_name: instanceName,
    phone,
    name: pickBestName(d),
    image: d.image || d.image_preview || null,
    image_preview: d.image_preview,
    is_group: d.is_group,

    wa_id: d.wa_id,
    wa_fastid: d.wa_fastid,
    wa_chatid: d.wa_chatid,
    wa_chatlid: d.wa_chatlid,
    owner: d.owner,
    wa_name: d.wa_name,
    wa_contact_name: d.wa_contact_name,
    wa_archived: d.wa_archived,
    wa_is_blocked: d.wa_is_blocked,
    wa_is_pinned: d.wa_is_pinned,
    wa_unread_count: d.wa_unread_count,
    wa_mute_end_time: d.wa_mute_end_time,
    wa_labels: d.wa_labels,

    wa_is_group: d.wa_is_group,
    wa_is_group_admin: d.wa_is_group_admin,
    wa_is_group_announce: d.wa_is_group_announce,
    wa_is_group_community: d.wa_is_group_community,
    wa_is_group_locked: d.wa_is_group_locked,

    chatbot_summary: d.chatbot_summary,
    chatbot_last_trigger_id: d.chatbot_last_trigger_id,
    chatbot_disable_until: d.chatbot_disable_until,
    chatbot_status: d.chatbot_status,

    lead_name: d.lead_name,
    lead_full_name: d.lead_full_name,
    lead_email: d.lead_email,
    lead_personalid: d.lead_personalid,
    lead_status: d.lead_status,
    lead_notes: d.lead_notes,
    lead_tags: d.lead_tags,
    lead_assigned_attendant_id: d.lead_assigned_attendant_id,
    lead_is_ticket_open: d.lead_is_ticket_open,
    ...d.lead_fields,

    common_groups: d.common_groups,
    raw: { ...d.raw, __source_instance: sourceInstance || instanceName },
    fetched_at: new Date().toISOString(),
    sync_error: null,
    sync_attempts: 0,
  };
}

/** Linha do cache → ChatDetails, para quem leu do banco em vez da API. */
export function fromCacheRow(row: any): ChatDetails {
  const base = normalizeChatDetails(row?.raw || {});
  return {
    ...base,
    name: row?.name ?? base.name,
    image: row?.image ?? base.image,
    image_preview: row?.image_preview ?? base.image_preview,
    is_group: row?.is_group ?? base.is_group,
    // common_groups já vem parseado no banco; o raw é a fonte só se faltar.
    common_groups: Array.isArray(row?.common_groups) && row.common_groups.length
      ? (row.common_groups as CommonGroup[])
      : base.common_groups,
  };
}

async function saveToCache(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_chat_details_cache')
    .upsert(row as any, { onConflict: 'instance_name,phone' });
  if (error) console.warn('[chat-details] upsert do cache falhou:', error.message);
}

/** Marca a falha para o varredor não retentar o mesmo número indefinidamente. */
async function recordFailure(instanceName: string, phone: string, message: string): Promise<void> {
  const { data: existing } = await supabase
    .from('whatsapp_chat_details_cache')
    .select('sync_attempts')
    .eq('instance_name', instanceName)
    .eq('phone', phone)
    .maybeSingle();

  await supabase.from('whatsapp_chat_details_cache').upsert(
    {
      instance_name: instanceName,
      phone,
      sync_error: message.slice(0, 300),
      sync_attempts: ((existing as any)?.sync_attempts || 0) + 1,
      fetched_at: new Date().toISOString(),
    } as any,
    { onConflict: 'instance_name,phone' },
  );
}

export interface GetChatDetailsOptions {
  phone: string;
  instanceName: string;
  /** Instâncias já carregadas — evita reler `whatsapp_instances` por telefone. */
  instances?: InstanceRow[];
  /** Idade máxima aceitável do cache. Default 24h. */
  maxAgeMs?: number;
  /** Ignora o cache e vai direto à UazAPI. */
  refresh?: boolean;
  preview?: boolean;
}

export interface GetChatDetailsResult {
  details: ChatDetails | null;
  from_cache: boolean;
  source_instance: string | null;
  error: string | null;
}

export async function loadInstances(): Promise<InstanceRow[]> {
  const { data } = await supabase
    .from('whatsapp_instances')
    .select('instance_name, instance_token, base_url, is_active');
  return ((data as any[]) || []).filter((r) => r?.instance_token) as InstanceRow[];
}

/**
 * Detalhes de um chat, cache-first.
 * Cache fresco → devolve do banco (zero chamadas). Velho ou ausente → consulta
 * a UazAPI, grava e devolve. Falha → registra o erro e devolve o cache velho se
 * houver, porque dado desatualizado é melhor que tela vazia.
 */
export async function getChatDetails(opts: GetChatDetailsOptions): Promise<GetChatDetailsResult> {
  const phone = String(opts.phone || '').replace(/\D/g, '');
  if (!phone) return { details: null, from_cache: false, source_instance: null, error: 'telefone vazio' };

  const maxAge = opts.maxAgeMs ?? DEFAULT_TTL_MS;

  const { data: cached } = await supabase
    .from('whatsapp_chat_details_cache')
    .select('*')
    .ilike('instance_name', opts.instanceName)
    .eq('phone', phone)
    .maybeSingle();

  const age = (cached as any)?.fetched_at
    ? Date.now() - new Date((cached as any).fetched_at).getTime()
    : Infinity;

  if (!opts.refresh && cached && age < maxAge && !(cached as any).sync_error) {
    return {
      details: fromCacheRow(cached),
      from_cache: true,
      source_instance: (cached as any)?.raw?.__source_instance || opts.instanceName,
      error: null,
    };
  }

  const instances = opts.instances?.length ? opts.instances : await loadInstances();
  try {
    const found = await fetchDetailsAcrossInstances(instances, opts.instanceName, phone, {
      preview: opts.preview,
    });
    if (!found) {
      await recordFailure(opts.instanceName, phone, 'nenhuma instância retornou dados');
      return {
        details: cached ? fromCacheRow(cached) : null,
        from_cache: !!cached,
        source_instance: null,
        error: 'nenhuma instância retornou dados',
      };
    }
    await saveToCache(toCacheRow(opts.instanceName, phone, found.details, found.source_instance));
    return { details: found.details, from_cache: false, source_instance: found.source_instance, error: null };
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    await recordFailure(opts.instanceName, phone, msg);
    return {
      details: cached ? fromCacheRow(cached) : null,
      from_cache: !!cached,
      source_instance: null,
      error: msg,
    };
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch {
        out[idx] = null as unknown as R;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/** getChatDetails para vários telefones, com concorrência limitada. */
export async function getChatDetailsBatch(
  phones: string[],
  opts: Omit<GetChatDetailsOptions, 'phone'> & { concurrency?: number },
): Promise<Map<string, GetChatDetailsResult>> {
  const unique = Array.from(new Set(phones.map((p) => String(p || '').replace(/\D/g, '')).filter(Boolean)));
  const instances = opts.instances?.length ? opts.instances : await loadInstances();

  const results = await mapWithConcurrency(unique, opts.concurrency ?? DEFAULT_CONCURRENCY, (phone) =>
    getChatDetails({ ...opts, phone, instances }),
  );

  const map = new Map<string, GetChatDetailsResult>();
  unique.forEach((phone, i) => {
    map.set(phone, results[i] || { details: null, from_cache: false, source_instance: null, error: 'falhou' });
  });
  return map;
}

// ============================================================
// Aplicação em `contacts`
// ============================================================

/** Mapeamento herdado do import-group-participants — mantido para não divergir. */
const LEAD_FIELD_MAP = {
  cpf: 'lead_field12',
  rg: 'lead_field13',
  street: 'lead_field14',
  neighborhood: 'lead_field15',
  cep: 'lead_field16',
} as const;

function onlyDigits(v: unknown, max: number): string | null {
  const d = String(v || '').replace(/\D/g, '').slice(0, max);
  return d || null;
}

export interface ApplyToContactResult {
  matched: boolean;
  updated: boolean;
  fields: string[];
}

/**
 * Copia para `contacts` o que a UazAPI sabe e nós não.
 *
 * Regra deliberada: só preenche campo VAZIO. O que a equipe digitou no WhatsJUD
 * vence o que veio da API — a única exceção é o nome placeholder
 * ("Participante 1234"), que existe só para a linha não ficar sem rótulo.
 */
export async function applyDetailsToContact(
  phone: string,
  d: ChatDetails,
): Promise<ApplyToContactResult> {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return { matched: false, updated: false, fields: [] };

  const last10 = digits.slice(-10);
  const { data: existing } = await supabase
    .from('contacts')
    .select('id, full_name, email, cpf, rg, street, neighborhood, cep, avatar_url')
    .ilike('phone', `%${last10}`)
    .is('deleted_at', null)
    .limit(1);

  const row: any = existing?.[0];
  if (!row) return { matched: false, updated: false, fields: [] };

  const patch: Record<string, unknown> = {};
  const name = pickBestName(d);
  const isPlaceholder = !row.full_name || /^Participante\s/i.test(String(row.full_name));
  if (name && isPlaceholder) patch.full_name = name;
  if (d.lead_email && !row.email) patch.email = d.lead_email;

  const cpf = onlyDigits(d.lead_personalid || d.lead_fields[LEAD_FIELD_MAP.cpf], 11);
  if (cpf?.length === 11 && !row.cpf) patch.cpf = cpf;

  const rg = d.lead_fields[LEAD_FIELD_MAP.rg];
  if (rg && !row.rg) patch.rg = rg;

  const street = d.lead_fields[LEAD_FIELD_MAP.street];
  if (street && !row.street) patch.street = street;

  const neighborhood = d.lead_fields[LEAD_FIELD_MAP.neighborhood];
  if (neighborhood && !row.neighborhood) patch.neighborhood = neighborhood;

  const cep = onlyDigits(d.lead_fields[LEAD_FIELD_MAP.cep], 8);
  if (cep?.length === 8 && !row.cep) patch.cep = cep;

  // Foto é a exceção que se atualiza sozinha: o WhatsApp é a fonte da verdade
  // dela e a URL da UazAPI expira. Um avatar manual (upload nosso) não tem o
  // host da UazAPI, então não é sobrescrito.
  const avatar = d.image || d.image_preview;
  const avatarIsFromWa = !row.avatar_url || /uazapi|whatsapp\.net|pps\.whatsapp/i.test(String(row.avatar_url));
  if (avatar && avatarIsFromWa && avatar !== row.avatar_url) patch.avatar_url = avatar;

  if (Object.keys(patch).length === 0) {
    return { matched: true, updated: false, fields: [] };
  }

  patch.wa_synced_at = new Date().toISOString();
  const { error } = await supabase.from('contacts').update(patch).eq('id', row.id);
  if (error) {
    console.warn('[chat-details] update de contacts falhou:', error.message);
    return { matched: true, updated: false, fields: [] };
  }
  return { matched: true, updated: true, fields: Object.keys(patch).filter((k) => k !== 'wa_synced_at') };
}
