import { useState, useRef, useEffect } from 'react';
import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Send, User, Link2, UserPlus, ExternalLink } from 'lucide-react';
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
}

export function WhatsAppChat({ conversation, onSendMessage, onLinkToLead, onLinkToContact }: Props) {
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [leads, setLeads] = useState<Array<{ id: string; lead_name: string | null }>>([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = [...conversation.messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

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

  const handleCreateContactAndLink = async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data: newContact, error } = await supabase
        .from('contacts')
        .insert({
          full_name: conversation.contact_name || `WhatsApp ${conversation.phone}`,
          phone: conversation.phone,
          created_by: currentUser?.id || null,
        })
        .select()
        .single();

      if (error) throw error;
      onLinkToContact(conversation.phone, newContact.id);
      toast.success('Contato criado e vinculado!');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao criar contato');
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
          )}
          {!conversation.contact_id && (
            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={handleCreateContactAndLink}>
              <UserPlus className="h-3 w-3" /> Criar Contato
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/10">
        {messages.map(msg => (
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
              {msg.media_url && (
                <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs underline mb-1">
                  <ExternalLink className="h-3 w-3" /> {msg.media_type || 'Mídia'}
                </a>
              )}
              {msg.message_text && <p className="whitespace-pre-wrap">{msg.message_text}</p>}
              <p className={cn(
                "text-[10px] mt-1",
                msg.direction === 'outbound' ? "text-green-200" : "text-muted-foreground"
              )}>
                {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
              </p>
            </div>
          </div>
        ))}
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
