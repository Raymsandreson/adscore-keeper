import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { 
  Tag, 
  CheckCircle2, 
  Plus, 
  Link2, 
  Unlink, 
  Kanban, 
  Search, 
  UserPlus,
  RefreshCw,
  Users,
  User,
  Eye,
  EyeOff
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useContactClassifications, classificationColors } from "@/hooks/useContactClassifications";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Comment {
  id: string;
  author_username: string | null;
  comment_text: string | null;
  post_url: string | null;
  platform: string;
  prospect_classification?: string[] | null;
  prospect_name?: string | null;
}

interface LinkedLead {
  id: string;
  lead_name: string | null;
  status: string | null;
  board_id: string | null;
}

interface Contact {
  id: string;
  full_name: string;
  instagram_username: string | null;
}

interface CommentClassificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comment: Comment | null;
  onClassificationsApplied: (classifications: string[] | null) => void;
  onLeadLinked?: () => void;
}

export const CommentClassificationDialog = ({
  open,
  onOpenChange,
  comment,
  onClassificationsApplied,
  onLeadLinked
}: CommentClassificationDialogProps) => {
  const { classifications, classificationConfig, addClassification, fetchClassifications } = useContactClassifications();
  const { boards } = useKanbanBoards();

  const [selectedClassifications, setSelectedClassifications] = useState<string[]>([]);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('bg-blue-500');
  const [newShowInWorkflow, setNewShowInWorkflow] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Lead linking state
  const [activeTab, setActiveTab] = useState<'classify' | 'lead'>('classify');
  const [linkedLeads, setLinkedLeads] = useState<LinkedLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  
  // New lead creation
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [selectedStageId, setSelectedStageId] = useState<string>('');
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadNotes, setNewLeadNotes] = useState('');
  
  // Search existing leads
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LinkedLead[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Relationship / Contact creation
  const [showRelationshipStep, setShowRelationshipStep] = useState(false);
  const [hasRelationship, setHasRelationship] = useState(false);
  const [relatedContactName, setRelatedContactName] = useState('');
  const [searchContactQuery, setSearchContactQuery] = useState('');
  const [contactSearchResults, setContactSearchResults] = useState<Contact[]>([]);
  const [selectedRelatedContact, setSelectedRelatedContact] = useState<Contact | null>(null);
  const [isSearchingContacts, setIsSearchingContacts] = useState(false);
  const [isCreatingNewContact, setIsCreatingNewContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [isCreatingContact, setIsCreatingContact] = useState(false);
  
  // Contact classification for new contacts created from Instagram flow
  const [newContactClassifications, setNewContactClassifications] = useState<string[]>([]);

  const username = comment?.author_username?.replace('@', '').toLowerCase() || '';

  // Fetch classifications when dialog opens
  useEffect(() => {
    if (open) {
      fetchClassifications();
    }
  }, [open, fetchClassifications]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open && comment) {
      setSelectedClassifications(comment.prospect_classification || []);
      setActiveTab('classify');
      setIsAddingNew(false);
      setNewName('');
      setSearchQuery('');
      setSearchResults([]);
      setShowRelationshipStep(false);
      setHasRelationship(false);
      setRelatedContactName('');
      setSelectedRelatedContact(null);
      setIsCreatingNewContact(false);
      setNewContactName('');
      setNewContactClassifications([]);
      // Pre-fill lead name with username
      const user = comment.author_username?.replace('@', '') || '';
      setNewLeadName(user ? `@${user}` : '');
      setNewLeadNotes('');
      fetchLinkedLeads();
    }
  }, [open, comment]);

  // Set default board
  useEffect(() => {
    if (boards.length > 0 && !selectedBoardId) {
      const defaultBoard = boards.find(b => b.is_default) || boards[0];
      setSelectedBoardId(defaultBoard.id);
      if (defaultBoard.stages.length > 0) {
        setSelectedStageId(defaultBoard.stages[0].id);
      }
    }
  }, [boards, selectedBoardId]);

  // Update stage when board changes
  useEffect(() => {
    const board = boards.find(b => b.id === selectedBoardId);
    if (board && board.stages.length > 0) {
      setSelectedStageId(board.stages[0].id);
    }
  }, [selectedBoardId, boards]);

  // Fetch leads already linked to this comment's user
  const fetchLinkedLeads = async () => {
    if (!username) return;
    
    setLoadingLeads(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('id, lead_name, status, board_id')
        .ilike('instagram_username', username);
      
      if (error) throw error;
      setLinkedLeads(data || []);
    } catch (error) {
      console.error('Error fetching linked leads:', error);
    } finally {
      setLoadingLeads(false);
    }
  };

  // Search for existing leads to link
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const linkedIds = linkedLeads.map(l => l.id);
      
      let queryBuilder = supabase
        .from('leads')
        .select('id, lead_name, status, board_id')
        .or(`lead_name.ilike.%${query}%,lead_email.ilike.%${query}%,lead_phone.ilike.%${query}%`)
        .limit(10);
      
      if (linkedIds.length > 0) {
        queryBuilder = queryBuilder.not('id', 'in', `(${linkedIds.join(',')})`);
      }
      
      const { data, error } = await queryBuilder;
      
      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error('Error searching leads:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Search for contacts
  const handleSearchContacts = async (query: string) => {
    setSearchContactQuery(query);
    if (query.length < 2) {
      setContactSearchResults([]);
      return;
    }

    setIsSearchingContacts(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, instagram_username')
        .or(`full_name.ilike.%${query}%,instagram_username.ilike.%${query}%`)
        .limit(10);
      
      if (error) throw error;
      setContactSearchResults(data || []);
    } catch (error) {
      console.error('Error searching contacts:', error);
    } finally {
      setIsSearchingContacts(false);
    }
  };

  // Create new contact for relationship
  const handleCreateNewRelatedContact = async () => {
    if (!newContactName.trim()) {
      toast.error('Nome do contato é obrigatório');
      return;
    }

    setIsCreatingContact(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .insert({
          full_name: newContactName.trim(),
        })
        .select('id, full_name, instagram_username')
        .single();

      if (error) throw error;

      toast.success(`Contato "${newContactName}" criado!`);
      setSelectedRelatedContact(data);
      setIsCreatingNewContact(false);
      setNewContactName('');
    } catch (error) {
      console.error('Error creating contact:', error);
      toast.error('Erro ao criar contato');
    } finally {
      setIsCreatingContact(false);
    }
  };

  // Toggle classification selection
  const toggleClassification = (name: string) => {
    setSelectedClassifications(prev => 
      prev.includes(name) 
        ? prev.filter(k => k !== name)
        : [...prev, name]
    );
  };

  // Add new classification
  const handleAddNew = async () => {
    if (!newName.trim()) return;
    
    const result = await addClassification(newName, newColor, newShowInWorkflow);
    if (result) {
      setSelectedClassifications(prev => [...prev, result.name]);
      setIsAddingNew(false);
      setNewName('');
      setNewShowInWorkflow(true);
    }
  };

  // Check if any selected classification implies a relationship
  const hasRelationshipClassification = useMemo(() => {
    const relationshipKeywords = ['primo', 'tio', 'pai', 'mãe', 'filho', 'filha', 'irmão', 'irmã', 'esposa', 'marido', 'parente', 'familia', 'familiar'];
    return selectedClassifications.some(cls => 
      relationshipKeywords.some(keyword => cls.toLowerCase().includes(keyword))
    );
  }, [selectedClassifications]);

  // Move to relationship step after classification
  const handleProceedToRelationship = () => {
    if (hasRelationshipClassification) {
      setShowRelationshipStep(true);
    } else {
      handleApplyClassificationsAndContact();
    }
  };

  // Apply classifications with optional contact creation
  const handleApplyClassificationsAndContact = async () => {
    if (!comment) return;

    const classificationsToSave = selectedClassifications.length > 0 ? selectedClassifications : null;

    setIsSaving(true);
    try {
      // Update all comments from the same author
      if (username) {
        const { error } = await supabase
          .from('instagram_comments')
          .update({ prospect_classification: classificationsToSave })
          .ilike('author_username', username);

        if (error) throw error;

        // Create contact if relationship is defined
        if (hasRelationship && (relatedContactName || selectedRelatedContact)) {
          // First, create or find the comment author as a contact
          const { data: existingContact } = await supabase
            .from('contacts')
            .select('id')
            .ilike('instagram_username', username)
            .maybeSingle();

          let authorContactId = existingContact?.id;
          
          const contactClassificationsToSave = newContactClassifications.length > 0 
            ? newContactClassifications 
            : classificationsToSave || [];

          if (authorContactId) {
            // Update existing contact with new classifications
            await supabase
              .from('contacts')
              .update({ classifications: contactClassificationsToSave })
              .eq('id', authorContactId);
          } else {
            // Create new contact
            const { data: newContact, error: contactError } = await supabase
              .from('contacts')
              .insert({
                full_name: comment.prospect_name || `@${username}`,
                instagram_username: username,
                classifications: contactClassificationsToSave,
              })
              .select('id')
              .single();

            if (contactError) throw contactError;
            authorContactId = newContact.id;
            toast.success(`Contato @${username} criado!`);
          }

          // Create relationship if we have a related contact
          if (authorContactId && selectedRelatedContact) {
            const relationshipType = selectedClassifications.find(cls => 
              ['primo', 'tio', 'pai', 'mãe', 'filho', 'filha', 'irmão', 'irmã', 'esposa', 'marido', 'parente', 'familia', 'familiar']
                .some(keyword => cls.toLowerCase().includes(keyword))
            ) || selectedClassifications[0];

            await supabase
              .from('contact_relationships')
              .insert({
                contact_id: authorContactId,
                related_contact_id: selectedRelatedContact.id,
                relationship_type: relationshipType,
                notes: `Criado via classificação de comentário Instagram`
              });

            toast.success(`Vínculo criado: @${username} é ${relationshipType} de ${selectedRelatedContact.full_name}`);
          }
        }

        const classLabels = selectedClassifications
          .map(k => classificationConfig[k]?.label || k.replace(/_/g, ' '))
          .join(', ');
        
        toast.success(
          classLabels 
            ? `Todos os comentários de @${username} classificados como: ${classLabels}`
            : `Classificação removida de @${username}`
        );
      } else {
        // Single comment update
        const { error } = await supabase
          .from('instagram_comments')
          .update({ prospect_classification: classificationsToSave })
          .eq('id', comment.id);

        if (error) throw error;
        toast.success('Comentário classificado!');
      }

      onClassificationsApplied(classificationsToSave);
      onOpenChange(false);
    } catch (error) {
      console.error('Error classifying comments:', error);
      toast.error('Erro ao classificar comentários');
    } finally {
      setIsSaving(false);
    }
  };

  // Link to existing lead
  const handleLinkToLead = async (leadId: string) => {
    if (!username) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('leads')
        .update({ instagram_username: username, instagram_comment_id: comment?.id })
        .eq('id', leadId);

      if (error) throw error;

      toast.success(`Usuário @${username} vinculado ao lead!`);
      await fetchLinkedLeads();
      setSearchQuery('');
      setSearchResults([]);
      onLeadLinked?.();
    } catch (error) {
      console.error('Error linking to lead:', error);
      toast.error('Erro ao vincular ao lead');
    } finally {
      setIsSaving(false);
    }
  };

  // Unlink from lead
  const handleUnlinkFromLead = async (leadId: string) => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('leads')
        .update({ instagram_username: null, instagram_comment_id: null })
        .eq('id', leadId);

      if (error) throw error;

      toast.success('Vínculo removido!');
      await fetchLinkedLeads();
      onLeadLinked?.();
    } catch (error) {
      console.error('Error unlinking from lead:', error);
      toast.error('Erro ao desvincular');
    } finally {
      setIsSaving(false);
    }
  };

  // Map stage name to valid status
  const mapStageToStatus = (stageName: string): string => {
    const validStatuses = ['new', 'contacted', 'qualified', 'converted', 'lost', 'comment'];
    const normalized = stageName.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/\s+/g, '_');
    
    if (validStatuses.includes(normalized)) {
      return normalized;
    }
    
    // Map common Portuguese terms
    if (normalized.includes('comentario')) return 'comment';
    if (normalized.includes('contato') || normalized.includes('contata')) return 'contacted';
    if (normalized.includes('qualifica')) return 'qualified';
    if (normalized.includes('convert') || normalized.includes('cliente')) return 'converted';
    if (normalized.includes('perdido') || normalized.includes('perda')) return 'lost';
    
    return 'new'; // Default fallback
  };

  // Create new lead and link
  const handleCreateNewLead = async () => {
    if (!selectedBoardId) {
      toast.error('Selecione um quadro');
      return;
    }

    if (!newLeadName.trim()) {
      toast.error('Informe o nome do lead');
      return;
    }

    const selectedBoard = boards.find(b => b.id === selectedBoardId);
    const selectedStage = selectedBoard?.stages.find(s => s.id === selectedStageId);
    const status = mapStageToStatus(selectedStage?.name || 'new');

    setIsSaving(true);
    try {
      // Check for duplicate if username is provided
      if (username) {
        const { data: existingLeads, error: checkError } = await supabase
          .from('leads')
          .select('id, lead_name')
          .eq('board_id', selectedBoardId)
          .ilike('instagram_username', username);
        
        if (checkError) throw checkError;
        
        if (existingLeads && existingLeads.length > 0) {
          toast.error(`Já existe um lead com @${username} neste quadro: "${existingLeads[0].lead_name}"`);
          setIsSaving(false);
          return;
        }
      }

      const { data: newLead, error } = await supabase
        .from('leads')
        .insert({
          lead_name: newLeadName.trim(),
          source: comment?.platform || 'instagram',
          status: status,
          board_id: selectedBoardId,
          instagram_username: username || null,
          instagram_comment_id: comment?.id || null,
          notes: newLeadNotes || (comment ? `Capturado via ${comment?.platform} - Comentou: "${comment?.comment_text?.slice(0, 100)}..."${comment?.post_url ? ` | Post: ${comment?.post_url}` : ''}` : '')
        })
        .select()
        .single();

      if (error) throw error;

      // Track linked contacts count
      let linkedContactsCount = 0;

      // If there's a related contact selected, create contact and link to lead
      if (selectedRelatedContact && newLead) {
        // First, create or find the comment author as a contact
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('id')
          .ilike('instagram_username', username || '')
          .maybeSingle();

        let authorContactId = existingContact?.id;

        if (!authorContactId && username) {
          const contactClassificationsToSave = newContactClassifications.length > 0 
            ? newContactClassifications 
            : (selectedClassifications.length > 0 ? selectedClassifications : null);
          const { data: newContact, error: contactError } = await supabase
            .from('contacts')
            .insert({
              full_name: comment?.prospect_name || `@${username}`,
              instagram_username: username,
              classifications: contactClassificationsToSave,
            })
            .select('id')
            .single();

          if (!contactError && newContact) {
            authorContactId = newContact.id;
          }
        }

        // Link contact to the new lead via contact_leads junction table
        if (authorContactId) {
          const { error: linkError } = await supabase
            .from('contact_leads')
            .insert({
              contact_id: authorContactId,
              lead_id: newLead.id,
              notes: `Vinculado via criação de lead do comentário Instagram`
            });
          if (!linkError) linkedContactsCount++;
        }

        // Also link the related contact to the lead
        const { error: relatedLinkError } = await supabase
          .from('contact_leads')
          .insert({
            contact_id: selectedRelatedContact.id,
            lead_id: newLead.id,
            notes: `Contato relacionado vinculado via classificação`
          });
        if (!relatedLinkError) linkedContactsCount++;
      } else if (username && newLead) {
        // No related contact, but still create author contact and link
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('id')
          .ilike('instagram_username', username)
          .maybeSingle();

        let authorContactId = existingContact?.id;

        if (!authorContactId) {
          const contactClassificationsToSave = newContactClassifications.length > 0 
            ? newContactClassifications 
            : (selectedClassifications.length > 0 ? selectedClassifications : null);
          const { data: newContact, error: contactError } = await supabase
            .from('contacts')
            .insert({
              full_name: comment?.prospect_name || newLeadName.trim() || `@${username}`,
              instagram_username: username,
              classifications: contactClassificationsToSave,
            })
            .select('id')
            .single();

          if (!contactError && newContact) {
            authorContactId = newContact.id;
          }
        }

        // Link contact to the new lead
        if (authorContactId) {
          const { error: linkError } = await supabase
            .from('contact_leads')
            .insert({
              contact_id: authorContactId,
              lead_id: newLead.id,
              notes: `Vinculado via criação de lead do comentário Instagram`
            });
          if (!linkError) linkedContactsCount++;
        }
      }

      // Build success message with contact count
      const contactsMessage = linkedContactsCount > 0 
        ? ` • ${linkedContactsCount} contato${linkedContactsCount > 1 ? 's' : ''} vinculado${linkedContactsCount > 1 ? 's' : ''}`
        : '';
      
      toast.success(`Lead "${newLeadName}" criado no quadro "${selectedBoard?.name}"!${contactsMessage}`);
      setNewLeadName('');
      setNewLeadNotes('');
      await fetchLinkedLeads();
      onLeadLinked?.();
    } catch (error) {
      console.error('Error creating lead:', error);
      toast.error('Erro ao criar lead');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedBoard = boards.find(b => b.id === selectedBoardId);

  // Format classification label
  const getLabel = (name: string): string => {
    if (classificationConfig[name]?.label) {
      return classificationConfig[name].label;
    }
    return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Relationship step content
  if (showRelationshipStep) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Em relação a quem?
            </DialogTitle>
            <DialogDescription>
              A classificação <strong>{selectedClassifications.filter(cls => 
                ['primo', 'tio', 'pai', 'mãe', 'filho', 'filha', 'irmão', 'irmã', 'esposa', 'marido', 'parente', 'familia', 'familiar']
                  .some(keyword => cls.toLowerCase().includes(keyword))
              ).map(c => getLabel(c)).join(', ')}</strong> sugere um vínculo familiar. Deseja registrar em relação a quem é essa classificação?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="has-relationship" className="text-sm">
                Este contato tem um vínculo com alguém?
              </Label>
              <Switch
                id="has-relationship"
                checked={hasRelationship}
                onCheckedChange={setHasRelationship}
              />
            </div>

            {hasRelationship && (
              <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                {!isCreatingNewContact ? (
                  <>
                    <Label className="text-sm font-medium">Buscar contato existente</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Buscar contato..."
                        className="pl-9"
                        value={searchContactQuery}
                        onChange={(e) => handleSearchContacts(e.target.value)}
                      />
                    </div>
                    
                    {contactSearchResults.length > 0 && (
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {contactSearchResults.map((contact) => (
                          <div 
                            key={contact.id} 
                            className={cn(
                              "flex items-center justify-between p-2 border rounded cursor-pointer transition-colors",
                              selectedRelatedContact?.id === contact.id 
                                ? "bg-primary/10 border-primary" 
                                : "hover:bg-muted/50"
                            )}
                            onClick={() => setSelectedRelatedContact(contact)}
                          >
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">{contact.full_name}</span>
                              {contact.instagram_username && (
                                <span className="text-xs text-muted-foreground">@{contact.instagram_username}</span>
                              )}
                            </div>
                            {selectedRelatedContact?.id === contact.id && (
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {searchContactQuery.length >= 2 && contactSearchResults.length === 0 && !isSearchingContacts && (
                      <div className="text-center py-3 text-muted-foreground text-sm">
                        Nenhum contato encontrado
                      </div>
                    )}

                    {/* Button to create new contact */}
                    <Button
                      variant="outline"
                      className="w-full border-dashed"
                      onClick={() => {
                        setIsCreatingNewContact(true);
                        setNewContactName(searchContactQuery);
                      }}
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Criar novo contato
                    </Button>
                  </>
                ) : (
                  <>
                    <Label className="text-sm font-medium">Criar novo contato</Label>
                    <Input
                      placeholder="Nome completo do contato..."
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        onClick={handleCreateNewRelatedContact} 
                        disabled={!newContactName.trim() || isCreatingContact}
                      >
                        {isCreatingContact ? (
                          <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4 mr-1" />
                        )}
                        Criar
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => {
                          setIsCreatingNewContact(false);
                          setNewContactName('');
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </>
                )}

                {selectedRelatedContact && (
                  <div className="p-2 bg-primary/10 rounded-lg flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="text-sm">
                      <strong>@{username}</strong> é <strong>{selectedClassifications.filter(cls => 
                        ['primo', 'tio', 'pai', 'mãe', 'filho', 'filha', 'irmão', 'irmã', 'esposa', 'marido', 'parente', 'familia', 'familiar']
                          .some(keyword => cls.toLowerCase().includes(keyword))
                      ).map(c => getLabel(c)).join(', ')}</strong> de <strong>{selectedRelatedContact.full_name}</strong>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowRelationshipStep(false)}>
              Voltar
            </Button>
            <Button onClick={handleApplyClassificationsAndContact} disabled={isSaving}>
              {isSaving ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            Classificar e Vincular
          </DialogTitle>
          <DialogDescription>
            Gerencie classificações e leads para <strong className="text-foreground">@{username}</strong>
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="classify" className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Classificar
            </TabsTrigger>
            <TabsTrigger value="lead" className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Leads
              {linkedLeads.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {linkedLeads.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="classify" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-4">
                {/* Classifications grid */}
                {classifications.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Nenhuma classificação cadastrada.</p>
                    <p className="text-sm">Crie uma nova abaixo.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {classifications.map((cls) => (
                      <Button
                        key={cls.id}
                        variant={selectedClassifications.includes(cls.name) ? "default" : "outline"}
                        className={cn(
                          "justify-start h-auto py-2",
                          selectedClassifications.includes(cls.name) && cls.color,
                          selectedClassifications.includes(cls.name) && "text-white"
                        )}
                        onClick={() => toggleClassification(cls.name)}
                      >
                        <CheckCircle2 className={cn(
                          "h-4 w-4 mr-2 flex-shrink-0",
                          selectedClassifications.includes(cls.name) ? "opacity-100" : "opacity-0"
                        )} />
                        <span className="truncate">{getLabel(cls.name)}</span>
                      </Button>
                    ))}
                  </div>
                )}

                {/* Add new classification */}
                {isAddingNew ? (
                  <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                    <Input
                      placeholder="Nome da nova classificação..."
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      autoFocus
                    />
                    <div className="flex flex-wrap gap-2">
                      {classificationColors.slice(0, 12).map((color) => (
                        <button
                          key={color.value}
                          type="button"
                          className={cn(
                            "w-6 h-6 rounded-full transition-all",
                            color.value,
                            newColor === color.value && "ring-2 ring-offset-2 ring-primary"
                          )}
                          onClick={() => setNewColor(color.value)}
                          title={color.label}
                        />
                      ))}
                    </div>
                    
                    {/* Show in workflow toggle */}
                    <div className="flex items-center justify-between p-2 rounded-lg border bg-background">
                      <div className="flex items-center gap-2">
                        {newShowInWorkflow ? (
                          <Eye className="h-4 w-4 text-green-500" />
                        ) : (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm">Exibir para responder</span>
                      </div>
                      <Switch
                        checked={newShowInWorkflow}
                        onCheckedChange={setNewShowInWorkflow}
                      />
                    </div>
                    
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleAddNew} disabled={!newName.trim()}>
                        Criar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        setIsAddingNew(false);
                        setNewName('');
                        setNewShowInWorkflow(true);
                      }}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full border-dashed"
                    onClick={() => setIsAddingNew(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Nova Classificação
                  </Button>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="lead" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-4">
                {/* Linked leads */}
                {linkedLeads.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Leads vinculados</Label>
                    {linkedLeads.map((lead) => {
                      const board = boards.find(b => b.id === lead.board_id);
                      return (
                        <div key={lead.id} className="flex items-center justify-between p-2 border rounded-lg bg-muted/30">
                          <div className="flex items-center gap-2">
                            <Link2 className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium">{lead.lead_name}</span>
                            {board && (
                              <Badge variant="outline" className="text-xs">
                                {board.name}
                              </Badge>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-destructive hover:text-destructive"
                            onClick={() => handleUnlinkFromLead(lead.id)}
                            disabled={isSaving}
                          >
                            <Unlink className="h-3 w-3 mr-1" />
                            Desvincular
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Search existing leads */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Vincular a lead existente</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar lead por nome, email ou telefone..."
                      className="pl-9"
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                    />
                  </div>
                  {searchResults.length > 0 && (
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {searchResults.map((lead) => (
                        <div key={lead.id} className="flex items-center justify-between p-2 border rounded hover:bg-muted/50">
                          <span className="text-sm">{lead.lead_name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => handleLinkToLead(lead.id)}
                            disabled={isSaving}
                          >
                            <Link2 className="h-3 w-3 mr-1" />
                            Vincular
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Create new lead */}
                <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    Criar novo lead
                  </Label>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Nome do Lead *</Label>
                    <Input
                      placeholder={username ? `@${username}` : "Nome do lead..."}
                      value={newLeadName}
                      onChange={(e) => setNewLeadName(e.target.value)}
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Quadro</Label>
                      <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Quadro..." />
                        </SelectTrigger>
                        <SelectContent>
                          {boards.map((board) => (
                            <SelectItem key={board.id} value={board.id}>
                              <div className="flex items-center gap-2">
                                <Kanban className="h-3 w-3" />
                                {board.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Estágio</Label>
                      <Select value={selectedStageId} onValueChange={setSelectedStageId}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Estágio..." />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedBoard?.stages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.id}>
                              <div className="flex items-center gap-2">
                                <div 
                                  className="w-2 h-2 rounded-full" 
                                  style={{ backgroundColor: stage.color }} 
                                />
                                {stage.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Contact classifications for the new contact */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Classificar contato vinculado</Label>
                    <div className="flex flex-wrap gap-1">
                      {classifications.map((c) => {
                        const isSelected = newContactClassifications.includes(c.name);
                        return (
                          <Badge
                            key={c.name}
                            variant={isSelected ? "default" : "outline"}
                            className={cn(
                              "cursor-pointer transition-all text-xs py-0.5",
                              isSelected && c.color,
                              isSelected && "text-white"
                            )}
                            onClick={() => {
                              setNewContactClassifications(prev =>
                                prev.includes(c.name)
                                  ? prev.filter(k => k !== c.name)
                                  : [...prev, c.name]
                              );
                            }}
                          >
                            {classificationConfig[c.name]?.label || c.name.replace(/_/g, ' ')}
                            {isSelected && <CheckCircle2 className="h-3 w-3 ml-1" />}
                          </Badge>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Essas classificações serão aplicadas ao contato criado automaticamente
                    </p>
                  </div>

                  <Textarea
                    placeholder="Observações (opcional)..."
                    value={newLeadNotes}
                    onChange={(e) => setNewLeadNotes(e.target.value)}
                    className="h-16 resize-none"
                  />

                  <Button 
                    className="w-full" 
                    onClick={handleCreateNewLead}
                    disabled={isSaving || !selectedBoardId || !newLeadName.trim()}
                  >
                    {isSaving ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4 mr-2" />
                    )}
                    Criar Lead em "{selectedBoard?.name || 'Quadro'}"
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex gap-2 sm:gap-0 border-t pt-4 mt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>
          {activeTab === 'classify' && (
            <Button onClick={handleProceedToRelationship} disabled={isSaving}>
              {isSaving ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Tag className="h-4 w-4 mr-2" />
              )}
              Aplicar Classificações
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
