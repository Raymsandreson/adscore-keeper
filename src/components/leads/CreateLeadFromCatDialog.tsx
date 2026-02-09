import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { UserPlus, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuthContext } from '@/contexts/AuthContext';
import { generateLeadName } from '@/utils/generateLeadName';
import type { CatLead } from '@/hooks/useCatLeads';

interface KanbanBoard {
  id: string;
  name: string;
  is_default: boolean;
  stages: { id: string; name: string; color: string }[];
}

interface CreateLeadFromCatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catLead: CatLead;
  onLeadCreated: (leadId: string) => void;
}

export function CreateLeadFromCatDialog({
  open,
  onOpenChange,
  catLead,
  onLeadCreated,
}: CreateLeadFromCatDialogProps) {
  const { user } = useAuthContext();
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');
  const [saving, setSaving] = useState(false);

  // Pre-fill fields from CAT data
  const phone = catLead.celular_1 || catLead.celular_2 || catLead.fixo_1 || '';
  const generatedName = generateLeadName({
    city: catLead.municipio,
    state: catLead.uf,
    victim_name: catLead.nome_completo,
    main_company: null,
    accident_date: catLead.data_acidente,
    damage_description: catLead.natureza_lesao,
  }, catLead.nome_completo);

  const [leadName, setLeadName] = useState(generatedName);
  const [leadNotes, setLeadNotes] = useState('');

  useEffect(() => {
    setLeadName(generatedName);
  }, [generatedName]);

  // Fetch boards
  useEffect(() => {
    const fetchBoards = async () => {
      const { data } = await supabase
        .from('kanban_boards')
        .select('id, name, is_default, stages')
        .order('display_order');
      if (data) {
        const parsed = data.map(b => ({
          ...b,
          stages: (b.stages as unknown as KanbanBoard['stages']) || [],
        }));
        setBoards(parsed);
        const defaultBoard = parsed.find(b => b.is_default) || parsed[0];
        if (defaultBoard) {
          setSelectedBoardId(defaultBoard.id);
          if (defaultBoard.stages.length > 0) {
            setSelectedStageId(defaultBoard.stages[0].id);
          }
        }
      }
    };
    if (open) fetchBoards();
  }, [open]);

  const selectedBoard = boards.find(b => b.id === selectedBoardId);

  useEffect(() => {
    if (selectedBoard && selectedBoard.stages.length > 0 && !selectedBoard.stages.find(s => s.id === selectedStageId)) {
      setSelectedStageId(selectedBoard.stages[0].id);
    }
  }, [selectedBoardId]);

  const handleCreate = async () => {
    if (!selectedBoardId) {
      toast.error('Selecione um quadro');
      return;
    }
    setSaving(true);
    try {
      const selectedStage = selectedBoard?.stages.find(s => s.id === selectedStageId);

      const { data: lead, error } = await supabase
        .from('leads')
        .insert([{
          lead_name: leadName,
          lead_phone: phone || null,
          victim_name: catLead.nome_completo,
          city: catLead.municipio,
          state: catLead.uf,
          neighborhood: catLead.bairro,
          accident_date: catLead.data_acidente,
          damage_description: catLead.natureza_lesao,
          source: 'cat_import',
          status: selectedStage?.name === 'Novo' ? 'new' : 'contacted',
          board_id: selectedBoardId,
          notes: leadNotes || `Importado da CAT - ${catLead.nome_completo}. ${catLead.natureza_lesao || ''} - ${catLead.parte_corpo_atingida || ''}`,
          created_by: user?.id,
          updated_by: user?.id,
        }])
        .select('id')
        .single();

      if (error) throw error;

      // Link cat_lead to the created lead
      await supabase
        .from('cat_leads')
        .update({ lead_id: lead.id, contact_status: 'converted' })
        .eq('id', catLead.id);

      // Record stage history
      if (selectedStage) {
        await supabase.from('lead_stage_history').insert([{
          lead_id: lead.id,
          to_stage: selectedStage.name,
          to_board_id: selectedBoardId,
          notes: 'Lead criado a partir de CAT',
        }]);
      }

      toast.success('Lead criado com sucesso!');
      onLeadCreated(lead.id);
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating lead from CAT:', error);
      toast.error('Erro ao criar lead');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Criar Lead a partir da CAT
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* CAT Summary */}
          <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
            <p><strong>{catLead.nome_completo}</strong></p>
            <p className="text-muted-foreground">{catLead.municipio}/{catLead.uf} • {catLead.natureza_lesao}</p>
            {phone && <p className="text-muted-foreground">📞 {phone}</p>}
          </div>

          {/* Lead Name */}
          <div className="space-y-1.5">
            <Label className="text-xs">Nome do Lead</Label>
            <Input
              value={leadName}
              onChange={e => setLeadName(e.target.value)}
              placeholder="Nome do lead..."
            />
          </div>

          {/* Board Selector */}
          <div className="space-y-1.5">
            <Label className="text-xs">Quadro Kanban</Label>
            <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar quadro" />
              </SelectTrigger>
              <SelectContent>
                {boards.map(b => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} {b.is_default && <Badge variant="secondary" className="ml-1 text-[10px]">Padrão</Badge>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stage Selector */}
          {selectedBoard && selectedBoard.stages.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Estágio inicial</Label>
              <Select value={selectedStageId} onValueChange={setSelectedStageId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar estágio" />
                </SelectTrigger>
                <SelectContent>
                  {selectedBoard.stages.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={leadNotes}
              onChange={e => setLeadNotes(e.target.value)}
              placeholder="Notas adicionais sobre o lead..."
              className="min-h-[60px]"
            />
          </div>

          <Button onClick={handleCreate} disabled={saving} className="w-full">
            <CheckCircle className="h-4 w-4 mr-2" />
            {saving ? 'Criando...' : 'Criar Lead'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
