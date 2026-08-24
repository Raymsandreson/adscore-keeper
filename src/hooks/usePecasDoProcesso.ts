// =============================================================================
// As peças dos autos deste processo, prontas para abrir na tela.
//
// Pedido do Raym (24/08/2026): poder abrir o documento — público ou privado —
// que sustenta o marco e os lançamentos financeiros (valor por parte e
// pagamentos), sem sair da tela.
//
// Só SELECT em `jm_documentos` (RLS ligada, policy de SELECT para
// `authenticated`) mais a assinatura de URL do bucket privado `jm-autos`. A URL
// assinada vale 10 minutos: tempo de abrir e baixar, não de vazar em histórico.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { cnjVariantes } from '@/lib/cnj';
import type { PecaDoProcesso } from '@/lib/pecasDoProcesso';

const BUCKET = 'jm-autos';
/** Curto de propósito: a URL assinada é um link público enquanto vive. */
const VALIDADE_S = 600;

interface Consulta { data: Record<string, unknown>[] | null; error: { message?: string } | null }
const externo = db as unknown as {
  from: (t: string) => { select: (c: string) => { in: (c: string, v: unknown[]) => unknown } };
};

export function usePecasDoProcesso(cnj: string | null | undefined) {
  const [pecas, setPecas] = useState<PecaDoProcesso[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    if (!cnj) { setPecas([]); return; }
    (async () => {
      setLoading(true);
      setErro(null);
      try {
        await ensureExternalSession();
        const r = await (externo.from('jm_documentos')
          .select('id, titulo, tipo, data_documento, storage_path, paginas')
          .in('processo_cnj', cnjVariantes(cnj)) as Promise<Consulta>);
        if (r.error) throw new Error(r.error.message || 'Falha ao carregar as peças');
        if (!vivo) return;
        setPecas(((r.data || []) as Record<string, unknown>[]).map(d => ({
          id: Number(d.id),
          titulo: (d.titulo as string) ?? null,
          tipo: (d.tipo as string) ?? null,
          dataDocumento: (d.data_documento as string) ?? null,
          storagePath: (d.storage_path as string) ?? null,
          paginas: d.paginas == null ? null : Number(d.paginas),
        })));
      } catch (e) {
        if (vivo) setErro(String((e as Error)?.message || e));
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [cnj]);

  /**
   * URL temporária do PDF. Volta null quando a peça não foi baixada ou o bucket
   * recusa — a tela precisa poder dizer "não consegui abrir" em vez de abrir
   * um visualizador vazio.
   */
  const assinar = useCallback(async (storagePath: string | null): Promise<string | null> => {
    if (!storagePath) return null;
    await ensureExternalSession();
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(storagePath, VALIDADE_S);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }, []);

  return { pecas, loading, erro, assinar };
}
