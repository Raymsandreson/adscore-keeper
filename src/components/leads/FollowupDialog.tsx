import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Plus, 
  Phone, 
  MessageSquare, 
  Mail, 
  Home, 
  Users,
  Trash2,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  useLeadFollowups, 
  LeadFollowup, 
  FollowupType, 
  FollowupOutcome,
  FOLLOWUP_TYPE_CONFIG,
  FOLLOWUP_OUTCOME_CONFIG
} from '@/hooks/useLeadFollowups';
import { Lead } from '@/hooks/useLeads';

interface FollowupDialogProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFollowupAdded?: () => void;
}

const TYPE_ICONS: Record<FollowupType, React.ReactNode> = {
  whatsapp: <MessageSquare className="h-4 w-4" />,
  call: <Phone className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  visit: <Home className="h-4 w-4" />,
  meeting: <Users className="h-4 w-4" />,
};

export function FollowupDialog({ lead, open, onOpenChange, onFollowupAdded }: FollowupDialogProps) {
  const { followups, loading, fetchFollowupsForLead, addFollowup, deleteFollowup } = useLeadFollowups();
  const [isAdding, setIsAdding] = useState(false);
  const [newFollowup, setNewFollowup] = useState<{
    type: FollowupType;
    outcome: FollowupOutcome | '';
    notes: string;
  }>({
    type: 'whatsapp',
    outcome: '',
    notes: '',
  });

  useEffect(() => {
    if (open && lead) {
      fetchFollowupsForLead(lead.id);
    }
  }, [open, lead?.id]);

  const handleAddFollowup = async () => {
    if (!lead) return;
    
    setIsAdding(true);
    try {
      await addFollowup(
        lead.id,
        newFollowup.type,
        newFollowup.outcome || undefined,
        newFollowup.notes || undefined
      );
      setNewFollowup({ type: 'whatsapp', outcome: '', notes: '' });
      await fetchFollowupsForLead(lead.id);
      onFollowupAdded?.();
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (followup: LeadFollowup) => {
    if (!lead) return;
    await deleteFollowup(followup.id, lead.id);
    await fetchFollowupsForLead(lead.id);
    onFollowupAdded?.();
  };

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Follow-ups - {lead.lead_name || 'Lead'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Add new followup form */}
          <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Novo Follow-up</span>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo</Label>
                <Select 
                  value={newFollowup.type} 
                  onValueChange={(v) => setNewFollowup(prev => ({ ...prev, type: v as FollowupType }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FOLLOWUP_TYPE_CONFIG) as FollowupType[]).map((type) => (
                      <SelectItem key={type} value={type}>
                        <span className="flex items-center gap-2">
                          {TYPE_ICONS[type]}
                          {FOLLOWUP_TYPE_CONFIG[type].label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Resultado</Label>
                <Select 
                  value={newFollowup.outcome} 
                  onValueChange={(v) => setNewFollowup(prev => ({ ...prev, outcome: v as FollowupOutcome }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FOLLOWUP_OUTCOME_CONFIG) as FollowupOutcome[]).map((outcome) => (
                      <SelectItem key={outcome} value={outcome}>
                        {FOLLOWUP_OUTCOME_CONFIG[outcome].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Notas (opcional)</Label>
              <Textarea
                value={newFollowup.notes}
                onChange={(e) => setNewFollowup(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Anotações sobre a interação..."
                className="h-20 resize-none"
              />
            </div>

            <Button 
              onClick={handleAddFollowup} 
              disabled={isAdding}
              className="w-full"
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Registrar Follow-up
            </Button>
          </div>

          {/* History */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Histórico</span>
              <Badge variant="outline">{followups.length} registros</Badge>
            </div>

            <ScrollArea className="h-[250px]">
              {loading ? (
                <div className="text-center text-muted-foreground py-8">Carregando...</div>
              ) : followups.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  Nenhum follow-up registrado
                </div>
              ) : (
                <div className="space-y-2 pr-3">
                  {followups.map((followup) => (
                    <div 
                      key={followup.id}
                      className="p-3 border rounded-lg bg-background hover:bg-muted/30 transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {TYPE_ICONS[followup.followup_type]}
                          <span className="font-medium text-sm">
                            {FOLLOWUP_TYPE_CONFIG[followup.followup_type]?.label || followup.followup_type}
                          </span>
                          {followup.outcome && (
                            <Badge 
                              variant="secondary" 
                              className={`text-xs ${FOLLOWUP_OUTCOME_CONFIG[followup.outcome as FollowupOutcome]?.color || ''} text-white`}
                            >
                              {FOLLOWUP_OUTCOME_CONFIG[followup.outcome as FollowupOutcome]?.label || followup.outcome}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(followup.followup_date), "dd/MM/yy HH:mm", { locale: ptBR })}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleDelete(followup)}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      {followup.notes && (
                        <p className="text-xs text-muted-foreground mt-2 pl-6">
                          {followup.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
