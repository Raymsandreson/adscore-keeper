import { useEffect, useRef } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';

// Allowlist (case-insensitive regex). Apenas estes funis recebem auto-bootstrap
// de etiquetas WhatsApp espelhadas com as etapas do Kanban.
const AUTO_SYNC_BOARD_PATTERN = /(bpc|autis|acidente\s*de\s*trabalho)/i;

const sessionKey = (boardId: string) => `stage-labels-bootstrap:${boardId}`;

/**
 * Dispara `sync-stage-labels` uma vez por sessão para boards do piloto
 * (BPC - Autismo e Acidente de Trabalho). Garante que toda etapa do Kanban
 * tenha a etiqueta correspondente nas instâncias UazAPI antes do operador
 * usar a tela. Idempotente do lado do servidor.
 */
export function useEnsureStageLabels(boards: Array<{ id: string; name: string }>) {
  const fired = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!boards?.length) return;
    for (const b of boards) {
      if (!b?.id || !b?.name) continue;
      if (!AUTO_SYNC_BOARD_PATTERN.test(b.name)) continue;
      if (fired.current.has(b.id)) continue;
      try {
        if (typeof window !== 'undefined' && window.sessionStorage.getItem(sessionKey(b.id))) {
          fired.current.add(b.id);
          continue;
        }
      } catch {}
      fired.current.add(b.id);
      cloudFunctions
        .invoke('sync-stage-labels', { body: { board_id: b.id, operation: 'upsert' } })
        .then(({ error }) => {
          if (error) {
            console.warn('[useEnsureStageLabels] sync failed', b.name, error);
            return;
          }
          try { window.sessionStorage.setItem(sessionKey(b.id), '1'); } catch {}
        })
        .catch((err) => console.warn('[useEnsureStageLabels] sync threw', b.name, err));
    }
  }, [boards]);
}
