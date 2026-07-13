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

        // 0) Coleta TODOS os group JIDs ligados a este lead:
        //    a) whatsapp_group_id direto do lead (param)
        //    b) qualquer contato vinculado ao lead cujo whatsapp_group_id != null
        //       (= contato que é um grupo)
        const groupIds = new Set<string>();
        if (whatsappGroupId) groupIds.add(whatsappGroupId);

        try {
          // contatos vinculados via contact_leads
          const { data: linked } = await externalSupabase
            .from('contact_leads')
            .select('contacts:contact_id(whatsapp_group_id)')
            .eq('lead_id', leadId);
          (linked || []).forEach((row: any) => {
            const gid = row?.contacts?.whatsapp_group_id;
            if (gid) groupIds.add(gid);
          });

          // contatos legados (contacts.lead_id == leadId)
          const { data: legacy } = await externalSupabase
            .from('contacts')
            .select('whatsapp_group_id')
            .eq('lead_id', leadId)
            .not('whatsapp_group_id', 'is', null);
          (legacy || []).forEach((row: any) => {
            if (row?.whatsapp_group_id) groupIds.add(row.whatsapp_group_id);
          });
        } catch (e) {
          console.warn('[useAutoImportGroupDocs] coletar group ids de contatos falhou', e);
        }

        // 1) Conta mídias disponíveis no WhatsApp (todos os grupos + lead).
        let mediaQuery = externalSupabase
          .from('whatsapp_messages')
          .select('external_message_id, message_type, media_url, created_at')
          .in('message_type', ['image', 'document'])
          .not('media_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(200);

        if (groupIds.size > 0) {
          const phoneIn = Array.from(groupIds)
            .map((g) => `"${g}"`)
            .join(',');
          mediaQuery = mediaQuery.or(`phone.in.(${phoneIn}),lead_id.eq.${leadId}`);
        } else {
          mediaQuery = mediaQuery.eq('lead_id', leadId);
        }

        const { data: mediaMsgs, error: mediaErr } = await mediaQuery;
        if (cancelled || mediaErr) return;

        // A MESMA mensagem de grupo existe N vezes em whatsapp_messages (uma
        // linha por instância do escritório no grupo), cada uma com um
        // external_message_id diferente — mas o sufixo após ':' (id real da
        // mensagem no WhatsApp) é idêntico. Sem essa dedup, `total` infla
        // (ex.: 81 linhas pra 19 mídias) e o import redisparava pra sempre,
        // repuxando tudo pro Drive a cada sincronização.
        const waMsgId = (id: string) => {
          const i = id.indexOf(':');
          return i >= 0 ? id.slice(i + 1) : id;
        };

        const bySuffix = new Map<string, string>(); // sufixo -> external_message_id escolhido
        [...(mediaMsgs || [])]
          .map((m: any) => String(m.external_message_id || '').trim())
          .filter(Boolean)
          .sort() // determinístico: mesma linha escolhida em toda execução
          .forEach((id) => {
            const key = waMsgId(id);
            if (key && !bySuffix.has(key)) bySuffix.set(key, id);
          });

        const total = bySuffix.size;
        if (total === 0) return;

        // 2) Busca o que JÁ está importado (por sufixo do id) — o que já tem
        //    registro NUNCA é reenviado, então apagar/organizar no Drive é
        //    definitivo (não volta na próxima sincronização).
        const { data: importedRows } = await supabase
          .from('process_documents')
          .select('ext_id:metadata->>external_message_id')
          .eq('lead_id', leadId)
          .eq('source', 'whatsapp_group')
          .limit(1000);
        const importedSuffixes = new Set(
          (importedRows || [])
            .map((r: any) => waMsgId(String(r.ext_id || '').trim()))
            .filter(Boolean),
        );

        const documents = Array.from(bySuffix.entries())
          .filter(([suffix]) => !importedSuffixes.has(suffix))
          .map(([, id]) => ({ message_id: id, document_type: 'Outro' }));

        const done = total - documents.length;
        setProgress({ total, done, running: false, newlyImported: 0 });

        // 3) Já tudo importado? Só mostra badge verde.
        if (documents.length === 0) {
          sessionStorage.setItem(`auto-import-docs:v6:${leadId}:done`, '1');
          return;
        }

        // 4) Guardas de sessão: lead 100% importado, importação já tentada
        //    nesta sessão (mídia que falha sempre não fica em loop), ou corrida
        //    concorrente de outro componente com o mesmo hook.
        const doneKey = `auto-import-docs:v6:${leadId}:done`;
        if (sessionStorage.getItem(doneKey)) return;

        const attemptedKey = `auto-import-docs:v6:${leadId}:attempted`;
        if (sessionStorage.getItem(attemptedKey)) return;

        const runningKey = `auto-import-docs:v6:${leadId}:running`;
        if (sessionStorage.getItem(runningKey)) return;
        sessionStorage.setItem(runningKey, '1');
        sessionStorage.setItem(attemptedKey, '1');

        setProgress({ total, done, running: true, newlyImported: 0 });

        const CHUNK_SIZE = 5;
        let doneAcc = done;
        let newlyAcc = 0;

        try {
          for (let i = 0; i < documents.length; i += CHUNK_SIZE) {
            if (cancelled) return;
            const chunk = documents.slice(i, i + CHUNK_SIZE);

            const { data: resp, error: invokeErr } = await supabase.functions.invoke(
              'import-group-docs-to-lead',
              { body: { lead_id: leadId, lead_name: leadName, documents: chunk } },
            );

            if (cancelled) return;
            if (invokeErr) {
              // Loga e CONTINUA — uma falha de rede em um lote não pode
              // abortar os outros 38 lotes que ainda faltam.
              console.warn('[useAutoImportGroupDocs] invoke error (continuando)', invokeErr);
              continue;
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

          if (doneAcc >= total) sessionStorage.setItem(doneKey, '1');
        } finally {
          sessionStorage.removeItem(runningKey);
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
