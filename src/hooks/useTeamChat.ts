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

export interface TeamMentionItem extends TeamMention {
  message: TeamMessage;
  /** 'in' = marcaram você. 'out' = você marcou alguém no chat de uma ficha. */
  direction: 'in' | 'out';
  status: MentionStatus | null;
  /** Primeira mensagem do thread depois da menção — a resposta que fechou a cobrança. */
  reply?: { sender_name: string | null; content: string; created_at: string } | null;
}

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

export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>(() => membersCache || []);

  useEffect(() => {
    if (membersCache) return;
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
    let alive = true;
    membersPromise.then(list => { if (alive) setMembers(list); });
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
      .order('created_at', { ascending: true })
      .limit(200);
    if (data) {
      cacheSet(cacheKey, data as TeamMessage[]);
      setMessagesState(data as TeamMessage[]);
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

    trackedThreads.current = new Set(
      resolved.map(i => `${i.message.entity_type}:${i.message.entity_id}`).filter(k => !k.endsWith(':'))
    );
    setMentions(resolved);
    setLoading(false);
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

  return { mentions, loading, markAsRead, markAllAsRead, reload: load };
}
