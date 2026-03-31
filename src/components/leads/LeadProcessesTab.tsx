import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useLeadProcesses, LeadProcess } from '@/hooks/useLeadProcesses';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { Plus, Scale, Gavel, FileText, Trash2, Edit3, Archive, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirmDelete } from '@/hooks/useConfirmDelete';

interface LeadProcessesTabProps {
  leadId: string;
  boards: KanbanBoard[];
}

export function LeadProcessesTab({ leadId, boards }: LeadProcessesTabProps) {
  const { processes, loading, fetchProcesses, addProcess, updateProcess, deleteProcess } = useLeadProcesses(leadId);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProcess, setEditingProcess] = useState<LeadProcess | null>(null);
  const { confirmDelete, ConfirmDeleteDialog } = useConfirmDelete();

  // Form state
  const [processType, setProcessType] = useState<'judicial' | 'administrativo'>('judicial');
  const [processNumber, setProcessNumber] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [startedAt, setStartedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [feePercentage, setFeePercentage] = useState('');

  useEffect(() => {
    fetchProcesses();
  }, [leadId]);

  const resetForm = () => {
    setProcessType('judicial');
    setProcessNumber('');
    setTitle('');
    setDescription('');
    setWorkflowId('');
    setStartedAt(new Date().toISOString().slice(0, 10));
    setNotes('');
    setFeePercentage('');
    setEditingProcess(null);
  };

  const openEdit = (p: LeadProcess) => {
    setEditingProcess(p);
    setProcessType(p.process_type);
    setProcessNumber(p.process_number || '');
    setTitle(p.title);
    setDescription(p.description || '');
    setWorkflowId(p.workflow_id || '');
    setStartedAt(p.started_at || '');
    setNotes(p.notes || '');
    setFeePercentage(p.fee_percentage != null ? String(p.fee_percentage) : '');
    setShowAddDialog(true);
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    const selectedBoard = boards.find(b => b.id === workflowId);
    const payload: Partial<LeadProcess> = {
      lead_id: leadId,
      process_type: processType,
      process_number: processNumber || null,
      title: title.trim(),
      description: description || null,
      workflow_id: workflowId || null,
      workflow_name: selectedBoard?.name || null,
      started_at: startedAt || null,
      notes: notes || null,
      fee_percentage: feePercentage ? parseFloat(feePercentage) : null,
    };

    if (editingProcess) {
      await updateProcess(editingProcess.id, payload);
    } else {
      const savedProcess = await addProcess(payload);
      
      // Auto-create "Dar andamento" activity for the new process
      if (savedProcess) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          await supabase.from('lead_activities').insert({
            lead_id: leadId,
            lead_name: title.trim(),
            title: 'Dar andamento',
            description: `Atividade criada automaticamente para o processo: ${title.trim()}${processNumber ? ` (Nº ${processNumber})` : ''}`,
            activity_type: 'tarefa',
            status: 'pendente',
            priority: 'normal',
            assigned_to: user?.id,
            created_by: user?.id,
            deadline: new Date().toISOString().slice(0, 10),
            process_id: savedProcess.id,
          } as any);
          toast.success('Atividade "Dar andamento" criada automaticamente');
        } catch (actErr) {
          console.error('Error auto-creating activity for process:', actErr);
        }
      }
    }
    setShowAddDialog(false);
    resetForm();
  };

  const handleStatusChange = async (p: LeadProcess, status: LeadProcess['status']) => {
    const updates: Partial<LeadProcess> = { status };
    if (status === 'concluido' || status === 'arquivado') {
      updates.finished_at = new Date().toISOString().slice(0, 10);
    }
    await updateProcess(p.id, updates);
  };

  const statusColors: Record<string, string> = {
    em_andamento: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    concluido: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    arquivado: 'bg-muted text-muted-foreground',
  };

  const statusLabels: Record<string, string> = {
    em_andamento: 'Em Andamento',
    concluido: 'Concluído',
    arquivado: 'Arquivado',
  };

  if (loading && processes.length === 0) {
    return <div className="text-center text-muted-foreground py-8">Carregando processos...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Scale className="h-4 w-4" />
          Processos ({processes.length})
        </h3>
        <Button size="sm" onClick={() => { resetForm(); setShowAddDialog(true); }}>
          <Plus className="h-4 w-4 mr-1" />
          Novo Processo
        </Button>
      </div>

      {processes.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Scale className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Nenhum processo vinculado a este caso.</p>
          <p className="text-xs mt-1">Adicione processos judiciais ou administrativos.</p>
        </div>
      )}

      <div className="space-y-3">
        {processes.map(p => (
          <Card key={p.id} className="p-3 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {p.process_type === 'judicial' ? (
                  <Gavel className="h-4 w-4 text-orange-500" />
                ) : (
                  <FileText className="h-4 w-4 text-blue-500" />
                )}
                <div>
                  <p className="text-sm font-medium">{p.title}</p>
                  {p.process_number && (
                    <p className="text-xs text-muted-foreground">Nº {p.process_number}</p>
                  )}
                  {p.fee_percentage != null && (
                    <p className="text-xs text-muted-foreground">Honorários: {p.fee_percentage}%</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="secondary" className={`text-xs ${statusColors[p.status]}`}>
                  {statusLabels[p.status]}
                </Badge>
              </div>
            </div>

            {p.workflow_name && (
              <p className="text-xs text-muted-foreground">
                Fluxo: <span className="font-medium">{p.workflow_name}</span>
              </p>
            )}

            {p.description && (
              <p className="text-xs text-muted-foreground">{p.description}</p>
            )}

            <div className="flex items-center gap-1 pt-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEdit(p)}>
                <Edit3 className="h-3 w-3 mr-1" />
                Editar
              </Button>
              {p.status === 'em_andamento' && (
                <>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-green-600" onClick={() => handleStatusChange(p, 'concluido')}>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Concluir
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleStatusChange(p, 'arquivado')}>
                    <Archive className="h-3 w-3 mr-1" />
                    Arquivar
                  </Button>
                </>
              )}
              {p.status !== 'em_andamento' && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleStatusChange(p, 'em_andamento')}>
                  Reabrir
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => confirmDelete('Excluir Processo', `Tem certeza que deseja excluir o processo "${p.title}"? Esta ação não pode ser desfeita.`, () => deleteProcess(p.id))}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProcess ? 'Editar Processo' : 'Novo Processo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Tipo *</Label>
              <Select value={processType} onValueChange={(v) => setProcessType(v as 'judicial' | 'administrativo')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="judicial">
                    <span className="flex items-center gap-2"><Gavel className="h-3 w-3" /> Judicial</span>
                  </SelectItem>
                  <SelectItem value="administrativo">
                    <span className="flex items-center gap-2"><FileText className="h-3 w-3" /> Administrativo</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Título *</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Processo trabalhista contra empresa X" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nº do Processo</Label>
                <Input value={processNumber} onChange={e => setProcessNumber(e.target.value)} placeholder="0000000-00.0000.0.00.0000" />
              </div>
              <div>
                <Label>Honorários (%)</Label>
                <Input type="number" min="0" max="100" step="0.1" value={feePercentage} onChange={e => setFeePercentage(e.target.value)} placeholder="Ex: 30" />
              </div>
            </div>

            <div>
              <Label>Fluxo de Trabalho</Label>
              <Select value={workflowId} onValueChange={setWorkflowId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um fluxo..." />
                </SelectTrigger>
                <SelectContent>
                  {boards.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Data de Início</Label>
              <Input type="date" value={startedAt} onChange={e => setStartedAt(e.target.value)} />
            </div>

            <div>
              <Label>Descrição</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Detalhes do processo..." rows={3} />
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas internas..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddDialog(false); resetForm(); }}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!title.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog />
    </div>
  );
}
