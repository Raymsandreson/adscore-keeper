import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

export interface TeamMessage {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  content: string;
  sender_id: string;
  sender_name: string | null;
  reply_to_id: string | null;
  created_at: string;
  deleted_at: string | null;
  // Paridade com o chat direto: áudio (com transcrição), anexos e urgente.
  message_type?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  audio_duration?: number | null;
  transcription?: string | null;
  is_urgent?: boolean | null;
  urgent_alert_at?: string | null;
}

/** Campos extras (mídia/urgente) opcionais ao enviar uma mensagem de equipe. */
export interface TeamMessageExtra {
  message_type?: string;
  file_url?: string;
  file_name?: string;
  file_size?: number;
  file_type?: string;
  audio_duration?: number;
  transcription?: string;
  is_urgent?: boolean;
  /** Responder uma mensagem do próprio thread (mesma semântica do chat direto). */
  reply_to_id?: string | null;
}

/**
 * Participação no chat da ficha: quem foi marcado (ou já falou) continua
 * recebendo o que vier depois, até apertar "Finalizar participação". Sem isso,
 * só a mensagem com o @ virava popup e a resposta passava batido.
 */
export async function followThread(
  people: { user_id: string; reason: 'mention' | 'message' }[],
  entityType: string,
  entityId: string,
  entityName?: string | null,
) {
  if (people.length === 0) return;
  try {
    await ensureExternalSession();
    await (externalSupabase as any)
      .from('team_chat_thread_followers')
      .upsert(
        people.map(p => ({
          user_id: p.user_id,
          entity_type: entityType,
          entity_id: entityId,
          entity_name: entityName || null,
          reason: p.reason,
          // Re-marcar quem tinha saído traz a pessoa de volta pro acompanhamento.
          left_at: null,
        })),
        { onConflict: 'user_id,entity_type,entity_id' }
      );
  } catch (e) {
    console.warn('[followThread] não consegui registrar a participação:', e);
  }
}

/** Chats de ficha que a pessoa acompanha hoje — `${entity_type}:${entity_id}`. */
export async function loadFollowedThreads(userId: string): Promise<Set<string>> {
  try {
    await ensureExternalSession();
    const { data } = await (externalSupabase as any)
      .from('team_chat_thread_followers')
      .select('entity_type, entity_id')
      .eq('user_id', userId)
      .is('left_at', null);
    return new Set((data || []).map((f: { entity_type: string; entity_id: string }) => `${f.entity_type}:${f.entity_id}`));
  } catch {
    return new Set();
  }
}

/** "Finalizar participação": para de receber as mensagens desse chat. */
export async function leaveThread(userId: string, entityType: string, entityId: string) {
  await ensureExternalSession();
  const { error } = await (externalSupabase as any)
    .from('team_chat_thread_followers')
    .upsert(
      {
        user_id: userId,
        entity_type: entityType,
        entity_id: entityId,
        left_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,entity_type,entity_id' }
    );
  if (error) throw error;
}

/** Deep-link da ficha por trás do chat — usado no push e nas notificações. */
export function entityChatUrl(entityType: string, entityId: string): string {
  return entityType === 'activity' ? `/?openActivity=${entityId}`
    : entityType === 'lead' ? `/leads?openLead=${entityId}`
    : entityType === 'contact' ? `/leads?openContact=${entityId}`
    : entityType === 'whatsapp' ? `/whatsapp?openChat=${encodeURIComponent(entityId)}`
    : entityType === 'case' ? `/cases/${entityId}`
    : '/';
}

export interface TeamMention {
  id: string;
  message_id: string;
  mentioned_user_id: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  // Menções feitas no chat direto/grupo não têm entity_*; apontam pra conversa
  conversation_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  message?: TeamMessage;
}

export interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

/**
 * Estado de cobrança de uma menção — mesmo vocabulário do Chat da Equipe:
 * "responder" é a bola com você, "aguardando" é a bola com o outro.
 */
export type MentionStatus = 'responder' | 'aguardando' | 'respondido';

/** Nível da cobrança de menção — mesmo par do funil de Feedbacks. */
export type MentionNudgeLevel = 'importante' | 'urgente';

/**
 * Última cobrança de uma menção: quando foi pedida urgência e se o popup já
 * apareceu pra quem tem que responder (o "✓ visto").
 */
export interface MentionNudge {
  level: MentionNudgeLevel;
  created_at: string;
  read_at: string | null;
  actor_name: string | null;
  recipient_name: string | null;
}

export interface TeamMentionItem extends TeamMention {
  message: TeamMessage;
  /** 'in' = marcaram você. 'out' = você marcou alguém no chat de uma ficha. */
  direction: 'in' | 'out';
  status: MentionStatus | null;
  /** Primeira mensagem do thread depois da menção — a resposta que fechou a cobrança. */
  reply?: { sender_name: string | null; content: string; created_at: string } | null;
  /** Quem foi marcado nessa mensagem — alvo da cobrança de urgência. */
  targets?: { user_id: string; name: string | null }[];
  /** Última cobrança dessa menção, se já houve. */
  nudge?: MentionNudge | null;
  /** Onde foi dito: conversa privada, grupo, ou o chat de uma ficha. */
  scope?: MentionScope;
  /** Marcaram você pelo nome, ou foi um "@todos" que pegou a equipe inteira. */
  mentionKind?: 'nome' | 'todos';
}

/** Onde a menção aconteceu — dimensão de filtro do painel. */
export type MentionScope = 'privado' | 'grupo' | 'ficha';

/**
 * "@todos" (ou @todas/@equipe/@all) é expandido em uma linha por pessoa na hora
 * do envio, então o que sobra pra distinguir "me chamaram" de "chamaram geral"
 * é o texto da própria mensagem.
 */
const MENTION_ALL = /@(todos|todas|equipe|all)\b/i;

/**
 * "@" seguido de letra e não colado num e-mail (fulano@dominio). O chat de ficha
 * não guarda o id de quem foi marcado nas próprias mensagens, e o RLS de
 * team_chat_mentions só devolve as menções recebidas — então o que você marcou
 * sai daqui, do texto da sua própria mensagem.
 */
const MENTION_IN_TEXT = /(^|[^\w@])@[\p{L}]/u;

/** A lista de membros muda muito pouco — não vale uma query por painel aberto. */
let membersCache: TeamMember[] | null = null;
let membersPromise: Promise<TeamMember[]> | null = null;

/** Mesma lista/cache do useTeamMembers, para quem precisa fora de um componente. */
export function loadTeamMembers(): Promise<TeamMember[]> {
  if (membersCache) return Promise.resolve(membersCache);
  if (!membersPromise) {
    // profiles continua no Cloud
    membersPromise = Promise.resolve(supabase
      .from('profiles')
      .select('user_id, full_name, email'))
      .then(({ data }) => {
        membersCache = data || [];
        return membersCache;
      });
  }
  return membersPromise;
}

export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>(() => membersCache || []);

  useEffect(() => {
    if (membersCache) return;
    let alive = true;
    loadTeamMembers().then(list => { if (alive) setMembers(list); });
    return () => { alive = false; };
  }, []);

  return members;
}

/**
 * Cache das últimas conversas abertas. Reabrir a mesma atividade/lead mostra o
 * histórico na hora e revalida por baixo, em vez de encarar o spinner de novo.
 */
const messagesCache = new Map<string, TeamMessage[]>();
const CACHE_MAX_ENTITIES = 40;

function cacheGet(key: string) {
  return messagesCache.get(key);
}

function cacheSet(key: string, msgs: TeamMessage[]) {
  if (messagesCache.size >= CACHE_MAX_ENTITIES && !messagesCache.has(key)) {
    const oldest = messagesCache.keys().next().value;
    if (oldest) messagesCache.delete(oldest);
  }
  messagesCache.set(key, msgs);
}

export function useTeamChat(entityType: string, entityId: string, entityName?: string) {
  const { user } = useAuthContext();
  const cacheKey = `${entityType}:${entityId}`;
  const [messages, setMessagesState] = useState<TeamMessage[]>(() => cacheGet(cacheKey) || []);
  const [loading, setLoading] = useState(() => !cacheGet(cacheKey));

  // Toda escrita de mensagens passa aqui para o cache não ficar defasado.
  const setMessages = useCallback((updater: React.SetStateAction<TeamMessage[]>) => {
    setMessagesState(prev => {
      const next = typeof updater === 'function' ? (updater as (p: TeamMessage[]) => TeamMessage[])(prev) : updater;
      cacheSet(cacheKey, next);
      return next;
    });
  }, [cacheKey]);

  // Troca de entidade: mostra o que já está em cache imediatamente.
  useEffect(() => {
    const cached = cacheGet(cacheKey);
    setMessagesState(cached || []);
    setLoading(!cached);
  }, [cacheKey]);

  const loadMessages = useCallback(async () => {
    const started = performance.now();
    // Sem cache é carregamento de verdade; com cache, revalida em silêncio.
    if (!cacheGet(cacheKey)) setLoading(true);
    await ensureExternalSession();
    const { data } = await externalSupabase
      .from('team_chat_messages')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .is('deleted_at', null)
      // Últimas 200, não as 200 primeiras: asc + limit congela a conversa
      // ao passar do teto (mesmo defeito do chat geral, 12/08/2026).
      .order('created_at', { ascending: false })
      .limit(200);
    if (data) {
      const janela = (data as TeamMessage[]).slice().reverse();
      cacheSet(cacheKey, janela);
      setMessagesState(janela);
    }
    setLoading(false);
    console.debug(`[team-chat] ${cacheKey} carregou em ${Math.round(performance.now() - started)}ms`);
  }, [entityType, entityId, cacheKey]);

  useEffect(() => {
    loadMessages();

    const channel = externalSupabase
      .channel(`team-chat-${entityType}-${entityId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_messages',
        filter: `entity_type=eq.${entityType}`,
      }, (payload) => {
        const newMsg = payload.new as TeamMessage;
        if (newMsg.entity_id === entityId) {
          setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
        }
      })
      .subscribe();

    return () => { externalSupabase.removeChannel(channel); };
  }, [entityType, entityId, loadMessages]);

  const sendMessage = useCallback(async (content: string, mentionedUserIds: string[], extra?: TeamMessageExtra) => {
    if (!user) return;

    await ensureExternalSession();

    const profileRes = await supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', user.id)
      .single();

    const senderName = profileRes.data?.full_name || user.email || 'Usuário';

    const { data: msg, error } = await externalSupabase
      .from('team_chat_messages')
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        entity_name: entityName || null,
        content,
        sender_id: user.id,
        sender_name: senderName,
        ...(extra?.message_type ? { message_type: extra.message_type } : {}),
        ...(extra?.file_url ? { file_url: extra.file_url } : {}),
        ...(extra?.file_name ? { file_name: extra.file_name } : {}),
        ...(extra?.file_size ? { file_size: extra.file_size } : {}),
        ...(extra?.file_type ? { file_type: extra.file_type } : {}),
        ...(extra?.audio_duration ? { audio_duration: extra.audio_duration } : {}),
        ...(extra?.transcription ? { transcription: extra.transcription } : {}),
        ...(extra?.is_urgent ? { is_urgent: true } : {}),
        ...(extra?.reply_to_id ? { reply_to_id: extra.reply_to_id } : {}),
      })
      .select()
      .single();

    if (error) {
      toast.error('Erro ao enviar mensagem');
      return;
    }

    // Optimistic update — não esperar o Realtime
    if (msg) {
      setMessages(prev => prev.some(m => m.id === (msg as TeamMessage).id) ? prev : [...prev, msg as TeamMessage]);
    }

    // Create mentions
    if (msg && mentionedUserIds.length > 0) {
      const mentions = mentionedUserIds.map(uid => ({
        message_id: msg.id,
        mentioned_user_id: uid,
        entity_type: entityType,
        entity_id: entityId,
        entity_name: entityName || null,
      }));

      await externalSupabase.from('team_chat_mentions').insert(mentions);

      // Marcado = passa a acompanhar este chat até "Finalizar participação".
      // Re-marcar alguém que tinha saído traz a pessoa de volta (left_at null).
      void followThread(
        mentionedUserIds.map(uid => ({ user_id: uid, reason: 'mention' as const })),
        entityType, entityId, entityName
      );

      // Send WhatsApp notification to mentioned users (using sender's instance)
      cloudFunctions.invoke('notify-team-mention', {
        body: {
          mentioned_user_ids: mentionedUserIds,
          message_content: content,
          sender_id: user.id,
          sender_name: senderName,
          entity_type: entityType,
          entity_id: entityId,
          entity_name: entityName || null,
        },
      }).catch(err => console.error('Failed to notify mentions via WhatsApp:', err));
    }

    // Quem fala no chat está participando dele: passa a receber o que vier
    // depois, pela mesma porta de quem foi marcado.
    if (msg) {
      void followThread([{ user_id: user.id, reason: 'message' }], entityType, entityId, entityName);
    }

    // Web Push nativo para os participantes do thread (celular/notebook, mesmo com
    // a aba fechada). Não bloqueia o envio.
    if (msg) {
      const url = entityChatUrl(entityType, entityId);
      cloudFunctions.invoke('send-team-push', {
        body: {
          entity_type: entityType,
          entity_id: entityId,
          sender_id: user.id,
          sender_name: senderName,
          content,
          is_urgent: !!extra?.is_urgent,
          mentioned_user_ids: mentionedUserIds,
          url,
        },
      }).catch(err => console.error('Falha ao enviar Web Push da equipe:', err));
    }

    return (msg as TeamMessage) || null;
  }, [user, entityType, entityId, entityName]);

  // Atualiza uma mensagem (ex.: preencher a transcrição do áudio depois de pronta).
  const updateMessage = useCallback(async (id: string, patch: Partial<TeamMessage>) => {
    await ensureExternalSession();
    await externalSupabase.from('team_chat_messages').update(patch).eq('id', id);
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
  }, [setMessages]);

  /**
   * Reenvia uma mensagem já enviada como urgente — mesma ação do chat direto.
   * Quem está com o sistema fechado é alcançado pelo Web Push (o popup vermelho
   * só existe dentro do app aberto).
   */
  const alertMessageAgain = useCallback(async (messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    try {
      await ensureExternalSession();
      const alertAt = new Date().toISOString();

      let { error } = await externalSupabase
        .from('team_chat_messages')
        .update({ is_urgent: true, urgent_alert_at: alertAt } as never)
        .eq('id', messageId);

      // Base sem a migration do urgent_alert_at: o alerta ainda vale, só não
      // guarda o carimbo do reenvio.
      if (error) {
        const retry = await externalSupabase
          .from('team_chat_messages')
          .update({ is_urgent: true } as never)
          .eq('id', messageId);
        error = retry.error;
      }
      if (error) throw error;

      setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, is_urgent: true } : m)));

      cloudFunctions.invoke('send-team-push', {
        body: {
          entity_type: entityType,
          entity_id: entityId,
          sender_id: user?.id,
          sender_name: msg?.sender_name || user?.email || 'Equipe',
          content: msg?.content || 'Mensagem urgente',
          is_urgent: true,
          url: entityChatUrl(entityType, entityId),
        },
      }).catch(err => console.error('Falha ao enviar Web Push (urgente):', err));

      toast.success('Alerta urgente reenviado');
    } catch (e) {
      console.error('[useTeamChat] erro ao reenviar alerta urgente:', e);
      toast.error('Não foi possível reenviar o alerta');
    }
  }, [messages, setMessages, entityType, entityId, user?.id, user?.email]);

  return { messages, loading, sendMessage, updateMessage, alertMessageAgain };
}

export function useUnreadMentionsCount() {
  const { user } = useAuthContext();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      await ensureExternalSession();

      const [{ count: mentionsCount }, { data: memberships, error: membershipsError }] = await Promise.all([
        externalSupabase
          .from('team_chat_mentions')
          .select('*', { count: 'exact', head: true })
          .eq('mentioned_user_id', user.id)
          .eq('is_read', false),
        externalSupabase
          .from('team_conversation_members')
          .select('conversation_id, last_read_at')
          .eq('user_id', user.id),
      ]);

      let unreadTeamMessages = 0;

      if (membershipsError) {
        console.error('Erro ao carregar conversas para contagem de não lidas:', membershipsError);
      } else if (memberships?.length) {
        const unreadResults = await Promise.all(
          memberships.map((membership) =>
            externalSupabase
              .from('team_messages')
              .select('id', { count: 'exact', head: true })
              .eq('conversation_id', membership.conversation_id)
              .neq('sender_id', user.id)
              .gt('created_at', membership.last_read_at || '1970-01-01T00:00:00.000Z')
          )
        );

        unreadTeamMessages = unreadResults.reduce((sum, result) => sum + (result.count || 0), 0);
      }

      setCount((mentionsCount || 0) + unreadTeamMessages);
    };

    load();

    const mentionsChannel = externalSupabase
      .channel(`mentions-count-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_chat_mentions',
        filter: `mentioned_user_id=eq.${user.id}`,
      }, () => { load(); })
      .subscribe();

    const teamMessagesChannel = externalSupabase
      .channel(`team-messages-count-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_messages',
      }, () => { load(); })
      .subscribe();

    const membershipsChannel = externalSupabase
      .channel(`team-memberships-count-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_conversation_members',
        filter: `user_id=eq.${user.id}`,
      }, () => { load(); })
      .subscribe();

    return () => {
      externalSupabase.removeChannel(mentionsChannel);
      externalSupabase.removeChannel(teamMessagesChannel);
      externalSupabase.removeChannel(membershipsChannel);
    };
  }, [user]);

  return count;
}

export function useMyMentions() {
  const { user } = useAuthContext();
  const [mentions, setMentions] = useState<TeamMentionItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** Chats de ficha que eu acompanho — `${entity_type}:${entity_id}`. */
  const [followedThreads, setFollowedThreads] = useState<Set<string>>(new Set());
  /**
   * Conversas que este painel está cobrando. O painel fica montado em toda tela,
   * então recarregar a cada mensagem da casa sairia caro — só interessa mensagem
   * nova numa conversa que já está na lista.
   */
  const trackedThreads = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    await ensureExternalSession();

    const [{ data: mentionData }, { data: sentData }] = await Promise.all([
      externalSupabase
        .from('team_chat_mentions')
        .select('*')
        .eq('mentioned_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
      // As menções que VOCÊ fez no chat de uma ficha. Não dá pra ler de
      // team_chat_mentions (RLS devolve só as recebidas), então vêm das suas
      // próprias mensagens — que a equipe inteira pode ler.
      externalSupabase
        .from('team_chat_messages')
        .select('*')
        .eq('sender_id', user.id)
        .is('deleted_at', null)
        .ilike('content', '%@%')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const incoming = mentionData || [];
    const sent = (sentData || []).filter(m => MENTION_IN_TEXT.test(m.content || ''));

    if (incoming.length === 0 && sent.length === 0) {
      setMentions([]);
      setLoading(false);
      return;
    }

    const msgMap = new Map<string, TeamMessage>();

    if (incoming.length > 0) {
      const msgIds = incoming.map(m => m.message_id);
      const { data: msgData } = await externalSupabase
        .from('team_chat_messages')
        .select('*')
        .in('id', msgIds);
      (msgData || []).forEach(m => msgMap.set(m.id, m as TeamMessage));

      // Menções feitas no chat direto/grupo apontam pra team_messages, não pra
      // team_chat_messages — sem resolver aqui elas somem do painel mas seguem
      // contando no badge, sem como marcar lidas.
      const missingIds = msgIds.filter(id => !msgMap.has(id));
      if (missingIds.length > 0) {
        const { data: directData } = await externalSupabase
          .from('team_messages')
          .select('id, sender_id, sender_name, content, created_at')
          .in('id', missingIds);
        (directData || []).forEach(m => {
          msgMap.set(m.id, {
            id: m.id,
            entity_type: 'team_chat',
            entity_id: '',
            entity_name: null,
            content: m.content || '',
            sender_id: m.sender_id,
            sender_name: m.sender_name,
            reply_to_id: null,
            created_at: m.created_at,
            deleted_at: null,
          } as TeamMessage);
        });
      }
    }

    const items: TeamMentionItem[] = [];

    incoming.forEach(m => {
      const message = msgMap.get(m.message_id);
      if (!message) return;
      items.push({ ...(m as TeamMention), message, direction: 'in', status: null, reply: null });
    });

    // A menção enviada não tem linha em team_chat_mentions do seu lado: o
    // registro é a própria mensagem. Id com prefixo pra nunca confundir com um
    // id de menção real (marcar como lida não se aplica).
    sent.forEach(m => {
      const message = m as TeamMessage;
      items.push({
        id: `sent:${message.id}`,
        message_id: message.id,
        mentioned_user_id: user.id,
        entity_type: message.entity_type,
        entity_id: message.entity_id,
        entity_name: message.entity_name,
        conversation_id: null,
        is_read: true,
        read_at: null,
        created_at: message.created_at,
        message,
        direction: 'out',
        status: null,
        reply: null,
      });
    });

    items.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // Quem já respondeu? Uma varredura só nas conversas envolvidas, do momento
    // da menção mais antiga pra frente.
    const entityIds = Array.from(
      new Set(items.map(i => i.message.entity_id).filter((id): id is string => !!id))
    );
    const byThread = new Map<string, { sender_id: string; sender_name: string | null; content: string; created_at: string }[]>();

    if (entityIds.length > 0) {
      const since = items.reduce((min, i) => (i.created_at < min ? i.created_at : min), items[0].created_at);
      const { data: threadData } = await externalSupabase
        .from('team_chat_messages')
        .select('entity_type, entity_id, sender_id, sender_name, content, created_at')
        .in('entity_id', entityIds)
        .gte('created_at', since)
        .is('deleted_at', null)
        // Descendente de propósito: se bater o teto, o que se perde é o passado
        // distante, não a resposta recém-chegada.
        .order('created_at', { ascending: false })
        .limit(1000);
      (threadData || []).forEach(m => {
        const key = `${m.entity_type}:${m.entity_id}`;
        const list = byThread.get(key);
        if (list) list.unshift(m);
        else byThread.set(key, [m]);
      });
    }

    const resolved = items.map(item => {
      const { entity_type, entity_id, created_at } = item.message;
      if (!entity_id) return item; // menção do chat direto — o próprio Chat cobra isso
      const thread = byThread.get(`${entity_type}:${entity_id}`) || [];
      const answer = thread.find(m =>
        m.created_at > created_at &&
        (item.direction === 'out' ? m.sender_id !== user.id : m.sender_id === user.id)
      );
      if (answer) {
        return {
          ...item,
          status: 'respondido' as MentionStatus,
          reply: { sender_name: answer.sender_name, content: answer.content, created_at: answer.created_at },
        };
      }
      return { ...item, status: (item.direction === 'out' ? 'aguardando' : 'responder') as MentionStatus };
    });

    // Cobrança de urgência: quem foi marcado em cada mensagem (o alvo) e a
    // última cobrança já dada (com o "visto"). Duas queries por lista inteira —
    // nada de uma por menção.
    const messageIds = Array.from(new Set(resolved.map(i => i.message_id)));
    const targetsByMessage = new Map<string, { user_id: string; name: string | null }[]>();
    const nudgeByMessage = new Map<string, MentionNudge>();

    if (messageIds.length > 0) {
      const [{ data: targetRows }, { data: nudgeRows }, members] = await Promise.all([
        // A policy do Externo deixa a equipe ler as menções da casa — é assim que
        // quem cobra descobre quem marcou (a mensagem não guarda o id do marcado).
        externalSupabase
          .from('team_chat_mentions')
          .select('message_id, mentioned_user_id')
          .in('message_id', messageIds),
        (externalSupabase as any)
          .from('mention_nudges')
          .select('message_id, level, created_at, read_at, actor_name, recipient_name')
          .in('message_id', messageIds)
          .order('created_at', { ascending: false }),
        loadTeamMembers(),
      ]);

      const nameById = new Map(members.map(m => [m.user_id, m.full_name]));
      (targetRows || []).forEach(t => {
        const list = targetsByMessage.get(t.message_id) || [];
        if (!list.some(x => x.user_id === t.mentioned_user_id)) {
          list.push({ user_id: t.mentioned_user_id, name: nameById.get(t.mentioned_user_id) ?? null });
        }
        targetsByMessage.set(t.message_id, list);
      });
      // Ordenado desc → a 1ª de cada mensagem é a cobrança mais recente.
      (nudgeRows || []).forEach((n: any) => {
        if (!nudgeByMessage.has(n.message_id)) {
          nudgeByMessage.set(n.message_id, {
            level: n.level === 'importante' ? 'importante' : 'urgente',
            created_at: n.created_at,
            read_at: n.read_at,
            actor_name: n.actor_name ?? null,
            recipient_name: n.recipient_name ?? null,
          });
        }
      });
    }

    // Privado x grupo: a menção do chat direto só aponta pra conversa; o tipo
    // mora em team_conversations. Uma query pras conversas citadas, não uma por
    // menção.
    const conversationIds = Array.from(
      new Set(resolved.map(i => i.conversation_id).filter((id): id is string => !!id))
    );
    const conversationTypes = new Map<string, string>();
    if (conversationIds.length > 0) {
      const { data: convs } = await externalSupabase
        .from('team_conversations')
        .select('id, type')
        .in('id', conversationIds);
      (convs || []).forEach(c => conversationTypes.set(c.id, (c as { type?: string }).type || 'direct'));
    }

    const withNudges = resolved.map(item => ({
      ...item,
      targets: targetsByMessage.get(item.message_id) || [],
      nudge: nudgeByMessage.get(item.message_id) || null,
      scope: (item.message.entity_id
        ? 'ficha'
        : conversationTypes.get(item.conversation_id || '') === 'group'
          ? 'grupo'
          : 'privado') as MentionScope,
      mentionKind: (MENTION_ALL.test(item.message.content || '') ? 'todos' : 'nome') as 'nome' | 'todos',
    }));

    trackedThreads.current = new Set(
      withNudges.map(i => `${i.message.entity_type}:${i.message.entity_id}`).filter(k => !k.endsWith(':'))
    );
    setMentions(withNudges);
    setLoading(false);
    setFollowedThreads(await loadFollowedThreads(user.id));
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Realtime: listen for new mentions or updates
  useEffect(() => {
    if (!user) return;
    const channel = externalSupabase
      .channel(`mentions-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'team_chat_mentions',
          filter: `mentioned_user_id=eq.${user.id}`,
        },
        () => {
          load();
        }
      )
      .subscribe();

    // "✓ visto" da cobrança ao vivo: o popup na tela do outro carimba read_at,
    // e quem cobrou vê isso sem reabrir o painel.
    const nudgesChannel = externalSupabase
      .channel(`mention-nudges-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mention_nudges' },
        (payload) => {
          const n = payload.new as { message_id?: string; read_at?: string | null };
          if (!n?.message_id || !n.read_at) return;
          setMentions(prev => prev.map(m => (
            m.message_id === n.message_id && m.nudge && !m.nudge.read_at
              ? { ...m, nudge: { ...m.nudge, read_at: n.read_at as string } }
              : m
          )));
        }
      )
      .subscribe();

    // A resposta que fecha uma cobrança é uma mensagem, não uma menção — sem
    // ouvir aqui, o "Aguardando" só viraria "Respondido" ao reabrir o painel.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const messagesChannel = externalSupabase
      .channel(`mentions-messages-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'team_chat_messages' },
        (payload) => {
          const msg = payload.new as TeamMessage;
          const isTracked = trackedThreads.current.has(`${msg.entity_type}:${msg.entity_id}`);
          // Menção nova sua entra na lista; de terceiro, só se for na conversa cobrada.
          const isMyNewMention = msg.sender_id === user.id && (msg.content || '').includes('@');
          if (!isTracked && !isMyNewMention) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { load(); }, 600);
        }
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      externalSupabase.removeChannel(channel);
      externalSupabase.removeChannel(messagesChannel);
      externalSupabase.removeChannel(nudgesChannel);
    };
  }, [user, load]);

  const markAsRead = useCallback(async (mentionId: string) => {
    // Menção enviada por você não tem linha própria — nada a marcar.
    if (mentionId.startsWith('sent:')) return;
    await externalSupabase
      .from('team_chat_mentions')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', mentionId);
    setMentions(prev => prev.map(m => m.id === mentionId ? { ...m, is_read: true } : m));
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    await externalSupabase
      .from('team_chat_mentions')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('mentioned_user_id', user.id)
      .eq('is_read', false);
    setMentions(prev => prev.map(m => ({ ...m, is_read: true })));
  }, [user]);

  /**
   * Cobra resposta de quem você marcou: grava em mention_nudges (vira popup na
   * tela dele via TeamChatNotifications) e dispara Web Push pra alcançar quem
   * está com o sistema fechado. O registro fica — inclusive o "visto".
   */
  const nudgeMention = useCallback(async (mention: TeamMentionItem, level: MentionNudgeLevel) => {
    if (!user) return;
    const targets = (mention.targets || []).filter(t => t.user_id !== user.id);
    if (targets.length === 0) {
      toast.error('Não achei quem foi marcado nessa mensagem para cobrar.');
      return;
    }

    const { entity_type, entity_id, entity_name } = mention.message;
    const myName = mention.message.sender_name || user.email || 'Alguém';
    const createdAt = new Date().toISOString();

    try {
      await ensureExternalSession();
      const { error } = await (externalSupabase as any).from('mention_nudges').insert(
        targets.map(t => ({
          message_id: mention.message_id,
          recipient_id: t.user_id,
          recipient_name: t.name,
          actor_id: user.id,
          actor_name: myName,
          level,
          entity_type,
          entity_id,
          entity_name: entity_name || null,
        }))
      );
      if (error) throw error;

      setMentions(prev => prev.map(m => m.message_id === mention.message_id
        ? {
            ...m,
            nudge: {
              level,
              created_at: createdAt,
              read_at: null,
              actor_name: myName,
              recipient_name: targets[0]?.name ?? null,
            },
          }
        : m));

      // Fora do app aberto o popup não existe — o push é o que alcança o celular.
      cloudFunctions.invoke('send-team-push', {
        body: {
          user_ids: targets.map(t => t.user_id),
          sender_id: user.id,
          sender_name: myName,
          title: level === 'urgente' ? '🚨 Responda com urgência' : '❗ Responda: é importante',
          content: mention.message.content || 'Você foi marcado e estão esperando sua resposta.',
          is_urgent: level === 'urgente',
          url: entityChatUrl(entity_type, entity_id),
        },
      }).catch(err => console.error('Falha no Web Push da cobrança de menção:', err));

      const quem = targets.map(t => t.name).filter(Boolean).join(', ') || 'quem foi marcado';
      toast.success(level === 'urgente'
        ? `🚨 Cobrança URGENTE enviada para ${quem}.`
        : `❗ Cobrança de importância enviada para ${quem}.`);
    } catch (e) {
      console.error('[useMyMentions] erro ao cobrar a menção:', e);
      toast.error('Não foi possível enviar a cobrança.');
    }
  }, [user]);

  /**
   * "Finalizar participação": para de receber as mensagens daquele chat de
   * ficha. Um novo @ traz a pessoa de volta.
   */
  const leaveMentionThread = useCallback(async (mention: TeamMentionItem) => {
    if (!user) return;
    const { entity_type, entity_id } = mention.message;
    if (!entity_type || !entity_id) return;
    try {
      await leaveThread(user.id, entity_type, entity_id);
      setFollowedThreads(prev => {
        const next = new Set(prev);
        next.delete(`${entity_type}:${entity_id}`);
        return next;
      });
      toast.success(`Você não recebe mais as mensagens de ${mention.entity_name || 'desse chat'}.`);
    } catch (e) {
      console.error('[useMyMentions] erro ao finalizar participação:', e);
      toast.error('Não foi possível finalizar a participação.');
    }
  }, [user]);

  return {
    mentions,
    loading,
    markAsRead,
    markAllAsRead,
    nudgeMention,
    followedThreads,
    leaveMentionThread,
    reload: load,
  };
}
