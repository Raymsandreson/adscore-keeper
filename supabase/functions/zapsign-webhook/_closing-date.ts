// Helpers extraídos de index.ts pra permitir testes unitários determinísticos.
//
// Regra de negócio: ao marcar um lead como fechado, a data `became_client_date`
// deve refletir QUANDO o cliente virou cliente de verdade, não quando o sistema
// processou. Em revogações/re-importações, o registro nasce hoje mas o grupo do
// WhatsApp já existe há meses/anos — nesse caso, a verdade é a data do grupo.
//
// Prioridade:
//   1) data de criação do grupo WhatsApp vinculado (se há grupo)
//   2) signed_at do ZapSign
//   3) hoje (último recurso)

/** Função pura: aplica a prioridade groupDate > signedAtIso > today. */
export function resolveClosingDate(
  groupDate: string | null | undefined,
  signedAtIso: string | null | undefined,
  todayIso: string = new Date().toISOString(),
): string {
  if (groupDate && /^\d{4}-\d{2}-\d{2}$/.test(groupDate)) return groupDate;
  if (signedAtIso) {
    const sliced = String(signedAtIso).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(sliced)) return sliced;
  }
  return todayIso.slice(0, 10);
}

/**
 * Busca a data de criação do grupo WhatsApp vinculado ao lead via UazAPI.
 * Retorna null quando não há grupo, instância indisponível, ou API falha.
 *
 * `fetchImpl` é injetável para testes — em produção é o fetch global.
 */
export async function fetchGroupCreationDate(
  client: any,
  leadId: string,
  instanceName?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    let groupJid: string | null = null;
    const { data: gRow } = await client
      .from('lead_whatsapp_groups')
      .select('group_jid')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    groupJid = (gRow as any)?.group_jid || null;
    if (!groupJid) {
      const { data: lRow } = await client
        .from('leads').select('whatsapp_group_id').eq('id', leadId).maybeSingle();
      groupJid = (lRow as any)?.whatsapp_group_id || null;
    }
    if (!groupJid) return null;
    if (!groupJid.includes('@')) groupJid = `${groupJid}@g.us`;

    let inst: any = null;
    if (instanceName) {
      const { data } = await client
        .from('whatsapp_instances')
        .select('instance_token, base_url')
        .ilike('instance_name', instanceName)
        .limit(1)
        .maybeSingle();
      inst = data;
    }
    if (!inst?.instance_token) {
      const { data } = await client
        .from('whatsapp_instances')
        .select('instance_token, base_url')
        .eq('is_active', true)
        .not('instance_token', 'is', null)
        .limit(1)
        .maybeSingle();
      inst = data;
    }
    if (!inst?.instance_token) return null;

    const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetchImpl(`${baseUrl}/group/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: inst.instance_token },
      body: JSON.stringify({ id: groupJid }),
      signal: ctrl.signal,
    }).catch(() => null);
    clearTimeout(tid);
    if (!res || !res.ok) {
      // consume body to avoid resource leak
      try { await res?.text(); } catch { /* noop */ }
      return null;
    }
    const data: any = await res.json().catch(() => ({}));
    const ts = data?.creation || data?.GroupCreated || data?.created_at
      || data?.data?.creation || data?.data?.GroupCreated;
    if (!ts) return null;
    const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch (e: any) {
    console.warn('[zapsign-webhook] fetchGroupCreationDate failed:', e?.message);
    return null;
  }
}
