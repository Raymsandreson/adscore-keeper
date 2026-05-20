import { useEffect, useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';

export interface AutoImportProgress {
  total: number;
  done: number;
  running: boolean;
  newlyImported: number;
}

/**
 * Sempre calcula `total` (mídias do grupo/lead no WhatsApp) e `done`
 * (process_documents já importadas com source=whatsapp_group). O badge
 * "Drive x/y" fica visível em qualquer tela que use este hook.
 *
 * Gatilho do upload: na 1ª montagem por sessão (por leadId), se `done < total`,
 * dispara import-group-docs-to-lead em lotes de 5. Idempotente (a edge
 * deduplica por external_message_id + content_hash).
 */
export function useAutoImportGroupDocs(
  leadId: string | null | undefined,
  leadName: string | null | undefined,
  whatsappGroupId: string | null | undefined,
  onImported?: () => void,
): AutoImportProgress {
  const [progress, setProgress] = useState<AutoImportProgress>({
    total: 0,
    done: 0,
    running: false,
    newlyImported: 0,
  });

  useEffect(() => {
    if (!leadId || !leadName) return;
    let cancelled = false;

    (async () => {
      try {
        await ensureExternalSession();

        // 1) Conta mídias disponíveis no WhatsApp (grupo ou lead).
        let mediaQuery = externalSupabase
          .from('whatsapp_messages')
          .select('external_message_id, message_type, media_url, created_at')
          .in('message_type', ['image', 'document', 'video', 'audio'])
          .not('media_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(200);

        mediaQuery = whatsappGroupId
          ? mediaQuery.or(`phone.eq.${whatsappGroupId},lead_id.eq.${leadId}`)
          : mediaQuery.eq('lead_id', leadId);

        const { data: mediaMsgs, error: mediaErr } = await mediaQuery;
        if (cancelled || mediaErr) return;

        const documents = (mediaMsgs || [])
          .map((m: any) => {
            const messageId = String(m.external_message_id || '').trim();
            if (!messageId) return null;
            return { message_id: messageId, document_type: 'Outro' };
          })
          .filter(Boolean) as { message_id: string; document_type: string }[];

        const total = documents.length;
        if (total === 0) return;

        // 2) Conta quantas já estão no Drive (process_documents do lead).
        const { count: doneCount } = await supabase
          .from('process_documents')
          .select('id', { count: 'exact', head: true })
          .eq('lead_id', leadId)
          .eq('source', 'whatsapp_group');

        const done = Math.min(doneCount || 0, total);
        setProgress({ total, done, running: false, newlyImported: 0 });

        // 3) Já tudo importado? Só mostra badge verde.
        if (done >= total) return;

        // 4) 1x por sessão por lead — evita reprocessar a cada navegação.
        const sessKey = `auto-import-docs:v3:${leadId}`;
        if (sessionStorage.getItem(sessKey)) return;
        sessionStorage.setItem(sessKey, '1');

        setProgress({ total, done, running: true, newlyImported: 0 });

        const CHUNK_SIZE = 5;
        let doneAcc = done;
        let newlyAcc = 0;

        for (let i = 0; i < documents.length; i += CHUNK_SIZE) {
          if (cancelled) return;
          const chunk = documents.slice(i, i + CHUNK_SIZE);

          const { data: resp, error: invokeErr } = await supabase.functions.invoke(
            'import-group-docs-to-lead',
            { body: { lead_id: leadId, lead_name: leadName, documents: chunk } },
          );

          if (cancelled) return;
          if (invokeErr) {
            console.warn('[useAutoImportGroupDocs] invoke error', invokeErr);
            break;
          }

          const results = (resp as any)?.results || [];
          const okNew = results.filter(
            (r: any) => (r.status === 'ok' || r.status === 'ok_no_drive') && !r.deduped,
          ).length;
          const okAll = results.filter(
            (r: any) => r.status === 'ok' || r.status === 'ok_no_drive',
          ).length;

          newlyAcc += okNew;
          doneAcc = Math.min(doneAcc + okAll, total);

          setProgress({
            total,
            done: doneAcc,
            running: i + CHUNK_SIZE < documents.length,
            newlyImported: newlyAcc,
          });
        }

        setProgress((p) => ({ ...p, running: false }));
        if (newlyAcc > 0) onImported?.();
      } catch (e) {
        console.warn('[useAutoImportGroupDocs] failed', e);
        if (!cancelled) setProgress((p) => ({ ...p, running: false }));
      }
    })();

    return () => { cancelled = true; };
  }, [leadId, leadName, whatsappGroupId, onImported]);

  return progress;
}
