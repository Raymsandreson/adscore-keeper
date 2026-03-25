import { useState, useEffect, useRef } from 'react'; // force rebuild
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  User,
  Phone,
  Mail,
  Instagram,
  MapPin,
  Edit,
  Save,
  X,
  ExternalLink,
  Users,
  Link2,
  MessageSquare,
  Calendar,
  History,
  Tag,
  FileText,
  Globe,
  Mic,
  CheckCircle,
  XCircle,
  Trash2,
} from 'lucide-react';
import { WhatsAppCallRecorder } from '@/components/whatsapp/WhatsAppCallRecorder';
import { Contact } from '@/hooks/useContacts';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { useContactRelationships } from '@/hooks/useContactRelationships';
import { useContactLeads, ContactLead } from '@/hooks/useContactLeads';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useCboProfessions } from '@/hooks/useCboProfessions';
import { useProfileNames } from '@/hooks/useProfileNames';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { MultiClassificationSelect } from './MultiClassificationSelect';
import { ContactInteractionHistory } from './ContactInteractionHistory';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Briefcase, Scale } from 'lucide-react';
import { ShareMenu } from '@/components/ShareMenu';
import { CopyableText } from '@/components/ui/copyable-text';
import { TeamChatButton } from '@/components/chat/TeamChatButton';
import { EntityAIChat } from '@/components/activities/EntityAIChat';
import { ContactCallHistory } from './ContactCallHistory';
import { Sparkles, PhoneCall } from 'lucide-react';
import { findClosedStageId, findRefusedStageId } from '@/utils/kanbanStageTypes';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import type { Lead } from '@/hooks/useLeads';

interface ContactDetailSheetProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContactUpdated?: () => void;
  mode?: 'sheet' | 'dialog';
}

// ViaCEP integration
async function fetchAddressFromCep(cep: string): Promise<{
  street: string;
  neighborhood: string;
  city: string;
  state: string;
} | null> {
  try {
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length !== 8) return null;
    
    const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
    const data = await response.json();
    
    if (data.erro) return null;
    
    return {
      street: data.logradouro || '',
      neighborhood: data.bairro || '',
      city: data.localidade || '',
      state: data.uf || '',
    };
  } catch (error) {
    console.error('Error fetching address from CEP:', error);
    return null;
  }
}

export function ContactDetailSheet({
  contact,
  open,
  onOpenChange,
  onContactUpdated,
  mode = 'sheet',
}: ContactDetailSheetProps) {
  const [isEditing, setIsEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Edit form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [instagramUsername, setInstagramUsername] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [street, setStreet] = useState('');
  const [cep, setCep] = useState('');
  const [notes, setNotes] = useState('');
  const [classifications, setClassifications] = useState<string[]>([]);
  const [followerStatus, setFollowerStatus] = useState<string>('none');
  const [profession, setProfession] = useState('');
  const [professionCboCode, setProfessionCboCode] = useState('');
  const [professionSearch, setProfessionSearch] = useState('');
  const [filteredProfessions, setFilteredProfessions] = useState<any[]>([]);
  const [whatsappGroupId, setWhatsappGroupId] = useState('');

  // Hooks
  const { classifications: availableClassifications } = useContactClassifications();
  const { relationships, loading: loadingRelationships } = useContactRelationships(contact?.id);
  const { leads: contactLeads, loading: loadingLeads, unlinkLead, fetchLeads: refetchLeads } = useContactLeads(contact?.id);
  const { states, cities, fetchCities } = useBrazilianLocations();
  const { professions, searchProfessions } = useCboProfessions();
  const { fetchProfileNames, getDisplayName } = useProfileNames();
  const { boards: kanbanBoards } = useKanbanBoards();

  // State for auto lead creation when classified as client
  const [showClientLeadDialog, setShowClientLeadDialog] = useState(false);
  const [clientLeadBoardId, setClientLeadBoardId] = useState('');
  const [clientLeadOutcome, setClientLeadOutcome] = useState<'closed' | 'refused'>('closed');
  const [clientLeadDate, setClientLeadDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [creatingClientLead, setCreatingClientLead] = useState(false);
  const [clientLeadMode, setClientLeadMode] = useState<'create' | 'link'>('create');
  const [existingLeadSearch, setExistingLeadSearch] = useState('');
  const [existingLeads, setExistingLeads] = useState<any[]>([]);
  const [selectedExistingLeadId, setSelectedExistingLeadId] = useState('');
  const previousClassificationsRef = useRef<string[]>([]);
  const [linkedProcesses, setLinkedProcesses] = useState<any[]>([]);
  
  // State for full LeadEditDialog when creating new lead
  const [showLeadEditDialog, setShowLeadEditDialog] = useState(false);
  const [newCreatedLead, setNewCreatedLead] = useState<Lead | null>(null);

  // Load contact data
  useEffect(() => {
    if (contact && open) {
      setFullName(contact.full_name || '');
      setPhone(contact.phone || '');
      setEmail(contact.email || '');
      setInstagramUsername(contact.instagram_username || '');
      setCity(contact.city || '');
      setState(contact.state || '');
      setNeighborhood(contact.neighborhood || '');
      setStreet(contact.street || '');
      setCep(contact.cep || '');
      setNotes(contact.notes || '');
      const contactClassifications = contact.classifications || [];
      setClassifications(contactClassifications);
      previousClassificationsRef.current = contactClassifications;
      setFollowerStatus(contact.follower_status || 'none');
      setProfession((contact as any).profession || '');
      setProfessionCboCode((contact as any).profession_cbo_code || '');
      setProfessionSearch((contact as any).profession || '');
      setWhatsappGroupId((contact as any).whatsapp_group_id || '');
      setIsEditing(true);
      
      // Fetch profile name for created_by
      const contactAny = contact as any;
      if (contactAny.created_by) {
        fetchProfileNames([contactAny.created_by]);
      }
    }
  }, [contact, open]);

  // Fetch linked cases/processes
  useEffect(() => {
    if (contact?.id && open) {
      (async () => {
        const { data } = await supabase
          .from('process_parties')
          .select('role, notes, lead_processes(id, process_number, polo_ativo, polo_passivo, status, case_id, legal_cases(case_number, title))')
          .eq('contact_id', contact.id);
        setLinkedProcesses((data || []).filter((d: any) => d.lead_processes).map((d: any) => ({
          role: d.role,
          roleNotes: d.notes,
          ...d.lead_processes,
          case_number: d.lead_processes?.legal_cases?.case_number,
          case_title: d.lead_processes?.legal_cases?.title,
        })));
      })();
    }
  }, [contact?.id, open]);

  // Search professions when typing
  useEffect(() => {
    const search = async () => {
      if (professionSearch.length >= 2) {
        const results = await searchProfessions(professionSearch);
        setFilteredProfessions(results);
      } else {
        setFilteredProfessions(professions.slice(0, 20));
      }
    };
    search();
  }, [professionSearch, professions, searchProfessions]);

  // Fetch cities when state changes
  useEffect(() => {
    if (state) {
      fetchCities(state);
    }
  }, [state, fetchCities]);

  const handleCepChange = async (newCep: string) => {
    setCep(newCep);
    if (newCep.replace(/\D/g, '').length === 8) {
      const address = await fetchAddressFromCep(newCep);
      if (address) {
        setStreet(address.street);
        setNeighborhood(address.neighborhood);
        setCity(address.city);
        setState(address.state);
      }
    }
  };

  const handleSave = async () => {
    if (!contact) return;
    if (!fullName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setSaving(true);
    try {
      // Resolve WhatsApp group link to JID if it's a link
      let resolvedGroupId = whatsappGroupId || null;
      if (whatsappGroupId && whatsappGroupId.includes('chat.whatsapp.com')) {
        try {
          const { data: resolveData } = await supabase.functions.invoke('send-whatsapp', {
            body: { action: 'resolve_group_link', group_link: whatsappGroupId },
          });
          if (resolveData?.success && resolveData.group_id) {
            resolvedGroupId = resolveData.group_id;
            setWhatsappGroupId(resolvedGroupId);
            toast.success(`Grupo identificado: ${resolveData.group_name || resolveData.group_id}`);
          } else {
            toast.error(resolveData?.error || 'Não foi possível resolver o link do grupo');
            setSaving(false);
            return;
          }
        } catch (e) {
          toast.error('Erro ao resolver link do grupo');
          setSaving(false);
          return;
        }
      }

      const { error } = await supabase
        .from('contacts')
        .update({
          full_name: fullName.trim(),
          phone: phone || null,
          email: email || null,
          instagram_username: instagramUsername || null,
          city: city || null,
          state: state || null,
          neighborhood: neighborhood || null,
          street: street || null,
          cep: cep || null,
          notes: notes || null,
          classifications: classifications.length > 0 ? classifications : null,
          follower_status: followerStatus || 'none',
          profession: profession || null,
          profession_cbo_code: professionCboCode || null,
          whatsapp_group_id: resolvedGroupId,
        })
        .eq('id', contact.id);

      if (error) throw error;

      toast.success('Contato atualizado com sucesso!');
      onContactUpdated?.();
    } catch (error) {
      console.error('Error updating contact:', error);
      toast.error('Erro ao salvar contato');
    } finally {
      setSaving(false);
    }
  };

  // Handle classification change - detect when "client" is added
  const handleClassificationsChange = (newClassifications: string[]) => {
    const wasClient = previousClassificationsRef.current.includes('client');
    const isNowClient = newClassifications.includes('client');
    
    setClassifications(newClassifications);
    previousClassificationsRef.current = newClassifications;
    
    // If "client" was just added, open lead creation dialog
    if (!wasClient && isNowClient && contact) {
      const defaultBoard = kanbanBoards.find(b => b.is_default) || kanbanBoards[0];
      if (defaultBoard) {
        setClientLeadBoardId(defaultBoard.id);
      }
      setClientLeadOutcome('closed');
      setClientLeadDate(format(new Date(), 'yyyy-MM-dd'));
      setClientLeadMode(contactLeads.length > 0 ? 'link' : 'create');
      setSelectedExistingLeadId('');
      setExistingLeadSearch('');
      setShowClientLeadDialog(true);
    }
  };

  // Search existing leads
  useEffect(() => {
    const searchLeads = async () => {
      if (clientLeadMode !== 'link') return;
      try {
        let query = supabase.from('leads').select('id, lead_name, board_id, status, created_at').order('created_at', { ascending: false }).limit(20);
        if (existingLeadSearch.trim()) {
          query = query.ilike('lead_name', `%${existingLeadSearch.trim()}%`);
        }
        const { data } = await query;
        setExistingLeads(data || []);
      } catch (e) {
        console.error('Error searching leads:', e);
      }
    };
    searchLeads();
  }, [clientLeadMode, existingLeadSearch]);

  // Create or link lead for client contact
  const handleCreateClientLead = async () => {
    if (!contact) return;
    
    setCreatingClientLead(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (clientLeadMode === 'link') {
        // Link existing lead
        if (!selectedExistingLeadId) {
          toast.error('Selecione um lead existente');
          setCreatingClientLead(false);
          return;
        }

        // Update existing lead with client outcome
        const updates: Record<string, any> = {
          client_classification: clientLeadOutcome === 'closed' ? 'client' : null,
          updated_by: currentUser?.id || null,
        };
        if (clientLeadOutcome === 'closed') {
          updates.became_client_date = clientLeadDate;
        } else {
          updates.classification_date = clientLeadDate;
        }

        // Find & set the terminal stage if board is known
        const existingLead = existingLeads.find(l => l.id === selectedExistingLeadId);
        if (existingLead?.board_id) {
          const board = kanbanBoards.find(b => b.id === existingLead.board_id);
          if (board) {
            const stageId = clientLeadOutcome === 'closed' ? findClosedStageId(board.stages) : findRefusedStageId(board.stages);
            if (stageId) updates.status = stageId;
          }
        }

        await supabase.from('leads').update(updates).eq('id', selectedExistingLeadId);

        // Create link if not already linked
        const { data: existingLink } = await supabase.from('contact_leads')
          .select('id').eq('contact_id', contact.id).eq('lead_id', selectedExistingLeadId).maybeSingle();
        if (!existingLink) {
          await supabase.from('contact_leads').insert({ contact_id: contact.id, lead_id: selectedExistingLeadId });
        }

        await supabase.from('contacts').update({
          lead_id: selectedExistingLeadId,
          converted_to_lead_at: new Date().toISOString(),
        }).eq('id', contact.id);

        toast.success(`Lead vinculado como ${clientLeadOutcome === 'closed' ? 'Fechado' : 'Recusado'}`);
      } else {
        // Create new lead — open full LeadEditDialog
        if (!clientLeadBoardId) {
          toast.error('Selecione um funil');
          setCreatingClientLead(false);
          return;
        }

        const board = kanbanBoards.find(b => b.id === clientLeadBoardId);
        if (!board) throw new Error('Funil não encontrado');
        
        const closedStageId = findClosedStageId(board.stages);
        const refusedStageId = findRefusedStageId(board.stages);
        
        const targetStageId = clientLeadOutcome === 'closed' ? closedStageId : refusedStageId;
        if (!targetStageId) {
          toast.error(`Estágio "${clientLeadOutcome === 'closed' ? 'Fechado' : 'Recusado'}" não encontrado neste funil`);
          setCreatingClientLead(false);
          return;
        }

        const { data: leadResult, error: leadError } = await supabase
          .from('leads')
          .insert({
            lead_name: contact.full_name,
            lead_phone: contact.phone,
            lead_email: contact.email,
            instagram_username: contact.instagram_username,
            source: 'contact_client',
            status: targetStageId,
            board_id: clientLeadBoardId,
            client_classification: clientLeadOutcome === 'closed' ? 'client' : null,
            became_client_date: clientLeadOutcome === 'closed' ? clientLeadDate : null,
            classification_date: clientLeadOutcome === 'refused' ? clientLeadDate : null,
            city: contact.city,
            state: contact.state,
            notes: contact.notes,
            created_by: currentUser?.id || null,
          })
          .select()
          .single();

        if (leadError) throw leadError;

        await supabase.from('contact_leads').insert({
          contact_id: contact.id,
          lead_id: leadResult.id,
        });

        await supabase.from('contacts').update({
          lead_id: leadResult.id,
          converted_to_lead_at: new Date().toISOString(),
        }).eq('id', contact.id);

        // Close this dialog and open full LeadEditDialog
        setShowClientLeadDialog(false);
        setNewCreatedLead(leadResult as Lead);
        setShowLeadEditDialog(true);
        toast.success('Lead criado! Complete os dados no formulário.');
      }

      if (clientLeadMode === 'link') {
        setShowClientLeadDialog(false);
        onContactUpdated?.();
      }
    } catch (error) {
      console.error('Error creating/linking client lead:', error);
      toast.error('Erro ao processar lead');
    } finally {
      setCreatingClientLead(false);
    }
  };

  const getClassificationLabel = (name: string) => {
    const labels: Record<string, string> = {
      client: 'Cliente',
      non_client: 'Não-Cliente',
      prospect: 'Prospect',
      partner: 'Parceiro',
      supplier: 'Fornecedor',
      ponte: 'Ponte',
      ex_cliente: 'Ex-cliente',
      advogado_interno: 'Advogado Interno',
      advogado_externo: 'Advogado Externo',
      advogado_adverso: 'Advogado Adverso',
      parte_contraria: 'Parte Contrária',
      prestador_servico: 'Prestador de Serviço',
      equipe_interna: 'Equipe Interna',
    };
    return labels[name] || name.replace(/_/g, ' ');
  };

  const getClassificationColor = (name: string) => {
    const found = availableClassifications.find(c => c.name === name);
    return found?.color || 'bg-gray-500';
  };

  const followerStatusLabels: Record<string, { label: string; color: string }> = {
    follower: { label: 'Seguidor', color: 'bg-blue-500' },
    following: { label: 'Seguindo', color: 'bg-yellow-500' },
    mutual: { label: 'Mútuo', color: 'bg-green-500' },
    none: { label: 'Nenhum', color: 'bg-gray-400' },
  };

  if (!contact) return null;

  const Wrapper = mode === 'dialog' ? Dialog : Sheet;
  const Content = mode === 'dialog' ? DialogContent : SheetContent;
  const Header = mode === 'dialog' ? DialogHeader : SheetHeader;
  const Title = mode === 'dialog' ? DialogTitle : SheetTitle;

  const contentClassName = mode === 'dialog'
    ? 'max-w-lg max-h-[90vh] overflow-hidden flex flex-col'
    : 'w-full sm:max-w-lg overflow-hidden flex flex-col';

  return (
    <>
    <Wrapper open={open && !showClientLeadDialog} onOpenChange={onOpenChange}>
      <Content className={contentClassName}>
         <Header className="pb-4">
          <div className="flex items-center justify-between">
            <Title className="flex items-center gap-2 text-xl">
              <User className="h-5 w-5" />
              <CopyableText copyValue={fullName || contact.full_name} label="Nome">
                {fullName || contact.full_name}
              </CopyableText>
            </Title>
            <div className="flex items-center gap-1">
              <ShareMenu entityType="contact" entityId={contact.id} entityName={contact.full_name} />
              <TeamChatButton entityType="contact" entityId={contact.id} entityName={contact.full_name} variant="icon" className="h-8 w-8" />
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>

          {/* Quick badges */}
          <div className="flex flex-wrap gap-2 mt-2">
            {classifications.map((c) => (
              <Badge key={c} className={`${getClassificationColor(c)} text-white text-xs`}>
                <Tag className="h-3 w-3 mr-1" />
                {getClassificationLabel(c)}
              </Badge>
            ))}
            {followerStatus && followerStatus !== 'none' && (
              <Badge className={`${followerStatusLabels[followerStatus]?.color} text-white text-xs`}>
                <Instagram className="h-3 w-3 mr-1" />
                {followerStatusLabels[followerStatus]?.label}
              </Badge>
            )}
          </div>
        </Header>

        <Tabs defaultValue="info" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="info" className="text-xs px-1">
              <User className="h-3 w-3 mr-1" />
              Info
            </TabsTrigger>
            <TabsTrigger value="calls" className="text-xs px-1">
              <PhoneCall className="h-3 w-3 mr-1" />
              Chamadas
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs px-1">
              <History className="h-3 w-3 mr-1" />
              Histórico
            </TabsTrigger>
            <TabsTrigger value="location" className="text-xs px-1">
              <MapPin className="h-3 w-3 mr-1" />
              Local
            </TabsTrigger>
            <TabsTrigger value="relationships" className="text-xs px-1">
              <Users className="h-3 w-3 mr-1" />
              Vínculos
            </TabsTrigger>
            <TabsTrigger value="leads" className="text-xs px-1">
              <Link2 className="h-3 w-3 mr-1" />
              Leads
            </TabsTrigger>
            <TabsTrigger value="ai_chat" className="text-xs px-1">
              <Sparkles className="h-3 w-3 mr-1" />
              IA
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4 pr-4">
            {/* Info Tab */}
            <TabsContent value="info" className="space-y-4 mt-0">
              {/* Meta info */}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {contact.created_at && !isNaN(new Date(contact.created_at).getTime()) && (
                  <Badge variant="outline" className="gap-1">
                    <Calendar className="h-3 w-3" />
                    Criado: {format(new Date(contact.created_at), "dd/MM/yyyy", { locale: ptBR })}
                    {(() => {
                      const creatorName = getDisplayName((contact as any).created_by);
                      return creatorName ? (
                        <span className="ml-1 flex items-center gap-0.5">
                          <User className="h-3 w-3" />
                          {creatorName}
                        </span>
                      ) : null;
                    })()}
                  </Badge>
                )}
                {contact.updated_at && !isNaN(new Date(contact.updated_at).getTime()) && (
                  <Badge variant="outline" className="gap-1">
                    <History className="h-3 w-3" />
                    Atualizado: {format(new Date(contact.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </Badge>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-4">
                  <div>
                    <Label className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Nome *
                    </Label>
                    <Input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Nome completo"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        Telefone
                      </Label>
                      <div className="flex gap-1">
                        <Input
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="(00) 00000-0000"
                          className="flex-1"
                        />
                        {phone && (
                          <WhatsAppCallRecorder
                            phone={phone}
                            contactName={fullName || contact.full_name}
                            contactId={contact.id}
                            leadId={contactLeads?.[0]?.lead?.id || null}
                          />
                        )}
                      </div>
                    </div>

                    <div className="col-span-2">
                      <Label className="flex items-center gap-1">
                        👥 Grupo WhatsApp
                      </Label>
                      <Input
                        value={whatsappGroupId}
                        onChange={(e) => setWhatsappGroupId(e.target.value)}
                        placeholder="https://chat.whatsapp.com/... ou 120363xxx@g.us"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Cole o link do grupo. O ID será extraído automaticamente.</p>
                    </div>

                    <div>
                      <Label className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        Email
                      </Label>
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="email@exemplo.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="flex items-center gap-1">
                        <Instagram className="h-3 w-3" />
                        Instagram
                      </Label>
                      <Input
                        value={instagramUsername}
                        onChange={(e) => setInstagramUsername(e.target.value)}
                        placeholder="@usuario"
                      />
                    </div>

                    <div>
                      <Label>Status Seguidor</Label>
                      <Select value={followerStatus} onValueChange={setFollowerStatus}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhum</SelectItem>
                          <SelectItem value="follower">Seguidor</SelectItem>
                          <SelectItem value="following">Seguindo</SelectItem>
                          <SelectItem value="mutual">Mútuo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Profession field */}
                  <div>
                    <Label className="flex items-center gap-1">
                      <Briefcase className="h-3 w-3" />
                      Profissão (CBO)
                    </Label>
                    <div className="relative">
                      <Input
                        value={professionSearch}
                        onChange={(e) => {
                          setProfessionSearch(e.target.value);
                          if (!e.target.value) {
                            setProfession('');
                            setProfessionCboCode('');
                          }
                        }}
                        placeholder="Digite para buscar..."
                        className="mb-1"
                      />
                      {professionSearch.length >= 2 && filteredProfessions.length > 0 && (
                        <div className="absolute z-50 w-full max-h-48 overflow-y-auto border rounded-md bg-popover shadow-md">
                          {filteredProfessions.map((p) => (
                            <button
                              key={p.cbo_code}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex justify-between items-center"
                              onClick={() => {
                                setProfession(p.title);
                                setProfessionCboCode(p.cbo_code);
                                setProfessionSearch(p.title);
                                setFilteredProfessions([]);
                              }}
                            >
                              <span>{p.title}</span>
                              <span className="text-xs text-muted-foreground">{p.cbo_code}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {profession && (
                        <div className="text-xs text-muted-foreground">
                          Código CBO: {professionCboCode}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label className="flex items-center gap-1">
                      <Tag className="h-3 w-3" />
                      Relacionamento Conosco
                    </Label>
                    <MultiClassificationSelect
                      values={classifications}
                      onChange={handleClassificationsChange}
                      classifications={availableClassifications.map(c => ({
                        name: c.name,
                        color: c.color,
                        label: getClassificationLabel(c.name),
                        isSystem: c.is_system || false,
                      }))}
                      onAddNew={async (name, color) => {
                        // Simple add - just return the name as result
                        return { name };
                      }}
                    />
                  </div>

                  <div>
                    <Label className="flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      Observações
                    </Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Notas sobre o contato..."
                      rows={3}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Display mode */}
                  <div className="space-y-3">
                     {contact.phone && (
                      <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <CopyableText copyValue={contact.phone} label="Telefone" className="flex-1">
                          <a
                            href={`tel:${contact.phone?.replace(/\D/g, '').replace(/^55/, '')}`}
                            className="callface-dial hover:underline"
                            data-phone={contact.phone?.replace(/\D/g, '').replace(/^55/, '')}
                          >
                            {contact.phone}
                          </a>
                        </CopyableText>
                        <a
                          href={`tel:${contact.phone?.replace(/\D/g, '').replace(/^55/, '')}`}
                          className="callface-dial inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent"
                          data-phone={contact.phone?.replace(/\D/g, '').replace(/^55/, '')}
                          title="Ligar via CallFace"
                        >
                          <PhoneCall className="h-4 w-4 text-primary" />
                        </a>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => window.open(`https://wa.me/${contact.phone?.replace(/\D/g, '')}`, '_blank')}
                        >
                          <MessageSquare className="h-4 w-4 text-green-600" />
                        </Button>
                      </div>
                    )}

                    {contact.email && (
                      <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <CopyableText copyValue={contact.email} label="Email" className="flex-1">
                          {contact.email}
                        </CopyableText>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => window.open(`mailto:${contact.email}`, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    {contact.instagram_username && (
                      <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                        <Instagram className="h-4 w-4 text-muted-foreground" />
                        <CopyableText copyValue={`@${contact.instagram_username?.replace('@', '')}`} label="Instagram" className="flex-1 truncate">
                          @{contact.instagram_username?.replace('@', '')}
                        </CopyableText>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => window.open(`https://instagram.com/${contact.instagram_username?.replace('@', '')}`, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    {(contact as any).profession && (
                      <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                        <CopyableText copyValue={(contact as any).profession} label="Profissão" className="flex-1">
                          {(contact as any).profession}
                          {(contact as any).profession_cbo_code && (
                            <span className="text-xs text-muted-foreground ml-2">
                              (CBO: {(contact as any).profession_cbo_code})
                            </span>
                          )}
                        </CopyableText>
                      </div>
                    )}

                    {!contact.phone && !contact.email && !contact.instagram_username && !(contact as any).profession && (
                      <p className="text-sm text-muted-foreground italic">
                        Nenhuma informação de contato cadastrada
                      </p>
                    )}
                  </div>

                  {contact.notes && (
                    <>
                      <Separator />
                      <div>
                        <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                          <FileText className="h-3 w-3" />
                          Observações
                        </Label>
                        <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Calls Tab */}
            <TabsContent value="calls" className="mt-0">
              <ContactCallHistory contactId={contact.id} contactPhone={contact.phone} />
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history" className="mt-0">
              <ContactInteractionHistory instagramUsername={contact.instagram_username} />
            </TabsContent>

            {/* Location Tab */}
            <TabsContent value="location" className="space-y-4 mt-0">
              {isEditing ? (
                <div className="space-y-4">
                  <div>
                    <Label className="flex items-center gap-1">
                      <Globe className="h-3 w-3" />
                      CEP
                    </Label>
                    <Input
                      value={cep}
                      onChange={(e) => handleCepChange(e.target.value)}
                      placeholder="00000-000"
                      maxLength={9}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Preencha o CEP para autocompletar endereço
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Estado</Label>
                      <Select value={state} onValueChange={setState}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          {states.map((s) => (
                            <SelectItem key={s.sigla} value={s.sigla}>
                              {s.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Cidade</Label>
                      <Select 
                        value={city} 
                        onValueChange={setCity}
                        disabled={!state}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={state ? "Selecione..." : "Selecione o estado"} />
                        </SelectTrigger>
                        <SelectContent>
                          {cities.map((c) => (
                            <SelectItem key={c.id} value={c.nome}>
                              {c.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Bairro</Label>
                    <Input
                      value={neighborhood}
                      onChange={(e) => setNeighborhood(e.target.value)}
                      placeholder="Bairro"
                    />
                  </div>

                  <div>
                    <Label>Rua</Label>
                    <Input
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      placeholder="Rua, número..."
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {(contact.city || contact.state) && (
                    <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {[contact.city, contact.state].filter(Boolean).join(' - ')}
                      </span>
                    </div>
                  )}

                  {contact.neighborhood && (
                    <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                      <MapPin className="h-4 w-4 text-muted-foreground opacity-50" />
                      <span className="text-sm">Bairro: {contact.neighborhood}</span>
                    </div>
                  )}

                  {contact.street && (
                    <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                      <MapPin className="h-4 w-4 text-muted-foreground opacity-50" />
                      <span className="text-sm">{contact.street}</span>
                    </div>
                  )}

                  {contact.cep && (
                    <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">CEP: {contact.cep}</span>
                    </div>
                  )}

                  {!contact.city && !contact.state && !contact.neighborhood && !contact.street && !contact.cep && (
                    <p className="text-sm text-muted-foreground italic">
                      Nenhuma informação de localização cadastrada
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Relationships Tab */}
            <TabsContent value="relationships" className="space-y-4 mt-0">
              {loadingRelationships ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
                </div>
              ) : relationships.length > 0 ? (
                <div className="space-y-2">
                  {relationships.map((rel) => (
                    <div
                      key={rel.id}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                    >
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {rel.related_contact?.full_name || 'Contato desconhecido'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {rel.relationship_type}
                          {rel.isInverse && ' (inverso)'}
                        </p>
                      </div>
                      {rel.related_contact?.instagram_username && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => window.open(`https://instagram.com/${rel.related_contact?.instagram_username?.replace('@', '')}`, '_blank')}
                        >
                          <Instagram className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Users className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Nenhum vínculo cadastrado
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use a gestão de relacionamentos para adicionar vínculos
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Leads Tab */}
            <TabsContent value="leads" className="space-y-4 mt-0">
              {loadingLeads ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
                </div>
              ) : contactLeads.length > 0 ? (
                <div className="space-y-2">
                  {contactLeads.map((contactLead) => (
                    <div
                      key={contactLead.id}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={async () => {
                        if (contactLead.lead?.id) {
                          const { data } = await supabase.from('leads').select('*').eq('id', contactLead.lead.id).single();
                          if (data) {
                            setNewCreatedLead(data as Lead);
                            setShowLeadEditDialog(true);
                          }
                        }
                      }}
                    >
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {contactLead.lead?.lead_name || 'Lead sem nome'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">
                            {contactLead.lead?.status || 'N/A'}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {contactLead.lead?.lead_phone && (
                          <>
                            <a
                              href={`tel:${contactLead.lead?.lead_phone?.replace(/\D/g, '').replace(/^55/, '')}`}
                              className="callface-dial inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent"
                              data-phone={contactLead.lead?.lead_phone?.replace(/\D/g, '').replace(/^55/, '')}
                              title="Ligar via CallFace"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <PhoneCall className="h-4 w-4 text-primary" />
                            </a>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => { e.stopPropagation(); window.open(`https://wa.me/${contactLead.lead?.lead_phone?.replace(/\D/g, '')}`, '_blank'); }}
                            >
                              <MessageSquare className="h-4 w-4 text-green-600" />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm('Deseja excluir este lead? Esta ação não pode ser desfeita.')) return;
                            try {
                              // Remove link first
                              await unlinkLead(contactLead.lead_id);
                              // Delete the lead itself
                              const { error } = await supabase.from('leads').delete().eq('id', contactLead.lead_id);
                              if (error) throw error;
                              toast.success('Lead excluído');
                              refetchLeads();
                            } catch (err) {
                              console.error(err);
                              toast.error('Erro ao excluir lead');
                            }
                          }}
                          title="Excluir lead"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Link2 className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Nenhum lead vinculado
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Vincule leads a este contato através do gerenciador
                  </p>
                </div>
              )}

              {/* Linked Cases/Processes */}
              {linkedProcesses.length > 0 && (
                <div className="space-y-2 pt-4 border-t">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <Scale className="h-4 w-4" />
                    Casos e Processos ({linkedProcesses.length})
                  </h4>
                  {linkedProcesses.map((proc: any, i: number) => (
                    <div key={i} className="p-2.5 rounded-lg border bg-card text-xs space-y-1">
                      {proc.case_number && (
                        <p className="font-medium text-sm">{proc.case_number} — {proc.case_title}</p>
                      )}
                      {proc.process_number && (
                        <p className="text-muted-foreground">Nº {proc.process_number}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">
                          {proc.role === 'autor' ? 'Autor' : proc.role === 'reu' ? 'Réu' : proc.role === 'advogado' ? 'Advogado' : proc.roleNotes || proc.role}
                        </Badge>
                        {proc.status && (
                          <Badge variant="secondary" className="text-[10px]">{proc.status}</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Chat IA Tab */}
            <TabsContent value="ai_chat" className="mt-0" style={{ height: '400px' }}>
              <EntityAIChat
                leadId={contactLeads?.[0]?.lead?.id || null}
                contactId={contact.id}
                entityType="contact"
                onApplyContactFields={(fields) => {
                  if (fields.full_name) setFullName(fields.full_name);
                  if (fields.phone) setPhone(fields.phone);
                  if (fields.email) setEmail(fields.email);
                  if (fields.city) setCity(fields.city);
                  if (fields.state) setState(fields.state);
                  if (fields.notes) setNotes(prev => prev ? `${prev}\n\n${fields.notes}` : fields.notes);
                  if (fields.profession) setProfession(fields.profession);
                }}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </Content>
    </Wrapper>

    {showClientLeadDialog && (
      <Dialog open={showClientLeadDialog} onOpenChange={(v) => { if (!v) setShowClientLeadDialog(false); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" style={{ zIndex: 9999 }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Cadastrar Lead do Cliente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Como <strong>{contact?.full_name}</strong> foi classificado como <Badge className="bg-green-500 text-white text-xs mx-1">Cliente</Badge>, vincule ou crie o lead:
            </p>

            {/* Mode toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={clientLeadMode === 'create' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setClientLeadMode('create'); }}
              >
                Criar novo lead
              </Button>
              <Button
                type="button"
                variant={clientLeadMode === 'link' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setClientLeadMode('link'); }}
              >
                Vincular existente
              </Button>
            </div>

            {clientLeadMode === 'link' ? (
              <div className="space-y-3">
                <div>
                  <Label>Buscar lead</Label>
                  <Input
                    placeholder="Nome do lead..."
                    value={existingLeadSearch}
                    onChange={(e) => setExistingLeadSearch(e.target.value)}
                  />
                </div>
                <ScrollArea className="h-40 border rounded-md">
                  <div className="p-1 space-y-1">
                    {existingLeads.map((lead) => {
                      const board = kanbanBoards.find(b => b.id === lead.board_id);
                      return (
                        <button
                          type="button"
                          key={lead.id}
                          onClick={() => setSelectedExistingLeadId(lead.id)}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                            selectedExistingLeadId === lead.id
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          }`}
                        >
                          <div className="font-medium truncate">{lead.lead_name || 'Sem nome'}</div>
                          <div className="text-xs opacity-70 flex items-center gap-1">
                            {board && (
                              <>
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: board.color || '#3b82f6' }} />
                                {board.name}
                                <span className="mx-1">·</span>
                              </>
                            )}
                            {format(new Date(lead.created_at), 'dd/MM/yyyy')}
                          </div>
                        </button>
                      );
                    })}
                    {existingLeads.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">Nenhum lead encontrado</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div>
                <Label>Funil</Label>
                <Select value={clientLeadBoardId} onValueChange={setClientLeadBoardId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o funil" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]" position="popper" sideOffset={4}>
                    {kanbanBoards.filter(b => (b as any).board_type !== 'workflow').map((board) => (
                      <SelectItem key={board.id} value={board.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: board.color || '#3b82f6' }} />
                          {board.name}
                          {board.is_default && <Badge variant="secondary" className="text-xs ml-1">Padrão</Badge>}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Resultado</Label>
              <Select value={clientLeadOutcome} onValueChange={(v) => setClientLeadOutcome(v as 'closed' | 'refused')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[9999]" position="popper" sideOffset={4}>
                  <SelectItem value="closed">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Fechado (ganho)
                    </div>
                  </SelectItem>
                  <SelectItem value="refused">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-red-500" />
                      Recusado (perdido)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{clientLeadOutcome === 'closed' ? 'Data de Fechamento' : 'Data da Recusa'}</Label>
              <Input
                type="date"
                value={clientLeadDate}
                onChange={(e) => setClientLeadDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowClientLeadDialog(false)}>
              Pular
            </Button>
            <Button
              type="button"
              onClick={handleCreateClientLead}
              disabled={
                creatingClientLead ||
                (clientLeadMode === 'create' && !clientLeadBoardId) ||
                (clientLeadMode === 'link' && !selectedExistingLeadId)
              }
            >
              {creatingClientLead ? 'Processando...' : clientLeadMode === 'create' ? 'Criar Lead' : 'Vincular Lead'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )}

    {/* Full LeadEditDialog for new lead creation */}
    <LeadEditDialog
      open={showLeadEditDialog}
      onOpenChange={(open) => {
        if (!open) {
          setShowLeadEditDialog(false);
          setNewCreatedLead(null);
          onContactUpdated?.();
        }
      }}
      lead={newCreatedLead}
      onSave={async (leadId, updates) => {
        const { error } = await supabase.from('leads').update(updates as any).eq('id', leadId);
        if (error) throw error;
      }}
      boards={kanbanBoards}
      mode="dialog"
    />
    </>
  );
}
