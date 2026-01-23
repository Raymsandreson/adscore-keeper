import React, { useState } from 'react';
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
  onDataChanged?: () => void;
}

export const CommentCardBadges: React.FC<CommentCardBadgesProps> = ({
  contactData,
  config,
  compact = false,
  interactive = false,
  authorUsername,
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

  if (loading) {
    return null;
  }

  const getFollowerStatusConfig = (status: string | null | undefined) => {
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
          className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800' 
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
        const { data: newContact, error: createError } = await supabase
          .from('contacts')
          .insert({
            full_name: authorUsername.replace('@', ''),
            instagram_username: normalizedUsername,
            classifications: selectedClassifications
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

      toast.success('Classificações atualizadas!');
      setClassificationOpen(false);
      onDataChanged?.();
    } catch (error) {
      console.error('Error saving classifications:', error);
      toast.error('Erro ao salvar classificações');
    } finally {
      setSavingClassifications(false);
    }
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
                  {!compact && getClassificationConfig(contactClassifications[0]).label}
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
          return (
            <Tooltip key={`class-${idx}`}>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline" 
                  className="text-xs gap-1"
                >
                  <div className={`w-2 h-2 rounded-full ${classConfig.color}`} />
                  {!compact && classConfig.label}
                  {idx === 0 && updatedAt && isRecent && (
                    <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  )}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {updatedAt ? (
                  <span>
                    {classConfig.label} • Atualizado em {format(updatedAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </span>
                ) : (
                  classConfig.label
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
                        {classConfig.label}
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

        {/* Connections/Relationships */}
        {config.connections && relationships.length > 0 && (
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Badge 
                variant="outline" 
                className="cursor-pointer text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900"
              >
                <Users className="h-3 w-3 mr-1" />
                {compact ? (
                  relationships.length
                ) : relationships.length === 1 ? (
                  <span className="capitalize">
                    {relationships[0].relationship_type.replace(/_/g, ' ')} de {relationships[0].related_contact.full_name.split(' ')[0]}
                  </span>
                ) : (
                  <span>{relationships.length} conexões</span>
                )}
              </Badge>
            </HoverCardTrigger>
            <HoverCardContent side="top" className="w-72 p-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Conexões:</p>
                {relationships.map(rel => (
                  <div 
                    key={rel.id} 
                    className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{rel.related_contact.full_name}</p>
                      <Badge variant="secondary" className="text-xs mt-1 capitalize">
                        {rel.relationship_type.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {rel.related_contact.phone && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
                              onClick={() => window.open(`https://wa.me/${formatPhoneForWhatsApp(rel.related_contact.phone!)}`, '_blank')}
                            >
                              <MessageCircle className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>WhatsApp</TooltipContent>
                        </Tooltip>
                      )}
                      {rel.related_contact.instagram_username && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-pink-600 hover:text-pink-700"
                              onClick={() => window.open(`https://instagram.com/${rel.related_contact.instagram_username?.replace('@', '')}`, '_blank')}
                            >
                              <Instagram className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Instagram</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </HoverCardContent>
          </HoverCard>
        )}
      </div>
    </TooltipProvider>
  );
};
