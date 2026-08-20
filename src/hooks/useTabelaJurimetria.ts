// A tabela crua que alimenta a carteira: `jm_partes`, a aba Tab. Aux da planilha.
// Carrega tudo de uma vez (1.222 linhas em 19/08/2026) porque filtro e ordenação
// são no cliente — assim mexer no filtro é instantâneo e não bate no banco.
import { useState, useEffect, useCallback } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { buscarTudo } from '@/lib/postgrestPaginacao';
import { montarLinha, type LinhaTabela } from '@/lib/tabelaJurimetria';

const COLUNAS =
  'parte_id, processo_cnj, cliente, uf_mora, cidade_mora, status_pagamento, fase_atual, ' +
  'termo_inicial_jcm, condenacao_cjcm, cota_parte_cjcm, cota_parte_vista_cjcm, ' +
  'hc_vista, hc_parcelado, hs, valores_importados_em';

export function useTabelaJurimetria() {
  const [linhas, setLinhas] = useState<LinhaTabela[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    await ensureExternalSession().catch(() => {});
    // `jm_partes` não está no schema tipado do client — mesmo desvio dos outros
    // hooks jm_*, a tabela existe só no Externo.
    const externo = db as unknown as {
      from: (t: string) => { select: (c: string) => {
        order: (col: string, o: { ascending: boolean }) => {
          range: (de: number, ate: number) => PromiseLike<{ data: Record<string, unknown>[] | null; error: { message?: string } | null }>;
        };
      } };
    };
    try {
      // Ordenar por parte_id é o que torna a paginação estável — sem ordem
      // definida o PostgREST pode repetir linha entre páginas.
      const dados = await buscarTudo<Record<string, unknown>>((de, ate) =>
        externo.from('jm_partes').select(COLUNAS).order('parte_id', { ascending: true }).range(de, ate),
      );
      setLinhas(dados.map(montarLinha));
    } catch (e) {
      const msg = (e as { message?: string })?.message || 'falha ao carregar a tabela';
      console.error('[useTabelaJurimetria]', msg);
      setErro(msg);
      setLinhas([]);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  return { linhas, carregando, erro, recarregar: carregar };
}
