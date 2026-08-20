import { useState, useEffect, useCallback } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { toast } from 'sonner';

/**
 * Fila de discagem: os leads que chegaram e ainda não receberam ligação.
 *
 * Serve para alimentar o discador da Callface — hoje por planilha, porque a API
 * pública deles não expõe endpoint de originar chamada (só `integrate-app/register`
 * e o webhook de retorno). A metade de cá não depende deles.
 *
 * Medição de 20/08/2026 que explica os filtros: dos 2.700 leads que chegaram em
 * 30 dias, 94% não têm telefone nenhum — 84% do volume é `google_alerts`, que é
 * notícia raspada, não pessoa. Por isso a fila filtra por telefone válido em vez
 * de listar "leads novos".
 */

const TETO = 2000;

export interface DialLead {
  id: string;
  lead_name: string | null;
  lead_phone: string | null;
  /** Só dígitos, com 55 na frente — como o sheet-lead-ingest normaliza. */
  telefone: string;
  board_id: string | null;
  board_name: string;
  source: string | null;
  created_at: string;
  status: string | null;
}

export interface DialQueueFilters {
  boardId: string;
  source: string;
  dias: number;
  esconderJaLigados: boolean;
}

/** Mesma normalização do railway `sheet-lead-ingest.ts`, para casar com o que já entra. */
export function normalizarTelefone(bruto: unknown): string {
  const d = String(bruto ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= 12 && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d;
}

/** 55 + DDD + 8 ou 9 dígitos. Fora disso o discador só queima tentativa. */
export function telefoneDiscavel(bruto: unknown): boolean {
  const d = normalizarTelefone(bruto);
  return d.length === 12 || d.length === 13;
}

/** PostgREST corta em 1000 — paginar sempre, e avisar se bater no teto. */
async function paginar<T>(monta: (de: number, ate: number) => any, teto = TETO): Promise<{ linhas: T[]; truncado: boolean }> {
  const linhas: T[] = [];
  for (let de = 0; de < teto; de += 1000) {
    const { data, error } = await monta(de, de + 999);
    if (error) throw error;
    const lote = (data || []) as T[];
    linhas.push(...lote);
    if (lote.length < 1000) return { linhas, truncado: false };
  }
  return { linhas, truncado: true };
}

export function useDialQueue(filtros: DialQueueFilters) {
  const [leads, setLeads] = useState<DialLead[]>([]);
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [truncado, setTruncado] = useState(false);
  /** Quantos saíram por já terem recebido ligação — o usuário merece ver o desconto. */
  const [descartadosPorLigacao, setDescartadosPorLigacao] = useState(0);

  const buscar = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();

      const { data: bs } = await externalSupabase.from('kanban_boards').select('id, name').order('display_order');
      const listaBoards = ((bs || []) as any[]).map((b) => ({ id: b.id, name: b.name }));
      setBoards(listaBoards);
      const nomeBoard = Object.fromEntries(listaBoards.map((b) => [b.id, b.name]));

      const corte = new Date(Date.now() - filtros.dias * 86400_000).toISOString();

      const { linhas: brutos, truncado: cortou } = await paginar<any>((de, ate) => {
        let q = externalSupabase
          .from('leads')
          .select('id, lead_name, lead_phone, board_id, source, created_at, status')
          .is('deleted_at', null)
          .not('lead_phone', 'is', null)
          .gte('created_at', corte)
          .order('created_at', { ascending: false })
          .range(de, ate);
        if (filtros.boardId !== 'all') q = q.eq('board_id', filtros.boardId);
        if (filtros.source !== 'all') q = q.eq('source', filtros.source);
        return q;
      });
      setTruncado(cortou);

      // Origens da janela toda, para o seletor não esconder opção que existe.
      setSources([...new Set(brutos.map((l) => l.source).filter(Boolean))].sort() as string[]);

      const discaveis = brutos.filter((l) => telefoneDiscavel(l.lead_phone));

      // Quem já recebeu ligação sai da fila: por vínculo de lead e por telefone,
      // porque 80% das ligações da Callface chegam sem lead_id (lista externa).
      let jaLigados = new Set<string>();
      let telefonesLigados = new Set<string>();
      if (filtros.esconderJaLigados && discaveis.length > 0) {
        const ids = discaveis.map((l) => l.id);
        for (let i = 0; i < ids.length; i += 200) {
          const { data: cr } = await externalSupabase
            .from('call_records')
            .select('lead_id, contact_phone')
            .in('lead_id', ids.slice(i, i + 200));
          for (const c of (cr || []) as any[]) if (c.lead_id) jaLigados.add(c.lead_id);
        }
        const { data: recentes } = await externalSupabase
          .from('call_records')
          .select('contact_phone')
          .gte('created_at', corte)
          .not('contact_phone', 'is', null)
          .limit(1000);
        telefonesLigados = new Set(
          ((recentes || []) as any[]).map((c) => normalizarTelefone(c.contact_phone)).filter(Boolean),
        );
      }

      const fila: DialLead[] = [];
      let descartados = 0;
      for (const l of discaveis) {
        const tel = normalizarTelefone(l.lead_phone);
        if (filtros.esconderJaLigados && (jaLigados.has(l.id) || telefonesLigados.has(tel))) {
          descartados++;
          continue;
        }
        fila.push({
          id: l.id,
          lead_name: l.lead_name,
          lead_phone: l.lead_phone,
          telefone: tel,
          board_id: l.board_id,
          board_name: nomeBoard[l.board_id] || '—',
          source: l.source,
          created_at: l.created_at,
          status: l.status,
        });
      }

      // Um telefone, uma linha: o mesmo número em dois leads viraria ligação repetida.
      const vistos = new Set<string>();
      setLeads(fila.filter((l) => (vistos.has(l.telefone) ? false : (vistos.add(l.telefone), true))));
      setDescartadosPorLigacao(descartados);
    } catch (e) {
      console.error('[fila de discagem] falhou:', e);
      toast.error('Não foi possível montar a fila de discagem');
    } finally {
      setLoading(false);
    }
  }, [filtros.boardId, filtros.source, filtros.dias, filtros.esconderJaLigados]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  return { leads, boards, sources, loading, truncado, descartadosPorLigacao, refetch: buscar };
}
