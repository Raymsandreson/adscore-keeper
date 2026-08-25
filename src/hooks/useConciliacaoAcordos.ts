// =============================================================================
// Conciliação dos acordos de um POP — "o que foi lançado bate com o acordo?".
//
// Pedido do Raym em 25/08/2026, depois que a conferência do caso 88 mostrou
// R$ 59.561,26 de divergência só no honorário. Medido na carteira inteira: de
// 38 acordos com lançamento, 17 batem, 11 têm honorário faltando (R$ 416.962,51)
// e 10 têm sobrando (R$ 172.693,35).
//
// A régua mora em `conciliacaoAcordo.ts` e é conferida contra o termo de acordo
// real. Aqui só se junta o dado: quais processos do POP têm acordo homologado, e
// quanto foi lançado em cada um.
//
// Tudo SELECT. A multa ("Multa pelo descumprimento" na observação) sai da conta
// do acordo e viaja separada — ela é devida, mas não é o acordo.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { conciliarAcordo, type Conciliacao } from '@/lib/conciliacaoAcordo';

interface Consulta { data: Record<string, unknown>[] | null; error: { message?: string } | null }
const externo = db as unknown as { from: (t: string) => { select: (c: string) => unknown } };

export interface AcordoConciliado {
  processId: string;
  cnj: string;
  titulo: string | null;
  dataAcordo: string | null;
  conciliacao: Conciliacao;
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const ehMulta = (obs: unknown) => /multa pelo descump/i.test(String(obs ?? ''));

export function useConciliacaoAcordos(boardId: string | null | undefined) {
  const [acordos, setAcordos] = useState<AcordoConciliado[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!boardId) { setAcordos([]); return; }
    setLoading(true); setErro(null);
    try {
      await ensureExternalSession();

      const marcos = await (externo.from('process_pop_marcos')
        .select('process_id, marco_chave, data_detectada') as { eq: (c: string, v: unknown) => Promise<Consulta> })
        .eq('board_id', boardId);
      if (marcos.error) throw new Error(marcos.error.message || 'Falha ao ler os marcos do POP');

      const comAcordo = new Map<string, string | null>();
      for (const m of marcos.data || []) {
        if (String(m.marco_chave) !== 'acordo_homologado') continue;
        comAcordo.set(String(m.process_id), (m.data_detectada as string) ?? null);
      }
      if (comAcordo.size === 0) { setAcordos([]); return; }

      const procs = await (externo.from('lead_processes')
        .select('id, process_number, title') as { in: (c: string, v: unknown[]) => Promise<Consulta> })
        .in('id', [...comAcordo.keys()]);
      if (procs.error) throw new Error(procs.error.message || 'Falha ao ler os processos');

      const porCnj = new Map<string, { id: string; cnj: string; titulo: string | null }>();
      for (const p of procs.data || []) {
        const cnj = String(p.process_number ?? '');
        if (!cnj) continue;
        porCnj.set(soDigitos(cnj), { id: String(p.id), cnj, titulo: (p.title as string) ?? null });
      }

      const lanc = await (externo.from('jm_lancamentos')
        .select('processo_cnj, categoria, pessoa, valor_caixa, observacao') as {
          in: (c: string, v: unknown[]) => Promise<Consulta> })
        .in('processo_cnj', [...porCnj.values()].map(p => p.cnj));
      if (lanc.error) throw new Error(lanc.error.message || 'Falha ao ler os lançamentos');

      const somas = new Map<string, { cliente: number; hc: number; hs: number; multa: number }>();
      for (const l of lanc.data || []) {
        const k = soDigitos(l.processo_cnj);
        if (!porCnj.has(k)) continue;
        const s = somas.get(k) ?? { cliente: 0, hc: 0, hs: 0, multa: 0 };
        const cat = String(l.categoria ?? '').toLowerCase();
        const valor = n(l.valor_caixa);
        if (ehMulta(l.observacao)) s.multa += valor;
        else if (cat.includes('indeniza')) s.cliente += valor;
        else if (String(l.pessoa ?? '') === 'HS') s.hs += valor;
        else if (cat.includes('honor') || cat.includes('atrasado')) s.hc += valor;
        somas.set(k, s);
      }

      setAcordos([...porCnj.entries()].map(([k, p]) => ({
        processId: p.id, cnj: p.cnj, titulo: p.titulo,
        dataAcordo: comAcordo.get(p.id) ?? null,
        conciliacao: conciliarAcordo(somas.get(k) ?? { cliente: 0, hc: 0 }),
      })));
    } catch (e) {
      setErro(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { void carregar(); }, [carregar]);

  return { acordos, loading, erro, recarregar: carregar };
}
