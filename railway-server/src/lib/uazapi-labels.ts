// Helper compartilhado pra chamadas de etiquetas (labels) na UazAPI.
// Usado por manage-uazapi-label (dialog manual) e sync-agent-labels (auto).
// Manter UMA implementação garante que o que funciona no dialog funciona no sync.
//
// Endpoint: POST /label/edit
//   create: { labelid: 'new', name, color }
//   update: { labelid, name, color }
//   delete: { labelid, delete: true }
// `color` é INT 0..19 (paleta Meta). Default 0.

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

export interface UazapiLabelCallResult {
  ok: boolean;
  data: any;
  status: number;
  text: string;
  disconnected: boolean;
}

async function postLabelEdit(baseUrl: string, token: string, body: Record<string, unknown>): Promise<UazapiLabelCallResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/label/edit`;
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  const disconnected = !r.ok && (/no session/i.test(text) || r.status === 401);
  return { ok: r.ok, data, status: r.status, text, disconnected };
}

export async function uazapiCreateLabel(baseUrl: string, token: string, name: string, color = 0): Promise<UazapiLabelCallResult> {
  return postLabelEdit(baseUrl, token, { labelid: 'new', name, color });
}

export async function uazapiUpdateLabel(baseUrl: string, token: string, labelId: string, name: string, color = 0): Promise<UazapiLabelCallResult> {
  return postLabelEdit(baseUrl, token, { labelid: labelId, name, color });
}

export async function uazapiDeleteLabel(baseUrl: string, token: string, labelId: string): Promise<UazapiLabelCallResult> {
  return postLabelEdit(baseUrl, token, { labelid: labelId, delete: true });
}

export interface UazapiListedLabel {
  id: string;
  name: string;
  color: number | null;
}

export async function uazapiListLabels(baseUrl: string, token: string): Promise<UazapiListedLabel[] | null> {
  const r = await fetchWithTimeout(`${baseUrl.replace(/\/$/, '')}/labels`, {
    method: 'GET',
    headers: { token },
  });
  if (!r.ok) return null;
  const data: any = await r.json().catch(() => null);
  const labels: any[] = Array.isArray(data) ? data : (data?.labels || []);
  return labels.map((l: any) => ({
    id: String(l.id ?? l.labelId ?? l.labelid ?? ''),
    name: String(l.name ?? l.label ?? ''),
    color: typeof l.color === 'number' ? l.color : null,
  })).filter((l) => l.id && l.name);
}

export async function uazapiFindLabelByName(baseUrl: string, token: string, labelName: string): Promise<UazapiListedLabel | null> {
  const all = await uazapiListLabels(baseUrl, token);
  if (!all) return null;
  const target = labelName.trim().toLowerCase();
  const matches = all.filter((l) => l.name.trim().toLowerCase() === target);
  return matches[matches.length - 1] || null;
}
