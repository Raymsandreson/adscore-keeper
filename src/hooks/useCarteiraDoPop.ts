// =============================================================================
// Carteira do POP — a régua de marcos com o dinheiro, o tempo e o custo em cima.
//
// Fonte: RPC `pop_carteira_marcos(board_id)` no Externo, uma linha por
// (processo × cliente) — granularidade do vocabulário FIDC. Este hook agrega:
//   - por MARCO: processos, valor por estágio financeiro, tempo médio no marco;
//   - TOTAIS: valor por estágio e da carteira, média de dias no marco, idade
//     média, índice de sucesso, custo (CAC dos leads) e rentabilidade.
//
// CUSTO: o snapshot de leads do Externo está com cac zerado (14/08/2026), então
// o hook busca o valor vivo no CLOUD (authClient, casa nativa dos leads) e usa
// o do Externo como fallback. Falha no Cloud não derruba a carteira.
//
// AVISO QUE A TELA REPETE: valor é "quanto o processo vale" (última decisão por
// cliente), não caixa do escritório — cota do cliente e honorário ainda não são
// separados. Rentabilidade aqui compara custo de aquisição com esse valor e com
// o PAGO realizado; leia com essa régua.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, authClient, ensureExternalSession } from '@/integrations/supabase';

export interface CarteiraPopLinha {
  process_id: string;
  lead_id: string | null;
  process_number: string | null;
  cnj_num: string;
  titulo: string | null;
  cliente: string | null;
  valor_condenacao: number | null;
  valor_pago: number | null;
  marco_chave: string | null;
  marco_rotulo: string | null;
  marco_ordem: number | null;
  marco_em: string | null;
  dias_no_marco: number | null;
  ajuizamento_em: string | null;
  idade_dias: number | null;
  tem_acordo: boolean;
  suspenso: boolean;
  estagio_financeiro: string;
  decidido: boolean;
  sucesso: boolean;
  /** Existe leitura de decisão na jurimetria (jm_decisoes) para este CNJ. */
  tem_leitura: boolean;
  custo_lead: number | null;
}

export interface ProcessoDoMarco {
  processId: string;
  cnj: string;
  titulo: string | null;
  clientes: number;
  valor: number;
  pago: number;
  diasNoMarco: number | null;
  estagio: string;
  temAcordo: boolean;
  suspenso: boolean;
}

export interface GrupoMarco {
  ordem: number;
  chave: string;
  rotulo: string;
  processos: ProcessoDoMarco[];
  valor: number;
  pago: number;
  diasMedio: number | null;
  porEstagio: Record<string, number>;
}

/** Ordem da régua financeira (decrescente de certeza do caixa, do vocabulário). */
export const ESTAGIO_ORDEM = [
  'PROJETADO', 'CONDENACAO', 'A_RECEBER', 'VENCIDO', 'EM_EXECUCAO', 'DEPOSITADO_EM_JUIZO', 'PAGO', 'INDEFERIDO',
];

export function useCarteiraDoPop(boardId: string | null) {
  const [linhas, setLinhas] = useState<CarteiraPopLinha[]>([]);
  const [custoCloud, setCustoCloud] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!boardId) { setLinhas([]); return; }
    setLoading(true);
    setErro(null);
    try {
      await ensureExternalSession();
      const { data, error } = await (db.rpc as unknown as (
        f: string, a: Record<string, unknown>,
      ) => PromiseLike<{ data?: CarteiraPopLinha[] | null; error?: { message?: string } | null }>)(
        'pop_carteira_marcos', { p_board_id: boardId },
      );
      if (error) throw new Error(error.message || 'pop_carteira_marcos falhou');
      const rows = data || [];
      setLinhas(rows);

      // CAC vivo no Cloud, em lotes — o snapshot do Externo é o fallback.
      const leadIds = [...new Set(rows.map(r => r.lead_id).filter(Boolean))] as string[];
      const mapa: Record<string, number> = {};
      for (let i = 0; i < leadIds.length; i += 200) {
        const chunk = leadIds.slice(i, i + 200);
        try {
          const { data: leads } = await authClient
            .from('leads')
            .select('id, cac, ad_spend_at_conversion')
            .in('id', chunk);
          for (const l of (leads || []) as { id: string; cac: number | null; ad_spend_at_conversion: number | null }[]) {
            const v = Number(l.cac ?? l.ad_spend_at_conversion ?? 0);
            if (v > 0) mapa[l.id] = v;
          }
        } catch {
          break; // sem Cloud, fica o fallback do Externo
        }
      }
      setCustoCloud(mapa);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const grupos = useMemo<GrupoMarco[]>(() => {
    // Primeiro consolida POR PROCESSO (linhas são processo × cliente).
    const porProcesso = new Map<string, ProcessoDoMarco & { _ordem: number; _chave: string; _rotulo: string }>();
    for (const l of linhas) {
      const p = porProcesso.get(l.process_id) || {
        processId: l.process_id,
        cnj: l.process_number || l.cnj_num,
        titulo: l.titulo,
        clientes: 0,
        valor: 0,
        pago: 0,
        diasNoMarco: l.dias_no_marco,
        estagio: l.estagio_financeiro,
        temAcordo: l.tem_acordo,
        suspenso: l.suspenso,
        _ordem: l.marco_ordem ?? -1,
        _chave: l.marco_chave || 'sem_marco',
        _rotulo: l.marco_rotulo || 'Sem marco detectado',
      };
      if (l.cliente) p.clientes += 1;
      p.valor += Number(l.valor_condenacao || 0);
      p.pago += Number(l.valor_pago || 0);
      porProcesso.set(l.process_id, p);
    }

    const mapa = new Map<string, GrupoMarco & { _dias: number[] }>();
    for (const p of porProcesso.values()) {
      const g = mapa.get(p._chave) || {
        ordem: p._ordem, chave: p._chave, rotulo: p._rotulo,
        processos: [], valor: 0, pago: 0, diasMedio: null, porEstagio: {}, _dias: [],
      };
      g.processos.push(p);
      g.valor += p.valor;
      g.pago += p.pago;
      g.porEstagio[p.estagio] = (g.porEstagio[p.estagio] || 0) + p.valor;
      if (p.diasNoMarco != null) g._dias.push(p.diasNoMarco);
      mapa.set(p._chave, g);
    }

    return [...mapa.values()]
      .map(({ _dias, ...g }) => ({
        ...g,
        processos: g.processos.sort((a, b) => (b.diasNoMarco ?? -1) - (a.diasNoMarco ?? -1)),
        diasMedio: _dias.length ? Math.round(_dias.reduce((s, d) => s + d, 0) / _dias.length) : null,
      }))
      .sort((a, b) => b.ordem - a.ordem);
  }, [linhas]);

  const totais = useMemo(() => {
    const processos = new Map<string, CarteiraPopLinha>();
    const porEstagio: Record<string, number> = {};
    let valor = 0, pago = 0;
    for (const l of linhas) {
      if (!processos.has(l.process_id)) processos.set(l.process_id, l);
      valor += Number(l.valor_condenacao || 0);
      pago += Number(l.valor_pago || 0);
      porEstagio[l.estagio_financeiro] = (porEstagio[l.estagio_financeiro] || 0) + Number(l.valor_condenacao || 0);
    }

    const procs = [...processos.values()];
    const dias = procs.map(p => p.dias_no_marco).filter((d): d is number => d != null);
    const idades = procs.map(p => p.idade_dias).filter((d): d is number => d != null);
    const decididos = procs.filter(p => p.decidido);
    // Índice de sucesso HONESTO: só entra no denominador o decidido AVALIÁVEL —
    // com leitura de decisão na jurimetria ou com acordo homologado. "Decidido
    // sem valor" sem leitura é buraco de captura, não derrota (medido em 14/08:
    // 239 decididos, 62 com leitura, 56 sucessos = 90%; dividir pelos 239 daria
    // 30% e mentiria para baixo).
    const avaliaveis = decididos.filter(p => p.tem_leitura || p.tem_acordo);
    const sucessos = avaliaveis.filter(p => p.sucesso);

    // Custo por LEAD distinto (um lead com 2 processos custa uma vez só).
    const custoPorLead = new Map<string, number>();
    for (const p of procs) {
      if (!p.lead_id) continue;
      const v = custoCloud[p.lead_id] ?? Number(p.custo_lead || 0);
      if (v > 0) custoPorLead.set(p.lead_id, v);
    }
    const custo = [...custoPorLead.values()].reduce((s, v) => s + v, 0);
    const leadsComCusto = custoPorLead.size;
    const leadsTotal = new Set(procs.map(p => p.lead_id).filter(Boolean)).size;

    return {
      processos: procs.length,
      semMarco: procs.filter(p => !p.marco_chave).length,
      valor,
      pago,
      porEstagio,
      mediaDiasNoMarco: dias.length ? Math.round(dias.reduce((s, d) => s + d, 0) / dias.length) : null,
      mediaIdadeDias: idades.length ? Math.round(idades.reduce((s, d) => s + d, 0) / idades.length) : null,
      decididos: decididos.length,
      avaliaveis: avaliaveis.length,
      semLeitura: decididos.length - avaliaveis.length,
      sucessos: sucessos.length,
      indiceSucesso: avaliaveis.length ? Math.round((sucessos.length / avaliaveis.length) * 100) : null,
      custo,
      leadsComCusto,
      leadsTotal,
      /** Realizado − custo: o que já voltou de fato contra o que foi gasto. */
      resultadoRealizado: pago - custo,
      /** Valor da carteira ÷ custo — potencial, no vocabulário do aviso da tela. */
      multiploPotencial: custo > 0 ? valor / custo : null,
    };
  }, [linhas, custoCloud]);

  return { linhas, grupos, totais, loading, erro, recarregar: carregar };
}
