import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Forward, Hash, Loader2, Search } from 'lucide-react';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useAuthContext } from '@/contexts/AuthContext';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { cn } from '@/lib/utils';

interface GroupTarget {
  id: string;
  name: string | null;
}

interface ForwardMessagePickerProps {
  /** Uma linha do que está sendo encaminhado (aparece no topo). */
  preview: string;
  /** Quem escreveu a mensagem original. */
  senderName?: string | null;
  sending?: boolean;
  onCancel: () => void;
  /** Encaminhar para um grupo já existente. */
  onPickConversation: (conversationId: string) => void;
  /** Encaminhar para uma pessoa (a conversa direta é aberta/reaproveitada). */
  onPickUser: (userId: string) => void;
  /**
   * Grupos já carregados pelo painel (Chat da Equipe). Sem isto o próprio
   * seletor busca os grupos de que o usuário participa.
   */
  groups?: GroupTarget[];
  /** Quem não deve aparecer na lista (ex.: quem saiu do escritório). */
  excludeUserIds?: Set<string>;
  className?: string;
}

const getInitials = (name: string) =>
  name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

/** Grupos de que EU participo — usado quando o painel não passa a lista pronta. */
function useMyGroupConversations(skip: boolean): GroupTarget[] {
  const { user } = useAuthContext();
  const [groups, setGroups] = useState<GroupTarget[]>([]);

  useEffect(() => {
    if (skip || !user?.id) return;
    let alive = true;
    (async () => {
      try {
        await ensureExternalSession();
        const { data: memberships } = await externalSupabase
          .from('team_conversation_members')
          .select('conversation_id')
          .eq('user_id', user.id);
        const ids = (memberships || []).map((m: { conversation_id: string }) => m.conversation_id);
        if (ids.length === 0) return;
        const { data } = await externalSupabase
          .from('team_conversations')
          .select('id, name, type')
          .in('id', ids)
          .eq('type', 'group');
        if (alive) setGroups(((data as GroupTarget[]) || []));
      } catch (e) {
        console.error('[ForwardMessagePicker] falha ao carregar grupos:', e);
      }
    })();
    return () => { alive = false; };
  }, [skip, user?.id]);

  return groups;
}

/**
 * Seletor de destino do "Encaminhar" — o mesmo no Chat da Equipe e no chat
 * interno da ficha/WhatsApp.
 */
export function ForwardMessagePicker({
  preview,
  senderName,
  sending,
  onCancel,
  onPickConversation,
  onPickUser,
  groups: groupsProp,
  excludeUserIds,
  className,
}: ForwardMessagePickerProps) {
  const { user } = useAuthContext();
  const profiles = useProfilesList();
  const loadedGroups = useMyGroupConversations(!!groupsProp);
  const groups = groupsProp || loadedGroups;
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();

  const groupTargets = useMemo(
    () => groups.filter(c => !q || (c.name || '').toLowerCase().includes(q)),
    [groups, q]
  );

  const peopleTargets = useMemo(
    () => profiles
      .filter(p => p.user_id !== user?.id && !excludeUserIds?.has(p.user_id))
      .filter(p => !q
        || (p.full_name || '').toLowerCase().includes(q)
        || (p.email || '').toLowerCase().includes(q)),
    [profiles, excludeUserIds, user?.id, q]
  );

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel} disabled={sending}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Forward className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Encaminhar para...</span>
        {sending && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
      </div>
      <div className="shrink-0 px-3 py-1.5 border-b bg-muted/20">
        <p className="text-[11px] text-muted-foreground truncate">
          <b>{senderName || 'Mensagem'}:</b> {preview}
        </p>
      </div>
      <div className="shrink-0 px-3 py-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar pessoa ou grupo..."
            className="h-8 pl-8 text-sm"
            autoFocus
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="divide-y">
          {groupTargets.length === 0 && peopleTargets.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">Ninguém encontrado com esse nome.</p>
          )}
          {groupTargets.map(c => (
            <button
              key={c.id}
              disabled={sending}
              onClick={() => onPickConversation(c.id)}
              className="w-full text-left px-4 py-2.5 hover:bg-accent/50 transition-colors flex items-center gap-3 disabled:opacity-50"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs bg-primary/20 text-primary">
                  <Hash className="h-3.5 w-3.5" />
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium truncate flex-1">{c.name || 'Grupo'}</span>
              <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">grupo</Badge>
            </button>
          ))}
          {peopleTargets.map(p => (
            <button
              key={p.user_id}
              disabled={sending}
              onClick={() => onPickUser(p.user_id)}
              className="w-full text-left px-4 py-2.5 hover:bg-accent/50 transition-colors flex items-center gap-3 disabled:opacity-50"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs bg-primary/20 text-primary">
                  {getInitials(p.full_name || p.email || '?')}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{p.full_name || p.email}</div>
                {p.email && p.full_name && (
                  <div className="text-[10px] text-muted-foreground truncate">{p.email}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
