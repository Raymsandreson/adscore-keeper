import { useState, useEffect, useRef } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, User, Send, MoreVertical, Link2, UserPlus, Plus, Scale, Sparkles, X, Users, Bot } from 'lucide-react';
import { Phone as PhoneIcon, PhoneIncoming, PhoneOutgoing, PhoneMissed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuthContext } from '@/contexts/AuthContext';

interface Message {
  id: string;
  message_text: string | null;
  direction: string;
  created_at: string;
  message_type: string;
  media_url: string | null;
  media_type: string | null;
  instance_name: string | null;
}

interface CallRecord {
  id: string;
  call_type: string;
  call_result: string;
  duration_seconds: number | null;
  notes: string | null;
  ai_summary: string | null;
  created_at: string;
  contact_name: string | null;
  phone_used: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string | null;
  contactName: string | null;
  instanceName: string | null;
  hasLead: boolean;
  hasContact: boolean;
  wasResponded: boolean;
  responseTimeMinutes: number | null;
  onOpenChat?: (phone: string) => void;
}

export function DashboardChatPreview({ open, onOpenChange, phone, contactName, instanceName, hasLead, hasContact, wasResponded, responseTimeMinutes, onOpenChat }: Props) {
  const { user } = useAuthContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [agentInfo, setAgentInfo] = useState<{ name: string; activated_by: string | null; is_active: boolean } | null>(null);
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !phone) return;
    setLoading(true);
    setAiSuggestion(null);
    setAgentInfo(null);
    const normalizedPhone = phone.replace(/\D/g, '');
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('id, message_text, direction, created_at, message_type, media_url, media_type, instance_name')
        .eq('phone', phone)
        .order('created_at', { ascending: true })
        .limit(200);
      setMessages(data || []);
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 100);
    };
    const fetchAgent = async () => {
      const { data } = await supabase
        .from('whatsapp_conversation_agents')
        .select('agent_id, is_active, activated_by')
        .or(`phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`)
        .limit(1)
        .maybeSingle();
      if (data) {
        const { data: agent } = await supabase
          .from('whatsapp_ai_agents' as any)
          .select('name')
          .eq('id', data.agent_id)
          .maybeSingle();
        const activatedByLabel = data.activated_by === 'stage_auto' ? 'Troca de Etapa'
          : (data.activated_by === 'ctwa_campaign' || data.activated_by === 'campaign_auto') ? 'Anúncio Meta'
          : data.activated_by === 'broadcast' ? 'Lista de Transmissão'
          : (data.activated_by === 'campaign_instance_auto' || data.activated_by === 'instance_default') ? 'Instância'
          : data.activated_by === 'manual' ? 'Manual'
          : data.activated_by || 'Automático';
        setAgentInfo({
          name: (agent as any)?.name || 'Agente',
          activated_by: activatedByLabel,
          is_active: data.is_active,
        });
      }
    };
    fetchMessages();
    fetchAgent();
  }, [open, phone]);

  // Realtime
  useEffect(() => {
    if (!open || !phone) return;
    const channel = supabase
      .channel(`dashboard-chat-${phone}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `phone=eq.${phone}`,
      }, (payload) => {
        const msg = payload.new as any;
        setMessages(prev => [...prev, msg]);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, phone]);

  const formatDateSeparator = (dateStr: string) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Hoje';
    if (isYesterday(date)) return 'Ontem';
    return format(date, "dd 'de' MMMM", { locale: ptBR });
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !phone || sending) return;
    setSending(true);
    try {
      let instanceId: string | undefined;
      const msgInstanceName = instanceName || messages.find(m => m.instance_name)?.instance_name;
      if (msgInstanceName) {
        const { data: inst } = await supabase
          .from('whatsapp_instances')
          .select('id')
          .eq('instance_name', msgInstanceName)
          .eq('is_active', true)
          .maybeSingle();
        if (inst) instanceId = inst.id;
      }
      if (!instanceId) {
        const { data: firstInst } = await supabase
          .from('whatsapp_instances')
          .select('id')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        if (firstInst) instanceId = firstInst.id;
      }

      let finalMessage = newMessage.trim();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, treatment_title')
          .eq('user_id', user.id)
          .single();
        if (profile?.full_name) {
          const parts = profile.full_name.split(' ');
          const displayName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
          const title = profile.treatment_title || '';
          const senderName = title ? `${title} ${displayName}` : displayName;
          finalMessage = `*${senderName}:*\n${newMessage.trim()}`;
        }
      }

      const { data, error } = await supabase.functions.invoke('send-whatsapp', {
        body: { phone, message: finalMessage, instance_id: instanceId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao enviar');

      setMessages(prev => [...prev, {
        id: data.message_id || crypto.randomUUID(),
        message_text: finalMessage,
        direction: 'outbound',
        created_at: new Date().toISOString(),
        message_type: 'text',
        media_url: null,
        media_type: null,
        instance_name: msgInstanceName || null,
      }]);
      setNewMessage('');
      toast.success('Mensagem enviada!');
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e: any) {
      console.error('Error sending:', e);
      toast.error('Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAction = (action: string) => {
    if (phone && onOpenChat) {
      onOpenChange(false);
      onOpenChat(phone);
    }
  };

  const handleCreateGroup = async () => {
    if (!phone || creatingGroup) return;
    setCreatingGroup(true);
    try {
      // Find lead linked to this contact/phone
      const normalizedPhone = phone.replace(/\D/g, '');
      
      // Try to find lead via contact_leads or directly by phone
      let leadName = contactName || normalizedPhone;
      let boardId: string | undefined;

      const { data: lead } = await supabase
        .from('leads')
        .select('id, lead_name, board_id')
        .or(`lead_phone.eq.${normalizedPhone},lead_phone.ilike.%${normalizedPhone.slice(-8)}%`)
        .limit(1)
        .maybeSingle();

      if (lead) {
        leadName = lead.lead_name || leadName;
        boardId = lead.board_id || undefined;
      }

      // Get instance id
      let instanceId: string | undefined;
      const msgInstanceName = instanceName || messages.find(m => m.instance_name)?.instance_name;
      if (msgInstanceName) {
        const { data: inst } = await supabase
          .from('whatsapp_instances')
          .select('id')
          .eq('instance_name', msgInstanceName)
          .eq('is_active', true)
          .maybeSingle();
        if (inst) instanceId = inst.id;
      }

      const { data, error } = await supabase.functions.invoke('create-whatsapp-group', {
        body: {
          phone: normalizedPhone,
          lead_name: leadName,
          board_id: boardId,
          contact_phone: normalizedPhone,
          creator_instance_id: instanceId,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao criar grupo');

      // Save group_id to lead if available
      if (lead?.id && data.group_id) {
        await supabase
          .from('leads')
          .update({ whatsapp_group_id: data.group_id } as any)
          .eq('id', lead.id);
      }

      // Save group_id to contact too
      if (data.group_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('id')
          .eq('phone', normalizedPhone)
          .maybeSingle();
        if (contact) {
          await supabase
            .from('contacts')
            .update({ whatsapp_group_id: data.group_id } as any)
            .eq('id', contact.id);
        }
      }

      toast.success(`Grupo "${leadName}" criado com ${data.participants_count} participantes!`);
    } catch (e: any) {
      console.error('Error creating group:', e);
      toast.error(e.message || 'Erro ao criar grupo');
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleSuggestNextStep = async () => {
    if (!phone || loadingSuggestion) return;
    setLoadingSuggestion(true);
    setAiSuggestion(null);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-next-step', {
        body: { phone },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAiSuggestion(data.suggestion);
    } catch (e: any) {
      console.error('Error suggesting:', e);
      toast.error('Erro ao gerar sugestão');
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const handleToggleAgent = async () => {
    if (!phone || !agentInfo) return;
    const normalizedPhone = phone.replace(/\D/g, '');
    const newActive = !agentInfo.is_active;
    try {
      await supabase
        .from('whatsapp_conversation_agents')
        .update({ is_active: newActive, human_paused_until: newActive ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() } as any)
        .or(`phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`);
      setAgentInfo({ ...agentInfo, is_active: newActive });
      toast.success(newActive ? 'Agente ativado!' : 'Agente desativado!');
    } catch (e) {
      toast.error('Erro ao alterar agente');
    }
  };

  let lastDateLabel = '';

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh] flex flex-col">
        <DrawerHeader className="pb-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <DrawerTitle className="text-base truncate flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                {contactName || phone}
              </DrawerTitle>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {phone && contactName && <span className="text-xs text-muted-foreground">{phone}</span>}
                {instanceName && <span className="text-[10px] text-muted-foreground">• {instanceName}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {hasLead && <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">Lead</Badge>}
                {hasContact && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Contato</Badge>}
                {!hasLead && !hasContact && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground">Sem vínculo</Badge>}
                {wasResponded ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800">
                    ✓ Respondido {responseTimeMinutes != null && responseTimeMinutes < 60 ? `em ${responseTimeMinutes}min` : responseTimeMinutes != null ? `em ${Math.floor(responseTimeMinutes / 60)}h` : ''}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800">
                    ⏳ Aguardando
                  </Badge>
                )}
              </div>
              {agentInfo && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Badge
                    variant={agentInfo.is_active ? "default" : "secondary"}
                    className="text-[10px] px-1.5 py-0 h-4 gap-1 cursor-pointer select-none"
                    onClick={handleToggleAgent}
                    title={agentInfo.is_active ? 'Clique para desativar o agente' : 'Clique para ativar o agente'}
                  >
                    <Bot className="h-3 w-3" />
                    {agentInfo.name}
                    {!agentInfo.is_active && ' (pausado)'}
                  </Badge>
                  {agentInfo.activated_by && (
                    <span className="text-[9px] text-muted-foreground">via {agentInfo.activated_by}</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0 ml-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={handleSuggestNextStep}
                disabled={loadingSuggestion}
                title="Sugerir próximo passo com IA"
              >
                {loadingSuggestion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-amber-500" />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleAction('link')}>
                    <Link2 className="h-4 w-4 mr-2" /> Vincular Lead
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAction('create_lead')}>
                    <Plus className="h-4 w-4 mr-2" /> Criar Lead + Contato
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAction('create_contact')}>
                    <UserPlus className="h-4 w-4 mr-2" /> Criar Contato
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAction('create_case')}>
                    <Scale className="h-4 w-4 mr-2" /> Criar Caso Jurídico
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCreateGroup} disabled={creatingGroup}>
                    {creatingGroup ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Users className="h-4 w-4 mr-2" />}
                    Criar Grupo WhatsApp
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </DrawerHeader>

        {/* AI Suggestion Banner */}
        {aiSuggestion && (
          <div className="mx-4 mb-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 relative">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 h-5 w-5"
              onClick={() => setAiSuggestion(null)}
            >
              <X className="h-3 w-3" />
            </Button>
            <div className="flex items-start gap-2 pr-5">
              <Sparkles className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-0.5">Próximo passo sugerido</p>
                <p className="text-xs text-amber-900 dark:text-amber-200">{aiSuggestion}</p>
              </div>
            </div>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 min-h-0 px-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem encontrada</p>
          ) : (
            <ScrollArea className="h-[50vh]">
              <div className="space-y-1 pr-3">
                {messages.map((msg) => {
                  const dateLabel = formatDateSeparator(msg.created_at);
                  const showDateSep = dateLabel !== lastDateLabel;
                  if (showDateSep) lastDateLabel = dateLabel;
                  const isInbound = msg.direction === 'inbound';

                  return (
                    <div key={msg.id}>
                      {showDateSep && (
                        <div className="flex justify-center my-2">
                          <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{dateLabel}</span>
                        </div>
                      )}
                      <div className={cn("flex", isInbound ? "justify-start" : "justify-end")}>
                        <div className={cn(
                          "max-w-[80%] rounded-lg px-3 py-1.5 text-xs",
                          isInbound
                            ? "bg-muted text-foreground rounded-tl-none"
                            : "bg-primary text-primary-foreground rounded-tr-none"
                        )}>
                          {msg.media_type && !msg.message_text && (
                            <span className="italic text-[10px] opacity-70">
                              {msg.media_type === 'image' ? '📷 Imagem' : msg.media_type === 'audio' ? '🎵 Áudio' : msg.media_type === 'video' ? '🎬 Vídeo' : msg.media_type === 'document' ? '📄 Documento' : '📎 Mídia'}
                            </span>
                          )}
                          {msg.message_text && <p className="whitespace-pre-wrap break-words">{msg.message_text}</p>}
                          <p className={cn("text-[9px] mt-0.5", isInbound ? "text-muted-foreground" : "text-primary-foreground/70")}>
                            {format(parseISO(msg.created_at), 'HH:mm')}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Message input */}
        <div className="px-4 pb-4 pt-2 shrink-0 border-t">
          <div className="flex items-end gap-2">
            <Textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite uma mensagem..."
              className="min-h-[40px] max-h-[100px] resize-none text-sm"
              rows={1}
            />
            <Button
              size="icon"
              className="shrink-0 h-10 w-10"
              onClick={handleSend}
              disabled={!newMessage.trim() || sending}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
