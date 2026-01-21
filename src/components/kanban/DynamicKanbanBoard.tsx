import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
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
  ArrowRightLeft,
  UserPlus,
  Clock,
} from 'lucide-react';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { Lead } from '@/hooks/useLeads';
import { differenceInDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { LeadContactsManager } from './LeadContactsManager';

interface DynamicKanbanBoardProps {
  board: KanbanBoard;
  leads: Lead[];
  loading: boolean;
  onMoveToStage: (leadId: string, stageId: string) => void;
  onMoveToBoard: (leadId: string, boardId: string, stageId?: string) => void;
  onDeleteLead: (id: string) => void;
  onEditLead?: (lead: Lead) => void;
  onManageContacts?: (lead: Lead) => void;
  availableBoards?: KanbanBoard[];
}

export function DynamicKanbanBoard({
  board,
  leads,
  loading,
  onMoveToStage,
  onMoveToBoard,
  onDeleteLead,
  onEditLead,
  onManageContacts,
  availableBoards = [],
}: DynamicKanbanBoardProps) {
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [conversionDialog, setConversionDialog] = useState<{ open: boolean; leadId: string | null; stageId: string | null }>({
    open: false,
    leadId: null,
    stageId: null,
  });
  const [conversionValue, setConversionValue] = useState('');
  const [contactsManagerLead, setContactsManagerLead] = useState<Lead | null>(null);
  const [contactCounts, setContactCounts] = useState<Record<string, number>>({});

  // Fetch contact counts for all leads
  useEffect(() => {
    const fetchContactCounts = async () => {
      const leadIds = leads.map(l => l.id);
      if (leadIds.length === 0) return;

      const { data, error } = await supabase
        .from('contacts')
        .select('lead_id')
        .in('lead_id', leadIds);

      if (error) {
        console.error('Error fetching contact counts:', error);
        return;
      }

      const counts: Record<string, number> = {};
      data?.forEach(contact => {
        if (contact.lead_id) {
          counts[contact.lead_id] = (counts[contact.lead_id] || 0) + 1;
        }
      });
      setContactCounts(counts);
    };

    fetchContactCounts();
  }, [leads]);

  // Group leads by stage
  const leadsByStage = useMemo(() => {
    const grouped: Record<string, Lead[]> = {};
    board.stages.forEach(stage => {
      grouped[stage.id] = [];
    });
    
    leads.forEach(lead => {
      const stageId = lead.status || board.stages[0]?.id;
      if (grouped[stageId]) {
        grouped[stageId].push(lead);
      } else if (board.stages.length > 0) {
        // Put in first stage if status doesn't match
        grouped[board.stages[0].id].push(lead);
      }
    });
    
    return grouped;
  }, [leads, board.stages]);

  const getInitials = (name: string | null) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getDaysInStage = (lead: Lead) => {
    return differenceInDays(new Date(), new Date(lead.updated_at));
  };

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
    if (confirm('Tem certeza que deseja remover este lead?')) {
      onDeleteLead(id);
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
        <div className="flex gap-4 overflow-x-auto pb-4">
          {board.stages.map((stage) => {
            const stageLeads = leadsByStage[stage.id] || [];
            const isDropTarget = dragOverStage === stage.id;

            return (
              <div
                key={stage.id}
                className={`flex-shrink-0 w-80 rounded-lg border transition-all ${
                  isDropTarget ? 'ring-2 ring-primary ring-offset-2' : ''
                }`}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                {/* Column Header */}
                <div 
                  className="p-3 rounded-t-lg border-b"
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
                        {stageLeads.length}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Column Content */}
                <ScrollArea className="h-[calc(100vh-400px)] min-h-[300px]">
                  <div className="p-2 space-y-2">
                    {stageLeads.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Users className="h-8 w-8 text-muted-foreground/40 mb-2" />
                        <p className="text-xs text-muted-foreground">
                          Nenhum lead neste estágio
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Arraste leads para cá
                        </p>
                      </div>
                    ) : (
                      stageLeads.map((lead) => {
                        const daysInStage = getDaysInStage(lead);
                        
                        return (
                          <Card
                            key={lead.id}
                            className={`cursor-grab active:cursor-grabbing transition-all hover:shadow-md ${
                              draggedLead?.id === lead.id ? 'opacity-50' : ''
                            }`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, lead)}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-start gap-3">
                                <div className="flex items-center gap-1">
                                  <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                                  <Avatar className="h-8 w-8">
                                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                      {getInitials(lead.lead_name)}
                                    </AvatarFallback>
                                  </Avatar>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <p className="font-medium text-sm break-words cursor-default">
                                            {lead.lead_name || 'Sem nome'}
                                          </p>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-xs">
                                          <p>{lead.lead_name || 'Sem nome'}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                      
                                      {/* Days in stage indicator */}
                                      {daysInStage > 3 && (
                                        <Badge variant="outline" className="text-xs mt-1 text-amber-600 border-amber-300">
                                          <Clock className="h-3 w-3 mr-1" />
                                          {daysInStage}d
                                        </Badge>
                                      )}
                                    </div>
                                    
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0">
                                          <MoreVertical className="h-3 w-3" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
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
                                        
                                        {lead.lead_phone && (
                                          <DropdownMenuItem
                                            onClick={() => window.open(`https://wa.me/${lead.lead_phone?.replace(/\D/g, '')}`, '_blank')}
                                          >
                                            <MessageSquare className="h-3 w-3 mr-2" />
                                            WhatsApp
                                          </DropdownMenuItem>
                                        )}

                                        {/* Move to another board */}
                                        {availableBoards.length > 1 && (
                                          <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                              <ArrowRightLeft className="h-3 w-3 mr-2" />
                                              Mover para outro quadro
                                            </DropdownMenuItem>
                                            {availableBoards
                                              .filter(b => b.id !== board.id)
                                              .map(b => (
                                                <DropdownMenuItem 
                                                  key={b.id}
                                                  onClick={() => onMoveToBoard(lead.id, b.id)}
                                                  className="pl-6"
                                                >
                                                  {b.name}
                                                </DropdownMenuItem>
                                              ))
                                            }
                                          </>
                                        )}
                                        
                                        <DropdownMenuSeparator />
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

                                  <div className="mt-2 space-y-1">
                                    {lead.lead_phone && (
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Phone className="h-3 w-3" />
                                        <span className="truncate">{lead.lead_phone}</span>
                                      </div>
                                    )}
                                    {lead.lead_email && (
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Mail className="h-3 w-3" />
                                        <span className="truncate">{lead.lead_email}</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Badges row */}
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {/* Contacts count badge */}
                                    {contactCounts[lead.id] > 0 && (
                                      <Badge 
                                        variant="outline" 
                                        className="text-xs cursor-pointer hover:bg-muted"
                                        onClick={() => setContactsManagerLead(lead)}
                                      >
                                        <Users className="h-3 w-3 mr-1" />
                                        {contactCounts[lead.id]} contato{contactCounts[lead.id] > 1 ? 's' : ''}
                                      </Badge>
                                    )}
                                    
                                    {/* Conversion value badge */}
                                    {lead.conversion_value > 0 && (
                                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                                        R$ {lead.conversion_value.toLocaleString('pt-BR')}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
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
      </>
    </TooltipProvider>
  );
}
