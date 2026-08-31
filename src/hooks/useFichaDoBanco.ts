// =============================================================================
// Lê do banco tudo que já se sabe sobre o processo — e só isso.
//
// Nenhuma consulta externa, nenhum crédito de API gasto: quatro SELECTs em
// tabelas que já existem. É o que sustenta o botão "Completar do banco" da
// ficha do processo, criado depois de abrir o 0017007-20.2016.5.16.0019 e ver
// campo vazio ao lado de uma publicação que dizia autor, vara, classe e cidade.
//
// O que lê:
//   process_movements ............ as publicações guardadas (a capa está nelas)
//   vw_estacao_evidencia_datajud . órgão julgador e grau, quando o CNJ tem
//   jm_processos / jm_partes ..... a jurimetria da carteira, quando o CNJ está lá
//
// As notas vêm da própria ficha aberta (lead_processes.notes) — quem chama
// passa, para não reler a linha que a tela já tem em mãos.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { cnjVariantes, onlyDigits } from '@/lib/cnj';
import {
  fichaDoBanco, detectarNossoPolo,
  type CampoDaFicha, type MovimentoDatajud, type ProcessoJurimetria, type PublicacaoDoBanco,
} from '@/lib/fichaDoBanco';

/** Quem assina os processos do escritório — usado só para dizer de que lado estamos. */
const ADVOGADOS_DO_ESCRITORIO = ['Raymsandreson de Morais Prudêncio'];

interface Consulta<T> { data: T[] | null; error: { message?: string } | null }
const externo = db as unknown as {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: unknown) => unknown;
      in: (c: string, v: unknown[]) => unknown;
    };
  };
};

export interface FichaDoBancoResultado {
  /** Campos que o banco consegue preencher, cada um com a origem. */
  campos: CampoDaFicha[];
  /** De que lado estamos, quando a publicação nomeia advogado do escritório. */
  nossoPolo: { polo: 'ATIVO' | 'PASSIVO'; advogado: string; parte: string } | null;
  loading: boolean;
  erro: string | null;
  recarregar: () => void;
}

export function useFichaDoBanco(
  processId: string | null | undefined,
  cnj: string | null | undefined,
  notas: string | null | undefined,
  /** Muda quando a tela quer reler (ex.: depois de gravar). */
  chave?: number,
): FichaDoBancoResultado {
  const [campos, setCampos] = useState<CampoDaFicha[]>([]);
  const [nossoPolo, setNossoPolo] = useState<FichaDoBancoResultado['nossoPolo']>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  const recarregar = useCallback(() => setRecarga((v) => v + 1), []);

  useEffect(() => {
    let vivo = true;
    if (!processId) { setCampos([]); setNossoPolo(null); return; }

    (async () => {
      setLoading(true);
      setErro(null);
      try {
        await ensureExternalSession();
        const variantes = cnj ? cnjVariantes(cnj) : [];
        const digitos = onlyDigits(cnj || '');

        const publicacoesQ = externo
          .from('process_movements')
          .select('descricao, data_movimentacao, fonte')
          .eq('process_id', processId) as Promise<Consulta<PublicacaoDoBanco>>;

        // As três consultas por CNJ só fazem sentido com CNJ; sem ele viram vazio.
        const datajudQ: Promise<Consulta<MovimentoDatajud>> = digitos
          ? externo.from('vw_estacao_evidencia_datajud')
            .select('orgao_julgador, tribunal_alias, grau, data_hora')
            .eq('cnj_num', digitos) as Promise<Consulta<MovimentoDatajud>>
          : Promise.resolve({ data: [], error: null });

        const jurimetriaQ: Promise<Consulta<ProcessoJurimetria>> = variantes.length
          ? externo.from('jm_processos')
            .select('uf_proc, cidade_proc, empresa, natureza, causa, data_protocolo')
            .in('processo_cnj', variantes) as Promise<Consulta<ProcessoJurimetria>>
          : Promise.resolve({ data: [], error: null });

        const partesQ: Promise<Consulta<{ cliente: string | null }>> = variantes.length
          ? externo.from('jm_partes')
            .select('cliente')
            .in('processo_cnj', variantes) as Promise<Consulta<{ cliente: string | null }>>
          : Promise.resolve({ data: [], error: null });

        const [pub, dj, jm, partes] = await Promise.all([publicacoesQ, datajudQ, jurimetriaQ, partesQ]);
        if (!vivo) return;

        // Falha de leitura vira aviso, não tela quebrada: o botão simplesmente
        // oferece menos campos. Só a publicação é indispensável.
        if (pub.error) throw new Error(pub.error.message || 'Falha ao ler as publicações do processo');

        const publicacoes = (pub.data || []).filter((p) => p.descricao);
        setCampos(fichaDoBanco({
          publicacoes,
          notas: notas ?? null,
          datajud: dj.error ? [] : (dj.data || []),
          jurimetria: jm.error ? null : ((jm.data || [])[0] ?? null),
          partesJurimetria: partes.error
            ? []
            : (partes.data || []).map((p) => p.cliente).filter((c): c is string => !!c),
        }));
        setNossoPolo(detectarNossoPolo(publicacoes, ADVOGADOS_DO_ESCRITORIO));
      } catch (e) {
        if (vivo) {
          setErro(String((e as Error)?.message || e));
          setCampos([]);
          setNossoPolo(null);
        }
      } finally {
        if (vivo) setLoading(false);
      }
    })();

    return () => { vivo = false; };
  }, [processId, cnj, notas, chave, recarga]);

  return { campos, nossoPolo, loading, erro, recarregar };
}
