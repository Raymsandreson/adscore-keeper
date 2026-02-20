import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { WhatsAppCallRecorder } from '@/components/whatsapp/WhatsAppCallRecorder';
import { Contact } from '@/hooks/useContacts';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { useContactRelationships } from '@/hooks/useContactRelationships';
import { useContactLeads, ContactLead } from '@/hooks/useContactLeads';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useCboProfessions } from '@/hooks/useCboProfessions';
import { useProfileNames } from '@/hooks/useProfileNames';
import { MultiClassificationSelect } from './MultiClassificationSelect';
import { ContactInteractionHistory } from './ContactInteractionHistory';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Briefcase } from 'lucide-react';

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

  // Hooks
  const { classifications: availableClassifications } = useContactClassifications();
  const { relationships, loading: loadingRelationships } = useContactRelationships(contact?.id);
  const { leads: contactLeads, loading: loadingLeads } = useContactLeads(contact?.id);
  const { states, cities, fetchCities } = useBrazilianLocations();
  const { professions, searchProfessions } = useCboProfessions();
  const { fetchProfileNames, getDisplayName } = useProfileNames();

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
      setClassifications(contact.classifications || []);
      setFollowerStatus(contact.follower_status || 'none');
      setProfession((contact as any).profession || '');
      setProfessionCboCode((contact as any).profession_cbo_code || '');
      setProfessionSearch((contact as any).profession || '');
      setIsEditing(true);
      
      // Fetch profile name for created_by
      const contactAny = contact as any;
      if (contactAny.created_by) {
        fetchProfileNames([contactAny.created_by]);
      }
    }
  }, [contact, open]);

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

  const getClassificationLabel = (name: string) => {
    const labels: Record<string, string> = {
      client: 'Cliente',
      non_client: 'Não-Cliente',
      prospect: 'Prospect',
      partner: 'Parceiro',
      supplier: 'Fornecedor',
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
    <Wrapper open={open} onOpenChange={onOpenChange}>
      <Content className={contentClassName}>
         <Header className="pb-4">
          <div className="flex items-center justify-between">
            <Title className="flex items-center gap-2 text-xl">
              <User className="h-5 w-5" />
              {fullName || contact.full_name}
            </Title>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
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
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="info" className="text-xs">
              <User className="h-3 w-3 mr-1" />
              Info
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs">
              <History className="h-3 w-3 mr-1" />
              Histórico
            </TabsTrigger>
            <TabsTrigger value="location" className="text-xs">
              <MapPin className="h-3 w-3 mr-1" />
              Local
            </TabsTrigger>
            <TabsTrigger value="relationships" className="text-xs">
              <Users className="h-3 w-3 mr-1" />
              Vínculos
            </TabsTrigger>
            <TabsTrigger value="leads" className="text-xs">
              <Link2 className="h-3 w-3 mr-1" />
              Leads
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
                      Classificações
                    </Label>
                    <MultiClassificationSelect
                      values={classifications}
                      onChange={setClassifications}
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
                        <span className="flex-1">{contact.phone}</span>
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
                        <span className="flex-1">{contact.email}</span>
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
                        <a 
                          href={`https://instagram.com/${contact.instagram_username?.replace('@', '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 text-primary hover:underline truncate"
                        >
                          https://instagram.com/{contact.instagram_username?.replace('@', '')}
                        </a>
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
                        <div className="flex-1">
                          <span>{(contact as any).profession}</span>
                          {(contact as any).profession_cbo_code && (
                            <span className="text-xs text-muted-foreground ml-2">
                              (CBO: {(contact as any).profession_cbo_code})
                            </span>
                          )}
                        </div>
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
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
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
                      {contactLead.lead?.lead_phone && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => window.open(`https://wa.me/${contactLead.lead?.lead_phone?.replace(/\D/g, '')}`, '_blank')}
                        >
                          <MessageSquare className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
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
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </Content>
    </Wrapper>
  );
}
