import { useEffect } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// Rótulo por tipo de notificação (tabela activity_notifications no Externo).
const TYPE_LABELS: Record<string, string> = {
  assigned: '📌 Atividade repassada para você',
  feedback: '💬 Feedback na atividade',
  status: '🔄 Situação da atividade alterada',
  rescheduled: '🗓️ Atividade reagendada',
  mention: '@ Você foi mencionado',
  incompleto: '⚠️ Feedback marcado como incompleto',
  praise: '🌟 Seu trabalho foi elogiado',
  cobranca: '⏰ Cobrança de atividade atrasada',
};

/**
 * Popups em tempo real das atividades internas: atribuição, feedback do
 * responsável, mudança de situação, reagendamento e @menções.
 * Escuta INSERTs em activity_notifications (Externo) filtrados pelo
 * destinatário (UUID do Externo) e mostra um toast com ação de abrir a
 * atividade no painel lateral (mecanismo ?openActivity= já existente).
 * Montado no App ao lado de TeamChatNotifications.
 */
export function ActivityNotificationsListener() {
  const { user } = useAuthContext();

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    let channel: ReturnType<typeof externalSupabase.channel> | null = null;

    (async () => {
      try {
        await ensureExternalSession();
        await ensureRemapCache();
        const extId = await remapToExternal(user.id);
        if (!extId || cancelled) return;

        channel = externalSupabase
          .channel('activity-notifications-' + user.id)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'activity_notifications',
              filter: `recipient_id=eq.${extId}`,
            },
            (payload) => {
              const n = payload.new as {
                id: string;
                activity_id: string | null;
                type: string;
                title: string | null;
                body: string | null;
                actor_name: string | null;
              };
              // Cobrança: o próprio título já carrega o nível (❗ Importante / 🚨 Urgente).
              // Mostra em destaque (toast de alerta, mais persistente) para não passar batido.
              const isCobranca = n.type === 'cobranca';
              const heading = isCobranca && n.title ? n.title : (TYPE_LABELS[n.type] || '🔔 Atividade');
              const parts = [
                !isCobranca && n.title ? `“${n.title}”` : '',
                n.body || '',
                n.actor_name ? `— ${n.actor_name}` : '',
              ].filter(Boolean);
              const opts = {
                description: parts.join('\n'),
                duration: isCobranca ? 30000 : 15000,
                action: n.activity_id
                  ? {
                      label: 'Abrir atividade',
                      onClick: () => {
                        // Marca como lida (best-effort) e abre no painel lateral.
                        externalSupabase
                          .from('activity_notifications' as never)
                          .update({ read_at: new Date().toISOString() } as never)
                          .eq('id', n.id)
                          .then(() => {});
                        window.location.assign(`/?openActivity=${n.activity_id}`);
                      },
                    }
                  : undefined,
              };
              if (isCobranca) toast.warning(heading, opts);
              else toast(heading, opts);
            }
          )
          .subscribe();
      } catch (e) {
        console.warn('[ActivityNotificationsListener] setup falhou:', e);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) externalSupabase.removeChannel(channel);
    };
  }, [user?.id]);

  return null;
}
