import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { 
  Users, 
  Tag,
  UserCheck,
  UserPlus,
  Users2,
  Link2Off,
  Link2,
  ExternalLink,
  MessageCircle,
  Instagram,
  Search,
  Plus,
  Loader2,
  Pencil,
  X,
  Settings2,
  Clock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { CommentContactData } from '@/hooks/useCommentContactInfo';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import type { CommentCardFieldsConfig } from '@/hooks/useCommentCardSettings';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { RelationshipPromptDialog, getRelationshipClassificationsFromList, isRelationshipClassification, RELATIONSHIP_KEYWORDS } from './RelationshipPromptDialog';
import { EditRelationshipDialog } from './EditRelationshipDialog';
import { ProfessionBadgePopover } from './ProfessionBadgePopover';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

// Detect relationship keywords in comment text
const detectRelationshipKeywordsInText = (text: string | null | undefined): string[] => {
  if (!text) return [];
  const lowerText = text.toLowerCase();
  return RELATIONSHIP_KEYWORDS.filter(keyword => lowerText.includes(keyword));
};

interface Lead {
  id: string;
  lead_name: string | null;
  status: string | null;
}

interface CommentCardBadgesProps {
  contactData: CommentContactData;
  config: CommentCardFieldsConfig;
  compact?: boolean;
  interactive?: boolean;
  authorUsername?: string | null;
  commentText?: string | null;
  onDataChanged?: () => void;
}

export const CommentCardBadges: React.FC<CommentCardBadgesProps> = ({
  contactData,
  config,
  compact = false,
  interactive = false,
  authorUsername,
  commentText,
  onDataChanged
}) => {
  const navigate = useNavigate();
  const { contact, linkedLeads, relationships, loading } = contactData;
  const { classifications, classificationConfig } = useContactClassifications();
  
  const contactClassifications = contact?.classifications || [];
  const followerStatus = contact?.follower_status;

  // Interactive states
  const [classificationOpen, setClassificationOpen] = useState(false);
  const [leadLinkOpen, setLeadLinkOpen] = useState(false);
  const [selectedClassifications, setSelectedClassifications] = useState<string[]>(contactClassifications);
  const [savingClassifications, setSavingClassifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Lead[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [manageLeadsOpen, setManageLeadsOpen] = useState(false);
  const [connectionLinkOpen, setConnectionLinkOpen] = useState(false);
  const [connectionSearchQuery, setConnectionSearchQuery] = useState('');
  const [connectionSearchResults, setConnectionSearchResults] = useState<Array<{id: string; full_name: string; instagram_username: string | null}>>([]);
  const [connectionSearchLoading, setConnectionSearchLoading] = useState(false);
  const [linkingConnection, setLinkingConnection] = useState(false);
  const [selectedRelationType, setSelectedRelationType] = useState('');
  const [relationshipTypes, setRelationshipTypes] = useState<Array<{id: string; name: string}>>([]);
  
  // Relationship prompt states
  const [showRelationshipPrompt, setShowRelationshipPrompt] = useState(false);
  const [pendingContactId, setPendingContactId] = useState<string | null>(null);
  const [pendingRelationshipClassification, setPendingRelationshipClassification] = useState<string>('');

  // Edit relationship states
  const [showEditRelationship, setShowEditRelationship] = useState(false);
  const [editingRelationship, setEditingRelationship] = useState<{
    id: string;
    type: string;
    relatedContact: { id: string; full_name: string };
  } | null>(null);

  // Detect new relationship classifications being added
  const newRelationshipClassifications = useMemo(() => {
    const currentRelationships = getRelationshipClassificationsFromList(contactClassifications);
    const selectedRelationships = getRelationshipClassificationsFromList(selectedClassifications);
    return selectedRelationships.filter(r => !currentRelationships.includes(r));
  }, [selectedClassifications, contactClassifications]);

  // Detect relationship keywords in comment text (for suggesting relationship creation)
  const detectedKeywordsInComment = useMemo(() => {
    return detectRelationshipKeywordsInText(commentText);
  }, [commentText]);

  // Check if we should highlight the "Vincular contato" badge
  const hasRelationshipKeywordInComment = detectedKeywordsInComment.length > 0 && relationships.length === 0;

  // Extract location from comment text using AI
  const extractLocationFromComment = async (contactId: string) => {
    if (!commentText || !authorUsername) return;
    
    // Skip if contact already has location data
    if (contact?.city || contact?.state) return;
    
    try {
      const { data, error } = await cloudFunctions.invoke('extract-location', {
        body: {
          commentText,
          authorUsername: authorUsername.replace('@', ''),
        }
      });
      
      if (error) {
        console.error('Error extracting location:', error);
        return;
      }
      
      if (data?.success && data.location && (data.location.city || data.location.state)) {
        // Update contact with extracted location
        const updateData: Record<string, string> = {};
        if (data.location.city) updateData.city = data.location.city;
        if (data.location.state) updateData.state = data.location.state;
        
        const { error: updateError } = await supabase
          .from('contacts')
          .update(updateData)
          .eq('id', contactId);
        
        if (!updateError) {
          const locationInfo = [data.location.city, data.location.state].filter(Boolean).join(', ');
          toast.info(`📍 Localização detectada: ${locationInfo}`, {
            description: `Extraído de: "${data.location.extractedFrom?.slice(0, 50) || commentText.slice(0, 50)}..."`
          });
        }
      }
    } catch (err) {
      console.error('Location extraction failed:', err);
    }
  };

  if (loading) {
    return null;
  }

  // Check if follow was requested but not yet accepted
  const followRequestedAt = contact?.follow_requested_at;
  const isFollowPending = !!followRequestedAt && contact?.follower_status !== 'following' && contact?.follower_status !== 'mutual';

  const getFollowerStatusConfig = (status: string | null | undefined) => {
    // If follow was requested but not yet following, show pending state
    if (isFollowPending) {
      return { 
        icon: Clock, 
        label: 'Solicitação pendente', 
        shortLabel: 'Pendente',
        className: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800' 
      };
    }
    
    switch (status) {
      case 'follower':
        return { 
          icon: UserCheck, 
          label: 'Te segue', 
          shortLabel: 'Seguidor',
          className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800' 
        };
      case 'following':
        return { 
          icon: UserPlus, 
          label: 'Você segue', 
          shortLabel: 'Seguindo',
          className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800' 
        };
      case 'mutual':
        return { 
          icon: Users2, 
          label: 'Mútuo', 
          shortLabel: 'Mútuo',
          className: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800' 
        };
      default:
        return null;
    }
  };

  const followerStatusConfig = getFollowerStatusConfig(followerStatus);

  const getClassificationConfig = (name: string) => {
    return classificationConfig[name] || { label: name, color: 'bg-gray-500' };
  };

  // Get relationship data for a classification if it's a relationship type
  const getRelationshipForClassification = (classification: string) => {
    const lowerClassification = classification.toLowerCase();
    return relationships.find(rel => 
      rel.relationship_type.toLowerCase().includes(lowerClassification) ||
      lowerClassification.includes(rel.relationship_type.toLowerCase())
    );
  };

  // Get display label with relationship name if applicable
  const getClassificationDisplayLabel = (classification: string) => {
    const config = getClassificationConfig(classification);
    const relationship = getRelationshipForClassification(classification);
    if (relationship && relationship.related_contact?.full_name) {
      const firstName = relationship.related_contact.full_name.split(' ')[0];
      return `${config.label} de ${firstName}`;
    }
    return config.label;
  };

  const formatPhoneForWhatsApp = (phone: string) => {
    return phone.replace(/\D/g, '');
  };

  const hasAnyData = followerStatusConfig || contactClassifications.length > 0 || linkedLeads.length > 0 || relationships.length > 0;

  if (!hasAnyData && !config.linkedLeads) {
    return null;
  }

  // Classification handlers
  const handleClassificationToggle = (classificationName: string) => {
    setSelectedClassifications(prev => 
      prev.includes(classificationName) 
        ? prev.filter(c => c !== classificationName)
        : [...prev, classificationName]
    );
  };

  const handleSaveClassifications = async () => {
    if (!contact?.id && !authorUsername) {
      toast.error('Contato não encontrado');
      return;
    }

    setSavingClassifications(true);
    try {
      let contactId = contact?.id;
      
      // Create contact if doesn't exist
      if (!contactId && authorUsername) {
        const normalizedUsername = authorUsername.startsWith('@') ? authorUsername : `@${authorUsername}`;
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        const { data: newContact, error: createError } = await supabase
          .from('contacts')
          .insert({
            full_name: authorUsername.replace('@', ''),
            instagram_username: normalizedUsername,
            classifications: selectedClassifications,
            created_by: currentUser?.id || null,
          })
          .select('id')
          .single();
        
        if (createError) throw createError;
        contactId = newContact?.id;
      } else if (contactId) {
        // Update existing contact
        const { error } = await supabase
          .from('contacts')
          .update({ classifications: selectedClassifications })
          .eq('id', contactId);
        
        if (error) throw error;
      }

      // Try to extract location from comment (runs in background)
      if (contactId) {
        extractLocationFromComment(contactId);
      }

      // Check if there are new relationship classifications
      if (newRelationshipClassifications.length > 0 && contactId) {
        // Show relationship prompt for the first new relationship classification
        setPendingContactId(contactId);
        setPendingRelationshipClassification(newRelationshipClassifications[0]);
        setShowRelationshipPrompt(true);
        setClassificationOpen(false);
        // Don't call onDataChanged yet - wait for relationship prompt to complete
      } else {
        toast.success('Classificações atualizadas!');
        setClassificationOpen(false);
        onDataChanged?.();
      }
    } catch (error) {
      console.error('Error saving classifications:', error);
      toast.error('Erro ao salvar classificações');
    } finally {
      setSavingClassifications(false);
    }
  };

  const handleRelationshipComplete = () => {
    toast.success('Classificações e relacionamento atualizados!');
    setPendingContactId(null);
    setPendingRelationshipClassification('');
    onDataChanged?.();
  };

  const handleEditRelationship = (classification: string) => {
    const relationship = getRelationshipForClassification(classification);
    
    if (relationship && contact?.id) {
      // Has existing relationship - open edit dialog
      setEditingRelationship({
        id: relationship.id,
        type: relationship.relationship_type,
        relatedContact: {
          id: relationship.related_contact.id,
          full_name: relationship.related_contact.full_name
        }
      });
      setShowEditRelationship(true);
    } else if (contact?.id && isRelationshipClassification(classification)) {
      // No relationship exists yet - open create dialog
      setPendingContactId(contact.id);
      setPendingRelationshipClassification(classification);
      setShowRelationshipPrompt(true);
    }
  };

  const handleEditRelationshipComplete = () => {
    setEditingRelationship(null);
    onDataChanged?.();
  };

  // Lead search and link handlers
  const handleSearchLeads = async (query: string) => {
    setSearchQuery(query);
    setSearchLoading(true);
    
    try {
      let dbQuery = supabase
        .from('leads')
        .select('id, lead_name, status')
        .limit(10);
      
      if (query.trim()) {
        dbQuery = dbQuery.or(`lead_name.ilike.%${query}%,lead_phone.ilike.%${query}%`);
      }
      
      const { data, error } = await dbQuery.order('created_at', { ascending: false });
      
      if (!error && data) {
        setSearchResults(data);
      }
    } catch (error) {
      console.error('Error searching leads:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleLinkLead = async (leadId: string) => {
    if (!contact?.id && !authorUsername) {
      toast.error('Contato não encontrado');
      return;
    }

    setLinking(true);
    try {
      let contactId = contact?.id;
      
      // Create contact if doesn't exist
      if (!contactId && authorUsername) {
        const normalizedUsername = authorUsername.startsWith('@') ? authorUsername : `@${authorUsername}`;
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        const { data: newContact, error: createError } = await supabase
          .from('contacts')
          .insert({
            full_name: authorUsername.replace('@', ''),
            instagram_username: normalizedUsername,
            created_by: currentUser?.id || null,
          })
          .select('id')
          .single();
        
        if (createError) throw createError;
        contactId = newContact?.id;
      }

      if (!contactId) {
        toast.error('Erro ao criar contato');
        return;
      }

      const supabaseAny = supabase as any;
      const { error } = await supabaseAny
        .from('contact_leads')
        .insert({
          contact_id: contactId,
          lead_id: leadId
        });

      if (error) {
        if (error.code === '23505') {
          toast.info('Lead já vinculado');
        } else {
          throw error;
        }
      } else {
        toast.success('Lead vinculado!');
        setLeadLinkOpen(false);
        onDataChanged?.();
      }
    } catch (error) {
      console.error('Error linking lead:', error);
      toast.error('Erro ao vincular lead');
    } finally {
      setLinking(false);
    }
  };

  const handleCreateNewLead = () => {
    const params = new URLSearchParams();
    if (authorUsername) {
      params.set('instagram', authorUsername.replace('@', ''));
      params.set('name', authorUsername.replace('@', ''));
    }
    if (contact?.id) {
      params.set('linkContact', contact.id);
    }
    navigate(`/leads?${params.toString()}`);
    setLeadLinkOpen(false);
  };

  const handleUnlinkLead = async (leadId: string) => {
    if (!contact?.id) {
      toast.error('Contato não encontrado');
      return;
    }

    setUnlinking(leadId);
    try {
      const supabaseAny = supabase as any;
      const { error } = await supabaseAny
        .from('contact_leads')
        .delete()
        .eq('contact_id', contact.id)
        .eq('lead_id', leadId);

      if (error) throw error;

      toast.success('Lead desvinculado!');
      setManageLeadsOpen(false);
      onDataChanged?.();
    } catch (error) {
      console.error('Error unlinking lead:', error);
      toast.error('Erro ao desvincular lead');
    } finally {
      setUnlinking(null);
    }
  };

  // Connection (relationship) handlers
  const loadRelationshipTypes = async () => {
    try {
      const supabaseAny = supabase as any;
      const { data, error } = await supabaseAny
        .from('contact_relationship_types')
        .select('id, name')
        .order('display_order');
      
      if (!error && data) {
        setRelationshipTypes(data);
        if (data.length > 0) {
          setSelectedRelationType(data[0].name);
        }
      }
    } catch (error) {
      console.error('Error loading relationship types:', error);
    }
  };

  const handleSearchContacts = async (query: string) => {
    setConnectionSearchQuery(query);
    setConnectionSearchLoading(true);
    
    try {
      let dbQuery = supabase
        .from('contacts')
        .select('id, full_name, instagram_username')
        .limit(10);
      
      if (query.trim()) {
        dbQuery = dbQuery.or(`full_name.ilike.%${query}%,instagram_username.ilike.%${query}%`);
      }
      
      // Exclude current contact
      if (contact?.id) {
        dbQuery = dbQuery.neq('id', contact.id);
      }
      
      const { data, error } = await dbQuery.order('created_at', { ascending: false });
      
      if (!error && data) {
        setConnectionSearchResults(data);
      }
    } catch (error) {
      console.error('Error searching contacts:', error);
    } finally {
      setConnectionSearchLoading(false);
    }
  };

  const handleLinkConnection = async (relatedContactId: string) => {
    if (!contact?.id && !authorUsername) {
      toast.error('Contato não encontrado');
      return;
    }

    if (!selectedRelationType) {
      toast.error('Selecione o tipo de vínculo');
      return;
    }

    setLinkingConnection(true);
    try {
      let contactId = contact?.id;
      
      // Create contact if doesn't exist
      if (!contactId && authorUsername) {
        const normalizedUsername = authorUsername.startsWith('@') ? authorUsername : `@${authorUsername}`;
        const { data: newContact, error: createError } = await supabase
          .from('contacts')
          .insert({
            full_name: authorUsername.replace('@', ''),
            instagram_username: normalizedUsername
          })
          .select('id')
          .single();
        
        if (createError) throw createError;
        contactId = newContact?.id;
      }

      if (!contactId) {
        toast.error('Erro ao criar contato');
        return;
      }

      const supabaseAny = supabase as any;
      const { error } = await supabaseAny
        .from('contact_relationships')
        .insert({
          contact_id: contactId,
          related_contact_id: relatedContactId,
          relationship_type: selectedRelationType
        });

      if (error) {
        if (error.code === '23505') {
          toast.info('Vínculo já existe');
        } else {
          throw error;
        }
      } else {
        toast.success('Vínculo criado!');
        setConnectionLinkOpen(false);
        onDataChanged?.();
      }
    } catch (error) {
      console.error('Error linking connection:', error);
      toast.error('Erro ao criar vínculo');
    } finally {
      setLinkingConnection(false);
    }
  };

  // Render classification badge (interactive or static)
  const renderClassificationBadge = () => {
    if (!config.classification) return null;

    const hasClassifications = contactClassifications.length > 0;

    if (interactive) {
      return (
        <Popover modal={true} open={classificationOpen} onOpenChange={(open) => {
          setClassificationOpen(open);
          if (open) {
            setSelectedClassifications(contactClassifications);
          }
        }}>
          <PopoverTrigger asChild>
            <button type="button" style={{ pointerEvents: "auto" }} className="inline-flex">
              {hasClassifications ? (
                <Badge 
                  variant="outline" 
                  className="text-xs gap-1 cursor-pointer hover:bg-accent"
                >
                  <div className={`w-2 h-2 rounded-full ${getClassificationConfig(contactClassifications[0]).color}`} />
                  {!compact && getClassificationDisplayLabel(contactClassifications[0])}
                  {contactClassifications.length > 1 && (
                    <span className="text-muted-foreground">+{contactClassifications.length - 1}</span>
                  )}
                  <Pencil className="h-2.5 w-2.5 ml-0.5 opacity-50" />
                </Badge>
              ) : (
                <Badge 
                  variant="outline" 
                  className="text-xs gap-1 cursor-pointer border-dashed bg-muted/50 text-muted-foreground hover:bg-accent"
                >
                  <Tag className="h-3 w-3" />
                  {!compact && "Classificar"}
                </Badge>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">Classificações</h4>
                {authorUsername && (
                  <Badge variant="secondary" className="text-xs">
                    @{authorUsername.replace('@', '')}
                  </Badge>
                )}
              </div>
              {contact?.updated_at && contactClassifications.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
                  <Clock className="h-3 w-3" />
                  <span>
                    Atualizado {formatDistanceToNow(new Date(contact.updated_at), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
              )}
              <ScrollArea className="h-[180px]">
                <div className="space-y-2">
                  {classifications.map(classification => {
                    const isSelected = selectedClassifications.includes(classification.name);
                    return (
                      <div 
                        key={classification.id}
                        className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer"
                        onClick={() => handleClassificationToggle(classification.name)}
                      >
                        <Checkbox 
                          checked={isSelected}
                          className="pointer-events-none"
                        />
                        <div className={`w-3 h-3 rounded-full ${classification.color}`}
                        />
                        <span className="text-sm flex-1">{getClassificationConfig(classification.name).label}</span>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setClassificationOpen(false)}
                >
                  Cancelar
                </Button>
                <Button 
                  size="sm"
                  onClick={handleSaveClassifications}
                  disabled={savingClassifications}
                >
                  {savingClassifications ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Salvar'
                  )}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      );
    }

    // Static rendering
    if (!hasClassifications) return null;

    const updatedAt = contact?.updated_at ? new Date(contact.updated_at) : null;
    const isRecent = updatedAt && (Date.now() - updatedAt.getTime()) < 24 * 60 * 60 * 1000;

    return (
      <>
        {contactClassifications.slice(0, compact ? 1 : 2).map((classification, idx) => {
          const classConfig = getClassificationConfig(classification);
          const relationship = getRelationshipForClassification(classification);
          const hasRelationship = relationship && relationship.related_contact?.full_name;
          const isRelationship = isRelationshipClassification(classification);
          const isClickable = interactive && isRelationship;
          
          return (
            <Tooltip key={`class-${idx}`}>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline" 
                  className={`text-xs gap-1 ${isClickable ? 'cursor-pointer hover:bg-accent' : ''}`}
                  onClick={isClickable ? () => handleEditRelationship(classification) : undefined}
                >
                  <div className={`w-2 h-2 rounded-full ${classConfig.color}`} />
                  {!compact && getClassificationDisplayLabel(classification)}
                  {idx === 0 && updatedAt && isRecent && (
                    <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  )}
                  {isClickable && (
                    <Pencil className="h-2.5 w-2.5 ml-0.5 opacity-50" />
                  )}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {isClickable ? (
                  <span>{hasRelationship ? 'Clique para editar o vínculo' : 'Clique para vincular a alguém'}</span>
                ) : updatedAt ? (
                  <span>
                    {getClassificationDisplayLabel(classification)} • Atualizado em {format(updatedAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </span>
                ) : (
                  getClassificationDisplayLabel(classification)
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
        
        {contactClassifications.length > (compact ? 1 : 2) && (
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Badge 
                variant="outline" 
                className="cursor-pointer text-xs bg-muted hover:bg-muted/80"
              >
                +{contactClassifications.length - (compact ? 1 : 2)}
              </Badge>
            </HoverCardTrigger>
            <HoverCardContent side="top" className="w-48 p-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Classificações:</p>
                <div className="flex flex-wrap gap-1">
                  {contactClassifications.map((classification, idx) => {
                    const classConfig = getClassificationConfig(classification);
                    return (
                      <Badge 
                        key={`class-all-${idx}`}
                        variant="outline" 
                        className="text-xs gap-1"
                      >
                        <div className={`w-2 h-2 rounded-full ${classConfig.color}`} />
                        {getClassificationDisplayLabel(classification)}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        )}
      </>
    );
  };

  // Render linked leads badge (interactive or static)
  const renderLinkedLeadsBadge = () => {
    if (!config.linkedLeads) return null;

    const hasLeads = linkedLeads.length > 0;

    if (interactive && !hasLeads) {
      return (
        <Popover modal={true} open={leadLinkOpen} onOpenChange={(open) => {
          setLeadLinkOpen(open);
          if (open) {
            handleSearchLeads('');
          }
        }}>
          <PopoverTrigger asChild>
            <button type="button" style={{ pointerEvents: "auto" }} className="inline-flex">
              <Badge 
                variant="outline" 
                className="text-xs gap-1 bg-muted/50 text-muted-foreground border-dashed cursor-pointer hover:bg-accent"
              >
                <Link2Off className="h-3 w-3" />
                {!compact && "Vincular lead"}
                <Plus className="h-2.5 w-2.5 ml-0.5 opacity-50" />
              </Badge>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">Vincular Lead</h4>
                {authorUsername && (
                  <Badge variant="secondary" className="text-xs">
                    @{authorUsername.replace('@', '')}
                  </Badge>
                )}
              </div>
              
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar lead..."
                  value={searchQuery}
                  onChange={(e) => handleSearchLeads(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              
              <ScrollArea className="h-[160px]">
                {searchLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="text-center py-6 text-sm text-muted-foreground">
                    {searchQuery ? 'Nenhum lead encontrado' : 'Digite para buscar'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {searchResults.map(lead => (
                      <button
                        key={lead.id}
                        type="button"
                        className="w-full flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors cursor-pointer text-left disabled:opacity-50"
                        onClick={() => handleLinkLead(lead.id)}
                        disabled={linking}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{lead.lead_name || 'Sem nome'}</p>
                          <Badge variant="secondary" className="text-xs">{lead.status || 'new'}</Badge>
                        </div>
                        {linking ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          <Link2 className="h-4 w-4 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
              
              <div className="border-t pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleCreateNewLead}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Criar novo lead
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      );
    }

    // Has leads - show them (both interactive and static)
    if (hasLeads) {
      return (
        <>
          {linkedLeads.slice(0, compact ? 1 : 2).map(lead => (
            <Tooltip key={lead.id}>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline" 
                  className="text-xs gap-1 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900"
                  onClick={() => navigate(`/leads?leadId=${lead.id}`)}
                >
                  {lead.lead_name?.slice(0, compact ? 10 : 15) || 'Lead'}
                  {(lead.lead_name?.length || 0) > (compact ? 10 : 15) && '...'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs">
                  <p className="font-medium">{lead.lead_name}</p>
                  <p className="text-muted-foreground">Status: {lead.status || 'new'}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
          
          {linkedLeads.length > (compact ? 1 : 2) && (
            <HoverCard openDelay={200} closeDelay={100}>
              <HoverCardTrigger asChild>
                <Badge 
                  variant="outline" 
                  className="cursor-pointer text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 hover:bg-blue-100"
                >
                  +{linkedLeads.length - (compact ? 1 : 2)} leads
                </Badge>
              </HoverCardTrigger>
              <HoverCardContent side="top" className="w-64 p-3">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Leads vinculados:</p>
                  {linkedLeads.map(lead => (
                    <div 
                      key={lead.id} 
                      className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                      onClick={() => navigate(`/leads?leadId=${lead.id}`)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{lead.lead_name || 'Sem nome'}</p>
                        <Badge variant="secondary" className="text-xs mt-1">{lead.status || 'new'}</Badge>
                      </div>
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              </HoverCardContent>
            </HoverCard>
          )}

          {/* Manage leads button when interactive */}
          {interactive && (
            <Popover modal={true} open={manageLeadsOpen} onOpenChange={setManageLeadsOpen}>
              <PopoverTrigger asChild>
                <button type="button" style={{ pointerEvents: "auto" }} className="inline-flex">
                  <Badge 
                    variant="outline" 
                    className="text-xs gap-1 cursor-pointer border-dashed hover:bg-accent"
                  >
                    <Settings2 className="h-3 w-3" />
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" align="start">
                <div className="space-y-3">
                  <h4 className="font-medium text-sm">Gerenciar Leads</h4>
                  
                  <ScrollArea className="max-h-[200px]">
                    <div className="space-y-2">
                      {linkedLeads.map(lead => (
                        <div 
                          key={lead.id}
                          className="flex items-center justify-between gap-2 p-2 rounded-md border bg-card"
                        >
                          <div 
                            className="flex-1 min-w-0 cursor-pointer hover:opacity-80"
                            onClick={() => {
                              navigate(`/leads?leadId=${lead.id}`);
                              setManageLeadsOpen(false);
                            }}
                          >
                            <p className="text-sm font-medium truncate">{lead.lead_name || 'Sem nome'}</p>
                            <Badge variant="secondary" className="text-xs">{lead.status || 'new'}</Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                navigate(`/leads?leadId=${lead.id}`);
                                setManageLeadsOpen(false);
                              }}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleUnlinkLead(lead.id)}
                              disabled={unlinking === lead.id}
                            >
                              {unlinking === lead.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <X className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  
                  <div className="border-t pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setManageLeadsOpen(false);
                        setLeadLinkOpen(true);
                        handleSearchLeads('');
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Vincular outro lead
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Add new lead popover */}
          {interactive && (
            <Popover open={leadLinkOpen} onOpenChange={(open) => {
              setLeadLinkOpen(open);
              if (open) handleSearchLeads('');
            }}>
              <PopoverTrigger asChild>
                <Badge 
                  variant="outline" 
                  className="text-xs gap-1 cursor-pointer border-dashed hover:bg-accent"
                >
                  <Plus className="h-3 w-3" />
                </Badge>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" align="start">
                <div className="space-y-3">
                  <h4 className="font-medium text-sm">Vincular Lead</h4>
                  
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar lead..."
                      value={searchQuery}
                      onChange={(e) => handleSearchLeads(e.target.value)}
                      className="pl-8 h-9"
                    />
                  </div>
                  
                  <ScrollArea className="h-[160px]">
                    {searchLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        {searchQuery ? 'Nenhum lead encontrado' : 'Digite para buscar'}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {searchResults.map(lead => (
                          <button
                            key={lead.id}
                            type="button"
                            className="w-full flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors cursor-pointer text-left disabled:opacity-50"
                            onClick={() => handleLinkLead(lead.id)}
                            disabled={linking}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{lead.lead_name || 'Sem nome'}</p>
                              <Badge variant="secondary" className="text-xs">{lead.status || 'new'}</Badge>
                            </div>
                            {linking ? (
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            ) : (
                              <Link2 className="h-4 w-4 text-primary" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  
                  <div className="border-t pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={handleCreateNewLead}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Criar novo lead
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </>
      );
    }

    // Static "no leads" badge
    return (
      <Badge 
        variant="outline" 
        className="text-xs gap-1 bg-muted/50 text-muted-foreground border-dashed"
      >
        <Link2Off className="h-3 w-3" />
        {!compact && "Não vinculado"}
      </Badge>
    );
  };

  // Render connections/relationships badge
  const renderConnectionsBadge = () => {
    if (!config.connections) return null;

    const hasConnections = relationships.length > 0;

    if (interactive && !hasConnections) {
      // Pre-select detected relationship type from comment
      const suggestedType = detectedKeywordsInComment.length > 0 
        ? detectedKeywordsInComment[0].charAt(0).toUpperCase() + detectedKeywordsInComment[0].slice(1)
        : '';

      return (
        <Popover modal={true} open={connectionLinkOpen} onOpenChange={(open) => {
          setConnectionLinkOpen(open);
          if (open) {
            loadRelationshipTypes();
            handleSearchContacts('');
            // Pre-select the detected relationship type
            if (suggestedType) {
              setSelectedRelationType(suggestedType);
            }
          }
        }}>
          <PopoverTrigger asChild>
            <button type="button" style={{ pointerEvents: "auto" }} className="inline-flex">
              <Badge 
                variant="outline" 
                className={`text-xs gap-1 cursor-pointer hover:bg-accent ${
                  hasRelationshipKeywordInComment 
                    ? 'bg-amber-50 text-amber-700 border-amber-300 animate-pulse dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700' 
                    : 'bg-muted/50 text-muted-foreground border-dashed'
                }`}
              >
                <Users className="h-3 w-3" />
                {!compact && (hasRelationshipKeywordInComment 
                  ? `Vincular ${suggestedType}?` 
                  : "Vincular contato"
                )}
                <Plus className="h-2.5 w-2.5 ml-0.5 opacity-50" />
              </Badge>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <div className="space-y-3">
              <h4 className="font-medium text-sm">Vincular a outro contato</h4>
              
              {/* Relationship type selector */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Tipo de vínculo</label>
                <div className="flex flex-wrap gap-1">
                  {relationshipTypes.map(type => (
                    <Badge
                      key={type.id}
                      variant={selectedRelationType === type.name ? "default" : "outline"}
                      className="text-xs cursor-pointer"
                      onClick={() => setSelectedRelationType(type.name)}
                    >
                      {type.name}
                    </Badge>
                  ))}
                </div>
              </div>
              
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar contato..."
                  value={connectionSearchQuery}
                  onChange={(e) => handleSearchContacts(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              
              <ScrollArea className="h-[160px]">
                {connectionSearchLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : connectionSearchResults.length === 0 ? (
                  <div className="text-center py-6 text-sm text-muted-foreground">
                    {connectionSearchQuery ? 'Nenhum contato encontrado' : 'Digite para buscar'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {connectionSearchResults.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors cursor-pointer text-left disabled:opacity-50"
                        onClick={() => handleLinkConnection(c.id)}
                        disabled={linkingConnection}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{c.full_name}</p>
                          {c.instagram_username && (
                            <p className="text-xs text-muted-foreground truncate">{c.instagram_username}</p>
                          )}
                        </div>
                        {linkingConnection ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          <Users className="h-4 w-4 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </PopoverContent>
        </Popover>
      );
    }

    // Has connections - show them
    if (hasConnections) {
      return (
        <>
          {relationships.slice(0, compact ? 1 : 2).map(rel => (
            <Tooltip key={rel.id}>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline" 
                  className="text-xs gap-1 bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900"
                  onClick={() => {
                    setEditingRelationship({
                      id: rel.id,
                      type: rel.relationship_type,
                      relatedContact: {
                        id: rel.related_contact.id,
                        full_name: rel.related_contact.full_name
                      }
                    });
                    setShowEditRelationship(true);
                  }}
                >
                  <Users className="h-3 w-3" />
                  {!compact && `${rel.relationship_type} de ${rel.related_contact.full_name.split(' ')[0]}`}
                  <Pencil className="h-2.5 w-2.5 ml-0.5 opacity-50" />
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs">
                  <p className="font-medium">{rel.relationship_type}</p>
                  <p className="text-muted-foreground">Vinculado a: {rel.related_contact.full_name}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
          
          {relationships.length > (compact ? 1 : 2) && (
            <Badge 
              variant="outline" 
              className="cursor-pointer text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800"
            >
              +{relationships.length - (compact ? 1 : 2)} vínculos
            </Badge>
          )}

          {/* Add more connections button when interactive */}
          {interactive && (
            <Popover modal={true} open={connectionLinkOpen} onOpenChange={(open) => {
              setConnectionLinkOpen(open);
              if (open) {
                loadRelationshipTypes();
                handleSearchContacts('');
              }
            }}>
              <PopoverTrigger asChild>
                <button type="button" style={{ pointerEvents: "auto" }} className="inline-flex">
                  <Badge 
                    variant="outline" 
                    className="text-xs gap-1 cursor-pointer border-dashed hover:bg-accent"
                  >
                    <Plus className="h-3 w-3" />
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" align="start">
                <div className="space-y-3">
                  <h4 className="font-medium text-sm">Adicionar vínculo</h4>
                  
                  {/* Relationship type selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Tipo de vínculo</label>
                    <div className="flex flex-wrap gap-1">
                      {relationshipTypes.map(type => (
                        <Badge
                          key={type.id}
                          variant={selectedRelationType === type.name ? "default" : "outline"}
                          className="text-xs cursor-pointer"
                          onClick={() => setSelectedRelationType(type.name)}
                        >
                          {type.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar contato..."
                      value={connectionSearchQuery}
                      onChange={(e) => handleSearchContacts(e.target.value)}
                      className="pl-8 h-9"
                    />
                  </div>
                  
                  <ScrollArea className="h-[160px]">
                    {connectionSearchLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : connectionSearchResults.length === 0 ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        {connectionSearchQuery ? 'Nenhum contato encontrado' : 'Digite para buscar'}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {connectionSearchResults.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors cursor-pointer text-left disabled:opacity-50"
                            onClick={() => handleLinkConnection(c.id)}
                            disabled={linkingConnection}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{c.full_name}</p>
                              {c.instagram_username && (
                                <p className="text-xs text-muted-foreground truncate">{c.instagram_username}</p>
                              )}
                            </div>
                            {linkingConnection ? (
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            ) : (
                              <Users className="h-4 w-4 text-primary" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </>
      );
    }

    return null;
  };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 flex-wrap">
        {/* Follower Status */}
        {config.followerStatus && followerStatusConfig && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="outline" 
                className={`text-xs gap-1 ${followerStatusConfig.className}`}
              >
                <followerStatusConfig.icon className="h-3 w-3" />
                {!compact && followerStatusConfig.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{followerStatusConfig.label}</TooltipContent>
          </Tooltip>
        )}

        {/* Classifications */}
        {renderClassificationBadge()}

        {/* Linked Leads */}
        {renderLinkedLeadsBadge()}

        {/* Profession Badge */}
        <ProfessionBadgePopover
          contactId={contact?.id}
          authorUsername={authorUsername}
          profession={contact?.profession}
          professionCboCode={contact?.profession_cbo_code}
          compact={compact}
          interactive={interactive}
          onDataChanged={onDataChanged}
        />

        {/* Connections/Relationships */}
        {renderConnectionsBadge()}
      </div>

      {/* Relationship Prompt Dialog */}
      <RelationshipPromptDialog
        open={showRelationshipPrompt}
        onOpenChange={setShowRelationshipPrompt}
        relationshipClassification={pendingRelationshipClassification}
        contactId={pendingContactId}
        contactName={contact?.full_name || authorUsername || 'Contato'}
        onComplete={handleRelationshipComplete}
      />

      {/* Edit Relationship Dialog */}
      {editingRelationship && (
        <EditRelationshipDialog
          open={showEditRelationship}
          onOpenChange={setShowEditRelationship}
          relationshipId={editingRelationship.id}
          relationshipType={editingRelationship.type}
          currentRelatedContact={editingRelationship.relatedContact}
          contactId={contact?.id || ''}
          contactName={contact?.full_name || authorUsername || 'Contato'}
          onComplete={handleEditRelationshipComplete}
        />
      )}
    </TooltipProvider>
  );
};
