import { useState, useRef, useEffect } from 'react';
import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Send, User, Link2, UserPlus, ExternalLink, Plus, Loader2, Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock } from 'lucide-react';
import { WhatsAppLeadPreview } from './WhatsAppLeadPreview';
import { WhatsAppCallRecorder } from './WhatsAppCallRecorder';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  conversation: WhatsAppConversation;
  onSendMessage: (phone: string, message: string, contactId?: string, leadId?: string) => Promise<boolean>;
  onLinkToLead: (phone: string, leadId: string) => void;
  onLinkToContact: (phone: string, contactId: string) => void;
  onCreateLead: () => void;
  onCreateContact: () => void;
  onCreateActivity?: (leadId: string, leadName: string, contactId?: string, contactName?: string) => void;
  onNavigateToLead?: (leadId: string) => void;
  onViewContact?: (contactId: string) => void;
}

export function WhatsAppChat({ conversation, onSendMessage, onLinkToLead, onLinkToContact, onCreateLead, onCreateContact, onCreateActivity, onNavigateToLead, onViewContact }: Props) {
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [leads, setLeads] = useState<Array<{ id: string; lead_name: string | null }>>([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [callRecords, setCallRecords] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = [...conversation.messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // Fetch call records for this phone
  useEffect(() => {
    const phone = conversation.phone;
    if (!phone) return;
    const fetchCalls = async () => {
      const { data } = await supabase
        .from('call_records')
        .select('*')
        .eq('contact_phone', phone)
        .order('created_at', { ascending: true });
      setCallRecords(data || []);
    };
    fetchCalls();

    const channel = supabase
      .channel(`call_records_chat_${phone}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_records', filter: `contact_phone=eq.${phone}` }, () => fetchCalls())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversation.phone]);

  // Merge messages and call records into a unified timeline
  const timelineItems = (() => {
    const items: Array<{ type: 'message' | 'call'; data: any; timestamp: string }> = [];
    for (const msg of messages) {
      items.push({ type: 'message', data: msg, timestamp: msg.created_at });
    }
    for (const call of callRecords) {
      items.push({ type: 'call', data: call, timestamp: call.created_at });
    }
    items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return items;
  })();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timelineItems.length]);

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    const success = await onSendMessage(
      conversation.phone,
      newMessage.trim(),
      conversation.contact_id || undefined,
      conversation.lead_id || undefined
    );
    if (success) setNewMessage('');
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const fetchLeads = async () => {
    const { data } = await supabase
      .from('leads')
      .select('id, lead_name')
      .order('created_at', { ascending: false })
      .limit(100);
    setLeads(data || []);
  };

  const handleLinkLead = () => {
    if (selectedLeadId) {
      onLinkToLead(conversation.phone, selectedLeadId);
      setShowLinkDialog(false);
      setSelectedLeadId('');
    }
  };

  const formatPhone = (phone: string) => {
    if (phone.length === 13) {
      return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
    }
    return phone;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="flex items-center gap-3 p-3 border-b bg-card shrink-0">
        <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <User className="h-5 w-5 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">
            {conversation.contact_name || formatPhone(conversation.phone)}
          </p>
          <p className="text-xs text-muted-foreground">{formatPhone(conversation.phone)}</p>
        </div>
        <div className="flex items-center gap-2">
          {conversation.lead_id ? (
            <Badge variant="outline" className="text-xs gap-1 text-blue-600">
              <Link2 className="h-3 w-3" /> Lead vinculado
            </Badge>
          ) : (
            <>
              <Dialog open={showLinkDialog} onOpenChange={(open) => { setShowLinkDialog(open); if (open) fetchLeads(); }}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs gap-1">
                    <Link2 className="h-3 w-3" /> Vincular Lead
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Vincular a um Lead</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
                      <SelectTrigger><SelectValue placeholder="Selecione um lead..." /></SelectTrigger>
                      <SelectContent>
                        {leads.map(lead => (
                          <SelectItem key={lead.id} value={lead.id}>
                            {lead.lead_name || 'Lead sem nome'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button className="w-full" onClick={handleLinkLead} disabled={!selectedLeadId}>
                      Vincular
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onCreateLead}>
                <Plus className="h-3 w-3" /> Criar Lead
              </Button>
            </>
          )}
          {conversation.contact_id ? (
            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => onViewContact?.(conversation.contact_id!)}>
              <User className="h-3 w-3" /> Ver Contato
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onCreateContact}>
              <UserPlus className="h-3 w-3" /> Criar Contato
            </Button>
          )}
          <WhatsAppCallRecorder
            phone={conversation.phone}
            contactName={conversation.contact_name}
            contactId={conversation.contact_id}
            leadId={conversation.lead_id}
          />
        </div>
      </div>

      {/* Lead Preview Card */}
      {conversation.lead_id && onCreateActivity && (
        <WhatsAppLeadPreview
          leadId={conversation.lead_id}
          contactId={conversation.contact_id}
          contactName={conversation.contact_name}
          onCreateActivity={onCreateActivity}
          onNavigateToLead={onNavigateToLead}
        />
      )}

      {/* Messages + Call Records Timeline */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/10">
        {timelineItems.map((item, idx) => {
          if (item.type === 'call') {
            const call = item.data;
            const isOutbound = call.call_type === 'outbound' || call.call_type === 'realizada';
            const resultMap: Record<string, string> = { atendeu: 'Atendeu', answered: 'Atendeu', 'não_atendeu': 'Não Atendeu', not_answered: 'Não Atendeu', ocupado: 'Ocupado', busy: 'Ocupado' };
            const resultLabel = resultMap[call.call_result] || call.call_result;
            const durationSec = call.duration_seconds || 0;
            const durationStr = `${Math.floor(durationSec / 60)}min ${durationSec % 60}s`;
            const startTime = format(new Date(call.created_at), "HH:mm", { locale: ptBR });
            const endDate = new Date(new Date(call.created_at).getTime() + durationSec * 1000);
            const endTime = format(endDate, "HH:mm", { locale: ptBR });
            const isUnanswered = call.call_result === 'não_atendeu' || call.call_result === 'not_answered';

            return (
              <div key={`call-${call.id}`} className="flex justify-center">
                <div className={cn(
                  "flex items-center gap-2 rounded-xl px-4 py-2 text-xs max-w-[85%] border",
                  isUnanswered 
                    ? "bg-destructive/10 border-destructive/30 text-destructive"
                    : "bg-primary/10 border-primary/30 text-primary"
                )}>
                  {isOutbound ? <PhoneOutgoing className="h-3.5 w-3.5 shrink-0" /> : <PhoneIncoming className="h-3.5 w-3.5 shrink-0" />}
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {isOutbound ? 'Chamada Realizada' : 'Chamada Recebida'}
                      {isUnanswered && ' — Não Atendeu'}
                    </span>
                    <div className="flex items-center gap-2 text-[10px] opacity-80">
                      <span>{resultLabel}</span>
                      <span>•</span>
                      <span>{durationStr}</span>
                      <span>•</span>
                      <Clock className="h-2.5 w-2.5 inline" />
                      <span>{startTime} → {endTime}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // Regular message
          const msg = item.data;
          return (
            <div
              key={msg.id}
              className={cn(
                "flex",
                msg.direction === 'outbound' ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[70%] rounded-2xl px-4 py-2 text-sm",
                  msg.direction === 'outbound'
                    ? "bg-green-600 text-white rounded-br-sm"
                    : "bg-card border rounded-bl-sm"
                )}
              >
                {/* Media rendering */}
                {msg.message_type === 'audio' && msg.media_url && (
                  <audio controls className="max-w-full mb-1" preload="none">
                    <source src={msg.media_url} type={msg.media_type || 'audio/ogg'} />
                    Áudio não suportado
                  </audio>
                )}
                {msg.message_type === 'image' && msg.media_url && (
                  <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
                    <img 
                      src={msg.media_url} 
                      alt="Imagem" 
                      className="max-w-full rounded-lg mb-1 max-h-[300px] object-cover cursor-pointer"
                      loading="lazy"
                    />
                  </a>
                )}
                {msg.message_type === 'video' && msg.media_url && (
                  <video controls className="max-w-full rounded-lg mb-1 max-h-[300px]" preload="none">
                    <source src={msg.media_url} type={msg.media_type || 'video/mp4'} />
                    Vídeo não suportado
                  </video>
                )}
                {msg.message_type === 'document' && msg.media_url && (
                  <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs underline mb-1">
                    <ExternalLink className="h-3 w-3" /> {msg.media_type || 'Documento'}
                  </a>
                )}
                {/* Fallback for media without proper type */}
                {msg.media_url && msg.message_type === 'text' && (
                  <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs underline mb-1">
                    <ExternalLink className="h-3 w-3" /> {msg.media_type || 'Mídia'}
                  </a>
                )}
                {msg.message_text && <p className="whitespace-pre-wrap">{msg.message_text}</p>}
                {!msg.message_text && !msg.media_url && msg.message_type !== 'text' && (
                  <p className="text-xs italic opacity-70">📎 {msg.message_type}</p>
                )}
                <p className={cn(
                  "text-[10px] mt-1",
                  msg.direction === 'outbound' ? "text-green-200" : "text-muted-foreground"
                )}>
                  {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t bg-card shrink-0">
        <div className="flex gap-2">
          <Textarea
            placeholder="Digite uma mensagem..."
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[44px] max-h-[120px] resize-none text-sm"
            rows={1}
          />
          <Button
            size="icon"
            className="h-11 w-11 shrink-0 bg-green-600 hover:bg-green-700"
            onClick={handleSend}
            disabled={!newMessage.trim() || sending}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
