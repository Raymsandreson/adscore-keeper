import { useEffect } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';

/**
 * Auto-importa todas as mídias recentes do grupo WhatsApp do lead para a pasta
 * "Outro" do Drive, em segundo plano. Idempotente (a edge `lead-drive`
 * deduplica por nome+tamanho). Roda 1x por sessão por leadId.
 *
 * Use em qualquer tela que abra um lead (edit lead, detalhe de atividade etc.)
 * para garantir que os documentos do grupo estejam sempre espelhados no Drive.
 */
export function useAutoImportGroupDocs(
  leadId: string | null | undefined,
  leadName: string | null | undefined,
  whatsappGroupId: string | null | undefined,
  onImported?: () => void,
) {
  useEffect(() => {
    if (!leadId || !leadName || !whatsappGroupId) return;

    const key = `auto-import-docs:${leadId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    let cancelled = false;

    (async () => {
      try {
        await ensureExternalSession();
        const { data, error } = await externalSupabase
          .from('whatsapp_messages')
          .select('external_message_id, message_type, media_url, created_at')
          .eq('phone', whatsappGroupId)
          .in('message_type', ['image', 'document', 'video', 'audio'])
          .not('media_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(200);

        if (cancelled || error || !data?.length) return;

        const documents = data
          .map((m: any) => {
            const last = (m.external_message_id || '').slice(-32);
            if (!last) return null;
            return { message_id: last, document_type: 'Outro' };
          })
          .filter(Boolean);

        if (documents.length === 0) return;

        const { data: resp, error: invokeErr } = await supabase.functions.invoke(
          'import-group-docs-to-lead',
          {
            body: { lead_id: leadId, lead_name: leadName, documents },
          },
        );

        if (cancelled) return;
        if (invokeErr) {
          console.warn('[useAutoImportGroupDocs] invoke error', invokeErr);
          return;
        }

        const results = (resp as any)?.results || [];
        const newlyImported = results.filter(
          (r: any) => (r.status === 'ok' || r.status === 'ok_no_drive') && !r.deduped,
        ).length;

        if (newlyImported > 0) onImported?.();
      } catch (e) {
        console.warn('[useAutoImportGroupDocs] failed', e);
      }
    })();

    return () => { cancelled = true; };
  }, [leadId, leadName, whatsappGroupId, onImported]);
}
