// =============================================================================
// A PEÇA QUE VOCÊ MESMO ANEXA A UM MARCO.
//
// Pedido do Raym (26/08/2026): o marco tem que mostrar a peça que o sustenta —
// e, quando não houver, deixar anexar. Metade dos processos não tem peça baixada
// pelo Escavador (43% têm, medido em 21/08/2026), então "não há peça" hoje é o
// caso comum, e a régua fica afirmando marco sem nada que se possa abrir.
//
// Onde grava: arquivo no bucket PRIVADO `jm-autos` (o mesmo dos autos baixados,
// já com URL assinada de 10 min) e a linha em `process_documents`, que é a
// tabela de documentos do processo no app. Não escreve em `jm_documentos`: lá o
// id é o id do documento no Escavador, e inventar id nesse espaço colide com a
// próxima captura.
//
// LGPD: peça de processo é dado de cliente. Bucket privado, nunca público, e
// nada de nome de parte em log.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db, authClient, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';

const BUCKET = 'jm-autos';
/** Curto de propósito: a URL assinada é um link público enquanto vive. */
const VALIDADE_S = 600;
/** Marca a linha como peça anexada à mão — separa do que veio do Escavador. */
export const FONTE_ANEXO = 'anexo_marco';
const LIMITE_MB = 50;

export interface AnexoDeMarco {
  id: string;
  titulo: string;
  /** Estação a que a peça foi anexada (MarcoTipo). */
  marcoTipo: string | null;
  dataDocumento: string | null;
  storagePath: string | null;
  nomeArquivo: string | null;
}

interface LinhaDocumento {
  id: string;
  title: string | null;
  file_url: string | null;
  file_name: string | null;
  document_date: string | null;
  metadata: Record<string, unknown> | null;
}

export function useAnexosDeMarco(processId: string | null | undefined, chave?: number) {
  const [anexos, setAnexos] = useState<AnexoDeMarco[]>([]);
  const [loading, setLoading] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const recarregar = useCallback(() => setRecarga((v) => v + 1), []);

  useEffect(() => {
    let vivo = true;
    if (!processId) { setAnexos([]); return; }
    (async () => {
      setLoading(true);
      try {
        await ensureExternalSession();
        const { data, error } = await db
          .from('process_documents' as never)
          .select('id, title, file_url, file_name, document_date, metadata')
          .eq('process_id', processId)
          .eq('source', FONTE_ANEXO);
        if (error) throw error;
        if (!vivo) return;
        setAnexos(((data || []) as unknown as LinhaDocumento[]).map((d) => ({
          id: d.id,
          titulo: d.title || d.file_name || 'Peça anexada',
          marcoTipo: (d.metadata?.marco_tipo as string) ?? null,
          dataDocumento: d.document_date,
          storagePath: d.file_url,
          nomeArquivo: d.file_name,
        })));
      } catch (e) {
        // Sem anexos a régua continua de pé; falhar aqui não pode derrubar a aba.
        console.warn('[useAnexosDeMarco] não consegui ler os anexos:', e);
        if (vivo) setAnexos([]);
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [processId, chave, recarga]);

  /** URL temporária do arquivo. null = não deu para assinar (a tela precisa dizer isso). */
  const assinar = useCallback(async (storagePath: string | null): Promise<string | null> => {
    if (!storagePath) return null;
    await ensureExternalSession();
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(storagePath, VALIDADE_S);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }, []);

  /**
   * Sobe o arquivo e liga ao marco. Devolve o anexo gravado — quem chama decide
   * o que dizer. Lança com mensagem legível: "falhou" sem motivo faz a pessoa
   * tentar de novo o mesmo arquivo grande demais.
   */
  const anexar = useCallback(async (
    arquivo: File,
    opts: { marcoTipo: string; dataMarco: string | null; caseId?: string | null; leadId?: string | null },
  ): Promise<AnexoDeMarco> => {
    if (!processId) throw new Error('Processo sem id — não dá para anexar');
    if (arquivo.size > LIMITE_MB * 1024 * 1024) {
      throw new Error(`Arquivo acima de ${LIMITE_MB} MB — reduza antes de anexar`);
    }
    setEnviando(true);
    try {
      await ensureExternalSession();
      const extensao = (arquivo.name.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase();
      const base = arquivo.name.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 60);
      const caminho = `anexos/${processId}/${Date.now()}_${base || 'peca'}${extensao}`;

      const { error: upErr } = await db.storage.from(BUCKET).upload(caminho, arquivo, {
        contentType: arquivo.type || 'application/octet-stream',
        upsert: false,
      });
      if (upErr) throw new Error(upErr.message || 'Não consegui subir o arquivo');

      const { data: { user } } = await authClient.auth.getUser();
      const porQuem = user?.id ? await remapToExternal(user.id) : null;

      const { data, error } = await db
        .from('process_documents' as never)
        .insert({
          process_id: processId,
          case_id: opts.caseId || null,
          lead_id: opts.leadId || null,
          document_type: 'peca_processual',
          title: arquivo.name,
          source: FONTE_ANEXO,
          file_url: caminho,
          file_name: arquivo.name,
          file_size: arquivo.size,
          document_date: opts.dataMarco ? String(opts.dataMarco).slice(0, 10) : null,
          metadata: { bucket: BUCKET, marco_tipo: opts.marcoTipo, marco_data: opts.dataMarco },
          uploaded_by: porQuem,
        } as never)
        .select('id, title, file_url, file_name, document_date, metadata')
        .single();
      if (error || !data) throw new Error(error?.message || 'Arquivo subiu, mas não consegui registrar a peça');

      const linha = data as unknown as LinhaDocumento;
      const novo: AnexoDeMarco = {
        id: linha.id,
        titulo: linha.title || arquivo.name,
        marcoTipo: opts.marcoTipo,
        dataDocumento: linha.document_date,
        storagePath: linha.file_url,
        nomeArquivo: linha.file_name,
      };
      setAnexos((prev) => [...prev, novo]);
      return novo;
    } finally {
      setEnviando(false);
    }
  }, [processId]);

  return { anexos, loading, enviando, anexar, assinar, recarregar };
}
