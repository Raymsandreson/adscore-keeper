import { useState, useRef, useEffect } from 'react';
import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, User, Link2, UserPlus, ExternalLink, Plus, Loader2, Phone, Mail, Instagram, MapPin, FileText } from 'lucide-react';
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

  // Create Lead Sheet
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [leadForm, setLeadForm] = useState({
    lead_name: '',
    source: 'whatsapp',
    news_link: '',
    notes: '',
  });

  // Create Contact Sheet
  const [showCreateContact, setShowCreateContact] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [contactForm, setContactForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    instagram_username: '',
    city: '',
    state: '',
    notes: '',
  });

  const messages = [...conversation.messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Pre-fill contact form when opening
  useEffect(() => {
    if (showCreateContact) {
      setContactForm({
        full_name: conversation.contact_name || '',
        phone: conversation.phone,
        email: '',
        instagram_username: '',
        city: '',
        state: '',
        notes: '',
      });
    }
  }, [showCreateContact, conversation]);

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

  const handleCreateLead = async () => {
    if (!leadForm.lead_name.trim()) {
      toast.error('Nome do lead é obrigatório');
      return;
    }
    setCreatingLead(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('leads')
        .insert({
          lead_name: leadForm.lead_name.trim(),
          source: leadForm.source || 'whatsapp',
          news_link: leadForm.news_link.trim() || null,
          notes: leadForm.notes.trim() || null,
          created_by: currentUser?.id || null,
        })
        .select('id')
        .single();

      if (error) throw error;

      onLinkToLead(conversation.phone, data.id);
      toast.success('Lead criado e vinculado!');
      setShowCreateLead(false);
      setLeadForm({ lead_name: '', source: 'whatsapp', news_link: '', notes: '' });
    } catch (e) {
      console.error(e);
      toast.error('Erro ao criar lead');
    } finally {
      setCreatingLead(false);
    }
  };

  const handleCreateContact = async () => {
    if (!contactForm.full_name.trim()) {
      toast.error('Nome do contato é obrigatório');
      return;
    }
    setCreatingContact(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const igUsername = contactForm.instagram_username.trim();
      const { data: newContact, error } = await supabase
        .from('contacts')
        .insert({
          full_name: contactForm.full_name.trim(),
          phone: contactForm.phone.trim() || null,
          email: contactForm.email.trim() || null,
          instagram_username: igUsername ? (igUsername.startsWith('@') ? igUsername : `@${igUsername}`) : null,
          city: contactForm.city.trim() || null,
          state: contactForm.state.trim() || null,
          notes: contactForm.notes.trim() || null,
          created_by: currentUser?.id || null,
        })
        .select('id')
        .single();

      if (error) throw error;

      onLinkToContact(conversation.phone, newContact.id);
      toast.success('Contato criado e vinculado!');
      setShowCreateContact(false);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao criar contato');
    } finally {
      setCreatingContact(false);
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
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setShowCreateLead(true)}>
                <Plus className="h-3 w-3" /> Criar Lead
              </Button>
            </>
          )}
          {!conversation.contact_id && (
            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setShowCreateContact(true)}>
              <UserPlus className="h-3 w-3" /> Criar Contato
            </Button>
          )}
        </div>
      </div>

      {/* Create Lead Sheet */}
      <Sheet open={showCreateLead} onOpenChange={setShowCreateLead}>
        <SheetContent className="w-[400px] sm:w-[450px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" /> Criar Novo Lead
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-120px)] mt-4">
            <div className="space-y-4 pr-4">
              <div className="space-y-2">
                <Label htmlFor="lead-name">Nome do Lead *</Label>
                <Input
                  id="lead-name"
                  placeholder="Nome do lead"
                  value={leadForm.lead_name}
                  onChange={e => setLeadForm(f => ({ ...f, lead_name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lead-source">Origem</Label>
                <Select value={leadForm.source} onValueChange={v => setLeadForm(f => ({ ...f, source: v }))}>
                  <SelectTrigger id="lead-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="indicacao">Indicação</SelectItem>
                    <SelectItem value="site">Site</SelectItem>
                    <SelectItem value="telefone">Telefone</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="lead-link">Link / Referência</Label>
                <Input
                  id="lead-link"
                  placeholder="URL ou referência"
                  value={leadForm.news_link}
                  onChange={e => setLeadForm(f => ({ ...f, news_link: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lead-notes">Observações</Label>
                <Textarea
                  id="lead-notes"
                  placeholder="Anotações sobre o lead..."
                  value={leadForm.notes}
                  onChange={e => setLeadForm(f => ({ ...f, notes: e.target.value }))}
                  rows={4}
                />
              </div>

              <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
                <p>O lead será criado e vinculado automaticamente a esta conversa.</p>
              </div>

              <Button
                className="w-full"
                onClick={handleCreateLead}
                disabled={!leadForm.lead_name.trim() || creatingLead}
              >
                {creatingLead ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Criar e Vincular Lead
              </Button>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Create Contact Sheet */}
      <Sheet open={showCreateContact} onOpenChange={setShowCreateContact}>
        <SheetContent className="w-[400px] sm:w-[450px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" /> Criar Novo Contato
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-120px)] mt-4">
            <div className="space-y-4 pr-4">
              <div className="space-y-2">
                <Label htmlFor="contact-name" className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" /> Nome Completo *
                </Label>
                <Input
                  id="contact-name"
                  placeholder="Nome do contato"
                  value={contactForm.full_name}
                  onChange={e => setContactForm(f => ({ ...f, full_name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact-phone" className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" /> Telefone
                </Label>
                <Input
                  id="contact-phone"
                  placeholder="(00) 00000-0000"
                  value={contactForm.phone}
                  onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact-email" className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> E-mail
                </Label>
                <Input
                  id="contact-email"
                  type="email"
                  placeholder="email@exemplo.com"
                  value={contactForm.email}
                  onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact-instagram" className="flex items-center gap-1.5">
                  <Instagram className="h-3.5 w-3.5" /> Instagram
                </Label>
                <Input
                  id="contact-instagram"
                  placeholder="@usuario"
                  value={contactForm.instagram_username}
                  onChange={e => setContactForm(f => ({ ...f, instagram_username: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="contact-city" className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> Cidade
                  </Label>
                  <Input
                    id="contact-city"
                    placeholder="Cidade"
                    value={contactForm.city}
                    onChange={e => setContactForm(f => ({ ...f, city: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-state">Estado</Label>
                  <Input
                    id="contact-state"
                    placeholder="UF"
                    value={contactForm.state}
                    onChange={e => setContactForm(f => ({ ...f, state: e.target.value }))}
                    maxLength={2}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact-notes" className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Observações
                </Label>
                <Textarea
                  id="contact-notes"
                  placeholder="Anotações sobre o contato..."
                  value={contactForm.notes}
                  onChange={e => setContactForm(f => ({ ...f, notes: e.target.value }))}
                  rows={4}
                />
              </div>

              <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
                <p>O contato será criado e vinculado automaticamente a esta conversa.</p>
              </div>

              <Button
                className="w-full"
                onClick={handleCreateContact}
                disabled={!contactForm.full_name.trim() || creatingContact}
              >
                {creatingContact ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
                Criar e Vincular Contato
              </Button>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

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
