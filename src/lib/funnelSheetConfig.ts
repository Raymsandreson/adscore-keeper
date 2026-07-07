// Mapeia funis (kanban_boards) que têm planilha do Meta Ads conectada.
// Modelo original: BPC-LOAS. Estendido pra Auxílio Acidente com a mesma estrutura
// (uma aba por operador + gateway do Google Sheets).

export type FunnelSheetKind = "bpc" | "aux-acidente";

export interface FunnelSheetConfig {
  spreadsheetId: string;
  kind: FunnelSheetKind;
  label: string;
  /** Rótulo curto para a UI (ex: "Painel detalhado BPC"). */
  panelTitle: string;
}

const BPC_SPREADSHEET_ID = "1EXB6oFovhX2LOHsC2X20LFk-JVIkjk-NR5Er4cUn6Qw";
const AUX_ACIDENTE_SPREADSHEET_ID = "1R4NGEmQSXYMjdsQI6cIw5aRQhppQ9O6CIf-u-pOyjKM";

export function getFunnelSheetConfig(boardName: string | undefined | null): FunnelSheetConfig | null {
  if (!boardName) return null;
  const name = boardName.toLowerCase();
  if (/aux[íi]lio\s*acidente|aux\.?\s*acidente/.test(name)) {
    return {
      spreadsheetId: AUX_ACIDENTE_SPREADSHEET_ID,
      kind: "aux-acidente",
      label: "Auxílio Acidente",
      panelTitle: "Painel detalhado Auxílio Acidente",
    };
  }
  if (/bpc|autis/.test(name)) {
    return {
      spreadsheetId: BPC_SPREADSHEET_ID,
      kind: "bpc",
      label: "BPC-LOAS",
      panelTitle: "Painel detalhado BPC",
    };
  }
  return null;
}

/** Compat: mantém a checagem antiga (`isBpcFunnel`) apenas quando quisermos algo BPC-específico. */
export function isBpcFunnel(boardName: string): boolean {
  return getFunnelSheetConfig(boardName)?.kind === "bpc";
}

/** Detecta se o funil tem QUALQUER planilha conectada (BPC ou Aux Acidente). */
export function hasFunnelSheet(boardName: string): boolean {
  return getFunnelSheetConfig(boardName) !== null;
}
