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
 * Auto-importa todas as mídias recentes do grupo WhatsApp do lead para a pasta
 * "Outro" do Drive, em segundo plano. Idempotente (a edge `lead-drive`
 * deduplica por nome+tamanho). Roda 1x por sessão por leadId.
 *
 * Retorna progresso { total, done, running } para o caller exibir badge
 * "Drive x/y" igual ao do chat do WhatsApp.
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

    const key = `auto-import-docs:${leadId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    let cancelled = false;

    (async () => {
      try {
        await ensureExternalSession();
        let query = externalSupabase
          .from('whatsapp_messages')
          .select('external_message_id, message_type, media_url, created_at')
          .in('message_type', ['image', 'document', 'video', 'audio'])
          .not('media_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(200);

        query = whatsappGroupId
          ? query.or(`phone.eq.${whatsappGroupId},lead_id.eq.${leadId}`)
          : query.eq('lead_id', leadId);

        const { data, error } = await query;

        if (cancelled || error || !data?.length) return;

        const documents = data
          .map((m: any) => {
            const last = (m.external_message_id || '').slice(-32);
            if (!last) return null;
            return { message_id: last, document_type: 'Outro' };
          })
          .filter(Boolean);

        if (documents.length === 0) return;

        setProgress({ total: documents.length, done: 0, running: true, newlyImported: 0 });

        const { data: resp, error: invokeErr } = await supabase.functions.invoke(
          'import-group-docs-to-lead',
          {
            body: { lead_id: leadId, lead_name: leadName, documents },
          },
        );

        if (cancelled) return;
        if (invokeErr) {
          console.warn('[useAutoImportGroupDocs] invoke error', invokeErr);
          setProgress((p) => ({ ...p, running: false }));
          return;
        }

        const results = (resp as any)?.results || [];
        const okCount = results.filter(
          (r: any) => r.status === 'ok' || r.status === 'ok_no_drive',
        ).length;
        const newlyImported = results.filter(
          (r: any) => (r.status === 'ok' || r.status === 'ok_no_drive') && !r.deduped,
        ).length;

        setProgress({
          total: documents.length,
          done: okCount,
          running: false,
          newlyImported,
        });

        if (newlyImported > 0) onImported?.();
      } catch (e) {
        console.warn('[useAutoImportGroupDocs] failed', e);
        if (!cancelled) setProgress((p) => ({ ...p, running: false }));
      }
    })();

    return () => { cancelled = true; };
  }, [leadId, leadName, whatsappGroupId, onImported]);

  return progress;
}
