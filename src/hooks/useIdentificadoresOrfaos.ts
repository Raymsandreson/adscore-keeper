import { useCallback, useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/functionRouter';

export type TipoOrfao = 'cnj' | 'sei' | 'demanda_sit' | 'ordem_servico' | 'protocolo_inss' | 'outro';
export type StatusOrfao = 'novo' | 'ignorado' | 'vinculado';

/**
 * Identificador citado em e-mail que não casou com processo cadastrado
 * (email_identificadores_orfaos no Externo, alimentada pela sync-email-push).
 */
export interface IdentificadorOrfao {
  identificador: string;
  identificador_exibicao: string;
  tipo: TipoOrfao;
  primeira_ocorrencia: string;
  ultima_ocorrencia: string;
  ocorrencias: number;
  ultimo_remetente: string | null;
  ultimo_assunto: string | null;
  ultimo_message_id: string | null;
  status: StatusOrfao;
  lead_process_id: string | null;
}

export interface ProcessoParaVincular {
  id: string;
  process_number: string | null;
  title: string;
  process_type: string | null;
}

export const TIPO_ORFAO_LABEL: Record<TipoOrfao, string> = {
  cnj: 'CNJ',
  sei: 'SEI',
  demanda_sit: 'Demanda SIT',
  ordem_servico: 'Ordem de serviço',
  protocolo_inss: 'Protocolo INSS',
  outro: 'Outro',
};

/**
 * Aba "Sem vínculo" do painel de atualizações: o que o e-mail citou e o
 * cadastro não conhece. Ordenada por ÚLTIMA OCORRÊNCIA desc — o backfill traz
 * processo de 2024, e o que está vivo tem que subir.
 */
export const useIdentificadoresOrfaos = (aberto: boolean) => {
  const { user } = useAuthContext();
  const [orfaos, setOrfaos] = useState<IdentificadorOrfao[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFiltro, setStatusFiltro] = useState<StatusOrfao>('novo');
  const [reprocessando, setReprocessando] = useState<string | null>(null);

  const fetchOrfaos = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = db as any;
      const { data, error } = await client
        .from('email_identificadores_orfaos')
        .select('identificador, identificador_exibicao, tipo, primeira_ocorrencia, ultima_ocorrencia, ocorrencias, ultimo_remetente, ultimo_assunto, ultimo_message_id, status, lead_process_id')
        .eq('status', statusFiltro)
        .order('ultima_ocorrencia', { ascending: false })
        .limit(500);
      if (error) throw error;
      setOrfaos((data || []) as IdentificadorOrfao[]);
    } catch (err) {
      console.warn('[useIdentificadoresOrfaos] busca falhou:', err);
      setOrfaos([]);
    } finally {
      setLoading(false);
    }
  }, [statusFiltro]);

  useEffect(() => {
    if (aberto) void fetchOrfaos();
  }, [aberto, fetchOrfaos]);

  const atualizarStatus = useCallback(async (
    identificador: string,
    patch: { status: StatusOrfao; lead_process_id?: string | null },
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = db as any;
    const extUser = user?.id ? await remapToExternal(user.id).catch(() => null) : null;
    const { error } = await client
      .from('email_identificadores_orfaos')
      .update({
        ...patch,
        ...(patch.status === 'vinculado'
          ? { vinculado_em: new Date().toISOString(), vinculado_por: extUser }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('identificador', identificador);
    if (error) throw error;
    setOrfaos((prev) => prev.filter((o) => o.identificador !== identificador));
  }, [user?.id]);

  const ignorar = useCallback(
    (o: IdentificadorOrfao) => atualizarStatus(o.identificador, { status: 'ignorado' }),
    [atualizarStatus],
  );

  /**
   * Reprocessa os e-mails do identificador para nascerem os cards
   * retroativos — é o que faz o vínculo valer para trás, não só daqui em
   * diante. apagar_cards limpa o card genérico antigo destes e-mails para o
   * novo (com parser certo) não duplicar.
   */
  const reprocessarIdentificador = useCallback(async (o: IdentificadorOrfao) => {
    setReprocessando(o.identificador);
    try {
      const { error } = await cloudFunctions.invoke('sync-email-push', {
        body: {
          reprocessar: { identificador: o.identificador_exibicao, apagar_cards: true },
          limite: 500,
        },
      });
      if (error) throw error;
    } finally {
      setReprocessando(null);
    }
  }, []);

  const vincular = useCallback(async (o: IdentificadorOrfao, processo: ProcessoParaVincular) => {
    await atualizarStatus(o.identificador, { status: 'vinculado', lead_process_id: processo.id });
    await reprocessarIdentificador(o);
  }, [atualizarStatus, reprocessarIdentificador]);

  /**
   * Cria o processo mínimo com o identificador como número — sem lead: o
   * vínculo com cliente vem depois, pela ficha. tipo cnj vira judicial; o
   * resto, administrativo.
   */
  const criarProcesso = useCallback(async (o: IdentificadorOrfao) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = db as any;
    const { data, error } = await client
      .from('lead_processes')
      .insert({
        process_number: o.identificador_exibicao,
        process_type: o.tipo === 'cnj' ? 'judicial' : 'administrativo',
        title: o.ultimo_assunto?.slice(0, 180) || `Processo ${o.identificador_exibicao}`,
        notes: `Criado pela aba "Sem vínculo" a partir de e-mail de ${o.ultimo_remetente || 'remetente desconhecido'}.`,
      })
      .select('id, process_number, title, process_type')
      .single();
    if (error) throw error;
    await vincular(o, data as ProcessoParaVincular);
    return data as ProcessoParaVincular;
  }, [vincular]);

  /** Busca por número ou nome, para a ação "Vincular a processo existente". */
  const buscarProcessos = useCallback(async (termo: string): Promise<ProcessoParaVincular[]> => {
    const limpo = termo.trim();
    if (limpo.length < 3) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = db as any;
    const { data, error } = await client
      .from('lead_processes')
      .select('id, process_number, title, process_type')
      .is('deleted_at', null)
      .or(`process_number.ilike.%${limpo}%,title.ilike.%${limpo}%`)
      .limit(10);
    if (error) throw error;
    return (data || []) as ProcessoParaVincular[];
  }, []);

  return {
    orfaos, loading, statusFiltro, setStatusFiltro, refetch: fetchOrfaos,
    ignorar, vincular, criarProcesso, buscarProcessos, reprocessando,
  };
};
