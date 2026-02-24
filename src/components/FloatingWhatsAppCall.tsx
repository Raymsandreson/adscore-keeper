import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Phone, X, MessageSquare, PhoneCall, PhoneIncoming, PhoneOutgoing, Search, Smartphone, Clock, User } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface UserInstance {
  id: string;
  instance_name: string;
  instance_token: string;
  base_url: string | null;
  owner_phone: string | null;
}

interface RecentConversation {
  phone: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string;
  instance_name: string | null;
}

interface RecentCall {
  id: string;
  contact_name: string | null;
  contact_phone: string | null;
  call_type: string;
  call_result: string;
  duration_seconds: number;
  created_at: string;
  lead_name: string | null;
}

export function FloatingWhatsAppCall() {
  const { user } = useAuthContext();
  const [open, setOpen] = useState(false);
  const [instances, setInstances] = useState<UserInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<UserInstance | null>(null);
  const [recentConversations, setRecentConversations] = useState<RecentConversation[]>([]);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [dialNumber, setDialNumber] = useState('');
  const [calling, setCalling] = useState(false);

  // Fetch user's instances
  const fetchInstances = useCallback(async () => {
    if (!user) return;
    try {
      // Get instance IDs the user has access to
      const { data: permissions } = await supabase
        .from('whatsapp_instance_users')
        .select('instance_id')
        .eq('user_id', user.id);

      if (!permissions || permissions.length === 0) return;

      const instanceIds = permissions.map(p => p.instance_id);
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, instance_token, base_url, owner_phone')
        .in('id', instanceIds)
        .eq('is_active', true);

      if (data && data.length > 0) {
        setInstances(data as UserInstance[]);
        // Auto-select if only one
        if (data.length === 1) {
          setSelectedInstance(data[0] as UserInstance);
        }
      }
    } catch (err) {
      console.error('Error fetching instances:', err);
    }
  }, [user]);

  // Fetch recent conversations for selected instance
  const fetchRecentConversations = useCallback(async () => {
    if (!selectedInstance) return;
    try {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('phone, contact_name, message_text, created_at, instance_name')
        .eq('instance_name', selectedInstance.instance_name)
        .order('created_at', { ascending: false })
        .limit(100);

      if (data) {
        // Group by phone, get latest per phone
        const phoneMap = new Map<string, RecentConversation>();
        for (const msg of data) {
          if (!phoneMap.has(msg.phone)) {
            phoneMap.set(msg.phone, {
              phone: msg.phone,
              contact_name: msg.contact_name,
              last_message: msg.message_text,
              last_message_at: msg.created_at,
              instance_name: msg.instance_name,
            });
          }
        }
        setRecentConversations(Array.from(phoneMap.values()).slice(0, 5));
      }
    } catch (err) {
      console.error('Error fetching recent conversations:', err);
    }
  }, [selectedInstance]);

  // Fetch recent calls
  const fetchRecentCalls = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('call_records')
        .select('id, contact_name, contact_phone, call_type, call_result, duration_seconds, created_at, lead_name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (data) setRecentCalls(data as RecentCall[]);
    } catch (err) {
      console.error('Error fetching recent calls:', err);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchInstances();
  }, [user, fetchInstances]);

  useEffect(() => {
    if (open && selectedInstance) {
      fetchRecentConversations();
      fetchRecentCalls();
    }
  }, [open, selectedInstance, fetchRecentConversations, fetchRecentCalls]);

  const handleMakeCall = async (phone: string, contactName?: string | null) => {
    if (!selectedInstance || !phone || calling) return;
    setCalling(true);
    try {
      const { data, error } = await supabase.functions.invoke('make-whatsapp-call', {
        body: {
          phone,
          contact_name: contactName || undefined,
          instance_id: selectedInstance.id,
          instance_name: selectedInstance.instance_name,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao ligar');
      toast.success(`Ligação iniciada para ${contactName || phone}`);
      setOpen(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Erro ao iniciar chamada');
      // Fallback tel:
      const clean = phone.replace(/\D/g, '');
      const tel = clean.startsWith('55') ? `tel:+${clean}` : `tel:+55${clean}`;
      window.open(tel);
    } finally {
      setCalling(false);
    }
  };

  const handleDialDirect = () => {
    if (!dialNumber.trim()) return;
    handleMakeCall(dialNumber.trim());
  };

  const formatDuration = (s: number) => {
    if (!s) return '0s';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m${sec > 0 ? sec + 's' : ''}` : `${sec}s`;
  };

  const filteredConversations = recentConversations.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (c.contact_name?.toLowerCase().includes(q)) || c.phone.includes(q);
  });

  if (!user) return null;

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => {
          setOpen(!open);
          if (!open && instances.length === 0) fetchInstances();
        }}
        className={cn(
          "fixed bottom-24 right-6 z-[60] h-14 w-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200",
          "bg-green-600 hover:bg-green-700 text-white hover:scale-105 active:scale-95",
          open && "bg-red-500 hover:bg-red-600"
        )}
        title="Ligar via WhatsApp"
      >
        {open ? <X className="h-6 w-6" /> : <Phone className="h-6 w-6" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-[7.5rem] right-6 z-[60] w-80 max-h-[70vh] rounded-2xl border-2 shadow-2xl bg-card overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-200">
          {/* Header */}
          <div className="bg-green-600 text-white px-4 py-3 flex items-center gap-2">
            <Phone className="h-5 w-5" />
            <span className="font-semibold text-sm">WhatsApp Call</span>
            {selectedInstance && (
              <Badge className="ml-auto bg-white/20 text-white text-[10px] hover:bg-white/30">
                {selectedInstance.instance_name}
              </Badge>
            )}
          </div>

          {/* Instance Selector - show if multiple */}
          {instances.length > 1 && !selectedInstance && (
            <div className="p-4 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Selecione a instância:</p>
              {instances.map(inst => (
                <button
                  key={inst.id}
                  onClick={() => setSelectedInstance(inst)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition-colors text-left"
                >
                  <Smartphone className="h-4 w-4 text-green-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{inst.instance_name}</p>
                    {inst.owner_phone && (
                      <p className="text-[11px] text-muted-foreground">{inst.owner_phone}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Instance selected but allow switching */}
          {instances.length > 1 && selectedInstance && (
            <div className="px-4 pt-2 pb-1">
              <button
                onClick={() => setSelectedInstance(null)}
                className="text-[11px] text-muted-foreground hover:text-foreground underline"
              >
                Trocar instância
              </button>
            </div>
          )}

          {/* Content when instance selected */}
          {selectedInstance && (
            <div className="flex flex-col">
              {/* Direct Dial */}
              <div className="px-4 pt-3 pb-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Digite o número..."
                    value={dialNumber}
                    onChange={e => setDialNumber(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleDialDirect()}
                    className="h-9 text-sm"
                  />
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 h-9 px-3"
                    onClick={handleDialDirect}
                    disabled={!dialNumber.trim() || calling}
                  >
                    <PhoneCall className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Search */}
              <div className="px-4 pb-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Buscar contato..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="h-8 text-xs pl-8"
                  />
                </div>
              </div>

              <ScrollArea className="max-h-[50vh]">
                {/* Recent Conversations */}
                <div className="px-4 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <MessageSquare className="h-3 w-3" />
                    Últimas Conversas
                  </p>
                  {filteredConversations.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">Nenhuma conversa recente</p>
                  ) : (
                    <div className="space-y-1">
                      {filteredConversations.map(conv => (
                        <button
                          key={conv.phone}
                          onClick={() => handleMakeCall(conv.phone, conv.contact_name)}
                          disabled={calling}
                          className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-accent transition-colors text-left group"
                        >
                          <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                            <User className="h-4 w-4 text-green-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {conv.contact_name || conv.phone}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {conv.last_message || conv.phone}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true, locale: ptBR })}
                            </span>
                            <Phone className="h-3.5 w-3.5 text-green-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Recent Calls */}
                <div className="px-4 py-2 pb-4">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Últimas Ligações
                  </p>
                  {recentCalls.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">Nenhuma ligação recente</p>
                  ) : (
                    <div className="space-y-1">
                      {recentCalls.map(call => (
                        <button
                          key={call.id}
                          onClick={() => call.contact_phone && handleMakeCall(call.contact_phone, call.contact_name)}
                          disabled={calling || !call.contact_phone}
                          className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-accent transition-colors text-left group"
                        >
                          <div className={cn(
                            "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                            call.call_result === 'atendeu' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
                          )}>
                            {call.call_type === 'recebida' ? (
                              <PhoneIncoming className={cn("h-4 w-4", call.call_result === 'atendeu' ? 'text-green-600' : 'text-red-500')} />
                            ) : (
                              <PhoneOutgoing className={cn("h-4 w-4", call.call_result === 'atendeu' ? 'text-green-600' : 'text-red-500')} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {call.contact_name || call.contact_phone || 'Desconhecido'}
                            </p>
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              {call.lead_name && <span className="truncate max-w-[100px]">📋 {call.lead_name}</span>}
                              <span>{formatDuration(call.duration_seconds)}</span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(call.created_at), { addSuffix: true, locale: ptBR })}
                            </span>
                            {call.contact_phone && (
                              <Phone className="h-3.5 w-3.5 text-green-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Loading / No instances */}
          {instances.length === 0 && (
            <div className="p-6 text-center">
              <Smartphone className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma instância configurada</p>
              <p className="text-xs text-muted-foreground mt-1">Configure suas instâncias no WhatsApp Inbox</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
