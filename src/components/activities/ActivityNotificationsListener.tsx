import { useEffect } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { appNavigate } from '@/lib/appNavigation';

// Rótulo por tipo de notificação (tabela activity_notifications no Externo).
const TYPE_LABELS: Record<string, string> = {
  assigned: '📌 Atividade repassada para você',
  assigned_bulk: '📦 Atividades repassadas para você',
  feedback: '💬 Feedback na atividade',
  status: '🔄 Situação da atividade alterada',
  rescheduled: '🗓️ Atividade reagendada',
  mention: '@ Você foi mencionado',
  incompleto: '⚠️ Feedback marcado como incompleto',
  praise: '🌟 Seu trabalho foi elogiado',
  avaliacao: '✅ Sua atividade foi avaliada',
  insatisfeito: '🔄 Pedido de melhoria na atividade',
  cobranca: '⏰ Cobrança de atividade atrasada',
  abertura: '👀 Atividade aberta pelo responsável',
};

// Tipos que não podem se perder se o membro estiver offline na hora do INSERT:
// cobrança e o retorno da avaliação. Ao logar, os pendentes aparecem em fila.
const CATCH_UP_TYPES = ['cobranca', 'incompleto', 'praise', 'avaliacao', 'insatisfeito'];
const CATCH_UP_DIAS = 7;

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
        // X para fechar. Estes popups ficam 15s (feedback, atribuição) a 30s
        // (cobrança, incompleto, insatisfeito) na tela e podem chegar
        // empilhados — sem o botão só saíam esperando o tempo acabar, porque
        // clicar no corpo não fecha e o único botão é "Abrir atividade", que
        // ainda dá preventDefault para manter o popup aberto.
        closeButton: true,
        action: n.activity_id
          ? {
              label: 'Abrir atividade',
              onClick: (event: { preventDefault: () => void }) => {
                // Mantém o popup na tela após abrir (o padrão do sonner é fechar no clique).
                event.preventDefault();
                markSeen(n.id);
                // SPA, não recarga: recarregar apagava os outros popups da tela.
                appNavigate(`/?openActivity=${n.activity_id}`);
              },
            }
          : undefined,
      };
      if (isCobranca) {
        toast.warning(heading, opts);
        // Cobrança exibida = vista pelo responsável; registra o "visto" para o observador.
        markSeen(n.id);
      } else if (n.type === 'incompleto' || n.type === 'insatisfeito') {
        // Avaliação que pede ação do responsável — fica mais tempo na tela.
        toast.warning(heading, { ...opts, duration: 30000 });
      } else if (n.type === 'praise') {
        toast.success(heading, opts);
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

        // Cobranças e avaliações pendentes (ainda não vistas): aparecem assim que o
        // responsável loga/abre o app, mesmo que estivesse offline quando chegaram.
        try {
          const desde = new Date(Date.now() - CATCH_UP_DIAS * 86400_000).toISOString();
          const { data: pend } = await (externalSupabase as any)
            .from('activity_notifications')
            .select('id, activity_id, type, title, body, actor_name')
            .eq('recipient_id', extId)
            .in('type', CATCH_UP_TYPES)
            .is('read_at', null)
            .gte('created_at', desde)
            .order('created_at', { ascending: true })
            .limit(10);
          if (!cancelled) (pend || []).forEach((n: Notif) => {
            render(n);
            // Exibida = vista; sem isso o mesmo popup voltaria a cada recarga.
            markSeen(n.id);
          });
        } catch (e) {
          console.warn('[ActivityNotificationsListener] pendentes falhou:', e);
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
