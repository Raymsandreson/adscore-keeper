// Aplicação/remoção de etiquetas em chat (não confundir com /label/edit que cria a etiqueta).
//
// UazAPI: POST /chat/labels  body: { number, labelid, action: 'add' | 'remove' }
// Header: token = instance_token. number = só dígitos do telefone (sem @s.whatsapp.net).
//
// Se a UazAPI da instância usar variação diferente desse endpoint, ajustar aqui
// e tudo (apply-stage-label, webhook reverso, manual select) passa a funcionar.

const UAZAPI_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UAZAPI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface ChatLabelResult {
  ok: boolean;
  status: number;
  data: any;
  text: string;
  disconnected: boolean;
}

export async function uazapiChatLabel(
  baseUrl: string,
  token: string,
  numberDigits: string,
  labelId: string,
  action: 'add' | 'remove',
): Promise<ChatLabelResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/labels`;
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ number: numberDigits, labelid: labelId, action }),
  });
  const text = await r.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  const disconnected = !r.ok && (/no session/i.test(text) || r.status === 401);
  return { ok: r.ok, status: r.status, data, text, disconnected };
}

/**
 * Descobre todas as instâncias UazAPI ativas onde o telefone tem histórico
 * de mensagens. Usa whatsapp_messages como fonte de verdade (mesmo padrão
 * que sync-agent-labels usa indiretamente).
 */
export async function getInstancesForPhone(
  ext: any,
  phoneDigits: string,
): Promise<Array<{ instance_name: string; instance_token: string; base_url: string | null }>> {
  if (!phoneDigits) return [];
  const last8 = phoneDigits.slice(-8);

  // 1) Tenta via whatsapp_messages
  const { data: msgRows } = await ext
    .from('whatsapp_messages')
    .select('instance_name')
    .like('phone', `%${last8}`)
    .not('instance_name', 'is', null)
    .limit(200);

  const namesFromMsgs = new Set<string>(
    (msgRows || []).map((r: any) => String(r.instance_name).toLowerCase()).filter(Boolean),
  );

  // 2) Se não achou nada, cai pra TODAS as instâncias ativas (comportamento de sync-agent-labels)
  let nameFilter: string[] | null = namesFromMsgs.size > 0 ? Array.from(namesFromMsgs) : null;

  let query = ext
    .from('whatsapp_instances')
    .select('instance_name, instance_token, base_url')
    .not('instance_token', 'is', null);

  if (nameFilter) {
    // Case-insensitive: faz post-filter no client
    const { data: allInst } = await query;
    return (allInst || []).filter((i: any) =>
      nameFilter!.includes(String(i.instance_name).toLowerCase()),
    );
  }

  const { data: allInst } = await query;
  return (allInst || []) as any[];
}
