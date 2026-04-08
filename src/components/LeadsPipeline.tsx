import { useState } from 'react';
import { useConfirmDelete } from '@/hooks/useConfirmDelete';
import { Card, CardContent } from '@/components/ui/card';
import { CardFieldsConfig } from '@/hooks/useCardFieldsSettings';
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
  Cloud,
  CloudOff,
  Loader2,
  AlertCircle,
  Instagram,
  ExternalLink,
  UserCheck,
  UserX,
  Briefcase,
  CircleOff,
  Target,
  Clock,
} from 'lucide-react';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Lead, LeadStatus, SyncStatus, ClientClassification } from '@/hooks/useLeads';
import { QuickFollowupButton } from '@/components/leads/QuickFollowupButton';
import { FollowupDialog } from '@/components/leads/FollowupDialog';

interface LeadsPipelineProps {
  leads: Lead[];
  loading: boolean;
  onStatusChange: (leadId: string, status: LeadStatus, conversionValue?: number) => void;
  onDeleteLead: (id: string) => void;
  onEditLead?: (lead: Lead) => void;
  onToggleFollower?: (leadId: string, isFollower: boolean) => void;
  onNavigateToComment?: (commentId: string) => void;
  onClassificationChange?: (leadId: string, classification: ClientClassification) => void;
  cardFieldsConfig?: CardFieldsConfig;
  onLeadsRefresh?: () => void;
  isLeadStagnant?: (lead: Lead) => { isStagnant: boolean; daysSinceLastActivity: number; threshold: number };
}

const classificationConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  client: { label: 'Cliente', color: 'border-green-500 text-green-600 bg-green-50', icon: <Briefcase className="h-3 w-3" /> },
  non_client: { label: 'Não-Cliente', color: 'border-red-500 text-red-600 bg-red-50', icon: <CircleOff className="h-3 w-3" /> },
  prospect: { label: 'Prospect', color: 'border-blue-500 text-blue-600 bg-blue-50', icon: <Target className="h-3 w-3" /> },
};

interface PipelineColumn {
  id: LeadStatus;
  title: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const columns: PipelineColumn[] = [
  { id: 'comment', title: 'Comentários', color: 'text-pink-600', bgColor: 'bg-pink-50', borderColor: 'border-pink-200' },
  { id: 'new', title: 'Em análise', color: 'text-blue-600', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' },
  { id: 'contacted', title: 'Contatado', color: 'text-yellow-600', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200' },
  { id: 'qualified', title: 'Qualificado', color: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
  { id: 'not_qualified', title: 'Desqualificado', color: 'text-gray-600', bgColor: 'bg-gray-50', borderColor: 'border-gray-200' },
  { id: 'converted', title: 'Convertido', color: 'text-emerald-600', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200' },
  { id: 'lost', title: 'Perdido', color: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-200' },
];

const LeadsPipeline = ({ leads, loading, onStatusChange, onDeleteLead, onEditLead, onToggleFollower, onNavigateToComment, onClassificationChange, cardFieldsConfig, onLeadsRefresh, isLeadStagnant }: LeadsPipelineProps) => {
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<LeadStatus | null>(null);
  const [conversionDialog, setConversionDialog] = useState<{ open: boolean; leadId: string | null }>({
    open: false,
    leadId: null,
  });
  const [conversionValue, setConversionValue] = useState('');
  const [followupDialogLead, setFollowupDialogLead] = useState<Lead | null>(null);

  const getLeadsByStatus = (status: LeadStatus) => {
    return leads.filter((lead) => lead.status === status);
  };

  const getInitials = (name: string | null) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    setDraggedLead(lead);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, newStatus: LeadStatus) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (draggedLead && draggedLead.status !== newStatus) {
      if (newStatus === 'converted') {
        setConversionDialog({ open: true, leadId: draggedLead.id });
      } else {
        onStatusChange(draggedLead.id, newStatus);
      }
    }
    setDraggedLead(null);
  };

  const handleConversionConfirm = () => {
    if (conversionDialog.leadId) {
      const value = parseFloat(conversionValue) || 0;
      onStatusChange(conversionDialog.leadId, 'converted', value);
    }
    setConversionDialog({ open: false, leadId: null });
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
        {columns.map((column) => {
          const columnLeads = getLeadsByStatus(column.id);
          const isDropTarget = dragOverColumn === column.id;

          return (
            <div
              key={column.id}
              className={`flex-shrink-0 w-80 rounded-lg border transition-all ${
                isDropTarget ? 'ring-2 ring-primary ring-offset-2' : ''
              }`}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              {/* Column Header */}
              <div className={`p-3 rounded-t-lg ${column.bgColor} ${column.borderColor} border-b`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-medium text-sm ${column.color}`}>{column.title}</h3>
                    <Badge variant="secondary" className="text-xs">
                      {columnLeads.length}
                    </Badge>
                  </div>
                  <MoreVertical className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              {/* Column Content */}
              <ScrollArea className="h-[calc(100vh-400px)] min-h-[300px]">
                <div className="p-2 space-y-2">
                  {columnLeads.length === 0 ? (
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
                    columnLeads.map((lead) => {
                      const stagnationInfo = isLeadStagnant?.(lead);
                      const isStagnant = stagnationInfo?.isStagnant ?? false;
                      
                      return (
                      <Card
                        key={lead.id}
                        className={`cursor-grab active:cursor-grabbing transition-all hover:shadow-md ${
                          draggedLead?.id === lead.id ? 'opacity-50' : ''
                        } ${isStagnant ? 'border-destructive/50 bg-destructive/5 ring-1 ring-destructive/20' : ''}`}
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
                                  {cardFieldsConfig?.campaign !== false && lead.campaign_name && (
                                    <Badge variant="outline" className="text-xs mt-1 truncate max-w-full">
                                      {lead.campaign_name}
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
                                    
                                    {/* Instagram actions for leads from comments */}
                                    {lead.instagram_username && (
                                      <DropdownMenuItem
                                        onClick={() => window.open(`https://instagram.com/${lead.instagram_username?.replace('@', '')}`, '_blank')}
                                      >
                                        <Instagram className="h-3 w-3 mr-2" />
                                        Ver perfil Instagram
                                      </DropdownMenuItem>
                                    )}
                                    
                                    {lead.instagram_comment_id && onNavigateToComment && (
                                      <DropdownMenuItem
                                        onClick={() => onNavigateToComment(lead.instagram_comment_id!)}
                                      >
                                        <ExternalLink className="h-3 w-3 mr-2" />
                                        Ver comentário original
                                      </DropdownMenuItem>
                                    )}
                                    
                                    {(lead.instagram_username || lead.source === 'instagram') && onToggleFollower && (
                                      <>
                                        <DropdownMenuSeparator />
                                        {lead.is_follower ? (
                                          <DropdownMenuItem
                                            onClick={() => onToggleFollower(lead.id, false)}
                                          >
                                            <UserX className="h-3 w-3 mr-2" />
                                            Marcar como não seguidor
                                          </DropdownMenuItem>
                                        ) : (
                                          <DropdownMenuItem
                                            onClick={() => onToggleFollower(lead.id, true)}
                                          >
                                            <UserCheck className="h-3 w-3 mr-2" />
                                            Marcar como seguidor
                                          </DropdownMenuItem>
                                        )}
                                      </>
                                    )}
                                    
                                    {/* Client Classification */}
                                    {onClassificationChange && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => onClassificationChange(lead.id, lead.client_classification === 'client' ? null : 'client')}
                                          className={lead.client_classification === 'client' ? 'bg-green-50' : ''}
                                        >
                                          <Briefcase className="h-3 w-3 mr-2" />
                                          {lead.client_classification === 'client' ? '✓ Cliente' : 'Marcar como Cliente'}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onClick={() => onClassificationChange(lead.id, lead.client_classification === 'non_client' ? null : 'non_client')}
                                          className={lead.client_classification === 'non_client' ? 'bg-red-50' : ''}
                                        >
                                          <CircleOff className="h-3 w-3 mr-2" />
                                          {lead.client_classification === 'non_client' ? '✓ Não-Cliente' : 'Marcar como Não-Cliente'}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onClick={() => onClassificationChange(lead.id, lead.client_classification === 'prospect' ? null : 'prospect')}
                                          className={lead.client_classification === 'prospect' ? 'bg-blue-50' : ''}
                                        >
                                          <Target className="h-3 w-3 mr-2" />
                                          {lead.client_classification === 'prospect' ? '✓ Prospect' : 'Marcar como Prospect'}
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                    
                                    <DropdownMenuSeparator />
                                    
                                    {lead.lead_phone && (
                                      <DropdownMenuItem
                                        onClick={() => window.open(`https://wa.me/${lead.lead_phone?.replace(/\D/g, '')}`, '_blank')}
                                      >
                                        <MessageSquare className="h-3 w-3 mr-2" />
                                        WhatsApp
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

                              <div className="mt-2 space-y-1">
                                {cardFieldsConfig?.phone !== false && lead.lead_phone && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Phone className="h-3 w-3" />
                                    <span className="truncate">{lead.lead_phone}</span>
                                  </div>
                                )}
                                {cardFieldsConfig?.email !== false && lead.lead_email && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Mail className="h-3 w-3" />
                                    <span className="truncate">{lead.lead_email}</span>
                                  </div>
                                )}
                                {cardFieldsConfig?.state && lead.state && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <span className="font-medium">{lead.state}</span>
                                    {cardFieldsConfig?.city && lead.city && (
                                      <span>- {lead.city}</span>
                                    )}
                                  </div>
                                )}
                                {cardFieldsConfig?.city && !cardFieldsConfig?.state && lead.city && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <span>{lead.city}</span>
                                  </div>
                                )}
                              </div>

                              {cardFieldsConfig?.conversionValue !== false && lead.status === 'converted' && (lead.conversion_value ?? 0) > 0 && (
                                <div className="mt-2">
                                  <Badge className="bg-emerald-500 text-white text-xs">
                                    R$ {(lead.conversion_value ?? 0).toLocaleString('pt-BR')}
                                  </Badge>
                                </div>
                              )}

                              {/* Follower badge for Instagram leads */}
                              {cardFieldsConfig?.followerBadge !== false && lead.is_follower !== null && (lead.instagram_username || lead.source === 'instagram') && (
                                <div className="mt-2">
                                  <Badge 
                                    variant="outline" 
                                    className={`text-xs ${lead.is_follower ? 'border-green-500 text-green-600' : 'border-gray-400 text-gray-500'}`}
                                  >
                                    {lead.is_follower ? (
                                      <><UserCheck className="h-3 w-3 mr-1" /> Seguidor</>
                                    ) : (
                                      <><UserX className="h-3 w-3 mr-1" /> Não seguidor</>
                                    )}
                                  </Badge>
                                </div>
                              )}

                              {/* Client Classification Badge */}
                              {cardFieldsConfig?.classification !== false && lead.client_classification && classificationConfig[lead.client_classification] && (
                                <div className="mt-2">
                                  <Badge 
                                    variant="outline" 
                                    className={`text-xs ${classificationConfig[lead.client_classification].color}`}
                                  >
                                    {classificationConfig[lead.client_classification].icon}
                                    <span className="ml-1">{classificationConfig[lead.client_classification].label}</span>
                                  </Badge>
                                </div>
                              )}

                              {/* Stagnation Alert */}
                              {isStagnant && stagnationInfo && (
                                <div className="mt-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="outline" className="text-destructive border-destructive/50 bg-destructive/10 text-xs">
                                        <AlertCircle className="h-3 w-3 mr-1" />
                                        {stagnationInfo.daysSinceLastActivity}d sem atividade
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      Lead sem atividade há {stagnationInfo.daysSinceLastActivity} dias (limite: {stagnationInfo.threshold}d)
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              )}

                              {/* Follow-up Quick Button */}
                              <div className="mt-2 flex items-center justify-between">
                                <QuickFollowupButton
                                  leadId={lead.id}
                                  followupCount={lead.followup_count || 0}
                                  onFollowupAdded={onLeadsRefresh}
                                  onViewHistory={() => setFollowupDialogLead(lead)}
                                  variant="compact"
                                />
                                {lead.last_followup_at && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {new Date(lead.last_followup_at).toLocaleDateString('pt-BR')}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>Último follow-up</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>

                              {/* Sync Status & Date */}
                              {(cardFieldsConfig?.createdAt !== false || cardFieldsConfig?.syncStatus !== false) && (
                                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                  {cardFieldsConfig?.createdAt !== false && (
                                    <span>{new Date(lead.created_at).toLocaleDateString('pt-BR')}</span>
                                  )}
                                  {cardFieldsConfig?.syncStatus !== false && lead.facebook_lead_id && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="flex items-center gap-1">
                                          {lead.sync_status === 'synced' && (
                                            <Cloud className="h-3 w-3 text-green-500" />
                                          )}
                                          {lead.sync_status === 'syncing' && (
                                            <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />
                                          )}
                                          {lead.sync_status === 'error' && (
                                            <AlertCircle className="h-3 w-3 text-red-500" />
                                          )}
                                          {lead.sync_status === 'local' && (
                                            <CloudOff className="h-3 w-3 text-muted-foreground" />
                                          )}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {lead.sync_status === 'synced' && 'Sincronizado com Facebook'}
                                        {lead.sync_status === 'syncing' && 'Sincronizando...'}
                                        {lead.sync_status === 'error' && 'Erro na sincronização'}
                                        {lead.sync_status === 'local' && 'Aguardando sincronização'}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                              )}
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
      <Dialog open={conversionDialog.open} onOpenChange={(open) => setConversionDialog({ open, leadId: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Valor da Conversão</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Qual foi o valor da venda/conversão?</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={conversionValue}
                onChange={(e) => setConversionValue(e.target.value)}
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConversionDialog({ open: false, leadId: null })}>
              Cancelar
            </Button>
            <Button onClick={handleConversionConfirm}>
              Confirmar Conversão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Followup Dialog */}
      <FollowupDialog
        lead={followupDialogLead}
        open={!!followupDialogLead}
        onOpenChange={(open) => !open && setFollowupDialogLead(null)}
        onFollowupAdded={onLeadsRefresh}
      />
      </>
    </TooltipProvider>
  );
};

export default LeadsPipeline;
