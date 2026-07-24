// Etapas derivadas da coluna "status" da planilha do funil (Meta Ads).
// Usado quando FunnelSheetConfig.stagesFromSheetStatus = true: a distribuição
// da Visão Geral e o filtro do painel lateral agrupam pelo status digitado
// pelos operadores na planilha, não pelas etapas do kanban.

export interface SheetStatusStageCount {
  id: string;
  name: string;
  color: string;
  count: number;
}

export const SHEET_STATUS_CLOSED_KEY = "fechado";
const NO_STATUS_KEY = "sem status";

// Ordem de funil: neutros/em progresso primeiro, desfechos no final.
const CANONICAL_STAGES: { key: string; label: string; color: string }[] = [
  { key: NO_STATUS_KEY, label: "Sem status", color: "#94a3b8" },
  { key: "primeiro contato", label: "Primeiro Contato", color: "#3b82f6" },
  { key: "sem resposta", label: "Sem resposta", color: "#f59e0b" },
  { key: "em andamento", label: "Em andamento", color: "#06b6d4" },
  { key: "follow up", label: "Follow Up", color: "#8b5cf6" },
  { key: "aguar. doc", label: "Aguar. Doc", color: "#d946ef" },
  { key: SHEET_STATUS_CLOSED_KEY, label: "Fechado", color: "#10b981" },
  { key: "inviavel", label: "Inviável", color: "#ef4444" },
  { key: "n errado", label: "Nº Errado", color: "#f97316" },
  { key: "cancelado", label: "Cancelado", color: "#64748b" },
];

// Grafias diferentes que significam o mesmo status na planilha.
const ALIASES: Record<string, string> = {
  errado: "n errado",
  "numero errado": "n errado",
  "aguar doc": "aguar. doc",
  "aguardando doc": "aguar. doc",
};

/** Chave canônica do status: sem acento/caixa/°, espaços colapsados, aliases aplicados. */
export function sheetStatusKey(raw: string | undefined | null): string {
  const s = (raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°º]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return NO_STATUS_KEY;
  return ALIASES[s] || s;
}

const EXTRA_PALETTE = ["#6366f1", "#14b8a6", "#a855f7", "#f43f5e", "#84cc16"];

/**
 * Conta leads por status. Retorna só etapas com pelo menos 1 lead, na ordem
 * canônica; status desconhecidos (digitados novos na planilha) entram no final
 * por contagem, com o rótulo original.
 */
export function buildSheetStatusStages(
  leads: Array<{ sheet_status?: string | null }>,
): SheetStatusStageCount[] {
  const counts = new Map<string, { count: number; firstRaw: string }>();
  for (const l of leads) {
    const key = sheetStatusKey(l.sheet_status);
    const cur = counts.get(key);
    if (cur) cur.count++;
    else counts.set(key, { count: 1, firstRaw: (l.sheet_status || "").trim() });
  }

  const stages: SheetStatusStageCount[] = [];
  const known = new Set(CANONICAL_STAGES.map((c) => c.key));
  for (const c of CANONICAL_STAGES) {
    const found = counts.get(c.key);
    if (found) stages.push({ id: c.key, name: c.label, color: c.color, count: found.count });
  }
  const unknown = Array.from(counts.entries())
    .filter(([k]) => !known.has(k))
    .sort((a, b) => b[1].count - a[1].count);
  unknown.forEach(([k, v], i) => {
    stages.push({
      id: k,
      name: v.firstRaw || k,
      color: EXTRA_PALETTE[i % EXTRA_PALETTE.length],
      count: v.count,
    });
  });
  return stages;
}
