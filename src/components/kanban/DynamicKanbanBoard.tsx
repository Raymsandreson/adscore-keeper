import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useConfirmDelete } from '@/hooks/useConfirmDelete';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { ShareMenu } from '@/components/ShareMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import {
  Phone,
  Mail,
  MoreVertical,
  GripVertical,
  Users,
  Trash2,
  Edit2,
  MessageSquare,
  Instagram,
  ExternalLink,
  Link2,
  ArrowRightLeft,
  UserPlus,
  Clock,
  AlertTriangle,
  Eye,
  Briefcase,
  Search,
  X,
  LayoutGrid,
  ChevronRight,
  CheckCircle2,
  XCircle,
  ClipboardPlus,
  Copy,
} from 'lucide-react';
import { CopyableText } from '@/components/ui/copyable-text';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { Lead } from '@/hooks/useLeads';
import { differenceInDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { LeadContactsManager } from './LeadContactsManager';
import { LeadCardChecklists } from './LeadCardChecklists';
import { ProfessionBadgePopover } from '@/components/instagram/ProfessionBadgePopover';
import { toast } from 'sonner';
import { findClosedStageId, findRefusedStageId, isClosedStage, isRefusedStage } from '@/utils/kanbanStageTypes';

interface DynamicKanbanBoardProps {
  board: KanbanBoard;
  leads: Lead[];
  loading: boolean;
  onMoveToStage: (leadId: string, stageId: string) => void;
  onMoveToBoard: (leadId: string, boardId: string, stageId?: string) => void;
  onDeleteLead: (id: string) => void;
  onCloneLead?: (lead: Lead) => void;
  onEditLead?: (lead: Lead) => void;
  onManageContacts?: (lead: Lead) => void;
  availableBoards?: KanbanBoard[];
  onChangeLeadStatus?: (leadId: string, newStatus: 'active' | 'closed' | 'refused' | 'inviavel') => void;
}

export function DynamicKanbanBoard({
  board,
  leads,
  loading,
  onMoveToStage,
  onMoveToBoard,
  onDeleteLead,
  onCloneLead,
  onEditLead,
  onManageContacts,
  availableBoards = [],
  onChangeLeadStatus,
}: DynamicKanbanBoardProps) {
  const { confirmDelete, ConfirmDeleteDialog } = useConfirmDelete();
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [conversionDialog, setConversionDialog] = useState<{ open: boolean; leadId: string | null; stageId: string | null }>({
    open: false,
    leadId: null,
    stageId: null,
  });
  const [conversionValue, setConversionValue] = useState('');
  const [contactsManagerLead, setContactsManagerLead] = useState<Lead | null>(null);
  const [activityDialog, setActivityDialog] = useState<{ open: boolean; lead: Lead | null }>({ open: false, lead: null });
  const [activityTitle, setActivityTitle] = useState('Dar andamento');
  const [activityDescription, setActivityDescription] = useState('');
  const [contactCounts, setContactCounts] = useState<Record<string, number>>({});
  const [leadContacts, setLeadContacts] = useState<Record<string, { id: string; full_name: string; phone?: string | null; instagram_username?: string | null; profession?: string | null; profession_cbo_code?: string | null }[]>>({});
  const [stageFilters, setStageFilters] = useState<Record<string, string>>({});
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const PAGE_INCREMENT = 50;
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  const handleTopScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (bottomScrollRef.current && topScrollRef.current) {
      bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
    isSyncing.current = false;
  }, []);

  const handleBottomScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (topScrollRef.current && bottomScrollRef.current) {
      topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
    }
    isSyncing.current = false;
  }, []);

  // Fetch contacts for all leads (using contact_leads junction + legacy lead_id)
  useEffect(() => {
    const fetchLeadContacts = async () => {
      const leadIds = leads.map(l => l.id);
      if (leadIds.length === 0) return;

      // Fetch from contact_leads junction table
      const { data: junctionData, error: junctionError } = await supabase
        .from('contact_leads')
        .select('lead_id, contact_id')
        .in('lead_id', leadIds);

      if (junctionError) {
        console.error('Error fetching contact_leads:', junctionError);
        return;
      }

      // Fetch legacy contacts with lead_id
      const { data: legacyData, error: legacyError } = await supabase
        .from('contacts')
        .select('id, lead_id, full_name, phone, instagram_username, profession, profession_cbo_code')
        .in('lead_id', leadIds);

      if (legacyError) {
        console.error('Error fetching legacy contacts:', legacyError);
      }

      // Get all contact IDs from junction
      const junctionContactIds = (junctionData || []).map(j => j.contact_id);
      
      // Fetch contact names for junction contacts
      let junctionContacts: { id: string; full_name: string; phone?: string | null; instagram_username?: string | null; profession?: string | null; profession_cbo_code?: string | null }[] = [];
      if (junctionContactIds.length > 0) {
        const { data: contactsData } = await supabase
          .from('contacts')
          .select('id, full_name, phone, instagram_username, profession, profession_cbo_code')
          .in('id', junctionContactIds);
        junctionContacts = contactsData || [];
      }

      // Build contacts map per lead
      const contactsMap: Record<string, { id: string; full_name: string; phone?: string | null; instagram_username?: string | null; profession?: string | null; profession_cbo_code?: string | null }[]> = {};
      const counts: Record<string, number> = {};

      // Add junction contacts
      (junctionData || []).forEach(junction => {
        const contact = junctionContacts.find(c => c.id === junction.contact_id);
        if (contact) {
          if (!contactsMap[junction.lead_id]) {
            contactsMap[junction.lead_id] = [];
          }
          // Avoid duplicates
          if (!contactsMap[junction.lead_id].some(c => c.id === contact.id)) {
            contactsMap[junction.lead_id].push(contact);
          }
        }
      });

      // Add legacy contacts
      (legacyData || []).forEach(contact => {
        if (contact.lead_id) {
          if (!contactsMap[contact.lead_id]) {
            contactsMap[contact.lead_id] = [];
          }
          // Avoid duplicates
          if (!contactsMap[contact.lead_id].some(c => c.id === contact.id)) {
            contactsMap[contact.lead_id].push({ 
              id: contact.id, 
              full_name: contact.full_name,
              phone: contact.phone,
              instagram_username: contact.instagram_username,
              profession: contact.profession,
              profession_cbo_code: contact.profession_cbo_code
            });
          }
        }
      });

      // Calculate counts
      Object.keys(contactsMap).forEach(leadId => {
        counts[leadId] = contactsMap[leadId].length;
      });

      setLeadContacts(contactsMap);
      setContactCounts(counts);
    };

    fetchLeadContacts();
  }, [leads]);

  // Separate leads by business status
  const activeLeads = useMemo(() => leads.filter(l => (l as any).lead_status === 'active' || !(l as any).lead_status), [leads]);
  const closedLeads = useMemo(() => leads.filter(l => (l as any).lead_status === 'closed'), [leads]);
  const refusedLeads = useMemo(() => leads.filter(l => (l as any).lead_status === 'refused'), [leads]);
  const inviavelLeads = useMemo(() => leads.filter(l => (l as any).lead_status === 'inviavel'), [leads]);

  // Group active leads by stage
  const leadsByStage = useMemo(() => {
    const grouped: Record<string, Lead[]> = {};
    board.stages.forEach(stage => {
      grouped[stage.id] = [];
    });
    
    activeLeads.forEach(lead => {
      const stageId = lead.status || board.stages[0]?.id;
      if (grouped[stageId]) {
        grouped[stageId].push(lead);
      } else if (board.stages.length > 0) {
        // Put in first stage if status doesn't match
        grouped[board.stages[0].id].push(lead);
      }
    });
    
    return grouped;
  }, [activeLeads, board.stages]);

  const getInitials = useCallback((name: string | null) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }, []);

  const getDaysInStage = useCallback((lead: Lead) => {
    return differenceInDays(new Date(), new Date(lead.updated_at));
  }, []);

  const isLeadStagnant = useCallback((lead: Lead, stageId: string) => {
    const stage = board.stages.find(s => s.id === stageId);
    if (!stage?.stagnationDays) return false;
    const daysInStage = getDaysInStage(lead);
    return daysInStage >= stage.stagnationDays;
  }, [board.stages, getDaysInStage]);

  // Calculate stagnant leads for the alert panel
  const stagnantLeads = useMemo(() => {
    const stagnant: { lead: Lead; stage: typeof board.stages[0]; daysInStage: number }[] = [];
    
    board.stages.forEach(stage => {
      if (!stage.stagnationDays) return;
      
      const stageLeads = leadsByStage[stage.id] || [];
      stageLeads.forEach(lead => {
        const daysInStage = getDaysInStage(lead);
        if (daysInStage >= stage.stagnationDays!) {
          stagnant.push({ lead, stage, daysInStage });
        }
      });
    });

    return stagnant.sort((a, b) => b.daysInStage - a.daysInStage);
  }, [leadsByStage, board.stages]);

  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    setDraggedLead(lead);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStage(stageId);
  };

  const handleDragLeave = () => {
    setDragOverStage(null);
  };

  const handleDrop = (e: React.DragEvent, newStageId: string) => {
    e.preventDefault();
    setDragOverStage(null);

    if (draggedLead && draggedLead.status !== newStageId) {
      // Check if moving to a "closed" or "converted" stage
      const stage = board.stages.find(s => s.id === newStageId);
      if (stage?.id.includes('closed') || stage?.id.includes('converted')) {
        setConversionDialog({ open: true, leadId: draggedLead.id, stageId: newStageId });
      } else {
        onMoveToStage(draggedLead.id, newStageId);
      }
    }
    setDraggedLead(null);
  };

  const handleConversionConfirm = () => {
    if (conversionDialog.leadId && conversionDialog.stageId) {
      onMoveToStage(conversionDialog.leadId, conversionDialog.stageId);
    }
    setConversionDialog({ open: false, leadId: null, stageId: null });
    setConversionValue('');
  };

  const handleDeleteClick = (id: string) => {
    confirmDelete('Remover Lead', 'Tem certeza que deseja remover este lead? Esta ação não pode ser desfeita.', () => onDeleteLead(id));
  };

  const handleCreateActivity = async () => {
    const lead = activityDialog.lead;
    if (!lead) return;
    try {
      const { error } = await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        lead_name: lead.lead_name,
        title: activityTitle.trim() || 'Dar andamento',
        description: activityDescription.trim() || null,
        activity_type: 'tarefa',
        status: 'pendente',
        priority: 'normal',
        deadline: new Date().toISOString().split('T')[0],
      });
      if (error) throw error;
      toast.success('Atividade criada com sucesso!');
      setActivityDialog({ open: false, lead: null });
      setActivityTitle('Dar andamento');
      setActivityDescription('');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao criar atividade');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Carregando leads...
      </div>
    );
  }

  return (
    <TooltipProvider>
      <>
        {/* Stagnant Leads Alert Panel */}
        {stagnantLeads.length > 0 && (
          <div className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <h4 className="font-medium text-sm text-red-700 dark:text-red-400">
                {stagnantLeads.length} lead{stagnantLeads.length > 1 ? 's' : ''} parado{stagnantLeads.length > 1 ? 's' : ''}
              </h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {stagnantLeads.slice(0, 5).map(({ lead, stage, daysInStage }) => (
                <div 
                  key={lead.id}
                  className="flex items-center gap-2 px-2 py-1 rounded-md bg-white dark:bg-background border border-red-200 dark:border-red-800"
                >
                  <span className="text-xs font-medium truncate max-w-[120px]">
                    {lead.lead_name || 'Sem nome'}
                  </span>
                  <Badge variant="outline" className="text-xs text-red-600 border-red-300">
                    {daysInStage}d em {stage.name}
                  </Badge>
                  {lead.lead_phone && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => window.open(`https://wa.me/${lead.lead_phone?.replace(/\D/g, '')}`, '_blank')}
                    >
                      <Phone className="h-3 w-3 text-green-600" />
                    </Button>
                  )}
                </div>
              ))}
              {stagnantLeads.length > 5 && (
                <Badge variant="secondary" className="text-xs">
                  +{stagnantLeads.length - 5} mais
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Top scrollbar */}
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          className="overflow-x-auto"
          style={{ height: '12px' }}
        >
          <div style={{ width: `calc(${board.stages.length + 2} * max(260px, calc((100vw - ${(board.stages.length + 2) * 4 + 16}px) / ${board.stages.length + 2})) + ${(board.stages.length + 1) * 4}px)`, height: '1px' }} />
        </div>

        <div ref={bottomScrollRef} onScroll={handleBottomScroll} className="flex gap-1 overflow-x-auto pb-4">
          {board.stages.map((stage) => {
            const stageFilter = stageFilters[stage.id] || '';
            const allStageLeads = leadsByStage[stage.id] || [];
            // Filter leads by search query within the column
            const matchedStageLeads = stageFilter
              ? allStageLeads.filter(lead =>
                  lead.lead_name?.toLowerCase().includes(stageFilter.toLowerCase())
                )
              : allStageLeads;
            // Pagination: show only `visibleCount` cards. Bypass when filtering.
            const visibleCount = visibleCounts[stage.id] ?? PAGE_INCREMENT;
            const stageLeads = stageFilter
              ? matchedStageLeads
              : matchedStageLeads.slice(0, visibleCount);
            const hasMore = !stageFilter && matchedStageLeads.length > stageLeads.length;
            const isDropTarget = dragOverStage === stage.id;

            return (
              <div
                key={stage.id}
                className={`flex-shrink-0 rounded-lg border transition-all ${
                  isDropTarget ? 'ring-2 ring-primary ring-offset-2' : ''
                }`}
                style={{ width: `max(260px, calc((100vw - ${(board.stages.length + 2) * 4 + 16}px) / ${board.stages.length + 2}))` }}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                {/* Column Header */}
                <div 
                  className="p-3 rounded-t-lg border-b space-y-2"
                  style={{ 
                    backgroundColor: `${stage.color}15`,
                    borderColor: `${stage.color}30`,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: stage.color }}
                      />
                      <h3 className="font-medium text-sm" style={{ color: stage.color }}>
                        {stage.name}
                      </h3>
                      <Badge variant="secondary" className="text-xs">
                        {stageFilter && matchedStageLeads.length !== allStageLeads.length
                          ? <><AnimatedNumber value={matchedStageLeads.length} />/<AnimatedNumber value={allStageLeads.length} /></>
                          : <AnimatedNumber value={allStageLeads.length} />}
                      </Badge>
                    </div>
                  </div>
                  {/* Search input per column */}
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <Input
                      placeholder="Buscar lead..."
                      value={stageFilter}
                      onChange={(e) => setStageFilters(prev => ({ ...prev, [stage.id]: e.target.value }))}
                      className="h-7 pl-7 pr-7 text-xs"
                    />
                    {stageFilter && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-1/2 transform -translate-y-1/2 h-7 w-7"
                        onClick={() => setStageFilters(prev => ({ ...prev, [stage.id]: '' }))}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Column Content */}
                <div className="h-[calc(100vh-380px)] min-h-[300px] overflow-y-auto">
                  <div className="p-2 space-y-2">
                    {stageLeads.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Users className="h-8 w-8 text-muted-foreground/40 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {stageFilter ? 'Nenhum lead encontrado' : 'Nenhum lead neste estágio'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {stageFilter ? 'Tente outro termo' : 'Arraste leads para cá'}
                        </p>
                      </div>
                    ) : (
                      stageLeads.map((lead) => {
                        const daysInStage = getDaysInStage(lead);
                        const isStagnant = isLeadStagnant(lead, stage.id);
                        // DEV-only render counter — remove after perf validation
                        if (import.meta.env.DEV) {
                          // eslint-disable-next-line no-console
                          console.count(`[LeadCard ${lead.id.slice(0, 8)}]`);
                        }

                        return (
                          <ContextMenu key={lead.id}>
                            <ContextMenuTrigger asChild>
                          <Card
                            className={`cursor-grab active:cursor-grabbing transition-all hover:shadow-md ${
                              draggedLead?.id === lead.id ? 'opacity-50' : ''
                            } ${isStagnant ? 'ring-2 ring-red-400 bg-red-50/50 dark:bg-red-950/20' : ''}`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, lead)}
                          >
                            <CardContent className="p-2.5 relative">
                              {/* Action buttons - top right corner */}
                              <div className="absolute top-1.5 right-1 flex items-center gap-0 z-10">
                                  <span onClick={e => e.stopPropagation()} draggable={false} onDragStart={e => e.preventDefault()}>
                                    <ShareMenu entityType="lead" entityId={lead.id} entityName={lead.lead_name || 'Sem nome'} size="icon" variant="ghost" className="h-6 w-6" />
                                  </span>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-6 w-6"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onEditLead?.(lead);
                                        }}
                                      >
                                        <Eye className="h-3 w-3 text-muted-foreground hover:text-primary" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      <p>Ver detalhes</p>
                                    </TooltipContent>
                                  </Tooltip>
                                      
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-muted">
                                            <MoreVertical className="h-4 w-4 text-muted-foreground" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="max-h-[70vh] overflow-y-auto">
                                        <DropdownMenuItem onClick={() => onEditLead?.(lead)}>
                                          <Edit2 className="h-3 w-3 mr-2" />
                                          Editar
                                        </DropdownMenuItem>
                                        
                                        <DropdownMenuItem onClick={() => setContactsManagerLead(lead)}>
                                          <Users className="h-3 w-3 mr-2" />
                                          Gerenciar Contatos
                                          {contactCounts[lead.id] > 0 && (
                                            <Badge variant="secondary" className="ml-auto text-xs">
                                              {contactCounts[lead.id]}
                                            </Badge>
                                          )}
                                        </DropdownMenuItem>
                                        
                                        {lead.instagram_username && (
                                          <DropdownMenuItem
                                            onClick={() => window.open(`https://instagram.com/${lead.instagram_username?.replace('@', '')}`, '_blank')}
                                          >
                                            <Instagram className="h-3 w-3 mr-2" />
                                            Ver perfil Instagram
                                          </DropdownMenuItem>
                                        )}
                                        
                                        {lead.instagram_comment_id && (
                                          <DropdownMenuItem
                                            onClick={() => {
                                              // Navigate to comment tracker with this comment highlighted
                                              toast.info('Acessar via Automação > Comentários para ver histórico completo');
                                            }}
                                          >
                                            <MessageSquare className="h-3 w-3 mr-2" />
                                            Comentário original
                                          </DropdownMenuItem>
                                        )}
                                        
                                        {lead.lead_phone && (
                                          <DropdownMenuItem
                                            onClick={() => window.open(`https://wa.me/${lead.lead_phone?.replace(/\D/g, '')}`, '_blank')}
                                          >
                                            <Phone className="h-3 w-3 mr-2" />
                                            WhatsApp
                                          </DropdownMenuItem>
                                        )}

                                        {/* Move to stage - hierarchical menu with boards and stages */}
                                        {availableBoards.length > 0 && (
                                          <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                              <ArrowRightLeft className="h-3 w-3 mr-2" />
                                              Mover para fase
                                            </DropdownMenuItem>
                                            
                                            {/* Current board stages first */}
                                            <DropdownMenuSub>
                                              <DropdownMenuSubTrigger className="pl-4">
                                                <LayoutGrid className="h-3 w-3 mr-2" />
                                                <span className="flex-1">{board.name}</span>
                                                <Badge variant="secondary" className="ml-2 text-xs">atual</Badge>
                                              </DropdownMenuSubTrigger>
                                              <DropdownMenuPortal>
                                                <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
                                                  {board.stages.map((stage) => {
                                                    const isCurrentStage = lead.status === stage.id;
                                                    return (
                                                      <DropdownMenuItem
                                                        key={stage.id}
                                                        onClick={() => onMoveToStage(lead.id, stage.id)}
                                                        disabled={isCurrentStage}
                                                        className="flex items-center gap-2"
                                                      >
                                                        <div 
                                                          className="w-2 h-2 rounded-full flex-shrink-0" 
                                                          style={{ backgroundColor: stage.color }}
                                                        />
                                                        <span className="flex-1">{stage.name}</span>
                                                        {isCurrentStage && (
                                                          <Badge variant="outline" className="text-xs ml-2">atual</Badge>
                                                        )}
                                                      </DropdownMenuItem>
                                                    );
                                                  })}
                                                </DropdownMenuSubContent>
                                              </DropdownMenuPortal>
                                            </DropdownMenuSub>

                                            {/* Other boards with their stages */}
                                            {availableBoards
                                              .filter(b => b.id !== board.id)
                                              .map(otherBoard => (
                                                <DropdownMenuSub key={otherBoard.id}>
                                                  <DropdownMenuSubTrigger className="pl-4">
                                                    <LayoutGrid className="h-3 w-3 mr-2" />
                                                    <span className="flex-1">{otherBoard.name}</span>
                                                  </DropdownMenuSubTrigger>
                                                  <DropdownMenuPortal>
                                                    <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
                                                      {otherBoard.stages.map((stage) => (
                                                        <DropdownMenuItem
                                                          key={stage.id}
                                                          onClick={() => onMoveToBoard(lead.id, otherBoard.id, stage.id)}
                                                          className="flex items-center gap-2"
                                                        >
                                                          <div 
                                                            className="w-2 h-2 rounded-full flex-shrink-0" 
                                                            style={{ backgroundColor: stage.color }}
                                                          />
                                                          <span>{stage.name}</span>
                                                        </DropdownMenuItem>
                                                      ))}
                                                      {otherBoard.stages.length === 0 && (
                                                        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                                          Nenhuma fase configurada
                                                        </DropdownMenuItem>
                                                      )}
                                                    </DropdownMenuSubContent>
                                                  </DropdownMenuPortal>
                                                </DropdownMenuSub>
                                              ))
                                            }
                                          </>
                                        )}

                                        {/* Quick actions: Fechado / Recusado / Inviável (status-based) */}
                                        {onChangeLeadStatus && ((lead as any).lead_status === 'active' || !(lead as any).lead_status) && (
                                          <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                              onClick={() => onChangeLeadStatus(lead.id, 'closed')}
                                              className="text-green-600"
                                            >
                                              <CheckCircle2 className="h-3 w-3 mr-2" />
                                              Marcar como Fechado
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onClick={() => onChangeLeadStatus(lead.id, 'refused')}
                                              className="text-red-600"
                                            >
                                              <XCircle className="h-3 w-3 mr-2" />
                                              Marcar como Recusado
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onClick={() => onChangeLeadStatus(lead.id, 'inviavel')}
                                              className="text-amber-600"
                                            >
                                              <AlertTriangle className="h-3 w-3 mr-2" />
                                              Marcar como Inviável
                                            </DropdownMenuItem>
                                          </>
                                        )}
                                        
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => setActivityDialog({ open: true, lead })}
                                        >
                                          <ClipboardPlus className="h-3 w-3 mr-2" />
                                          Nova Atividade
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        {onCloneLead && (
                                          <DropdownMenuItem onClick={() => onCloneLead(lead)}>
                                            <Copy className="h-3 w-3 mr-2" />
                                            Duplicar Lead
                                          </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem
                                          className="text-destructive"
                                          onClick={() => handleDeleteClick(lead.id)}
                                        >
                                          <Trash2 className="h-3 w-3 mr-2" />
                                          Remover
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                              </div>

                              {/* Lead name + avatar */}
                              <div className="flex items-start gap-2 pr-20 mb-1">
                                <Avatar className="h-7 w-7 flex-shrink-0">
                                  <AvatarFallback className={`text-[10px] ${isStagnant ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'}`}>
                                    {getInitials(lead.lead_name)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="font-medium text-xs leading-tight break-words cursor-default" onClick={e => e.stopPropagation()} draggable={false} onDragStart={e => e.preventDefault()}>
                                        <CopyableText copyValue={lead.lead_name || 'Sem nome'} label="Nome">
                                          {lead.lead_name || 'Sem nome'}
                                        </CopyableText>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs">
                                      <p>{lead.lead_name || 'Sem nome'}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>

                                  <div className="mt-2 space-y-1">
                                    {lead.lead_phone && (
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground" onClick={e => e.stopPropagation()} draggable={false} onDragStart={e => e.preventDefault()}>
                                        <Phone className="h-3 w-3" />
                                        <CopyableText copyValue={lead.lead_phone} label="Telefone" className="truncate">
                                          {lead.lead_phone}
                                        </CopyableText>
                                      </div>
                                    )}
                                    {lead.lead_email && (
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground" onClick={e => e.stopPropagation()} draggable={false} onDragStart={e => e.preventDefault()}>
                                        <Mail className="h-3 w-3" />
                                        <CopyableText copyValue={lead.lead_email} label="Email" className="truncate">
                                          {lead.lead_email}
                                        </CopyableText>
                                      </div>
                                    )}
                                  </div>

                                  {/* Linked contacts list */}
                                  {leadContacts[lead.id]?.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {leadContacts[lead.id].length > 2 ? (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <div 
                                              className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                                              onClick={() => setContactsManagerLead(lead)}
                                            >
                                              <Users className="h-3 w-3 flex-shrink-0" />
                                              <span className="truncate">
                                                {leadContacts[lead.id].slice(0, 2).map(c => c.full_name).join(', ')} +{leadContacts[lead.id].length - 2}
                                              </span>
                                            </div>
                                          </TooltipTrigger>
                                          <TooltipContent side="bottom" className="max-w-xs">
                                            <div className="space-y-2">
                                              <p className="font-medium text-xs border-b pb-1">Contatos vinculados:</p>
                                              {leadContacts[lead.id].map(c => (
                                                <div key={c.id} className="flex items-center justify-between gap-3 text-xs">
                                                  <span className="font-medium">{c.full_name}</span>
                                                  <div className="flex items-center gap-1">
                                                    {c.phone && (
                                                      <a
                                                        href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-1 rounded hover:bg-green-100 text-green-600 transition-colors"
                                                        title={`WhatsApp: ${c.phone}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                      >
                                                        <Phone className="h-3 w-3" />
                                                      </a>
                                                    )}
                                                    {c.instagram_username && (
                                                      <a
                                                        href={`https://instagram.com/${c.instagram_username.replace('@', '')}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-1 rounded hover:bg-pink-100 text-pink-600 transition-colors"
                                                        title={`Instagram: @${c.instagram_username.replace('@', '')}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                      >
                                                        <Instagram className="h-3 w-3" />
                                                      </a>
                                                    )}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </TooltipContent>
                                        </Tooltip>
                                      ) : (
                                        <div 
                                          className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                                          onClick={() => setContactsManagerLead(lead)}
                                        >
                                          <Users className="h-3 w-3 flex-shrink-0" />
                                          <span className="truncate">
                                            {leadContacts[lead.id].map(c => c.full_name).join(', ')}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Badges row */}
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {/* Profession badges from linked contacts */}
                                    {leadContacts[lead.id]?.filter(c => c.profession).slice(0, 2).map((contact) => (
                                      <ProfessionBadgePopover
                                        key={contact.id}
                                        contactId={contact.id}
                                        authorUsername={contact.instagram_username}
                                        profession={contact.profession}
                                        professionCboCode={contact.profession_cbo_code}
                                        compact={true}
                                        interactive={false}
                                      />
                                    ))}
                                    {/* Conversion value badge */}
                                    {lead.conversion_value > 0 && (
                                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                                        R$ {lead.conversion_value.toLocaleString('pt-BR')}
                                      </Badge>
                                    )}
                                  </div>

                                  {/* Checklist progress preview */}
                                  <LeadCardChecklists
                                    leadId={lead.id}
                                    boardId={board.id}
                                    stageId={stage.id}
                                  />

                                  {/* Days in stage indicator */}
                                  {(daysInStage > 3 || isStagnant) && (
                                    <Badge 
                                      variant="outline" 
                                      className={`text-xs mt-1 inline-flex ${
                                        isStagnant 
                                          ? 'text-red-600 border-red-400 bg-red-100 dark:bg-red-950' 
                                          : 'text-amber-600 border-amber-300'
                                      }`}
                                    >
                                      <Clock className="h-3 w-3 mr-1" />
                                      {daysInStage}d {isStagnant && '⚠️'}
                                    </Badge>
                                  )}
                            </CardContent>
                          </Card>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem
                                onClick={() => {
                                  window.open(`${window.location.origin}/leads?openLead=${lead.id}`, '_blank');
                                }}
                              >
                                <ExternalLink className="h-3.5 w-3.5 mr-2" />
                                Abrir em nova aba
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => {
                                  const url = `${window.location.origin}/leads?id=${lead.id}`;
                                  navigator.clipboard.writeText(url);
                                  toast.success('Link copiado!');
                                }}
                              >
                                <Link2 className="h-3.5 w-3.5 mr-2" />
                                Copiar link
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => {
                                  const url = `${window.location.origin}/leads?id=${lead.id}`;
                                  const text = `Lead: *${lead.lead_name || 'Sem nome'}*\n${url}`;
                                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                                }}
                              >
                                <MessageSquare className="h-3.5 w-3.5 mr-2" />
                                Enviar via WhatsApp
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })
                    )}
                    {hasMore && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2 text-xs"
                        onClick={() =>
                          setVisibleCounts(prev => ({
                            ...prev,
                            [stage.id]: (prev[stage.id] ?? PAGE_INCREMENT) + PAGE_INCREMENT,
                          }))
                        }
                      >
                        Carregar mais ({matchedStageLeads.length - stageLeads.length} restantes)
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Fixed Status Columns: Fechados, Recusados & Inviáveis */}
          {[
            { id: 'closed', name: 'Fechados', color: '#22c55e', icon: CheckCircle2, leads: closedLeads },
            { id: 'refused', name: 'Recusados', color: '#ef4444', icon: XCircle, leads: refusedLeads },
            { id: 'inviavel', name: 'Inviáveis', color: '#f59e0b', icon: AlertTriangle, leads: inviavelLeads },
          ].map(statusCol => {
            const colFilter = stageFilters[statusCol.id] || '';
            const filteredLeads = colFilter
              ? statusCol.leads.filter(lead => lead.lead_name?.toLowerCase().includes(colFilter.toLowerCase()))
              : statusCol.leads;
            const IconComp = statusCol.icon;
            return (
              <div
                key={statusCol.id}
                className="flex-shrink-0 rounded-lg border"
                style={{ width: `max(240px, calc((100vw - ${(board.stages.length + 2) * 4 + 16}px) / ${board.stages.length + 2}))` }}
                onDragOver={(e) => { e.preventDefault(); setDragOverStage(statusCol.id); }}
                onDragLeave={handleDragLeave}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverStage(null);
                  if (draggedLead && onChangeLeadStatus) {
                    onChangeLeadStatus(draggedLead.id, statusCol.id as 'closed' | 'refused' | 'inviavel');
                  }
                  setDraggedLead(null);
                }}
              >
                <div
                  className="p-3 rounded-t-lg border-b space-y-2"
                  style={{ backgroundColor: `${statusCol.color}15`, borderColor: `${statusCol.color}30` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <IconComp className="w-3.5 h-3.5" style={{ color: statusCol.color }} />
                      <h3 className="font-medium text-sm" style={{ color: statusCol.color }}>
                        {statusCol.name}
                      </h3>
                      <Badge variant="secondary" className="text-xs">
                        <AnimatedNumber value={filteredLeads.length} />
                      </Badge>
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <Input
                      placeholder="Buscar lead..."
                      value={colFilter}
                      onChange={(e) => setStageFilters(prev => ({ ...prev, [statusCol.id]: e.target.value }))}
                      className="h-7 pl-7 pr-7 text-xs"
                    />
                    {colFilter && (
                      <Button variant="ghost" size="icon" className="absolute right-0 top-1/2 transform -translate-y-1/2 h-7 w-7"
                        onClick={() => setStageFilters(prev => ({ ...prev, [statusCol.id]: '' }))}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="h-[calc(100vh-380px)] min-h-[300px] overflow-y-auto">
                  <div className="p-2 space-y-2">
                    {filteredLeads.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <IconComp className="h-8 w-8 text-muted-foreground/40 mb-2" />
                        <p className="text-xs text-muted-foreground">Nenhum lead {statusCol.name.toLowerCase()}</p>
                      </div>
                    ) : (
                      filteredLeads.map(lead => (
                        <Card key={lead.id} className="cursor-pointer hover:shadow-md transition-all"
                          onClick={(e) => { e.stopPropagation(); onEditLead?.(lead); }}
                        >
                          <CardContent className="p-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <Avatar className="h-7 w-7 flex-shrink-0">
                                  <AvatarFallback className="text-xs" style={{ backgroundColor: `${statusCol.color}20`, color: statusCol.color }}>
                                    {getInitials(lead.lead_name)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm font-medium truncate">{lead.lead_name || 'Sem nome'}</span>
                              </div>
                              {onChangeLeadStatus && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0">
                                      <MoreVertical className="h-3 w-3" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onChangeLeadStatus(lead.id, 'active'); }}>
                                      <ArrowRightLeft className="h-3 w-3 mr-2" />
                                      Voltar para Em Andamento
                                    </DropdownMenuItem>
                                    {statusCol.id !== 'closed' && (
                                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onChangeLeadStatus(lead.id, 'closed'); }} className="text-green-600">
                                        <CheckCircle2 className="h-3 w-3 mr-2" />
                                        Mover para Fechados
                                      </DropdownMenuItem>
                                    )}
                                    {statusCol.id !== 'refused' && (
                                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onChangeLeadStatus(lead.id, 'refused'); }} className="text-red-600">
                                        <XCircle className="h-3 w-3 mr-2" />
                                        Mover para Recusados
                                      </DropdownMenuItem>
                                    )}
                                    {statusCol.id !== 'inviavel' && (
                                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onChangeLeadStatus(lead.id, 'inviavel'); }} className="text-amber-600">
                                        <AlertTriangle className="h-3 w-3 mr-2" />
                                        Mover para Inviáveis
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteClick(lead.id); }}>
                                      <Trash2 className="h-3 w-3 mr-2" />
                                      Remover
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                            {lead.lead_phone && (
                              <span className="text-xs text-muted-foreground">{lead.lead_phone}</span>
                            )}
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Conversion Value Dialog */}
        <Dialog open={conversionDialog.open} onOpenChange={(open) => !open && setConversionDialog({ open: false, leadId: null, stageId: null })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar Conversão</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="conversionValue">Valor da Conversão (R$)</Label>
                <Input
                  id="conversionValue"
                  type="number"
                  placeholder="0,00"
                  value={conversionValue}
                  onChange={(e) => setConversionValue(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConversionDialog({ open: false, leadId: null, stageId: null })}>
                Cancelar
              </Button>
              <Button onClick={handleConversionConfirm}>
                Confirmar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Lead Contacts Manager */}
        <LeadContactsManager
          lead={contactsManagerLead}
          open={!!contactsManagerLead}
          onOpenChange={(open) => !open && setContactsManagerLead(null)}
        />
        {/* Activity Creation Dialog */}
        <Dialog open={activityDialog.open} onOpenChange={(open) => { if (!open) { setActivityDialog({ open: false, lead: null }); setActivityTitle('Dar andamento'); setActivityDescription(''); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Atividade</DialogTitle>
              <DialogDescription>
                {activityDialog.lead?.lead_name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="activityTitle">Título</Label>
                <Input
                  id="activityTitle"
                  value={activityTitle}
                  onChange={(e) => setActivityTitle(e.target.value)}
                  placeholder="Título da atividade"
                />
              </div>
              <div>
                <Label htmlFor="activityDesc">Descrição</Label>
                <Textarea
                  id="activityDesc"
                  value={activityDescription}
                  onChange={(e) => setActivityDescription(e.target.value)}
                  placeholder="Descreva o que precisa ser feito..."
                  className="min-h-[80px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setActivityDialog({ open: false, lead: null }); setActivityTitle('Dar andamento'); setActivityDescription(''); }}>
                Cancelar
              </Button>
              <Button onClick={handleCreateActivity}>
                Criar Atividade
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      <ConfirmDeleteDialog />
      </>
    </TooltipProvider>
  );
}
