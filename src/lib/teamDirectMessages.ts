/**
 * Envio para conversas do Chat da Equipe (team_messages) fora do painel.
 *
 * O chat interno é a mesma função em todo o sistema: o chat da ficha e o da
 * conversa do WhatsApp também precisam abrir uma conversa direta ("responder no
 * privado") e mandar mensagem pra outra conversa ("encaminhar"). Sem isto cada
 * painel teria que montar o hook inteiro do Chat da Equipe só pra isso.
 */
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { TEAM_CHAT_PARAM } from '@/components/chat/TeamChatDeepLink';
import { toast } from 'sonner';

export interface SendTeamDirectMessageOptions {
  message_type?: string;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  audio_duration?: number | null;
  transcription?: string | null;
  mentionedUserIds?: string[];
  reply_to_id?: string | null;
  is_urgent?: boolean;
  /** Nome do remetente já resolvido — evita uma ida ao profiles por envio. */
  senderName?: string | null;
}

/** Nome de exibição do usuário atual (cai no e-mail se o perfil não tiver nome). */
export async function resolveSenderName(userId: string, fallback?: string | null): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.full_name || fallback || 'Anônimo';
}

/** Abre (ou reaproveita) a conversa direta com outra pessoa. */
export async function startDirectConversationWith(
  otherUserId: string,
  selfUserId: string
): Promise<string | null> {
  try {
    await ensureExternalSession();
    const { data: conversationId, error } = await (externalSupabase.rpc as any)('start_team_direct_conversation', {
      _other_user_id: otherUserId,
      _self_user_id: selfUserId,
    });
    if (error || !conversationId) {
      console.error('[teamDirectMessages] erro ao abrir conversa direta:', error);
      toast.error('Não foi possível abrir a conversa.');
      return null;
    }
    return conversationId as string;
  } catch (e) {
    console.error('[teamDirectMessages] erro ao abrir conversa direta:', e);
    toast.error('Não foi possível abrir a conversa.');
    return null;
  }
}

/**
 * Insere a mensagem, grava as menções, sobe a conversa na lista e dispara o Web
 * Push. Devolve a linha inserida (pro painel fazer atualização otimista) ou
 * null quando falha — o toast de erro já sai daqui.
 */
export async function sendTeamDirectMessage(
  conversationId: string,
  senderId: string,
  senderEmail: string | null | undefined,
  content: string,
  options?: SendTeamDirectMessageOptions
): Promise<{ id: string } | null> {
  if (!conversationId || !senderId) return null;
  if (!content.trim() && !options?.file_url) return null;

  try {
    await ensureExternalSession();

    const senderName = options?.senderName || (await resolveSenderName(senderId, senderEmail));

    const { data: inserted, error } = await (externalSupabase.from('team_messages') as any).insert({
      conversation_id: conversationId,
      sender_id: senderId,
      sender_name: senderName,
      content: content.trim() || null,
      message_type: options?.message_type || 'text',
      file_url: options?.file_url || null,
      file_name: options?.file_name || null,
      file_size: options?.file_size || null,
      file_type: options?.file_type || null,
      audio_duration: options?.audio_duration || null,
      transcription: options?.transcription || null,
      reply_to_id: options?.reply_to_id || null,
      // Só envia a coluna quando true, pra não quebrar caso a migration ainda não tenha sido aplicada
      ...(options?.is_urgent ? { is_urgent: true } : {}),
    }).select().single();

    if (error) {
      console.error('[teamDirectMessages] erro ao enviar mensagem:', error);
      toast.error('Não foi possível enviar a mensagem.');
      return null;
    }

    const mentionedIds = (options?.mentionedUserIds || []).filter(uid => uid && uid !== senderId);
    if (inserted && mentionedIds.length > 0) {
      await (externalSupabase.from('team_chat_mentions') as any).insert(
        mentionedIds.map(uid => ({
          message_id: inserted.id,
          mentioned_user_id: uid,
          conversation_id: conversationId,
        }))
      );
    }

    await externalSupabase
      .from('team_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    // Web Push nativo para os membros da conversa (celular/notebook, mesmo com
    // a aba fechada). Não bloqueia o envio.
    if (inserted) {
      cloudFunctions.invoke('send-team-push', {
        body: {
          conversation_id: conversationId,
          sender_id: senderId,
          sender_name: senderName,
          content: content.trim() || '📎 Anexo',
          is_urgent: !!options?.is_urgent,
          mentioned_user_ids: mentionedIds,
          // Deep-link: o toque na notificação abre a conversa, não a home.
          url: `/?${TEAM_CHAT_PARAM}=${encodeURIComponent(conversationId)}`,
        },
      }).catch(err => console.error('Falha ao enviar Web Push (chat direto):', err));
    }

    return inserted;
  } catch (e) {
    console.error('[teamDirectMessages] erro ao enviar mensagem:', e);
    toast.error('Não foi possível enviar a mensagem.');
    return null;
  }
}
