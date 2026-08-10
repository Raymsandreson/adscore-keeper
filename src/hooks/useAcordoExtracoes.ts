// =============================================================================
// Extrações de ACORDO lidas pela IA dentro das atas de audiência, agrupadas por
// processo para a revisão humana.
//
// Por que agrupar por processo e não listar ata a ata: um mesmo acordo costuma
// aparecer em mais de uma ata do processo (a ata da audiência e a ata que
// registra a homologação, às vezes com dias de diferença). Quem revisa decide
// sobre O ACORDO, não sobre cada PDF — daí a ata mais antiga virar a principal e
// as outras ficarem como evidência de apoio.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db } from '@/integrations/supabase';

export interface AcordoDados {
  valor_total: number | null;
  n_parcelas: number | null;
  valor_parcela: number | null;
  devedor: string | null;
  parcial: boolean | null;
  prossegue_contra: string | null;
  por_reclamante: { nome: string; valor: number | null }[] | null;
}

export interface AcordoExtracao {
  id: string;
  documento_id: number;
  processo_cnj: string;
  data_extraida: string | null;
  dados: AcordoDados;
  confianca: 'alta' | 'media' | 'baixa';
  motivo: string | null;
  trecho: string | null;
  revisado: boolean;
  aprovado: boolean | null;
  criado_em: string;
}

export interface AcordoProcesso {
  processo_cnj: string;
  /** A extração mais antiga do processo — é ela que define a data do marco. */
  principal: AcordoExtracao;
  /** Demais atas do mesmo processo que também apontaram acordo. */
  apoio: AcordoExtracao[];
  revisado: boolean;
  aprovado: boolean | null;
}

function agrupar(linhas: AcordoExtracao[]): AcordoProcesso[] {
  const porProcesso = new Map<string, AcordoExtracao[]>();
  for (const l of linhas) {
    const lista = porProcesso.get(l.processo_cnj) || [];
    lista.push(l);
    porProcesso.set(l.processo_cnj, lista);
  }

  const out: AcordoProcesso[] = [];
  for (const [cnj, lista] of porProcesso) {
    // Sem data não dá pra ordenar por ela: vai pro fim, não pro começo.
    const ordenada = [...lista].sort((a, b) => {
      if (!a.data_extraida) return 1;
      if (!b.data_extraida) return -1;
      return a.data_extraida.localeCompare(b.data_extraida);
    });
    const [principal, ...apoio] = ordenada;
    out.push({
      processo_cnj: cnj,
      principal,
      apoio,
      revisado: ordenada.every((l) => l.revisado),
      aprovado: principal.aprovado,
    });
  }

  // Pendentes primeiro; dentro de cada grupo, o acordo mais recente na frente.
  return out.sort((a, b) => {
    if (a.revisado !== b.revisado) return a.revisado ? 1 : -1;
    return (b.principal.data_extraida || '').localeCompare(a.principal.data_extraida || '');
  });
}

export function useAcordoExtracoes() {
  const [processos, setProcessos] = useState<AcordoProcesso[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      // `as any`: pop_marco_extracoes é nova e ainda não está em
      // integrations/supabase/types.ts. Mesmo padrão de useAcolhedores.
      const { data, error } = await (db as any)
        .from('pop_marco_extracoes')
        .select('id, documento_id, processo_cnj, data_extraida, dados, confianca, motivo, trecho, revisado, aprovado, criado_em')
        .eq('marco_chave', 'acordo_homologado')
        .eq('houve', true)
        .order('data_extraida', { ascending: false });

      if (error) throw error;
      setProcessos(agrupar((data || []) as unknown as AcordoExtracao[]));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setProcessos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  /**
   * Aprova ou rejeita TODAS as extrações do processo de uma vez — a decisão é
   * sobre o acordo, e deixar uma ata aprovada e outra não criaria dois estados
   * para o mesmo fato.
   */
  const revisar = useCallback(async (cnj: string, aprovado: boolean, userId?: string | null) => {
    const { error } = await (db as any)
      .from('pop_marco_extracoes')
      .update({
        revisado: true,
        aprovado,
        revisado_em: new Date().toISOString(),
        revisado_por: userId || null,
      })
      .eq('processo_cnj', cnj)
      .eq('marco_chave', 'acordo_homologado')
      .eq('houve', true);

    if (error) throw error;
    await carregar();
  }, [carregar]);

  const pendentes = processos.filter((p) => !p.revisado);
  const aprovados = processos.filter((p) => p.revisado && p.aprovado === true);
  const rejeitados = processos.filter((p) => p.revisado && p.aprovado === false);

  return { processos, pendentes, aprovados, rejeitados, loading, erro, recarregar: carregar, revisar };
}
