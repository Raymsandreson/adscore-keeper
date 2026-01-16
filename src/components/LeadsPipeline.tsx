import { useState } from 'react';
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
} from 'lucide-react';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Lead, LeadStatus, SyncStatus } from '@/hooks/useLeads';

interface LeadsPipelineProps {
  leads: Lead[];
  loading: boolean;
  onStatusChange: (leadId: string, status: LeadStatus, conversionValue?: number) => void;
  onDeleteLead: (id: string) => void;
  onToggleFollower?: (leadId: string, isFollower: boolean) => void;
  onNavigateToComment?: (commentId: string) => void;
}

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

const LeadsPipeline = ({ leads, loading, onStatusChange, onDeleteLead, onToggleFollower, onNavigateToComment }: LeadsPipelineProps) => {
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<LeadStatus | null>(null);
  const [conversionDialog, setConversionDialog] = useState<{ open: boolean; leadId: string | null }>({
    open: false,
    leadId: null,
  });
  const [conversionValue, setConversionValue] = useState('');

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
              className={`flex-shrink-0 w-72 rounded-lg border transition-all ${
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
                    columnLeads.map((lead) => (
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
                                <div className="truncate">
                                  <p className="font-medium text-sm truncate">
                                    {lead.lead_name || 'Sem nome'}
                                  </p>
                                  {lead.campaign_name && (
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
                                    <DropdownMenuItem>
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
                                    
                                    {/* Extract username from lead_name if starts with @ */}
                                    {!lead.instagram_username && lead.lead_name?.startsWith('@') && (
                                      <DropdownMenuItem
                                        onClick={() => window.open(`https://instagram.com/${lead.lead_name?.replace('@', '')}`, '_blank')}
                                      >
                                        <Instagram className="h-3 w-3 mr-2" />
                                        Ver perfil Instagram
                                      </DropdownMenuItem>
                                    )}
                                    
                                    {(lead.instagram_username || lead.lead_name?.startsWith('@') || lead.source === 'instagram') && onToggleFollower && (
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

                              {lead.status === 'converted' && lead.conversion_value > 0 && (
                                <div className="mt-2">
                                  <Badge className="bg-emerald-500 text-white text-xs">
                                    R$ {lead.conversion_value.toLocaleString('pt-BR')}
                                  </Badge>
                                </div>
                              )}

                              {/* Follower badge for Instagram leads */}
                              {lead.is_follower !== null && (lead.instagram_username || lead.lead_name?.startsWith('@') || lead.source === 'instagram') && (
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

                              {/* Sync Status & Date */}
                              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                <span>{new Date(lead.created_at).toLocaleDateString('pt-BR')}</span>
                                {lead.facebook_lead_id && (
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
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
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
      </>
    </TooltipProvider>
  );
};

export default LeadsPipeline;
