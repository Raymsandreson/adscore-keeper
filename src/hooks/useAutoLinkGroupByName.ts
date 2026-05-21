/**
 * useAutoLinkGroupByName
 * --------------------------------------------------------------
 * Quando um lead com caso fechado abre e ainda não tem grupo
 * WhatsApp vinculado, procura no cache de grupos por nome
 * (whatsapp_groups_cache.group_name ilike tokens do nome do lead).
 *
 * - Match único → insere em `lead_whatsapp_groups` (Externo).
 *   A trigger `trg_auto_close_on_group_link` no Externo já cuida
 *   de marcar o lead como `closed`.
 * - Vários matches → emite toast pedindo escolha manual.
 * - Nenhum match → silencioso.
 *
 * Roda 1x por sessão por lead (sessionStorage).
 */

import { useEffect, useRef, useState } from 'react';
import { authClient as cloudClient } from '@/integrations/supabase';
import { externalSupabase } from '@/integrations/supabase/externalClient';
import { toast } from 'sonner';

const SESSION_PREFIX = 'auto-link-group:v1:';

function tokenizeName(name: string): string[] {
  if (!name) return [];
  const stop = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'a', 'o', 'lead', 'caso']);
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !stop.has(t));
}

interface Options {
  leadId?: string | null;
  leadName?: string | null;
  hasCaseClosed: boolean;
  currentGroupId?: string | null;
  onLinked?: () => void;
}

export function useAutoLinkGroupByName({
  leadId,
  leadName,
  hasCaseClosed,
  currentGroupId,
  onLinked,
}: Options) {
  const [linking, setLinking] = useState(false);
  const ranRef = useRef<string | null>(null);

  useEffect(() => {
    if (!leadId || !leadName) return;
    if (!hasCaseClosed) return;
    if (currentGroupId) return;
    if (ranRef.current === leadId) return;

    const sessionKey = `${SESSION_PREFIX}${leadId}`;
    if (sessionStorage.getItem(sessionKey)) return;

    const tokens = tokenizeName(leadName);
    if (tokens.length === 0) return;

    ranRef.current = leadId;
    sessionStorage.setItem(sessionKey, '1');

    let cancelled = false;

    (async () => {
      setLinking(true);
      try {
        // OR ilike across all significant tokens
        const orFilter = tokens
          .map((t) => `group_name.ilike.%${t.replace(/[%,()]/g, ' ')}%`)
          .join(',');

        const { data, error } = await cloudClient
          .from('whatsapp_groups_cache')
          .select('group_jid, group_name, instance_name, fetched_at')
          .or(orFilter)
          .order('fetched_at', { ascending: false })
          .limit(20);

        if (error || cancelled || !data || data.length === 0) return;

        // Score: number of tokens matched in group_name (case/accent-insensitive)
        const norm = (s: string) =>
          s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const scored = data
          .map((g: any) => {
            const name = norm(g.group_name || '');
            const matched = tokens.filter((t) => name.includes(t)).length;
            return { ...g, _score: matched };
          })
          .filter((g) => g._score > 0)
          .sort((a, b) => b._score - a._score);

        if (scored.length === 0) return;

        const top = scored[0];
        const competitors = scored.filter((g) => g._score === top._score);

        if (competitors.length === 1) {
          // unique winner → link automatically
          const { error: insertErr } = await externalSupabase
            .from('lead_whatsapp_groups')
            .insert({
              lead_id: leadId,
              group_jid: top.group_jid,
              group_name: top.group_name,
              instance_name: top.instance_name,
              auto_linked: true,
            } as any);

          if (insertErr) {
            // Likely duplicate (unique constraint) — silent
            return;
          }

          // Also update legacy column for compatibility
          await externalSupabase
            .from('leads')
            .update({ whatsapp_group_id: top.group_jid } as any)
            .eq('id', leadId);

          if (!cancelled) {
            toast.success(
              `Grupo "${top.group_name}" vinculado automaticamente a este lead.`,
              { duration: 5000 }
            );
            onLinked?.();
          }
        } else if (!cancelled) {
          toast.info(
            `Encontrei ${competitors.length} grupos que podem ser deste lead. Vincule manualmente em "Grupos WhatsApp".`,
            { duration: 6000 }
          );
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLinking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, leadName, hasCaseClosed, currentGroupId]);

  return { linking };
}
