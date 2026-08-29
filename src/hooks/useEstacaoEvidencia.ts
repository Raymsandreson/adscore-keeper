// =============================================================================
// A PROVA DE CADA ESTAÇÃO: código do DataJud + peça publicada no processo.
//
// A régua de marcos afirma "houve Sentença em 11/06/2026" e, até aqui, a única
// coisa conferível era o trecho de texto que o Escavador devolveu. O que prova
// o marco já estava no banco e a tela nunca leu:
//
//   vw_estacao_evidencia_datajud .... movimento do DataJud (codigo TPU, nome,
//                                     grau, órgão julgador) casado com a estação
//   vw_estacao_evidencia_documento .. peça pública cujo título casa com a estação
//   jm_documentos ................... o acervo inteiro do processo, pra mostrar
//                                     o que caiu no período do marco sem casar
//                                     título nenhum
//
// COBERTURA (medida em 21/08/2026, sobre os 547 CNJs com marco): 156 têm
// movimento do DataJud (28%) e 236 têm documento baixado (43%). A tela PRECISA
// dizer quando não tem — silêncio aqui vira "não houve", que é outra coisa.
//
// Este hook não classifica nada: só junta a prova. Quem decide se a peça prova
// AQUELE marco é a janela de data aplicada em provaDaEstacao().
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { db, authClient, externalFunctionUrl } from '@/integrations/supabase';
import type { MarcoTipo } from '@/hooks/useProcessMovements';

export interface EvidenciaDatajud {
  cnj_num: string;
  estacao: MarcoTipo;
  movimento_id: number;
  codigo: number;
  nome: string | null;
  grau: string | null;
  orgao_julgador: string | null;
  tribunal_alias: string | null;
  data_hora: string;
  complementos: unknown;
  /** O que o código significa na nossa config (estacao_sinais.observacao). */
  codigo_significado: string | null;
}

export interface EvidenciaDocumento {
  cnj_num?: string;
  /** null quando a peça não casou título nenhum (veio do acervo do período). */
  estacao: MarcoTipo | null;
  documento_id: number;
  titulo: string | null;
  /** jm_documentos.tipo — PUBLICO / RESTRITO. */
  sigilo: string | null;
  data_documento: string | null;
  origem: string | null;
  /** Caminho no bucket privado jm-autos. null = ainda não baixado. */
  storage_path: string | null;
  /** URL da API do Escavador — exige token, não abre no navegador. */
  link_api: string | null;
  storage_error?: string | null;
  stored_at?: string | null;
}

/** Só dígitos — o formato do CNJ varia entre as tabelas. */
export function cnjNum(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '');
}

/** Reescreve 20 dígitos no formato NNNNNNN-DD.AAAA.J.TR.OOOO. */
function cnjMascarado(digitos: string): string | null {
  if (digitos.length !== 20) return null;
  return `${digitos.slice(0, 7)}-${digitos.slice(7, 9)}.${digitos.slice(9, 13)}.${digitos.slice(13, 14)}.${digitos.slice(14, 16)}.${digitos.slice(16)}`;
}

const DIAS = 86400000;

function parseDia(v: string | null | undefined): number | null {
  if (!v) return null;
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/** Distância em dias entre duas datas (∞ quando falta alguma). */
export function distanciaDias(a: string | null | undefined, b: string | null | undefined): number {
  const ta = parseDia(a);
  const tb = parseDia(b);
  if (ta == null || tb == null) return Infinity;
  return Math.abs(Math.round((ta - tb) / DIAS));
}

// Janelas. A peça com o título certo pode estar semanas longe do movimento que
// o Escavador publicou (a publicação atrasa), por isso 45 dias. A peça SEM
// título casado só entra se for praticamente do mesmo ato — 15 dias.
export const JANELA_PROVA_DIAS = 45;
export const JANELA_PERIODO_DIAS = 15;

export interface ProvaDaEstacao {
  /** Movimentos do DataJud cujo código TPU corresponde a esta estação. */
  datajud: EvidenciaDatajud[];
  /** Peças com título da estação e dentro da janela do marco. */
  documentos: EvidenciaDocumento[];
  /** Peças com o título da estação, mas de outro momento do processo. */
  documentosForaDaJanela: EvidenciaDocumento[];
  /** Qualquer peça do processo no período do marco, sem casar título. */
  documentosDoPeriodo: EvidenciaDocumento[];
}

export interface EstacaoEvidencia {
  datajud: EvidenciaDatajud[];
  documentosPorEstacao: EvidenciaDocumento[];
  /** Acervo inteiro do processo em jm_documentos. */
  acervo: EvidenciaDocumento[];
  loading: boolean;
  /** true quando o processo não tem NENHUM movimento do DataJud capturado. */
  semDatajud: boolean;
  /** true quando o processo não tem NENHUMA peça baixada. */
  semAcervo: boolean;
  provaDaEstacao: (estacao: MarcoTipo, dataMarco: string | null) => ProvaDaEstacao;
}

/**
 * Carrega a prova de todos os CNJs passados (a linha do trem pode estar em
 * escopo 'caso', juntando processos conexos).
 */
export function useEstacaoEvidencia(cnjs: (string | null | undefined)[]): EstacaoEvidencia {
  const [datajud, setDatajud] = useState<EvidenciaDatajud[]>([]);
  const [documentosPorEstacao, setDocumentosPorEstacao] = useState<EvidenciaDocumento[]>([]);
  const [acervo, setAcervo] = useState<EvidenciaDocumento[]>([]);
  const [loading, setLoading] = useState(false);

  // Chave estável: sem isto o array recriado a cada render refaz o fetch em loop.
  const chave = useMemo(
    () => Array.from(new Set(cnjs.map(cnjNum).filter((c) => c.length >= 15))).sort().join(','),
    [cnjs],
  );

  const buscar = useCallback(async () => {
    const nums = chave ? chave.split(',') : [];
    if (!nums.length) {
      setDatajud([]);
      setDocumentosPorEstacao([]);
      setAcervo([]);
      return;
    }
    setLoading(true);
    try {
      // As views e jm_documentos não estão no types.ts gerado — cast local,
      // mesmo padrão de useProcessMovements.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = db as any;
      // jm_documentos guarda o CNJ formatado; as views já devolvem só dígitos.
      const formatados = nums.map(cnjMascarado).filter((v): v is string => !!v);

      const [dj, docEst, todos] = await Promise.all([
        client.from('vw_estacao_evidencia_datajud').select('*').in('cnj_num', nums),
        client.from('vw_estacao_evidencia_documento').select('*').in('cnj_num', nums),
        client
          .from('jm_documentos')
          .select('id, processo_cnj, titulo, tipo, data_documento, origem, storage_path, link_api, storage_error, stored_at')
          .in('processo_cnj', formatados.length ? formatados : nums)
          .order('data_documento', { ascending: false, nullsFirst: false })
          // Com autos completos um processo passa de dezenas para centenas de
          // peças. O bloco "outras peças do período" só olha a vizinhança do
          // marco, então o teto não esconde nada que a tela fosse mostrar.
          .limit(500),
      ]);

      setDatajud((dj.data || []) as EvidenciaDatajud[]);
      setDocumentosPorEstacao((docEst.data || []) as EvidenciaDocumento[]);
      setAcervo(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((todos.data || []) as any[]).map((d) => ({
          cnj_num: cnjNum(d.processo_cnj),
          estacao: null,
          documento_id: d.id,
          titulo: d.titulo,
          sigilo: d.tipo,
          data_documento: d.data_documento,
          origem: d.origem,
          storage_path: d.storage_path,
          link_api: d.link_api,
          storage_error: d.storage_error,
          stored_at: d.stored_at,
        })),
      );
    } catch (e) {
      console.error('Error fetching estacao evidencia:', e);
      setDatajud([]);
      setDocumentosPorEstacao([]);
      setAcervo([]);
    } finally {
      setLoading(false);
    }
  }, [chave]);

  useEffect(() => {
    buscar();
  }, [buscar]);

  const provaDaEstacao = useCallback(
    (estacao: MarcoTipo, dataMarco: string | null): ProvaDaEstacao => {
      const dj = datajud
        .filter((m) => m.estacao === estacao)
        .sort((a, b) => (b.data_hora || '').localeCompare(a.data_hora || ''));

      const daEstacao = documentosPorEstacao.filter((d) => d.estacao === estacao);
      const dentro = daEstacao.filter((d) => distanciaDias(d.data_documento, dataMarco) <= JANELA_PROVA_DIAS);
      const fora = daEstacao.filter((d) => !dentro.includes(d));

      const jaListado = new Set(dentro.map((d) => d.documento_id));
      const periodo = acervo.filter(
        (d) => !jaListado.has(d.documento_id) && distanciaDias(d.data_documento, dataMarco) <= JANELA_PERIODO_DIAS,
      );

      const porData = (a: EvidenciaDocumento, b: EvidenciaDocumento) =>
        (b.data_documento || '').localeCompare(a.data_documento || '');

      return {
        datajud: dj,
        documentos: dentro.sort(porData),
        documentosForaDaJanela: fora.sort(porData),
        documentosDoPeriodo: periodo.sort(porData),
      };
    },
    [datajud, documentosPorEstacao, acervo],
  );

  return {
    datajud,
    documentosPorEstacao,
    acervo,
    loading,
    semDatajud: !loading && datajud.length === 0,
    semAcervo: !loading && acervo.length === 0,
    provaDaEstacao,
  };
}

/**
 * URL assinada da peça (1h), pela edge function jm-doc-url do Externo.
 *
 * NÃO assina direto pelo client: o bucket jm-autos é privado e não tem policy
 * de leitura de propósito. A sessão do Externo é anônima (signInAnonymously com
 * a chave que está no bundle), então liberar o bucket para `authenticated`
 * liberaria PDF de autos — restritos inclusive — para quem abrisse o JS. Quem
 * assina é o service role, atrás da checagem do login DO CLOUD, e por isso o
 * token enviado aqui é o do authClient, não o do db.
 *
 * Devolve null quando a peça ainda não foi baixada ou o usuário não está logado.
 */
export async function abrirDocumentoArquivado(documentoId: number | null): Promise<string | null> {
  if (!documentoId) return null;
  const { data: { session } } = await authClient.auth.getSession();
  if (!session?.access_token) {
    console.warn('[jm-doc-url] sem sessão do cloud — não dá para assinar a peça');
    return null;
  }
  try {
    const r = await fetch(externalFunctionUrl('jm-doc-url'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ documento_id: documentoId }),
    });
    const j = await r.json();
    if (!j?.ok) {
      console.error('[jm-doc-url] recusou:', j?.motivo, j?.erro ?? '');
      return null;
    }
    return j.url as string;
  } catch (e) {
    console.error('[jm-doc-url] falhou:', e);
    return null;
  }
}
