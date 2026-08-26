// Regras de destino do zap do INSS que não tocam banco nem rede — ficam à
// parte porque o vitest da raiz só consegue importar módulo puro (o
// `inss-zap.ts` instancia o cliente do Supabase no import).

const SAIU_DO_GRUPO_MS = 7 * 24 * 60 * 60 * 1000;
const PREFERIDAS = ['atendimento previdenciario', 'atendimento previdenciario 2', 'atendimento processual'];
export const normalizarNome = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Ordena os espelhos do grupo: primeiro as instâncias da firma que ainda estão
 * dentro, depois as demais vivas, da mais recente para a mais antiga.
 * Pura, para poder ser testada sem banco.
 */
export function escolherCandidatas(
  rows: { instance_name: string; created_at: string }[],
): string[] {
  if (!rows || rows.length === 0) return [];
  const ordenadas = [...rows].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const maisNova = Date.parse(ordenadas[0].created_at);
  const vivas = ordenadas.filter((r) => maisNova - Date.parse(r.created_at) <= SAIU_DO_GRUPO_MS);
  const out: string[] = [];
  const push = (n?: string | null) => {
    if (n && !out.some((x) => normalizarNome(x) === normalizarNome(n))) out.push(n);
  };
  for (const nome of PREFERIDAS) {
    const hit = vivas.find((r) => normalizarNome(r.instance_name) === nome);
    if (hit) push(hit.instance_name);
  }
  for (const r of vivas) push(r.instance_name);
  return out;
}

/**
 * Número de destino da UazAPI. O `group_jid` está gravado dos dois jeitos —
 * 1.262 com `@g.us` e 945 só com os dígitos (medido em 26/08/2026) — e o
 * endpoint quer o JID do grupo.
 */
export function jidDeGrupo(groupJid: string): string {
  const bruto = (groupJid || '').trim();
  if (bruto.includes('@')) return bruto;
  const digitos = bruto.replace(/\D/g, '');
  return digitos.length >= 15 ? `${digitos}@g.us` : bruto;
}

/** Erro do body em texto legível — `String(body)` virava "[object Object]". */
export function descreverErro(r: { status: number; body?: any }): string {
  let detalhe = '';
  try {
    detalhe = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  } catch {
    detalhe = String(r.body);
  }
  return `uazapi ${r.status}: ${(detalhe || '').slice(0, 300)}`;
}
