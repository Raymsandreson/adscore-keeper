// =============================================================================
// Carteira por fase do POP: onde cada processo está e quanto vale ali.
//
// A granularidade da fonte é (processo x cliente) — um processo de litisconsórcio
// tem um valor por pessoa. Ao agrupar por fase, os PROCESSOS são contados
// distintos e os VALORES somados por linha; misturar isso conta processo várias
// vezes.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';

export interface CarteiraLinha {
  processo_cnj: string;
  caso: string | null;
  status_jurimetria: string | null;
  cliente: string | null;
  valor_condenacao: number | null;
  valor_pago: number | null;
  marco_chave: string | null;
  marco_rotulo: string | null;
  marco_ordem: number | null;
  stage_id: string | null;
  marco_em: string | null;
  tem_acordo: boolean;
  suspenso: boolean;
  data_decisao: string | null;
  estagio_financeiro: string;
}

export interface GrupoFase {
  ordem: number;
  fase: string;
  processos: number;
  clientes: number;
  valor: number;
  pago: number;
  comAcordo: number;
  suspensos: number;
  porEstagio: Record<string, number>;
}

export type Periodo = 'tudo' | '30d' | '90d' | '12m';

const DIAS: Record<Periodo, number | null> = { tudo: null, '30d': 30, '90d': 90, '12m': 365 };

export function useCarteiraPorFase(periodo: Periodo = 'tudo') {
  const [linhas, setLinhas] = useState<CarteiraLinha[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      // `as any`: a view é nova e ainda não está nos tipos gerados.
      const { data, error } = await (db as any)
        .from('vw_pop_carteira_por_fase')
        .select('*');
      if (error) throw error;
      setLinhas((data || []) as CarteiraLinha[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  /**
   * O período filtra pela data em que o MARCO foi atingido — "o que entrou
   * nesta fase nos últimos 90 dias". Filtrar pela data da decisão responderia
   * outra pergunta (quando o valor foi fixado), e processo sem decisão sumiria.
   */
  const filtradas = useMemo(() => {
    const dias = DIAS[periodo];
    if (!dias) return linhas;
    const corte = new Date();
    corte.setDate(corte.getDate() - dias);
    const corteIso = corte.toISOString().slice(0, 10);
    return linhas.filter((l) => (l.marco_em || '') >= corteIso);
  }, [linhas, periodo]);

  const grupos = useMemo<GrupoFase[]>(() => {
    const mapa = new Map<string, GrupoFase & { _cnjs: Set<string> }>();
    for (const l of filtradas) {
      const fase = l.marco_rotulo || 'Sem marco detectado';
      const ordem = l.marco_ordem ?? 99;
      const g = mapa.get(fase) || {
        ordem, fase, processos: 0, clientes: 0, valor: 0, pago: 0,
        comAcordo: 0, suspensos: 0, porEstagio: {}, _cnjs: new Set<string>(),
      };
      g._cnjs.add(l.processo_cnj);
      if (l.cliente) g.clientes += 1;
      g.valor += Number(l.valor_condenacao || 0);
      g.pago += Number(l.valor_pago || 0);
      if (l.tem_acordo) g.comAcordo += 1;
      if (l.suspenso) g.suspensos += 1;
      g.porEstagio[l.estagio_financeiro] = (g.porEstagio[l.estagio_financeiro] || 0) + Number(l.valor_condenacao || 0);
      mapa.set(fase, g);
    }
    return [...mapa.values()]
      .map(({ _cnjs, ...g }) => ({ ...g, processos: _cnjs.size }))
      .sort((a, b) => a.ordem - b.ordem);
  }, [filtradas]);

  const totais = useMemo(() => {
    const porEstagio: Record<string, number> = {};
    const cnjs = new Set<string>();
    let valor = 0, pago = 0;
    for (const l of filtradas) {
      cnjs.add(l.processo_cnj);
      valor += Number(l.valor_condenacao || 0);
      pago += Number(l.valor_pago || 0);
      porEstagio[l.estagio_financeiro] = (porEstagio[l.estagio_financeiro] || 0) + Number(l.valor_condenacao || 0);
    }
    return { processos: cnjs.size, valor, pago, porEstagio };
  }, [filtradas]);

  return { linhas: filtradas, grupos, totais, loading, erro, recarregar: carregar };
}
