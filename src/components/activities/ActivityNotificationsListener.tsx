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
  abertura: '👀 Atividade aberta pelo responsável',
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

    // Marca a notificação como lida/vista (best-effort) — alimenta o "visto" no card do observador.
    const markSeen = (id: string) => {
      externalSupabase
        .from('activity_notifications' as never)
        .update({ read_at: new Date().toISOString() } as never)
        .eq('id', id)
        .then(() => {});
    };

    type Notif = {
      id: string;
      activity_id: string | null;
      type: string;
      title: string | null;
      body: string | null;
      actor_name: string | null;
    };

    const render = (n: Notif) => {
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
                markSeen(n.id);
                window.location.assign(`/?openActivity=${n.activity_id}`);
              },
            }
          : undefined,
      };
      if (isCobranca) {
        toast.warning(heading, opts);
        // Cobrança exibida = vista pelo responsável; registra o "visto" para o observador.
        markSeen(n.id);
      } else {
        toast(heading, opts);
      }
    };

    (async () => {
      try {
        await ensureExternalSession();
        await ensureRemapCache();
        const extId = await remapToExternal(user.id);
        if (!extId || cancelled) return;

        // Cobranças pendentes (ainda não vistas): aparecem assim que o responsável
        // loga/abre o app, mesmo que estivesse offline quando foram enviadas.
        try {
          const { data: pend } = await (externalSupabase as any)
            .from('activity_notifications')
            .select('id, activity_id, type, title, body, actor_name')
            .eq('recipient_id', extId)
            .eq('type', 'cobranca')
            .is('read_at', null)
            .order('created_at', { ascending: true })
            .limit(10);
          if (!cancelled) (pend || []).forEach((n: Notif) => render(n));
        } catch (e) {
          console.warn('[ActivityNotificationsListener] cobranças pendentes falhou:', e);
        }

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
            (payload) => render(payload.new as Notif)
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
