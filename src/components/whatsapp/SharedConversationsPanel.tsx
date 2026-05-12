import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Share2, MessageCircle, ClipboardPlus, Loader2, Inbox } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSharedWithMe } from '@/hooks/useSharedWithMe';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useAuthContext } from '@/contexts/AuthContext';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function SharedConversationsPanel({ open, onOpenChange }: Props) {
  const { items, loading, reload } = useSharedWithMe();
  const profiles = useProfilesList();
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  const getProfileName = (uid: string) => {
    const p = profiles.find(pr => pr.user_id === uid);
    return p?.full_name || p?.email || uid.slice(0, 8);
  };

  const openConversation = (phone: string) => {
    onOpenChange(false);
    navigate(`/whatsapp?openChat=${encodeURIComponent(phone)}`);
  };

  const createActivity = async (share: { id: string; phone: string; instance_name: string; shared_by: string }) => {
    if (!user) return;
    setCreatingFor(share.id);
    try {
      // Try to find the lead linked to this phone via whatsapp_messages
      await ensureExternalSession();
      const { data: msg } = await externalSupabase
        .from('whatsapp_messages')
        .select('lead_id, contact_name')
        .eq('phone', share.phone)
        .not('lead_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const sharerName = getProfileName(share.shared_by);
      const myProfile = profiles.find(p => p.user_id === user.id);

      const { error } = await externalSupabase.from('lead_activities').insert({
        lead_id: msg?.lead_id || null,
        lead_name: msg?.contact_name || share.phone,
        title: `Tratar conversa compartilhada por ${sharerName}`,
        description: `Conversa do WhatsApp (${share.phone}) compartilhada com você.\n\nLink: ${window.location.origin}/whatsapp?openChat=${encodeURIComponent(share.phone)}`,
        activity_type: 'tarefa',
        status: 'pendente',
        priority: 'normal',
        assigned_to: user.id,
        assigned_to_name: myProfile?.full_name || user.email || null,
        created_by: user.id,
        deadline: new Date().toISOString().slice(0, 10),
        action_source: 'shared_conversation',
      });

      if (error) throw error;

      // Mark share as acknowledged so it stops being highlighted
      await supabase
        .from('whatsapp_conversation_shares')
        .update({ acknowledged_at: new Date().toISOString() } as any)
        .eq('id', share.id);

      toast.success('Atividade criada e atribuída a você');
      reload();
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao criar atividade');
    } finally {
      setCreatingFor(null);
    }
  };

  const unreadCount = items.filter(i => !i.acknowledged_at).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            Compartilhadas comigo
            {unreadCount > 0 && <Badge variant="destructive" className="ml-1">{unreadCount}</Badge>}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground gap-2">
              <Inbox className="h-10 w-10 opacity-30" />
              <p className="text-sm text-center">
                Ninguém compartilhou conversas do WhatsApp com você ainda.
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {items.map(share => {
                const isNew = !share.acknowledged_at;
                return (
                  <div
                    key={share.id}
                    className={`rounded-lg border p-3 ${isNew ? 'bg-primary/5 border-primary/30' : 'bg-card'}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{share.phone}</p>
                        <p className="text-[11px] text-muted-foreground">
                          de <span className="font-medium">{getProfileName(share.shared_by)}</span>
                          {' · '}
                          {format(new Date(share.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Instância: {share.instance_name}
                        </p>
                      </div>
                      {isNew && <Badge variant="default" className="text-[9px] shrink-0">Nova</Badge>}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-xs"
                        onClick={() => openConversation(share.phone)}
                      >
                        <MessageCircle className="h-3.5 w-3.5 mr-1" />
                        Abrir conversa
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-1 h-8 text-xs"
                        onClick={() => createActivity(share)}
                        disabled={creatingFor === share.id}
                      >
                        {creatingFor === share.id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <ClipboardPlus className="h-3.5 w-3.5 mr-1" />
                        )}
                        Criar atividade
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
