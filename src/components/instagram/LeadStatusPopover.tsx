import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Briefcase, 
  ExternalLink, 
  ChevronRight,
  Loader2,
  Check
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface Stage {
  id: string;
  name: string;
  color?: string;
}

interface Board {
  id: string;
  name: string;
  stages: Stage[];
}

interface LeadStatusPopoverProps {
  leadId: string;
  leadName: string | null;
  currentStatus: string | null;
  boardId: string | null;
  onStatusChanged?: () => void;
}

export const LeadStatusPopover: React.FC<LeadStatusPopoverProps> = ({
  leadId,
  leadName,
  currentStatus,
  boardId,
  onStatusChanged
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (open && boardId) {
      fetchBoard();
    }
  }, [open, boardId]);

  const fetchBoard = async () => {
    if (!boardId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('kanban_boards')
        .select('id, name, stages')
        .eq('id', boardId)
        .single();

      if (!error && data) {
        const rawStages = data.stages as unknown;
        const stages: Stage[] = Array.isArray(rawStages) 
          ? (rawStages as Stage[])
          : [];
        setBoard({ ...data, stages });
      }
    } catch (error) {
      console.error('Error fetching board:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeStatus = async (stageId: string) => {
    if (stageId === currentStatus) {
      setOpen(false);
      return;
    }

    setUpdating(true);
    try {
      // Update lead status
      const { error: updateError } = await supabase
        .from('leads')
        .update({ status: stageId })
        .eq('id', leadId);

      if (updateError) throw updateError;

      // Record history
      await supabase
        .from('lead_stage_history')
        .insert({
          lead_id: leadId,
          from_stage: currentStatus,
          to_stage: stageId,
          from_board_id: boardId,
          to_board_id: boardId
        });

      toast.success('Status atualizado!');
      onStatusChanged?.();
      setOpen(false);
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Erro ao atualizar status');
    } finally {
      setUpdating(false);
    }
  };

  const handleOpenInKanban = () => {
    navigate(`/leads?leadId=${leadId}`);
    setOpen(false);
  };

  const currentStageName = board?.stages.find(s => s.id === currentStatus)?.name || currentStatus || 'new';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge 
          variant="outline" 
          className="cursor-pointer text-xs bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors gap-1"
        >
          <Briefcase className="h-3 w-3" />
          <span className="max-w-[100px] truncate">
            {leadName || 'Sem nome'}
          </span>
          <span className="text-blue-500">
            ({currentStageName})
          </span>
          <ChevronRight className="h-3 w-3" />
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="space-y-2">
          <div className="flex items-center justify-between px-2 pb-2 border-b">
            <span className="text-sm font-medium truncate">{leadName || 'Lead'}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              onClick={handleOpenInKanban}
            >
              <ExternalLink className="h-3 w-3" />
              Abrir
            </Button>
          </div>
          
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : !board ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Lead sem quadro vinculado
            </div>
          ) : (
            <ScrollArea className="max-h-[200px]">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground px-2 pb-1">{board.name}</p>
                {board.stages.map(stage => (
                  <button
                    key={stage.id}
                    type="button"
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors text-left disabled:opacity-50"
                    onClick={() => handleChangeStatus(stage.id)}
                    disabled={updating}
                  >
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: stage.color || '#3b82f6' }}
                      />
                      <span className="text-sm">{stage.name}</span>
                    </div>
                    {currentStatus === stage.id && (
                      <Check className="h-3 w-3 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
