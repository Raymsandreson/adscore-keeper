import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { useProfilesList } from '@/hooks/useProfilesList';
import { TeamChatPanel } from '@/components/chat/TeamChatPanel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  phone: string;
  instanceName: string | null;
  contactName?: string | null;
  onClose?: () => void;
  className?: string;
}

/**
 * Chat interno da equipe dentro da própria conversa do WhatsApp.
 *
 * Regra combinada com o time: quem é marcado com @ aqui passa a ter acesso à
 * conversa do cliente mesmo que ela não seja da instância dele — o mesmo
 * mecanismo do "Compartilhar conversa" (whatsapp_conversation_shares), só que
 * disparado pela menção. O acesso concedido fica registrado no próprio chat e
 * pode ser revogado no diálogo de compartilhamento.
 */
export function WhatsAppConversationTeamChat({ phone, instanceName, contactName, onClose, className }: Props) {
  const { user } = useAuthContext();
  const profiles = useProfilesList();
  const [sharedWith, setSharedWith] = useState<string[]>([]);

  const loadShares = useCallback(async () => {
    if (!instanceName) return;
    const { data } = await supabase
      .from('whatsapp_conversation_shares')
      .select('shared_with')
      .eq('phone', phone)
      .eq('instance_name', instanceName);
    setSharedWith((data || []).map((s: { shared_with: string }) => s.shared_with));
  }, [phone, instanceName]);

  useEffect(() => { loadShares(); }, [loadShares]);

  const nameOf = useCallback((userId: string) => {
    const p = profiles.find(pr => pr.user_id === userId);
    return p?.full_name || p?.email || userId.slice(0, 8);
  }, [profiles]);

  /** Garante acesso à conversa para quem foi mencionado. */
  const grantAccessToMentioned = useCallback(async (mentionedUserIds: string[]) => {
    if (!user || !instanceName) return;
    const alreadyShared = new Set(sharedWith);
    const targets = mentionedUserIds.filter(uid => uid !== user.id && !alreadyShared.has(uid));
    if (targets.length === 0) return;

    const granted: string[] = [];
    for (const uid of targets) {
      const { error } = await supabase
        .from('whatsapp_conversation_shares')
        .insert({
          phone,
          instance_name: instanceName,
          shared_by: user.id,
          shared_with: uid,
          identify_sender: true,
          can_reshare: false,
        });
      // 23505 = já tinha acesso; qualquer outro erro é falha real de permissão.
      if (error && error.code !== '23505') {
        console.error('[WhatsAppConversationTeamChat] falha ao liberar acesso:', error);
        toast.error(`Não consegui liberar o acesso de ${nameOf(uid)} a esta conversa`);
        continue;
      }
      granted.push(uid);
    }

    if (granted.length === 0) return;
    setSharedWith(prev => [...prev, ...granted]);
    toast.success(
      granted.length === 1
        ? `${nameOf(granted[0])} agora tem acesso a esta conversa`
        : `${granted.length} pessoas agora têm acesso a esta conversa`
    );

    // Notificação por WhatsApp (mesma rota do compartilhamento manual).
    for (const uid of granted) {
      supabase.functions.invoke('notify-conversation-share', {
        body: {
          recipient_user_id: uid,
          sender_id: user.id,
          sender_name: nameOf(user.id),
          conversation_phone: phone,
          conversation_name: contactName || phone,
        },
      }).catch(err => console.error('notify-conversation-share failed:', err));
    }
  }, [user, instanceName, phone, contactName, sharedWith, nameOf]);

  const others = sharedWith.filter(uid => uid !== user?.id);

  return (
    <div className={className}>
      <div className="flex flex-col h-full bg-background">
        <div className="shrink-0 border-b bg-primary/5 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-primary min-w-0">
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Chat interno da equipe</span>
            </span>
            {onClose && (
              <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto shrink-0" onClick={onClose} title="Fechar chat interno">
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            Sobre {contactName || phone} — o cliente não vê nada daqui.
          </p>
          {others.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              <span className="text-[10px] text-muted-foreground">Com acesso:</span>
              {others.map(uid => (
                <Badge key={uid} variant="outline" className="text-[9px] h-4 px-1.5">{nameOf(uid)}</Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0">
          <TeamChatPanel
            entityType="whatsapp"
            entityId={phone}
            entityName={contactName || phone}
            onMentionUsers={instanceName ? grantAccessToMentioned : undefined}
            footerNote={
              instanceName
                ? 'Quem você marcar com @ passa a ter acesso a esta conversa do WhatsApp e é notificado.'
                : 'Conversa sem instância definida — marcar alguém aqui não libera o acesso automático.'
            }
          />
        </div>
      </div>
    </div>
  );
}
