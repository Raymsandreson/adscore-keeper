import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Instagram,
  Search,
  Users,
  MessageSquare,
  Clock,
  Check,
  Filter,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { Lead } from '@/hooks/useLeads';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface InstagramProspect {
  id: string;
  author_username: string | null;
  comment_text: string | null;
  created_at: string;
  funnel_stage: string | null;
  prospect_name: string | null;
  post_url: string | null;
  comment_type: string;
  already_converted: boolean;
}

interface ImportInstagramProspectsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boards: KanbanBoard[];
  targetBoardId: string | null;
  onImportComplete: () => void;
}

const FUNNEL_STAGES = [
  { key: 'comment', label: 'Comentário', color: 'text-blue-600' },
  { key: 'dm', label: 'DM', color: 'text-purple-600' },
  { key: 'whatsapp', label: 'WhatsApp', color: 'text-green-600' },
  { key: 'visit_scheduled', label: 'Agendada', color: 'text-orange-600' },
  { key: 'visit_done', label: 'Visitou', color: 'text-amber-600' },
  { key: 'closed', label: 'Fechado', color: 'text-emerald-600' },
  { key: 'post_sale', label: 'Pós-venda', color: 'text-teal-600' },
];

export function ImportInstagramProspects({
  open,
  onOpenChange,
  boards,
  targetBoardId,
  onImportComplete,
}: ImportInstagramProspectsProps) {
  const [prospects, setProspects] = useState<InstagramProspect[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProspects, setSelectedProspects] = useState<Set<string>>(new Set());
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(targetBoardId);
  const [stageFilter, setStageFilter] = useState<string>('all_active');

  useEffect(() => {
    if (open) {
      fetchProspects();
      setSelectedBoardId(targetBoardId);
    }
  }, [open, targetBoardId]);

  const fetchProspects = async () => {
    setLoading(true);
    try {
      // Fetch prospects from instagram_comments
      const { data: comments, error: commentsError } = await supabase
        .from('instagram_comments')
        .select('id, author_username, comment_text, created_at, funnel_stage, prospect_name, post_url, comment_type')
        .order('created_at', { ascending: false })
        .limit(200);

      if (commentsError) throw commentsError;

      // Fetch existing leads with instagram_comment_id to know which are already converted
      const { data: existingLeads, error: leadsError } = await supabase
        .from('leads')
        .select('instagram_comment_id')
        .not('instagram_comment_id', 'is', null);

      if (leadsError) throw leadsError;

      const convertedIds = new Set(existingLeads?.map(l => l.instagram_comment_id) || []);

      const mappedProspects: InstagramProspect[] = (comments || []).map(c => ({
        id: c.id,
        author_username: c.author_username,
        comment_text: c.comment_text,
        created_at: c.created_at,
        funnel_stage: c.funnel_stage,
        prospect_name: c.prospect_name,
        post_url: c.post_url,
        comment_type: c.comment_type,
        already_converted: convertedIds.has(c.id),
      }));

      setProspects(mappedProspects);
    } catch (error) {
      console.error('Error fetching prospects:', error);
      toast.error('Erro ao buscar prospectos');
    } finally {
      setLoading(false);
    }
  };

  const filteredProspects = useMemo(() => {
    let filtered = prospects;

    // Filter by stage
    if (stageFilter === 'all_active') {
      filtered = filtered.filter(p => !['closed', 'post_sale'].includes(p.funnel_stage || ''));
    } else if (stageFilter !== 'all') {
      filtered = filtered.filter(p => p.funnel_stage === stageFilter);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.author_username?.toLowerCase().includes(query) ||
        p.prospect_name?.toLowerCase().includes(query) ||
        p.comment_text?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [prospects, stageFilter, searchQuery]);

  const availableProspects = useMemo(() => {
    return filteredProspects.filter(p => !p.already_converted);
  }, [filteredProspects]);

  const toggleSelectAll = () => {
    if (selectedProspects.size === availableProspects.length) {
      setSelectedProspects(new Set());
    } else {
      setSelectedProspects(new Set(availableProspects.map(p => p.id)));
    }
  };

  const toggleProspect = (id: string) => {
    const newSet = new Set(selectedProspects);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedProspects(newSet);
  };

  const handleImport = async () => {
    if (selectedProspects.size === 0) {
      toast.error('Selecione pelo menos um prospecto');
      return;
    }

    if (!selectedBoardId) {
      toast.error('Selecione um quadro de destino');
      return;
    }

    const targetBoard = boards.find(b => b.id === selectedBoardId);
    const firstStage = targetBoard?.stages[0]?.id || 'new';

    setImporting(true);
    try {
      const prospectsToImport = prospects.filter(p => selectedProspects.has(p.id));
      
      const leadsToInsert = prospectsToImport.map(p => ({
        lead_name: p.prospect_name || `@${p.author_username}` || 'Prospecto Instagram',
        source: 'instagram',
        status: firstStage,
        board_id: selectedBoardId,
        instagram_comment_id: p.id,
        instagram_username: p.author_username,
        notes: `Importado do Instagram - Estágio: ${FUNNEL_STAGES.find(s => s.key === p.funnel_stage)?.label || p.funnel_stage}${p.comment_text ? `\n\nComentário: "${p.comment_text.slice(0, 200)}${p.comment_text.length > 200 ? '...' : ''}"` : ''}${p.post_url ? `\n\nPost: ${p.post_url}` : ''}`,
      }));

      const { error } = await supabase
        .from('leads')
        .insert(leadsToInsert);

      if (error) throw error;

      toast.success(`${leadsToInsert.length} prospecto${leadsToInsert.length > 1 ? 's' : ''} importado${leadsToInsert.length > 1 ? 's' : ''} com sucesso!`);
      setSelectedProspects(new Set());
      onImportComplete();
      onOpenChange(false);
    } catch (error) {
      console.error('Error importing prospects:', error);
      toast.error('Erro ao importar prospectos');
    } finally {
      setImporting(false);
    }
  };

  const getStageConfig = (stage: string | null) => {
    return FUNNEL_STAGES.find(s => s.key === stage) || { label: stage || 'N/A', color: 'text-muted-foreground' };
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Instagram className="h-5 w-5 text-pink-500" />
            Importar Prospectos do Instagram
          </SheetTitle>
          <SheetDescription>
            Selecione prospectos da sua base do Instagram para convertê-los em leads no Kanban.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* Target Board Selection */}
          <div>
            <label className="text-sm font-medium mb-2 block">Quadro de Destino</label>
            <Select value={selectedBoardId || undefined} onValueChange={setSelectedBoardId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um quadro" />
              </SelectTrigger>
              <SelectContent>
                {boards.map(board => (
                  <SelectItem key={board.id} value={board.id}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: board.color }}
                      />
                      {board.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por @usuario ou texto..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-[140px]">
                <Filter className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_active">Ativos</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
                {FUNNEL_STAGES.map(stage => (
                  <SelectItem key={stage.key} value={stage.key}>
                    {stage.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Select All */}
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={availableProspects.length > 0 && selectedProspects.size === availableProspects.length}
                onCheckedChange={toggleSelectAll}
                disabled={availableProspects.length === 0}
              />
              <span className="text-sm text-muted-foreground">
                Selecionar todos ({availableProspects.length} disponíveis)
              </span>
            </div>
            {selectedProspects.size > 0 && (
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                {selectedProspects.size} selecionado{selectedProspects.size > 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          {/* Prospects List */}
          <ScrollArea className="h-[400px] border rounded-lg">
            {loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Carregando prospectos...
              </div>
            ) : filteredProspects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Users className="h-8 w-8 mb-2" />
                <p>Nenhum prospecto encontrado</p>
              </div>
            ) : (
              <div className="p-2 space-y-2">
                {filteredProspects.map(prospect => {
                  const stageConfig = getStageConfig(prospect.funnel_stage);
                  const isSelected = selectedProspects.has(prospect.id);
                  const isConverted = prospect.already_converted;

                  return (
                    <div
                      key={prospect.id}
                      className={`p-3 rounded-lg border transition-colors ${
                        isConverted 
                          ? 'bg-muted/50 opacity-60' 
                          : isSelected 
                            ? 'bg-primary/5 border-primary/30' 
                            : 'hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleProspect(prospect.id)}
                          disabled={isConverted}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">
                              {prospect.prospect_name || `@${prospect.author_username}` || 'Desconhecido'}
                            </span>
                            <Badge variant="secondary" className={`text-xs ${stageConfig.color}`}>
                              {stageConfig.label}
                            </Badge>
                            {isConverted && (
                              <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                                <Check className="h-3 w-3 mr-1" />
                                Já importado
                              </Badge>
                            )}
                          </div>
                          
                          {prospect.comment_text && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              <MessageSquare className="h-3 w-3 inline mr-1" />
                              {prospect.comment_text}
                            </p>
                          )}

                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDistanceToNow(new Date(prospect.created_at), { 
                                addSuffix: true, 
                                locale: ptBR 
                              })}
                            </span>
                            {prospect.post_url && (
                              <a
                                href={prospect.post_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 hover:text-primary"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Ver post
                              </a>
                            )}
                          </div>

                          {/* Classifications now come from contacts table, not shown here */}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        <SheetFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancelar
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={selectedProspects.size === 0 || !selectedBoardId || importing}
            className="flex-1"
          >
            {importing ? 'Importando...' : (
              <>
                <ArrowRight className="h-4 w-4 mr-2" />
                Importar {selectedProspects.size > 0 ? `(${selectedProspects.size})` : ''}
              </>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
