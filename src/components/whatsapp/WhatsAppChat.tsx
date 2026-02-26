import { useState, useRef, useEffect } from 'react';
import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Send, User, Users, Link2, UserPlus, ExternalLink, Plus, Loader2, Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, X, Lock, LockOpen } from 'lucide-react';
import { WhatsAppLeadPreview } from './WhatsAppLeadPreview';
import { WhatsAppCallRecorder } from './WhatsAppCallRecorder';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuthContext } from '@/contexts/AuthContext';

const TREATMENT_OPTIONS = ['', 'Dr.', 'Dra.', 'Sr.', 'Sra.', 'Prof.', 'Profa.'];
const NAME_FORMAT_OPTIONS = [
  { value: 'full', label: 'Nome completo' },
  { value: 'first', label: 'Primeiro nome' },
  { value: 'first_last', label: 'Primeiro e último' },
  { value: 'nickname', label: 'Apelido' },
];

interface Props {
  conversation: WhatsAppConversation;
  onSendMessage: (
    phone: string,
    message: string,
    contactId?: string,
    leadId?: string,
    conversationInstanceName?: string | null,
    identifySender?: boolean,
    chatId?: string,
    treatmentOverride?: string | null,
    nameFormatOverride?: string,
    nicknameOverride?: string | null
  ) => Promise<boolean>;
  onLinkToLead: (phone: string, leadId: string) => void;
  onLinkToContact: (phone: string, contactId: string) => void;
  onCreateLead: () => void;
  onCreateContact: () => void;
  onCreateActivity?: (leadId: string, leadName: string, contactId?: string, contactName?: string) => void;
  onNavigateToLead?: (leadId: string) => void;
  onViewContact?: (contactId: string) => void;
  onPrivacyChanged?: () => void;
}

export function WhatsAppChat({ conversation, onSendMessage, onLinkToLead, onLinkToContact, onCreateLead, onCreateContact, onCreateActivity, onNavigateToLead, onViewContact, onPrivacyChanged }: Props) {
  const { profile } = useAuthContext();
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [leads, setLeads] = useState<Array<{ id: string; lead_name: string | null }>>([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [selectedRelationship, setSelectedRelationship] = useState('');
  const [callRecords, setCallRecords] = useState<any[]>([]);
  const [identifySender, setIdentifySender] = useState(true);
  const [treatmentTitle, setTreatmentTitle] = useState<string>('');
  const [nameFormat, setNameFormat] = useState<string>('first_last');
  const [nicknames, setNicknames] = useState<string[]>([]);
  const [selectedNickname, setSelectedNickname] = useState<string>('');
  const [newNickname, setNewNickname] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [togglingPrivate, setTogglingPrivate] = useState(false);
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = [...conversation.messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // Detect if this is a group conversation
  const isGroup = messages.some(msg => {
    const meta = msg.metadata;
    if (!meta) return false;
    // UazAPI: chat.wa_isGroup or message.isGroup or chatid contains @g.us
    return meta?.chat?.wa_isGroup === true 
      || meta?.message?.isGroup === true 
      || (meta?.chat?.wa_chatid || '').includes('@g.us');
  });

  // Extract sender info from group message metadata (UazAPI format)
  const getGroupSenderInfo = (msg: any): { name: string | null; phone: string | null } => {
    const meta = msg.metadata;
    if (!meta || msg.direction === 'outbound') return { name: null, phone: null };
    
    // UazAPI: sender phone is in message.sender_pn (e.g. "5588...@s.whatsapp.net")
    const senderPn = meta?.message?.sender_pn || meta?.sender_pn || '';
    const senderPhone = senderPn.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    
    // UazAPI: sender name is in message.senderName or message.groupName is the group name
    const senderName = meta?.message?.senderName || meta?.senderName || meta?.chat?.pushName || null;
    
    return { name: senderName, phone: senderPhone || null };
  };

  // Extract unique group participants from messages metadata
  const groupParticipants = isGroup ? (() => {
    const participantMap = new Map<string, string>();
    for (const msg of messages) {
      const meta = msg.metadata;
      if (!meta) continue;
      
      if (msg.direction === 'inbound') {
        const { name, phone } = getGroupSenderInfo(msg);
        if (phone && !participantMap.has(phone)) {
          participantMap.set(phone, name || phone);
        }
      } else {
        // Outbound: owner phone
        const ownerPhone = (meta?.owner || meta?.message?.owner || '').replace(/\D/g, '');
        if (ownerPhone && !participantMap.has(ownerPhone)) {
          participantMap.set(ownerPhone, 'Você');
        }
      }
    }
    return Array.from(participantMap.entries()).map(([phone, name]) => ({ phone, name })).sort((a, b) => a.name.localeCompare(b.name));
  })() : [];

  // Color assignment for group senders
  const senderColors = ['text-blue-600', 'text-emerald-600', 'text-purple-600', 'text-orange-600', 'text-pink-600', 'text-teal-600', 'text-amber-600', 'text-indigo-600'];
  const getSenderColor = (phone: string) => {
    let hash = 0;
    for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
    return senderColors[Math.abs(hash) % senderColors.length];
  };

  useEffect(() => {
    const storageKey = `wa-identify-sender:${conversation.phone}`;
    const savedPreference = localStorage.getItem(storageKey);
    setIdentifySender(savedPreference !== 'false');

    const treatmentKey = `wa-treatment:${conversation.phone}`;
    const savedTreatment = localStorage.getItem(treatmentKey);
    // Default treatment: Dr. for male, Dra. for female, based on profile gender
    const profileGender = (profile as any)?.gender;
    const defaultTreatment = profileGender === 'female' ? 'Dra.' : profileGender === 'male' ? 'Dr.' : '';
    setTreatmentTitle(savedTreatment ?? defaultTreatment);

    const nameFormatKey = `wa-name-format:${conversation.phone}`;
    const savedFormat = localStorage.getItem(nameFormatKey);
    setNameFormat(savedFormat || 'first_last');

    // Load nicknames list (global) and selected nickname (per conversation)
    const nicknamesKey = `wa-nicknames`;
    const savedNicknames = localStorage.getItem(nicknamesKey);
    setNicknames(savedNicknames ? JSON.parse(savedNicknames) : []);

    const selectedNicknameKey = `wa-selected-nickname:${conversation.phone}`;
    const savedSelectedNickname = localStorage.getItem(selectedNicknameKey);
    setSelectedNickname(savedSelectedNickname || '');
  }, [conversation.phone, profile]);

  // Check if conversation is private
  useEffect(() => {
    if (!conversation.phone || !conversation.instance_name) return;
    const checkPrivate = async () => {
      const { data } = await supabase
        .from('whatsapp_private_conversations')
        .select('id')
        .eq('phone', conversation.phone)
        .eq('instance_name', conversation.instance_name)
        .maybeSingle();
      setIsPrivate(!!data);
    };
    checkPrivate();
  }, [conversation.phone, conversation.instance_name]);

  const handleTogglePrivate = async () => {
    if (!conversation.instance_name) return;
    setTogglingPrivate(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return;
      
      if (isPrivate) {
        await supabase.from('whatsapp_private_conversations')
          .delete()
          .eq('phone', conversation.phone)
          .eq('instance_name', conversation.instance_name);
        setIsPrivate(false);
        toast.success('Conversa tornada pública');
      } else {
        await supabase.from('whatsapp_private_conversations')
          .insert({ phone: conversation.phone, instance_name: conversation.instance_name, private_by: currentUser.id });
        setIsPrivate(true);
        toast.success('Conversa marcada como privada');
      }
      onPrivacyChanged?.();
    } catch (e) {
      toast.error('Erro ao alterar privacidade');
    } finally {
      setTogglingPrivate(false);
    }
  };

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

  const handleToggleIdentifySender = (checked: boolean) => {
    setIdentifySender(checked);
    const storageKey = `wa-identify-sender:${conversation.phone}`;
    localStorage.setItem(storageKey, checked ? 'true' : 'false');
  };

  const handleTreatmentChange = (value: string) => {
    const v = value === 'none' ? '' : value;
    setTreatmentTitle(v);
    const treatmentKey = `wa-treatment:${conversation.phone}`;
    localStorage.setItem(treatmentKey, v);
  };

  const handleNameFormatChange = (value: string) => {
    setNameFormat(value);
    const nameFormatKey = `wa-name-format:${conversation.phone}`;
    localStorage.setItem(nameFormatKey, value);
  };

  const handleAddNickname = () => {
    const trimmed = newNickname.trim();
    if (!trimmed || nicknames.includes(trimmed)) return;
    const updated = [...nicknames, trimmed];
    setNicknames(updated);
    localStorage.setItem('wa-nicknames', JSON.stringify(updated));
    setSelectedNickname(trimmed);
    localStorage.setItem(`wa-selected-nickname:${conversation.phone}`, trimmed);
    setNewNickname('');
  };

  const handleRemoveNickname = (nick: string) => {
    const updated = nicknames.filter(n => n !== nick);
    setNicknames(updated);
    localStorage.setItem('wa-nicknames', JSON.stringify(updated));
    if (selectedNickname === nick) {
      setSelectedNickname(updated[0] || '');
      localStorage.setItem(`wa-selected-nickname:${conversation.phone}`, updated[0] || '');
    }
  };

  const handleSelectNickname = (value: string) => {
    setSelectedNickname(value);
    localStorage.setItem(`wa-selected-nickname:${conversation.phone}`, value);
  };

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;

    const conversationChatId =
      conversation.messages.find((msg) => typeof msg.metadata?.chat?.wa_chatid === 'string')?.metadata?.chat?.wa_chatid ||
      conversation.messages.find((msg) => typeof msg.metadata?.message?.chatid === 'string')?.metadata?.message?.chatid;

    setSending(true);
    try {
      const success = await onSendMessage(
        conversation.phone,
        newMessage.trim(),
        conversation.contact_id || undefined,
        conversation.lead_id || undefined,
        conversation.instance_name,
        identifySender,
        conversationChatId,
        nameFormat === 'nickname' ? null : (treatmentTitle || null),
        nameFormat,
        nameFormat === 'nickname' ? (selectedNickname || null) : null
      );
      if (success) setNewMessage('');
    } catch (err) {
      console.error('handleSend error:', err);
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

  const fetchLeads = async () => {
    const { data } = await supabase
      .from('leads')
      .select('id, lead_name')
      .order('created_at', { ascending: false })
      .limit(100);
    setLeads(data || []);
  };

  const handleLinkLead = async () => {
    if (selectedLeadId) {
      onLinkToLead(conversation.phone, selectedLeadId);
      
      // If there's a contact linked, also create contact_leads bridge with relationship
      if (conversation.contact_id && selectedRelationship) {
        try {
          // Check if bridge already exists
          const { data: existing } = await supabase
            .from('contact_leads')
            .select('id')
            .eq('contact_id', conversation.contact_id)
            .eq('lead_id', selectedLeadId)
            .maybeSingle();
          
          if (existing) {
            await supabase.from('contact_leads')
              .update({ relationship_to_victim: selectedRelationship } as any)
              .eq('id', existing.id);
          } else {
            await supabase.from('contact_leads').insert({
              contact_id: conversation.contact_id,
              lead_id: selectedLeadId,
              relationship_to_victim: selectedRelationship,
            } as any);
          }
        } catch (e) {
          console.error('Error linking contact to lead:', e);
        }
      }
      
      setShowLinkDialog(false);
      setSelectedLeadId('');
      setSelectedRelationship('');
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
                    {conversation.contact_id && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Relação com a vítima</label>
                        <Select value={selectedRelationship} onValueChange={setSelectedRelationship}>
                          <SelectTrigger><SelectValue placeholder="Selecione a relação..." /></SelectTrigger>
                          <SelectContent>
                            {['Vítima', 'Cônjuge', 'Pai/Mãe', 'Filho(a)', 'Irmão(ã)', 'Familiar', 'Amigo(a)', 'Colega de Trabalho', 'Advogado(a)', 'Testemunha', 'Responsável', 'Outro'].map(r => (
                              <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
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
            instanceName={conversation.instance_name}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isPrivate ? "default" : "outline"}
                size="icon"
                className="h-8 w-8"
                onClick={handleTogglePrivate}
                disabled={togglingPrivate}
              >
                {isPrivate ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isPrivate ? 'Conversa privada (clique para tornar pública)' : 'Tornar conversa privada'}
            </TooltipContent>
          </Tooltip>
          {isGroup && (
            <Dialog open={showGroupMembers} onOpenChange={setShowGroupMembers}>
              <DialogTrigger asChild>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8">
                      <Users className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Membros do grupo ({groupParticipants.length})</TooltipContent>
                </Tooltip>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Membros do grupo ({groupParticipants.length})
                  </DialogTitle>
                </DialogHeader>
                <div className="max-h-[400px] overflow-y-auto space-y-1">
                  {groupParticipants.map(p => (
                    <div key={p.phone} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50">
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{formatPhone(p.phone)}</p>
                      </div>
                    </div>
                  ))}
                  {groupParticipants.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Nenhum participante identificado nas mensagens.
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          )}
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
                {/* Group sender name */}
                {isGroup && msg.direction === 'inbound' && (() => {
                  const sender = getGroupSenderInfo(msg);
                  if (!sender.phone && !sender.name) return null;
                  return (
                    <p className={cn("text-[11px] font-semibold mb-0.5", sender.phone ? getSenderColor(sender.phone) : 'text-primary')}>
                      {sender.name || formatPhone(sender.phone || '')}
                      {sender.name && sender.phone && (
                        <span className="font-normal text-muted-foreground ml-1">~{formatPhone(sender.phone)}</span>
                      )}
                    </p>
                  );
                })()}
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
      <div className="p-3 border-t bg-card shrink-0 space-y-2">
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {identifySender && (
            <>
              <Select value={nameFormat} onValueChange={handleNameFormatChange}>
                <SelectTrigger className="h-7 w-[130px] text-xs">
                  <SelectValue placeholder="Nome" />
                </SelectTrigger>
                <SelectContent>
                  {NAME_FORMAT_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {nameFormat === 'nickname' ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1 max-w-[150px]">
                      <User className="h-3 w-3 shrink-0" />
                      <span className="truncate">{selectedNickname || 'Escolher apelido'}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3 space-y-3" align="end">
                    <p className="text-xs font-medium">Apelidos cadastrados</p>
                    {nicknames.length > 0 ? (
                      <div className="space-y-1 max-h-[120px] overflow-y-auto">
                        {nicknames.map(nick => (
                          <div key={nick} className="flex items-center justify-between gap-1">
                            <Button
                              variant={selectedNickname === nick ? "default" : "ghost"}
                              size="sm"
                              className="flex-1 justify-start h-7 text-xs"
                              onClick={() => handleSelectNickname(nick)}
                            >
                              {nick}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveNickname(nick)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Nenhum apelido cadastrado</p>
                    )}
                    <div className="flex gap-1">
                      <Input
                        placeholder="Novo apelido..."
                        value={newNickname}
                        onChange={e => setNewNickname(e.target.value)}
                        className="h-7 text-xs"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddNickname(); } }}
                      />
                      <Button size="sm" className="h-7 text-xs px-2" onClick={handleAddNickname} disabled={!newNickname.trim()}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                <Select value={treatmentTitle || 'none'} onValueChange={handleTreatmentChange}>
                  <SelectTrigger className="h-7 w-[100px] text-xs">
                    <SelectValue placeholder="Título" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem título</SelectItem>
                    {TREATMENT_OPTIONS.filter(t => t).map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}
          <Label htmlFor="identify-sender" className="text-xs text-muted-foreground cursor-pointer">
            Identificar remetente
          </Label>
          <Switch
            id="identify-sender"
            checked={identifySender}
            onCheckedChange={handleToggleIdentifySender}
          />
        </div>
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
