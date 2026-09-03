import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { normalizeWhatsAppConversationPhone } from '@/lib/whatsappPhone';

export interface SharedConversation {
  id: string;
  phone: string;
  instance_name: string;
  shared_by: string;
  shared_with: string;
  identify_sender: boolean;
  can_reshare: boolean;
  created_at: string;
  acknowledged_at?: string | null;
}

/**
 * Identidade do compartilhamento = telefone + instância, igual ao resto da inbox.
 * Casar só por telefone confundia o mesmo número em instâncias diferentes.
 */
export const sharedConversationKey = (phone: string, instanceName?: string | null) =>
  `${normalizeWhatsAppConversationPhone(phone)}__${(instanceName || '').trim().toLowerCase()}`;

/** O que a lista precisa saber sobre uma conversa compartilhada, já agregado. */
export interface ShareMark {
  key: string;
  phone: string;
  instance_name: string;
  /** Compartilhamentos em que eu sou o destinatário. */
  incoming: SharedConversation[];
  /** Compartilhamentos que eu fiz para outras pessoas. */
  outgoing: SharedConversation[];
  /** Ids das contrapartes: quem me mandou e para quem eu mandei. */
  people: string[];
  /** Recebida e ainda não confirmada (sem acknowledged_at). */
  unacknowledged: boolean;
}

export function useSharedWithMe() {
  const { user } = useAuthContext();
  const [items, setItems] = useState<SharedConversation[]>([]);
  const [sharedByMe, setSharedByMe] = useState<SharedConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [withMe, byMe] = await Promise.all([
      supabase
        .from('whatsapp_conversation_shares')
        .select('*')
        .eq('shared_with', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('whatsapp_conversation_shares')
        .select('*')
        .eq('shared_by', user.id)
        .order('created_at', { ascending: false }),
    ]);
    setItems((withMe.data || []) as any);
    setSharedByMe((byMe.data || []) as any);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Realtime: refresh when shares change involving me
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`shares-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_conversation_shares',
        filter: `shared_with=eq.${user.id}`,
      }, () => { load(); })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_conversation_shares',
        filter: `shared_by=eq.${user.id}`,
      }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  // Índice por conversa (telefone + instância), sem recorte por instância
  // selecionada: uma conversa compartilhada da instância de outro operador
  // continua sendo uma conversa compartilhada comigo.
  const marksByKey = useMemo(() => {
    const map = new Map<string, ShareMark>();
    const ensure = (share: SharedConversation) => {
      const key = sharedConversationKey(share.phone, share.instance_name);
      let mark = map.get(key);
      if (!mark) {
        mark = {
          key,
          phone: share.phone,
          instance_name: share.instance_name,
          incoming: [],
          outgoing: [],
          people: [],
          unacknowledged: false,
        };
        map.set(key, mark);
      }
      return mark;
    };

    for (const share of items) {
      const mark = ensure(share);
      mark.incoming.push(share);
      if (!mark.people.includes(share.shared_by)) mark.people.push(share.shared_by);
      if (!share.acknowledged_at) mark.unacknowledged = true;
    }
    for (const share of sharedByMe) {
      const mark = ensure(share);
      mark.outgoing.push(share);
      if (!mark.people.includes(share.shared_with)) mark.people.push(share.shared_with);
    }

    return map;
  }, [items, sharedByMe]);

  return { items, sharedByMe, marksByKey, loading, reload: load };
}
