// =============================================================================
// Marcos de um POP. Usado em dois lugares do editor, por isso vive num hook:
//   - a seção "Marcos do POP", que lista a régua;
//   - a seção "Resultados possíveis do POP", que mostra o estágio financeiro
//     que cada resultado implica — derivado pelo marco, não digitado.
//
// É essa ponte que evita as "duas medições" que o usuário apontou (08/08/2026):
//   resultado do POP → marco → estágio financeiro
// Uma entrada só (o resultado), dois eixos derivados.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';

export interface PopMarco {
  id: string;
  chave: string;
  rotulo: string;
  ordem: number;
  stage_id: string | null;
  terminal: boolean;
  eventual: boolean;
  atravessa_fases: boolean;
  estagio_financeiro_sugerido: string | null;
}

export const ESTAGIO_LABEL: Record<string, string> = {
  PROJETADO: 'Projetado',
  CONDENACAO: 'Condenação',
  A_RECEBER: 'A receber',
  VENCIDO: 'Vencido',
  EM_EXECUCAO: 'Em execução',
  DEPOSITADO_EM_JUIZO: 'Depositado em juízo',
  PAGO: 'Pago',
  INDEFERIDO: 'Indeferido',
};

export function usePopMarcos(boardId: string | null) {
  const [marcos, setMarcos] = useState<PopMarco[]>([]);
  const [sinais, setSinais] = useState<Record<string, { tpu: number; documento: number }>>({});
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!boardId) { setMarcos([]); setSinais({}); setLoading(false); return; }
    setLoading(true);
    try {
      // `as any`: pop_marcos/pop_marco_sinais ainda não estão nos tipos gerados.
      const { data: ms } = await (db as any)
        .from('pop_marcos')
        .select('id, chave, rotulo, ordem, stage_id, terminal, eventual, atravessa_fases, estagio_financeiro_sugerido')
        .eq('board_id', boardId)
        .order('ordem');

      const lista = (ms || []) as PopMarco[];
      setMarcos(lista);

      if (lista.length) {
        const { data: ss } = await (db as any)
          .from('pop_marco_sinais')
          .select('pop_marco_id, tipo')
          .in('pop_marco_id', lista.map((m) => m.id));
        const contagem: Record<string, { tpu: number; documento: number }> = {};
        for (const s of (ss || []) as { pop_marco_id: string; tipo: string }[]) {
          const atual = contagem[s.pop_marco_id] || { tpu: 0, documento: 0 };
          if (s.tipo === 'documento') atual.documento += 1;
          else atual.tpu += 1;
          contagem[s.pop_marco_id] = atual;
        }
        setSinais(contagem);
      } else {
        setSinais({});
      }
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { void carregar(); }, [carregar]);

  /** chave do marco → estágio financeiro que ele implica. */
  const estagioPorMarco = useMemo(() => {
    const mapa: Record<string, string> = {};
    for (const m of marcos) {
      if (m.estagio_financeiro_sugerido) mapa[m.chave] = m.estagio_financeiro_sugerido;
    }
    return mapa;
  }, [marcos]);

  /** Marcos que são fase da régua, na ordem. */
  const fases = useMemo(() => marcos.filter((m) => !m.atravessa_fases), [marcos]);
  /** Marcos que acontecem em qualquer ponto (acordo) — são resultado, não fase. */
  const atravessam = useMemo(() => marcos.filter((m) => m.atravessa_fases), [marcos]);

  return { marcos, fases, atravessam, sinais, estagioPorMarco, loading, recarregar: carregar };
}
