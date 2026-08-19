import { useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AtSign, MessageCircle, EyeOff, AlarmClock } from 'lucide-react';
import { playUrgentChime } from '@/lib/sounds';
import { isSoundEnabled } from '@/lib/soundSettings';
import { TeamNotificationToast } from './TeamNotificationToast';
import { openTeamChatConversation } from '@/lib/teamChatPanelEvents';
import { appNavigate } from '@/lib/appNavigation';
import { resolveActivityChatRoots, resolveOpenActivityOfChain } from '@/lib/activityChatThread';
import { resolveThreadKeys, resolveChatScope } from '@/lib/entityChatScope';
import {
  getActiveTeamChatConversation,
  getActiveTeamChatEntity,
  subscribeActiveTeamChatConversation,
} from '@/lib/teamChatActiveConversation';

const MUTE_KEY = 'team-chat-notifications-muted';
const MUTE_UNTIL_KEY = 'team-chat-notifications-muted-until';

function isMuted() {
  // Check timed mute first
  const mutedUntil = localStorage.getItem(MUTE_UNTIL_KEY);
  if (mutedUntil) {
    if (Date.now() < Number(mutedUntil)) return true;
    // Expired – clean up
    localStorage.removeItem(MUTE_UNTIL_KEY);
    localStorage.removeItem(MUTE_KEY);
    return false;
  }
  return localStorage.getItem(MUTE_KEY) === 'true';
}

function muteForMinutes(minutes: number | null) {
  if (minutes === null) {
    // Indefinite mute
    localStorage.setItem(MUTE_KEY, 'true');
    localStorage.removeItem(MUTE_UNTIL_KEY);
    toast.info('Notificações silenciadas até você reativar');
  } else {
    const until = Date.now() + minutes * 60 * 1000;
    localStorage.setItem(MUTE_UNTIL_KEY, String(until));
    localStorage.setItem(MUTE_KEY, 'true');
    const label = minutes >= 60 ? `${minutes / 60} hora${minutes > 60 ? 's' : ''}` : `${minutes} minutos`;
    toast.info(`Notificações silenciadas por ${label}`);
  }
}

function buildPreview(message: { content?: string | null; message_type?: string | null; file_name?: string | null }) {
  const content = message.content?.trim();
  if (content) return content;

  switch (message.message_type) {
    case 'audio':
      return '🎤 Áudio';
    case 'image':
      return '📷 Imagem';
    case 'file':
      return message.file_name ? `📎 ${message.file_name}` : '📎 Arquivo';
    default:
      return 'Nova mensagem';
  }
}

const NORMAL_TOAST_DURATION_MS = 15000;

// Cobrança de menção pendente não pode se perder: quem estava offline vê ao voltar.
const MENTION_NUDGE_CATCH_UP_DIAS = 7;

// Menção recebida com o app fechado também não: marca d'água do último popup
// exibido, pra mostrar o que chegou desde então sem repetir a cada recarga.
const MENTION_CATCH_UP_KEY = 'team-mentions-last-popup-at';
const MENTION_CATCH_UP_DIAS = 3;
const MENTION_CATCH_UP_MAX = 5;

/** Linha de mention_nudges (Externo) — a cobrança "responda com urgência". */
type MentionNudge = {
  id: string;
  message_id: string;
  actor_id: string | null;
  actor_name: string | null;
  level: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
};

/** Texto da menção cobrada — é o que a pessoa precisa ler pra saber o que responder. */
async function mentionNudgePreview(messageId: string): Promise<string> {
  try {
    const { data } = await externalSupabase
      .from('team_chat_messages')
      .select('content, message_type, file_name')
      .eq('id', messageId)
      .maybeSingle();
    if (data) return buildPreview(data as any).substring(0, 120);
  } catch (e) {
    console.warn('[TeamChatNotifications] preview da cobrança falhou:', e);
  }
  return 'Você foi marcado e estão esperando sua resposta.';
}

/** Popup exibido = cobrança vista (alimenta o "✓ visto" de quem cobrou). */
function markMentionNudgeSeen(id: string) {
  return (externalSupabase as any)
    .from('mention_nudges')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
    .then(() => {});
}

// Um popup por conversa (estilo WhatsApp): mensagens novas da mesma pessoa/grupo
// atualizam o popup existente e incrementam o contador, em vez de empilhar.
const conversationToastState = new Map<string, { count: number; urgent: boolean }>();

function conversationToastId(conversationId: string) {
  return `team-chat-conv-${conversationId}`;
}

function clearConversationToastState(conversationId: string) {
  conversationToastState.delete(conversationId);
}

function dismissConversationToast(conversationId: string) {
  clearConversationToastState(conversationId);
  toast.dismiss(conversationToastId(conversationId));
}

function showNotificationToast({
  id,
  icon,
  title,
  context,
  preview,
  count,
  urgent,
  fileUrl,
  fileName,
  fileType,
  messageType,
  onOpen,
  onReply,
  onClosed,
  onManualDismiss,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  context?: string;
  preview: string;
  count?: number;
  urgent?: boolean;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  messageType?: string | null;
  onOpen: () => void | Promise<void>;
  onReply?: (reply: string) => Promise<void>;
  onClosed?: () => void;
  onManualDismiss?: () => void;
}) {
  toast.custom((toastId) => (
    <TeamNotificationToast
      toastId={toastId}
      icon={icon}
      title={title}
      context={context}
      preview={preview}
      count={count}
      urgent={urgent}
      fileUrl={fileUrl}
      fileName={fileName}
      fileType={fileType}
      messageType={messageType}
      onOpen={onOpen}
      onReply={onReply}
      onMuteForMinutes={muteForMinutes}
      onManualDismiss={onManualDismiss}
    />
  ), {
    ...(id ? { id } : {}),
    duration: urgent ? Infinity : NORMAL_TOAST_DURATION_MS,
    position: 'top-center',
    onDismiss: onClosed,
    onAutoClose: onClosed,
  });
}

function showConversationToast({
  conversationId,
  icon,
  title,
  context,
  preview,
  urgent,
  increment,
  fileUrl,
  fileName,
  fileType,
  messageType,
  onOpen,
  onReply,
  onManualDismiss,
}: {
  conversationId: string;
  icon: ReactNode;
  title: string;
  context?: string;
  preview: string;
  urgent?: boolean;
  increment: boolean;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  messageType?: string | null;
  onOpen: () => void | Promise<void>;
  onReply?: (reply: string) => Promise<void>;
  onManualDismiss?: () => void;
}) {
  const state = conversationToastState.get(conversationId) || { count: 0, urgent: false };
  if (increment || state.count === 0) state.count += 1;
  state.urgent = state.urgent || !!urgent;
  conversationToastState.set(conversationId, state);

  showNotificationToast({
    id: conversationToastId(conversationId),
    icon,
    title,
    context,
    preview,
    count: state.count,
    urgent: state.urgent,
    fileUrl,
    fileName,
    fileType,
    messageType,
    onOpen: () => {
      clearConversationToastState(conversationId);
      return onOpen();
    },
    onReply: onReply
      ? async (reply) => {
          await onReply(reply);
          clearConversationToastState(conversationId);
        }
      : undefined,
    onClosed: () => clearConversationToastState(conversationId),
    onManualDismiss,
  });

  // Mudo de fábrica: liga em Configurações → Notificações → Sons do sistema.
  if (urgent && isSoundEnabled('chatUrgent')) playUrgentChime();
}

export function TeamChatNotifications() {
  const { user } = useAuthContext();
  const teamConversationIdsRef = useRef<Set<string>>(new Set());
  /** Chats de ficha que eu acompanho — `${entity_type}:${entity_id}`. */
  const followedThreadsRef = useRef<Set<string>>(new Set());
  const teamConversationLabelsRef = useRef<Map<string, string>>(new Map());
  const currentUserNameRef = useRef('');

  useEffect(() => {
    if (!user) return;

    console.log('[TeamChatNotifications] Subscribing for user:', user.id);

    void ensureExternalSession();

    const loadCurrentUserName = async () => {
      // profiles continua no Cloud
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle();

      currentUserNameRef.current = data?.full_name || user.email || 'Usuário';
    };

    const loadTeamConversationContext = async () => {
      const { data: memberships, error: membershipsError } = await externalSupabase
        .from('team_conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (membershipsError) {
        console.error('[TeamChatNotifications] Failed to load team memberships:', membershipsError);
        return;
      }

      const conversationIds = memberships?.map((membership) => membership.conversation_id) || [];
      teamConversationIdsRef.current = new Set(conversationIds);

      if (conversationIds.length === 0) {
        teamConversationLabelsRef.current = new Map();
        return;
      }

      const { data: conversations, error: conversationsError } = await externalSupabase
        .from('team_conversations')
        .select('id, type, name')
        .in('id', conversationIds);

      if (conversationsError) {
        console.error('[TeamChatNotifications] Failed to load team conversations:', conversationsError);
        return;
      }

      teamConversationLabelsRef.current = new Map(
        (conversations || []).map((conversation) => [
          conversation.id,
          getConversationLabel(conversation.type, conversation.name),
        ])
      );
    };

    const resolveConversationLabel = async (conversationId: string) => {
      const cached = teamConversationLabelsRef.current.get(conversationId);
      if (cached) return cached;

      const { data } = await externalSupabase
        .from('team_conversations')
        .select('type, name')
        .eq('id', conversationId)
        .maybeSingle();

      const label = getConversationLabel(data?.type, data?.name ?? null);
      teamConversationLabelsRef.current.set(conversationId, label);
      return label;
    };

    const isUserConversationMember = async (conversationId: string) => {
      if (teamConversationIdsRef.current.has(conversationId)) return true;

      const { data } = await externalSupabase
        .from('team_conversation_members')
        .select('conversation_id')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (data?.conversation_id) {
        teamConversationIdsRef.current.add(conversationId);
        return true;
      }

      return false;
    };

    const getCurrentUserName = () => currentUserNameRef.current || user.email || 'Usuário';

    // Registra que o usuário viu o popup e fechou sem responder — avisa quem enviou
    const recordPopupDismissal = async ({
      conversationId,
      messageId,
      senderId,
    }: {
      conversationId: string;
      messageId?: string;
      senderId?: string;
    }) => {
      if (!senderId || senderId === user.id) return;
      const { error } = await ((externalSupabase as any).from('team_popup_receipts') as any).insert({
        conversation_id: conversationId,
        message_id: messageId || null,
        dismissed_by: user.id,
        dismissed_by_name: getCurrentUserName(),
        notify_user_id: senderId,
      });
      if (error) console.error('[TeamChatNotifications] Failed to record popup dismissal:', error);
    };

    const replyToEntityChat = async ({
      entityType,
      entityId,
      entityName,
      content,
    }: {
      entityType: string;
      entityId: string;
      entityName?: string | null;
      content: string;
    }) => {
      // Responder pelo popup entra no MESMO thread do chat: no processo quando
      // a atividade tem um, senão na raiz da cadeia. Popup de mensagem legada
      // (gravada no id da atividade) não pode reabrir a conversa em separado.
      const escopo = await resolveChatScope(entityType, entityId);

      const { error } = await externalSupabase
        .from('team_chat_messages')
        .insert({
          entity_type: escopo.writeType,
          entity_id: escopo.writeId,
          entity_name: escopo.writeName || entityName || null,
          content,
          sender_id: user.id,
          sender_name: getCurrentUserName(),
        });

      if (error) throw error;
    };

    const replyToConversation = async (conversationId: string, content: string) => {
      const { error } = await externalSupabase
        .from('team_messages')
        .insert({
          conversation_id: conversationId,
          content,
          sender_id: user.id,
          sender_name: getCurrentUserName(),
          message_type: 'text',
        });

      if (error) throw error;

      const { error: updateError } = await externalSupabase
        .from('team_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      if (updateError) throw updateError;
    };

    const getEntityChatUrl = async ({
      entityType,
      entityId,
      messageId,
    }: {
      entityType: string;
      entityId: string;
      messageId?: string;
    }) => {
      const messageParam = messageId ? `&highlightMsg=${messageId}` : '';

      switch (entityType) {
        case 'lead': {
          let boardParam = '';
          const { data } = await supabase
            .from('leads')
            .select('board_id')
            .eq('id', entityId)
            .maybeSingle();

          if (data?.board_id) {
            boardParam = `board=${data.board_id}&`;
          }

          return `/leads?${boardParam}openLead=${entityId}${messageParam}`;
        }
        case 'activity': {
          // O chat é da cadeia e mora na raiz, que costuma estar concluída.
          // Abrir a etapa VIVA — a conversa é a mesma em qualquer elo.
          const alvo = await resolveOpenActivityOfChain(entityId);
          return `/?openActivity=${alvo}${messageParam}`;
        }
        case 'contact':
          return `/leads?openContact=${entityId}${messageParam}`;
        case 'workflow':
          return `/workflow?openBoard=${entityId}${messageParam}`;
        case 'pop_step': {
          // entityId = id do passo. Resolve o board (POP) que o contém via
          // template → stage link (tudo no Externo).
          let boardId: string | null = null;
          try {
            await ensureExternalSession();
            const { data: tmpl } = await (externalSupabase as any)
              .from('checklist_templates')
              .select('id')
              .contains('items', [{ id: entityId }])
              .limit(1)
              .maybeSingle();
            if (tmpl?.id) {
              const { data: link } = await externalSupabase
                .from('checklist_stage_links')
                .select('board_id')
                .eq('checklist_template_id', tmpl.id)
                .limit(1)
                .maybeSingle();
              boardId = (link as { board_id?: string } | null)?.board_id ?? null;
            }
          } catch (e) {
            console.error('Erro ao resolver o POP do passo:', e);
          }
          if (!boardId) return null;
          return `/workflow-progress?editBoard=${boardId}&openStep=${entityId}&openStepChat=1${messageParam}`;
        }
        case 'whatsapp':
          return `/whatsapp?openChat=${encodeURIComponent(entityId)}`;
        case 'process':
          // Sem este case o clique no popup era morto e silencioso: o default
          // devolvia null e openEntityChat saía sem navegar.
          return `/cases?openProcess=${entityId}${messageParam}`;
        case 'case':
          return `/cases/${entityId}${messageParam ? `?${messageParam.slice(1)}` : ''}`;
        default:
          return null;
      }
    };

    const openEntityChat = async (options: { entityType: string; entityId: string; messageId?: string }) => {
      const url = await getEntityChatUrl(options);
      if (!url) return;
      // SPA, não recarga: recarregar a página apagava os outros popups da tela.
      appNavigate(url);
    };

    void Promise.all([loadTeamConversationContext(), loadCurrentUserName()]);

    // Listen for new mentions directed at this user
    const handleMention = async (mention: any) => {
        // Branch 1: mention inside a team conversation (general/direct chat)
        if (mention.conversation_id) {
          const { data: tmsg } = await (externalSupabase
            .from('team_messages') as any)
            .select('content, sender_name, sender_id, message_type, file_name, file_url, file_type, is_urgent')
            .eq('id', mention.message_id)
            .maybeSingle();

          if (!tmsg) return;
          if ((tmsg as any).sender_id === user.id) return; // nunca notificar mensagem própria
          if (
            getActiveTeamChatConversation() === mention.conversation_id &&
            document.visibilityState === 'visible'
          ) return; // conversa já aberta na tela

          const senderName = (tmsg as any).sender_name || 'Alguém';
          const context = await resolveConversationLabel(mention.conversation_id);
          const preview = buildPreview(tmsg as any).substring(0, 120);

          showConversationToast({
            conversationId: mention.conversation_id,
            icon: <AtSign className="h-4 w-4 text-primary shrink-0" />,
            title: `${senderName} te mencionou`,
            context,
            preview,
            urgent: Boolean((tmsg as any).is_urgent),
            increment: false, // o canal de team_messages já conta essa mensagem
            fileUrl: (tmsg as any).file_url,
            fileName: (tmsg as any).file_name,
            fileType: (tmsg as any).file_type,
            messageType: (tmsg as any).message_type,
            onOpen: () => {
              openTeamChatConversation({
                conversationId: mention.conversation_id,
                focusComposer: true,
              });
            },
            onReply: (reply) => replyToConversation(mention.conversation_id, reply),
            onManualDismiss: () => {
              void recordPopupDismissal({
                conversationId: mention.conversation_id,
                messageId: mention.message_id,
                senderId: (tmsg as any).sender_id,
              });
            },
          });
          return;
        }

        // Branch 2: menção no chat de uma ficha (atividade, lead, processo…)
        // `as any` como no branch 1: os types gerados não conhecem as colunas de
        // mídia de team_chat_messages (message_type, file_*), que existem no
        // banco desde a migration de anexos. Sem isso o select inteiro vira
        // SelectQueryError e o tsc reprova até `sender_name`.
        const { data: msg } = await (externalSupabase
          .from('team_chat_messages') as any)
          .select('content, sender_name, sender_id, entity_name, entity_type, message_type, file_name, file_url, file_type, is_urgent')
          .eq('id', mention.message_id)
          .single();

        if (!msg) return;
        if ((msg as any).sender_id === user.id) return; // nunca notificar mensagem própria

        // Marcado aqui = passo a acompanhar este chat já nesta sessão, sem
        // esperar recarregar a página pra receber a resposta que vier depois.
        followedThreadsRef.current.add(`${msg.entity_type}:${mention.entity_id}`);

        if (
          getActiveTeamChatEntity() === `${msg.entity_type}:${mention.entity_id}` &&
          document.visibilityState === 'visible'
        ) return; // o chat dessa ficha já está aberto na tela

        const senderName = msg.sender_name || 'Alguém';
        const context = msg.entity_name || msg.entity_type || '';
        const preview = buildPreview(msg).substring(0, 120);
        // Menção urgente na ficha vale o mesmo que no chat direto: som e popup
        // que só sai no clique. Sem isso ela sumia sozinha em 15s, calada.
        const urgent = Boolean((msg as any).is_urgent);

        showNotificationToast({
          id: `team-entity-${mention.entity_type}-${mention.entity_id}`,
          icon: <AtSign className={`h-4 w-4 shrink-0 ${urgent ? 'text-destructive' : 'text-primary'}`} />,
          title: `${senderName} te mencionou`,
          context: context ? `em ${context}` : undefined,
          preview,
          urgent,
          fileUrl: (msg as any).file_url,
          fileName: (msg as any).file_name,
          fileType: (msg as any).file_type,
          messageType: (msg as any).message_type,
          onOpen: () => openEntityChat({
            entityType: msg.entity_type,
            entityId: mention.entity_id,
            messageId: mention.message_id,
          }),
          onReply: (reply) => replyToEntityChat({
            entityType: mention.entity_type,
            entityId: mention.entity_id,
            entityName: mention.entity_name,
            content: reply,
          }),
        });
    };

    // Threads de ficha que eu acompanho (fui marcado ou já falei) e ainda não
    // finalizei. É o que decide se a mensagem que chega vira popup.
    const loadFollowedThreads = async () => {
      const { data } = await (externalSupabase as any)
        .from('team_chat_thread_followers')
        .select('entity_type, entity_id')
        .eq('user_id', user.id)
        .is('left_at', null);
      const seguidos = (data || []) as { entity_type: string; entity_id: string }[];
      const chaves = new Set(seguidos.map(f => `${f.entity_type}:${f.entity_id}`));

      // Linhas gravadas antes do chat virar da cadeia apontam para o id do ELO.
      // A mensagem nova chega na raiz — sem traduzir, quem acompanhava desde
      // antes deixaria de ser avisado ao virar a etapa.
      const idsDeAtividade = seguidos.filter(f => f.entity_type === 'activity').map(f => f.entity_id);
      const raizes = await resolveActivityChatRoots(idsDeAtividade);
      for (const raiz of raizes.values()) chaves.add(`activity:${raiz}`);

      // Desde 19/08/2026 a conversa da atividade/processo que tem caso mora no
      // CASO. Quem acompanhava pelo id da atividade (ou do processo, no escopo
      // anterior, de 18/08) continua sendo avisado.
      const donos = await resolveThreadKeys({
        activityIds: idsDeAtividade,
        processIds: seguidos.filter(f => f.entity_type === 'process').map(f => f.entity_id),
      });
      for (const chave of donos) chaves.add(chave);

      followedThreadsRef.current = chaves;
    };
    void loadFollowedThreads();

    // Mensagem nova num chat de ficha que eu acompanho — mesmo sem @ pra mim.
    // Sem filtro no servidor porque a chave é (entity_type, entity_id); o corte
    // é aqui, contra o conjunto que eu sigo. Volume real: ~50 msgs/dia.
    const followedThreadsChannel = externalSupabase
      .channel('notification-followed-threads-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_messages',
      }, async (payload) => {
        if (isMuted()) return;
        const msg = payload.new as any;
        if (!msg?.entity_id || msg.sender_id === user.id) return;

        const key = `${msg.entity_type}:${msg.entity_id}`;
        if (!followedThreadsRef.current.has(key)) return;
        if (getActiveTeamChatEntity() === key && document.visibilityState === 'visible') return;

        // Se essa mensagem me marcou, o canal de menções já cuida dela — o
        // popup de lá é mais completo e não pode virar dois avisos.
        const { count } = await (externalSupabase as any)
          .from('team_chat_mentions')
          .select('id', { count: 'exact', head: true })
          .eq('message_id', msg.id)
          .eq('mentioned_user_id', user.id);
        if (count) return;

        const urgent = Boolean(msg.is_urgent);
        showNotificationToast({
          id: `team-entity-${msg.entity_type}-${msg.entity_id}`,
          icon: <MessageCircle className={`h-4 w-4 shrink-0 ${urgent ? 'text-destructive' : 'text-primary'}`} />,
          title: msg.sender_name || 'Alguém',
          context: msg.entity_name ? `em ${msg.entity_name}` : `em ${getEntityLabel(msg.entity_type)}`,
          preview: buildPreview(msg).substring(0, 120),
          urgent,
          fileUrl: msg.file_url,
          fileName: msg.file_name,
          fileType: msg.file_type,
          messageType: msg.message_type,
          onOpen: () => openEntityChat({
            entityType: msg.entity_type,
            entityId: msg.entity_id,
            messageId: msg.id,
          }),
          onReply: (reply) => replyToEntityChat({
            entityType: msg.entity_type,
            entityId: msg.entity_id,
            entityName: msg.entity_name,
            content: reply,
          }),
        });
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Followed threads channel status:', status);
      });

    const mentionsChannel = externalSupabase
      .channel('notification-mentions-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_mentions',
        filter: `mentioned_user_id=eq.${user.id}`,
      }, async (payload) => {
        console.log('[TeamChatNotifications] Mention received:', payload);
        if (isMuted()) return;
        await handleMention(payload.new as any);
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Mentions channel status:', status);
      });

    // Menção que chegou com o app fechado não pode se perder: ao voltar, as não
    // lidas desde o último popup aparecem em fila. A marca d'água evita repetir
    // o mesmo popup a cada recarga (marcar como lida aqui apagaria o badge).
    void (async () => {
      if (isMuted()) return;
      const marca = localStorage.getItem(MENTION_CATCH_UP_KEY);
      const desde = marca || new Date(Date.now() - MENTION_CATCH_UP_DIAS * 86400_000).toISOString();
      const agora = new Date().toISOString();
      const { data: pend } = await externalSupabase
        .from('team_chat_mentions')
        .select('message_id, conversation_id, entity_type, entity_id, entity_name, created_at')
        .eq('mentioned_user_id', user.id)
        .eq('is_read', false)
        .gt('created_at', desde)
        .order('created_at', { ascending: true })
        .limit(MENTION_CATCH_UP_MAX);
      localStorage.setItem(MENTION_CATCH_UP_KEY, agora);
      for (const m of (pend || [])) {
        await handleMention(m as any);
      }
    })();

    // Contextual team chat messages channel REMOVED — was broadcasting to ALL users.
    // Mentions are already handled by mentionsChannel above.

    // Listen for team direct/group chat messages used by the Chat da Equipe panel
    const teamMessagesChannel = externalSupabase
      .channel('notification-team-messages-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_messages',
      }, async (payload) => {
        console.log('[TeamChatNotifications] Team message received:', payload);
        if (isMuted()) return;

        const msg = payload.new as any;
        if (msg.sender_id === user.id) return; // mensagem própria nunca gera popup
        if (
          getActiveTeamChatConversation() === msg.conversation_id &&
          document.visibilityState === 'visible'
        ) return; // conversa já aberta na tela
        if (!(await isUserConversationMember(msg.conversation_id))) return;

        const senderName = msg.sender_name || 'Alguém';
        const context = await resolveConversationLabel(msg.conversation_id);
        const preview = buildPreview(msg).substring(0, 120);

        showConversationToast({
          conversationId: msg.conversation_id,
          icon: <MessageCircle className="h-4 w-4 text-primary shrink-0" />,
          title: senderName,
          context,
          preview,
          urgent: Boolean(msg.is_urgent),
          increment: true,
          fileUrl: msg.file_url,
          fileName: msg.file_name,
          fileType: msg.file_type,
          messageType: msg.message_type,
          onOpen: () => {
            openTeamChatConversation({
              conversationId: msg.conversation_id,
              focusComposer: true,
            });
          },
          onReply: (reply) => replyToConversation(msg.conversation_id, reply),
          onManualDismiss: () => {
            void recordPopupDismissal({
              conversationId: msg.conversation_id,
              messageId: msg.id,
              senderId: msg.sender_id,
            });
          },
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'team_messages',
      }, async (payload) => {
        // "Reenviar como urgente": mensagem antiga marcada de novo → popup reaparece
        if (isMuted()) return;

        const msg = payload.new as any;
        if (msg.sender_id === user.id) return;
        if (!msg.is_urgent || !msg.urgent_alert_at) return;
        // Só reage a re-alertas recentes (evita popup em UPDATEs não relacionados)
        if (Date.now() - new Date(msg.urgent_alert_at).getTime() > 60_000) return;
        if (
          getActiveTeamChatConversation() === msg.conversation_id &&
          document.visibilityState === 'visible'
        ) return;
        if (!(await isUserConversationMember(msg.conversation_id))) return;

        const senderName = msg.sender_name || 'Alguém';
        const context = await resolveConversationLabel(msg.conversation_id);
        const preview = buildPreview(msg).substring(0, 120);

        showConversationToast({
          conversationId: msg.conversation_id,
          icon: <MessageCircle className="h-4 w-4 text-destructive shrink-0" />,
          title: `${senderName} está aguardando resposta`,
          context,
          preview,
          urgent: true,
          increment: false,
          fileUrl: msg.file_url,
          fileName: msg.file_name,
          fileType: msg.file_type,
          messageType: msg.message_type,
          onOpen: () => {
            openTeamChatConversation({
              conversationId: msg.conversation_id,
              focusComposer: true,
            });
          },
          onReply: (reply) => replyToConversation(msg.conversation_id, reply),
          onManualDismiss: () => {
            void recordPopupDismissal({
              conversationId: msg.conversation_id,
              messageId: msg.id,
              senderId: msg.sender_id,
            });
          },
        });
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Team messages channel status:', status);
      });

    // Cobrança de menção ("responda com urgência"): popup vermelho que só sai
    // com o clique, e o "visto" volta pra quem cobrou no painel de Menções.
    const showMentionNudge = async (n: MentionNudge) => {
      const urgente = n.level !== 'importante';
      const preview = await mentionNudgePreview(n.message_id);
      showNotificationToast({
        id: `mention-nudge-${n.id}`,
        icon: <AlarmClock className={`h-4 w-4 shrink-0 ${urgente ? 'text-destructive' : 'text-amber-500'}`} />,
        title: urgente
          ? `🚨 ${n.actor_name || 'Alguém'} precisa da sua resposta AGORA`
          : `❗ ${n.actor_name || 'Alguém'} pediu sua resposta`,
        context: n.entity_name ? `em ${n.entity_name}` : (n.entity_type ? `em ${getEntityLabel(n.entity_type)}` : undefined),
        preview,
        urgent: urgente,
        onOpen: () => {
          if (!n.entity_type || !n.entity_id) return;
          void openEntityChat({
            entityType: n.entity_type,
            entityId: n.entity_id,
            messageId: n.message_id,
          });
        },
        onReply: n.entity_type && n.entity_id
          ? (reply) => replyToEntityChat({
              entityType: n.entity_type as string,
              entityId: n.entity_id as string,
              entityName: n.entity_name,
              content: reply,
            })
          : undefined,
      });
      // Popup exibido = cobrança vista. É esse carimbo que vira o "✓ visto"
      // no painel de quem cobrou (mesma regra da cobrança de atividade).
      void markMentionNudgeSeen(n.id);
    };

    const mentionNudgesChannel = externalSupabase
      .channel('notification-mention-nudges-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'mention_nudges',
        filter: `recipient_id=eq.${user.id}`,
      }, async (payload) => {
        // Urgência não é silenciável: quem cobrou está esperando resposta.
        const n = payload.new as MentionNudge;
        if (n.actor_id === user.id) return; // nunca cobrar a si mesmo
        await showMentionNudge(n);
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Mention nudges channel status:', status);
      });

    // Quem estava com o app fechado quando a cobrança chegou vê ao voltar.
    void (async () => {
      const desde = new Date(Date.now() - MENTION_NUDGE_CATCH_UP_DIAS * 86400_000).toISOString();
      const { data: pend } = await (externalSupabase as any)
        .from('mention_nudges')
        .select('id, message_id, actor_id, actor_name, level, entity_type, entity_id, entity_name')
        .eq('recipient_id', user.id)
        .is('read_at', null)
        .gte('created_at', desde)
        .order('created_at', { ascending: true })
        .limit(5);
      for (const n of ((pend || []) as MentionNudge[])) {
        if (n.actor_id === user.id) continue;
        await showMentionNudge(n);
      }
    })();

    // Avisa quem enviou quando o destinatário fecha o popup sem responder
    const popupReceiptsChannel = externalSupabase
      .channel('notification-popup-receipts-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_popup_receipts',
        filter: `notify_user_id=eq.${user.id}`,
      }, async (payload) => {
        if (isMuted()) return;
        const receipt = payload.new as any;
        if (receipt.dismissed_by === user.id) return;

        const dismisserName = receipt.dismissed_by_name || 'Alguém';

        let preview = 'Sua mensagem foi vista, mas ficou sem resposta.';
        if (receipt.message_id) {
          const { data: originalMsg } = await externalSupabase
            .from('team_messages')
            .select('content, message_type, file_name')
            .eq('id', receipt.message_id)
            .maybeSingle();
          if (originalMsg) {
            preview = `"${buildPreview(originalMsg as any).substring(0, 100)}" ficou sem resposta.`;
          }
        }

        showNotificationToast({
          id: `team-receipt-${receipt.conversation_id}`,
          icon: <EyeOff className="h-4 w-4 text-amber-500 shrink-0" />,
          title: `${dismisserName} viu e fechou sem responder`,
          context: 'Você pode reenviar a mensagem como urgente',
          preview,
          onOpen: () => {
            openTeamChatConversation({
              conversationId: receipt.conversation_id,
              focusComposer: true,
            });
          },
        });
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Popup receipts channel status:', status);
      });

    const teamMembershipsChannel = externalSupabase
      .channel('notification-team-memberships-' + user.id)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_conversation_members',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        console.log('[TeamChatNotifications] Team memberships changed');
        void loadTeamConversationContext();
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Team memberships channel status:', status);
      });

    // Ao abrir uma conversa no painel, dispensa o popup dela
    const unsubscribeActiveConversation = subscribeActiveTeamChatConversation((conversationId) => {
      if (conversationId) dismissConversationToast(conversationId);
    });

    return () => {
      externalSupabase.removeChannel(mentionsChannel);
      externalSupabase.removeChannel(followedThreadsChannel);
      externalSupabase.removeChannel(mentionNudgesChannel);
      externalSupabase.removeChannel(teamMessagesChannel);
      externalSupabase.removeChannel(popupReceiptsChannel);
      externalSupabase.removeChannel(teamMembershipsChannel);
      unsubscribeActiveConversation();
    };
  }, [user]);

  return null;
}

function getEntityLabel(type: string): string {
  switch (type) {
    case 'lead': return 'Lead';
    case 'activity': return 'Atividade';
    case 'whatsapp': return 'WhatsApp';
    case 'direct': return 'Mensagem direta';
    case 'general': return 'Chat Geral';
    default: return type || '';
  }
}

function getConversationLabel(type?: string | null, name?: string | null): string {
  if (type === 'group') return name || 'Chat da Equipe';
  return 'Mensagem direta';
}
