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
  ExternalLink
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
}

interface LinkedLead {
  id: string;
  lead_name: string | null;
  status: string | null;
  board_id: string | null;
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
  const { classifications, classificationConfig, addClassification } = useContactClassifications();
  const { boards } = useKanbanBoards();

  const [selectedClassifications, setSelectedClassifications] = useState<string[]>([]);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('bg-blue-500');
  const [isSaving, setIsSaving] = useState(false);
  
  // Lead linking state
  const [activeTab, setActiveTab] = useState<'classify' | 'lead'>('classify');
  const [linkedLeads, setLinkedLeads] = useState<LinkedLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  
  // New lead creation
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [selectedStageId, setSelectedStageId] = useState<string>('');
  const [newLeadNotes, setNewLeadNotes] = useState('');
  
  // Search existing leads
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LinkedLead[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const username = comment?.author_username?.replace('@', '').toLowerCase() || '';

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open && comment) {
      setSelectedClassifications(comment.prospect_classification || []);
      setActiveTab('classify');
      setIsAddingNew(false);
      setNewName('');
      setSearchQuery('');
      setSearchResults([]);
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
    
    const result = await addClassification(newName, newColor);
    if (result) {
      setSelectedClassifications(prev => [...prev, result.name]);
      setIsAddingNew(false);
      setNewName('');
    }
  };

  // Apply classifications to comment
  const handleApplyClassifications = async () => {
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

        const classLabels = selectedClassifications
          .map(k => classificationConfig[k]?.label || k)
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

  // Create new lead and link
  const handleCreateNewLead = async () => {
    if (!username || !selectedBoardId) {
      toast.error('Selecione um quadro');
      return;
    }

    const selectedBoard = boards.find(b => b.id === selectedBoardId);
    const selectedStage = selectedBoard?.stages.find(s => s.id === selectedStageId);

    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .insert({
          lead_name: `@${username}`,
          source: comment?.platform || 'instagram',
          status: selectedStage?.name?.toLowerCase().replace(/\s+/g, '_') || 'new',
          board_id: selectedBoardId,
          instagram_username: username,
          instagram_comment_id: comment?.id,
          notes: newLeadNotes || `Capturado via ${comment?.platform} - Comentou: "${comment?.comment_text?.slice(0, 100)}..."${comment?.post_url ? ` | Post: ${comment?.post_url}` : ''}`
        })
        .select()
        .single();

      if (error) throw error;

      toast.success(`Lead @${username} criado no quadro "${selectedBoard?.name}"!`);
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
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleAddNew} disabled={!newName.trim()}>
                        Criar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        setIsAddingNew(false);
                        setNewName('');
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

                  <Textarea
                    placeholder="Observações (opcional)..."
                    value={newLeadNotes}
                    onChange={(e) => setNewLeadNotes(e.target.value)}
                    className="h-16 resize-none"
                  />

                  <Button 
                    className="w-full" 
                    onClick={handleCreateNewLead}
                    disabled={isSaving || !selectedBoardId}
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
            <Button onClick={handleApplyClassifications} disabled={isSaving}>
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
