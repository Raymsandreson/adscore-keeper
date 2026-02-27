import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Share2, Trash2, UserPlus, Link2, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { useProfilesList } from '@/hooks/useProfilesList';
import { toast } from 'sonner';

interface Share {
  id: string;
  phone: string;
  instance_name: string;
  shared_by: string;
  shared_with: string;
  identify_sender: boolean;
  can_reshare: boolean;
  created_at: string;
}

interface Props {
  phone: string;
  instanceName: string | null;
}

export function WhatsAppConversationShareDialog({ phone, instanceName }: Props) {
  const { user } = useAuthContext();
  const profiles = useProfilesList();
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [identifySender, setIdentifySender] = useState(true);
  const [canReshare, setCanReshare] = useState(false);
  const [saving, setSaving] = useState(false);

  // Check if current user is the sharer or has reshare permission
  const [canShare, setCanShare] = useState(false);

  const fetchShares = async () => {
    if (!instanceName) return;
    setLoading(true);
    const { data } = await supabase
      .from('whatsapp_conversation_shares')
      .select('*')
      .eq('phone', phone)
      .eq('instance_name', instanceName);
    setShares((data || []) as Share[]);
    setLoading(false);
  };

  useEffect(() => {
    if (open) fetchShares();
  }, [open, phone, instanceName]);

  // Determine if current user can share
  useEffect(() => {
    if (!user || !instanceName) return;
    // Check if user has instance access (is sharer) or has reshare permission
    const checkPermission = async () => {
      const { data: instanceAccess } = await supabase
        .from('whatsapp_instance_users')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);
      
      if (instanceAccess && instanceAccess.length > 0) {
        setCanShare(true);
        return;
      }

      // Check if user has reshare permission for this conversation
      const { data: resharePermission } = await supabase
        .from('whatsapp_conversation_shares')
        .select('id')
        .eq('phone', phone)
        .eq('instance_name', instanceName)
        .eq('shared_with', user.id)
        .eq('can_reshare', true)
        .maybeSingle();
      
      setCanShare(!!resharePermission);
    };
    checkPermission();
  }, [user, phone, instanceName]);

  const handleAddShare = async () => {
    if (!selectedUserId || !instanceName || !user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('whatsapp_conversation_shares')
        .insert({
          phone,
          instance_name: instanceName,
          shared_by: user.id,
          shared_with: selectedUserId,
          identify_sender: identifySender,
          can_reshare: canReshare,
        });
      if (error) throw error;
      toast.success('Conversa compartilhada!');
      // Copy link to clipboard automatically
      const url = `${window.location.origin}/whatsapp?openChat=${encodeURIComponent(phone)}`;
      navigator.clipboard.writeText(url).then(() => {
        toast.info('Link copiado para enviar ao usuário!', { duration: 3000 });
      });
      setSelectedUserId('');
      setIdentifySender(true);
      setCanReshare(false);
      fetchShares();
    } catch (e: any) {
      if (e?.code === '23505') {
        toast.error('Este usuário já tem acesso a esta conversa');
      } else {
        toast.error('Erro ao compartilhar');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveShare = async (shareId: string) => {
    try {
      await supabase.from('whatsapp_conversation_shares').delete().eq('id', shareId);
      toast.success('Compartilhamento removido');
      fetchShares();
    } catch {
      toast.error('Erro ao remover');
    }
  };

  const handleToggleIdentify = async (shareId: string, value: boolean) => {
    await supabase
      .from('whatsapp_conversation_shares')
      .update({ identify_sender: value } as any)
      .eq('id', shareId);
    setShares(prev => prev.map(s => s.id === shareId ? { ...s, identify_sender: value } : s));
  };

  const handleToggleReshare = async (shareId: string, value: boolean) => {
    await supabase
      .from('whatsapp_conversation_shares')
      .update({ can_reshare: value } as any)
      .eq('id', shareId);
    setShares(prev => prev.map(s => s.id === shareId ? { ...s, can_reshare: value } : s));
  };

  const getProfileName = (userId: string) => {
    const p = profiles.find(pr => pr.user_id === userId);
    return p?.full_name || p?.email || userId.slice(0, 8);
  };

  // Users already shared with
  const sharedUserIds = new Set(shares.map(s => s.shared_with));
  const availableProfiles = profiles.filter(p =>
    p.user_id !== user?.id && !sharedUserIds.has(p.user_id)
  );

  // Is current user the owner of any share (i.e. the one who shared)?
  const isOwner = shares.some(s => s.shared_by === user?.id);
  const myShare = shares.find(s => s.shared_with === user?.id);

  if (!canShare && !isOwner && shares.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Compartilhar conversa">
          <Share2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Compartilhar Conversa
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Copy link to chat */}
          {shares.length > 0 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => {
                  const url = `${window.location.origin}/whatsapp?openChat=${encodeURIComponent(phone)}`;
                  navigator.clipboard.writeText(url).then(() => {
                    toast.success('Link da conversa copiado!');
                  });
                }}
              >
                <Link2 className="h-4 w-4" />
                Copiar link da conversa
              </Button>
            </div>
          )}

          {/* Add new share */}
          {canShare && availableProfiles.length > 0 && (
            <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <UserPlus className="h-4 w-4" /> Adicionar usuário
              </Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione um usuário..." />
                </SelectTrigger>
                <SelectContent>
                  {availableProfiles.map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name || p.email || p.user_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedUserId && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Identificar remetente</Label>
                    <Switch checked={identifySender} onCheckedChange={setIdentifySender} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Pode compartilhar com outros</Label>
                    <Switch checked={canReshare} onCheckedChange={setCanReshare} />
                  </div>
                  <Button size="sm" onClick={handleAddShare} disabled={saving} className="w-full">
                    {saving ? 'Compartilhando...' : 'Compartilhar'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Current shares list */}
          {shares.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Usuários com acesso</Label>
              {shares.map(share => {
                const isMyShare = share.shared_by === user?.id;
                return (
                  <div key={share.id} className="flex items-center gap-2 p-2 rounded-lg border text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs truncate">{getProfileName(share.shared_with)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Compartilhado por {getProfileName(share.shared_by)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isMyShare && (
                        <>
                          <div className="flex flex-col gap-1 items-end">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground">ID</span>
                              <Switch
                                checked={share.identify_sender}
                                onCheckedChange={v => handleToggleIdentify(share.id, v)}
                                className="scale-75"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground">Re</span>
                              <Switch
                                checked={share.can_reshare}
                                onCheckedChange={v => handleToggleReshare(share.id, v)}
                                className="scale-75"
                              />
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveShare(share.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {!isMyShare && (
                        <div className="flex flex-col gap-0.5 items-end">
                          <Badge variant={share.identify_sender ? 'default' : 'secondary'} className="text-[9px]">
                            {share.identify_sender ? 'Identificado' : 'Anônimo'}
                          </Badge>
                          {share.can_reshare && (
                            <Badge variant="outline" className="text-[9px]">Pode compartilhar</Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum compartilhamento ativo para esta conversa.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
