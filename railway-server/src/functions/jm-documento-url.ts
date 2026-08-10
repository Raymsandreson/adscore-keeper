// Devolve uma URL assinada e curta para um documento dos autos (bucket jm-autos).
//
// POR QUE PASSA PELO SERVIDOR: jm-autos é privado e NÃO tem policy de leitura em
// storage.objects. Abrir o bucket para `authenticated` daria a qualquer sessão do
// app acesso direto a peça de processo — e a sessão do Externo é anônima
// (signInAnonymously). Assinar aqui, com service role e validade curta, mantém o
// bucket fechado e ainda permite a revisão humana abrir o PDF na tela.
//
// Body: { documento_id: number, expira_em?: number }  → { url, titulo, processo_cnj }
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';

const BUCKET = 'jm-autos';
const DEFAULT_TTL = 300; // 5 min: tempo de olhar o documento, não de compartilhar.
const MAX_TTL = 3600;

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { documento_id, expira_em } = (req.body || {}) as {
      documento_id?: number;
      expira_em?: number;
    };
    if (!documento_id) return ok({ success: false, error: 'documento_id é obrigatório' });

    const { data: doc, error } = await supabase
      .from('jm_documentos')
      .select('id, processo_cnj, titulo, storage_path, data_documento')
      .eq('id', documento_id)
      .maybeSingle();
    if (error) throw error;
    if (!doc) return ok({ success: false, error: 'documento não encontrado' });
    if (!doc.storage_path) return ok({ success: false, error: 'documento sem arquivo guardado' });

    const ttl = Math.min(Math.max(Number(expira_em) || DEFAULT_TTL, 60), MAX_TTL);
    const { data: signed, error: signErr } = await supabase
      .storage.from(BUCKET).createSignedUrl(doc.storage_path, ttl);
    if (signErr || !signed?.signedUrl) {
      return ok({ success: false, error: `falha ao assinar: ${signErr?.message || 'sem url'}` });
    }

    return ok({
      success: true,
      url: signed.signedUrl,
      titulo: doc.titulo,
      processo_cnj: doc.processo_cnj,
      data_documento: doc.data_documento,
      expira_em: ttl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('jm-documento-url error:', msg);
    return ok({ success: false, error: msg });
  }
};
