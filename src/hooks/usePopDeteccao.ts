// =============================================================================
// A configuração de detecção de um POP: os marcos e, em cada um, as regras que
// o reconhecem sozinho.
//
// Por que existe (24/08/2026). `pop_marco_sinais` é a tabela que responde "como
// este marco é detectado automaticamente" desde 08/08, e até aqui só dava para
// mexer nela por SQL ou pela Auditoria de códigos — que só lista código TPU que
// JÁ apareceu nos processos do POP. No BPC JUDICIAL a auditoria aparece vazia
// porque jm_movimentos não tem uma linha sequer para os 30 processos (são todos
// federais); a régua daquele POP anda só pelo Escavador. Sem uma tela que mostre
// a regra em si, não havia como configurar a detecção do que ainda não
// aconteceu.
//
// As cinco fontes, e o que cada sinal precisa:
//   tpu        código do movimento CNJ (+ grau, + complemento)     DataJud
//   texto      regex na classe/conteúdo da movimentação            Escavador
//   documento  regex no título da peça                             autos
//   grau       o grau em si (G1/G2/SUP), sem padrão                Escavador
//   email      regex num campo do e-mail (+ status, + serviço)     INSS
//
// `padrao` e `padrao_excluir` são REGEX POSIX sobre o texto em minúsculas. Não
// é detalhe de implementação: quem escreve é do jurídico, e a tela precisa
// dizer isso em vez de fingir que é busca literal.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';

export type TipoSinal = 'tpu' | 'texto' | 'documento' | 'grau' | 'email';

export interface Sinal {
  id: string;
  pop_marco_id: string;
  tipo: TipoSinal;
  codigo: number | null;
  grau: string | null;
  complemento_pattern: string | null;
  padrao: string | null;
  padrao_excluir: string | null;
  campo_email: string | null;
  email_status: string | null;
  email_servico: string | null;
  origem: 'manual' | 'ia';
  confirmado: boolean;
  motivo: string | null;
}

export interface MarcoDoPop {
  id: string;
  chave: string;
  rotulo: string;
  ordem: number;
  stage_id: string | null;
  eventual: boolean;
  terminal: boolean;
  atravessa_fases: boolean;
  descricao: string | null;
}

/** O que a contra-prova devolve. `alvos` é processo — ou requerimento, no e-mail. */
export interface Contraprova {
  unidade?: 'processos' | 'requerimentos';
  alvos?: number;
  ocorrencias?: number;
  primeira?: string | null;
  ultima?: string | null;
  amostra?: { texto: string; data: string | null }[];
  erro?: string;
}

export type NovoSinal = Omit<Sinal, 'id' | 'pop_marco_id' | 'origem' | 'confirmado'>;

const CAMPOS = 'id, pop_marco_id, tipo, codigo, grau, complemento_pattern, padrao, padrao_excluir, campo_email, email_status, email_servico, origem, confirmado, motivo';

export function usePopDeteccao(boardId: string | null, ativo: boolean) {
  const [marcos, setMarcos] = useState<MarcoDoPop[]>([]);
  const [sinais, setSinais] = useState<Record<string, Sinal[]>>({});
  const [loading, setLoading] = useState(false);

  const carregar = useCallback(async () => {
    if (!boardId || !ativo) return;
    setLoading(true);
    try {
      await ensureExternalSession();
      const { data: ms } = await (db as any)
        .from('pop_marcos')
        .select('id, chave, rotulo, ordem, stage_id, eventual, terminal, atravessa_fases, descricao')
        .eq('board_id', boardId)
        .order('ordem');

      const lista = (ms || []) as MarcoDoPop[];
      setMarcos(lista);

      if (!lista.length) { setSinais({}); return; }

      const { data: ss } = await (db as any)
        .from('pop_marco_sinais')
        .select(CAMPOS)
        .in('pop_marco_id', lista.map((m) => m.id));

      const porMarco: Record<string, Sinal[]> = {};
      for (const s of (ss || []) as Sinal[]) {
        (porMarco[s.pop_marco_id] ||= []).push(s);
      }
      setSinais(porMarco);
    } finally {
      setLoading(false);
    }
  }, [boardId, ativo]);

  useEffect(() => { void carregar(); }, [carregar]);

  /**
   * Contra-prova ANTES de gravar. Não grava nada: só pergunta ao banco quantos
   * processos deste POP a regra pegaria e devolve cinco frases de exemplo — que
   * é a parte que importa. "Pega 340" parece ótimo até você ler que 300 são
   * "Mero expediente".
   */
  const testar = useCallback(async (s: NovoSinal): Promise<Contraprova> => {
    if (!boardId) return {};
    await ensureExternalSession();
    const { data, error } = await (db.rpc as unknown as (
      f: string, a: Record<string, unknown>,
    ) => PromiseLike<{ data?: Contraprova | null; error?: { message?: string } | null }>)(
      'pop_sinal_teste',
      {
        p_board_id: boardId,
        p_tipo: s.tipo,
        p_codigo: s.codigo,
        p_grau: s.grau,
        p_complemento_pattern: s.complemento_pattern,
        p_padrao: s.padrao,
        p_padrao_excluir: s.padrao_excluir,
        p_campo_email: s.campo_email,
        p_email_status: s.email_status,
        p_email_servico: s.email_servico,
      },
    );
    if (error) return { erro: error.message || 'pop_sinal_teste falhou' };
    return (data || {}) as Contraprova;
  }, [boardId]);

  const adicionar = useCallback(async (marcoId: string, s: NovoSinal, motivo: string) => {
    await ensureExternalSession();
    const { error } = await (db as any).from('pop_marco_sinais').insert({
      pop_marco_id: marcoId,
      tipo: s.tipo,
      codigo: s.codigo,
      grau: s.grau,
      complemento_pattern: s.complemento_pattern,
      padrao: s.padrao,
      padrao_excluir: s.padrao_excluir,
      campo_email: s.campo_email,
      email_status: s.email_status,
      email_servico: s.email_servico,
      // Foi gente que escreveu e viu a contra-prova: manual e já confirmado.
      // `origem` só aceita 'manual' | 'ia' (check constraint).
      origem: 'manual',
      confirmado: true,
      motivo,
    });
    if (error) throw new Error(error.message);
    await carregar();
  }, [carregar]);

  const remover = useCallback(async (sinalId: string) => {
    await ensureExternalSession();
    const { error } = await (db as any).from('pop_marco_sinais').delete().eq('id', sinalId);
    if (error) throw new Error(error.message);
    await carregar();
  }, [carregar]);

  const confirmar = useCallback(async (sinalId: string) => {
    await ensureExternalSession();
    const { error } = await (db as any)
      .from('pop_marco_sinais').update({ confirmado: true }).eq('id', sinalId);
    if (error) throw new Error(error.message);
    await carregar();
  }, [carregar]);

  return { marcos, sinais, loading, testar, adicionar, remover, confirmar, recarregar: carregar };
}
