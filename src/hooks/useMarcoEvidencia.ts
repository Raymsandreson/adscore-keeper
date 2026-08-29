// =============================================================================
// A evidência crua de UM marco — "por que este processo passou por aqui?".
//
// Pedido do Raym (27/08/2026): "eu acho que o datajud pode estar mais
// atrapalhando que ajudando; aqui poderia também consultar que movimentação do
// datajud ele usou para identificar que passou por aquele marco".
//
// A trilha da conferência diz "Decisão TST / STJ · DataJud · 19/05/2026" e para
// aí. Este hook traz o que está atrás disso: a regra que reconhece o marco, cada
// linha que casou com a regra (movimento do DataJud, peça dos autos, publicação
// do Escavador, e-mail do INSS, capa do processo), qual delas ditou a data, e o
// que as OUTRAS fontes diriam sobre o mesmo marco.
//
// Tudo vem de uma RPC só (`pop_marco_evidencia`), que espelha exatamente os
// predicados das views da régua. Espelhar em vez de reimplementar é o ponto: se
// a tela calculasse por conta própria, ela poderia "concordar" com a régua por
// coincidência e esconder justamente o desacordo que se quer ver.
//
// Leitura pura — a RPC não detecta, não grava e não move nada.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';

/** Uma regra de detecção do marco, como está em `pop_marco_sinais`. */
export interface RegraDoMarco {
  tipo: 'tpu' | 'documento' | 'texto' | 'grau' | 'email';
  codigo: number | null;
  grau: string | null;
  complemento_pattern: string | null;
  padrao: string | null;
  padrao_excluir: string | null;
  campo_email: string | null;
  email_status: string | null;
  email_servico: string | null;
  origem: 'manual' | 'ia' | null;
  confirmado: boolean;
  motivo: string | null;
}

export interface MovimentoDataJud {
  id: number;
  codigo: number;
  nome: string | null;
  grau: string | null;
  orgao_julgador: string | null;
  tribunal: string | null;
  data: string | null;
  data_hora: string | null;
  complementos: unknown;
  sinal_codigo: number | null;
  sinal_grau: string | null;
  /** Foi esta linha que ditou a data do marco (a mais antiga que casou). */
  usado: boolean;
}

export interface PecaCasadaComMarco {
  documento_id: number;
  titulo: string | null;
  tipo: string | null;
  data: string | null;
  paginas: number | null;
  origem: string | null;
  tem_arquivo: boolean;
  /** Peça desvinculada na tela que a régua continua usando — divergência real. */
  oculta_em: string | null;
  padrao: string | null;
  usado: boolean;
}

export interface PublicacaoEscavador {
  data: string | null;
  classe: string | null;
  conteudo: string | null;
  cortado: boolean;
  grau: string | null;
  via: 'escavador_texto' | 'escavador_grau';
  padrao: string | null;
  usado: boolean;
}

export interface EventoEmail {
  data: string | null;
  evento: string | null;
  status: string | null;
  servico: string | null;
  despacho: string | null;
  padrao: string | null;
  usado: boolean;
}

/** O que cada fonte diria sobre este marco, e qual venceu o empate. */
export interface FonteCandidata {
  fonte: string;
  /** 1 = movimento/documento, 2 = Escavador/e-mail, 3 = capa. Menor vence. */
  prioridade: number;
  data: string | null;
  casou: number;
  venceu: boolean;
}

interface Lista<T> { total: number; linhas: T[] }

export interface EvidenciaDoMarco {
  erro?: string;
  marco: {
    chave: string;
    rotulo: string | null;
    data_detectada: string | null;
    fonte: string | null;
    /** false = marco gravado no processo que não existe mais no POP. */
    cadastrado_no_pop: boolean;
  };
  cnj: string;
  regras: RegraDoMarco[];
  datajud: Lista<MovimentoDataJud>;
  documento: Lista<PecaCasadaComMarco>;
  escavador: Lista<PublicacaoEscavador>;
  email: Lista<EventoEmail>;
  capa: { data_distribuicao: string | null; data_inicio: string | null; data: string | null } | null;
  candidatas: FonteCandidata[];
  /** Quanto existe deste processo em cada fonte — fonte vazia explica silêncio. */
  cobertura: {
    movimentos_datajud: number;
    documentos: number;
    movimentacoes_escavador: number;
  };
}

export function useMarcoEvidencia(processId: string | null, marcoChave: string | null) {
  const [evidencia, setEvidencia] = useState<EvidenciaDoMarco | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!processId || !marcoChave) { setEvidencia(null); return; }
    setLoading(true);
    setErro(null);
    try {
      // Sessão anônima do Externo: sem ela a RLS devolve zero linha em silêncio.
      await ensureExternalSession();
      const { data, error } = await (db.rpc as unknown as (
        f: string, a: Record<string, unknown>,
      ) => PromiseLike<{ data?: EvidenciaDoMarco | null; error?: { message?: string } | null }>)(
        'pop_marco_evidencia',
        { p_process_id: processId, p_marco_chave: marcoChave },
      );
      if (error) throw new Error(error.message || 'falha ao buscar a evidência');
      setEvidencia((data as EvidenciaDoMarco) ?? null);
    } catch (e) {
      setErro(String((e as Error)?.message || e));
      setEvidencia(null);
    } finally {
      setLoading(false);
    }
  }, [processId, marcoChave]);

  useEffect(() => { void carregar(); }, [carregar]);

  return { evidencia, loading, erro, recarregar: carregar };
}
