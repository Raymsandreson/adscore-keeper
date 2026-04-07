import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useLegalCases, LegalCase } from '@/hooks/useLegalCases';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useLeadProcesses, LeadProcess } from '@/hooks/useLeadProcesses';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { useProcessParties, partyRoleLabels, PartyRole } from '@/hooks/useProcessParties';
import { autoCreatePartiesFromEnvolvidos } from '@/utils/escavadorPartyUtils';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { supabase } from '@/integrations/supabase/client';
import {
  Plus, Scale, Gavel, FileText, Trash2, Edit3, Archive, CheckCircle,
  ChevronDown, ChevronRight, FolderOpen, Users, Briefcase, XCircle, RefreshCw, Loader2, ScrollText, Upload, Sparkles, Bell, BellOff, BellRing,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { ProcessMonitorDialog } from '@/components/cases/ProcessMonitorDialog';
import { toast } from 'sonner';
import AddProcessDialog from '@/components/cases/AddProcessDialog';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface LegalCasesTabProps {
  leadId: string;
  boards: KanbanBoard[];
  onViewContact?: (contactId: string) => void;
}

export function LegalCasesTab({ leadId, boards, onViewContact }: LegalCasesTabProps) {
  const { cases, loading: casesLoading, fetchCases, createCase, updateCase, deleteCase } = useLegalCases(leadId);
  const { nuclei } = useSpecializedNuclei();
  const profiles = useProfilesList();

  const [showCaseDialog, setShowCaseDialog] = useState(false);
  const [editingCase, setEditingCase] = useState<LegalCase | null>(null);
  const [caseTitle, setCaseTitle] = useState('');
  const [caseCaseNumber, setCaseCaseNumber] = useState('');
  const [caseDescription, setCaseDescription] = useState('');
  const [caseNucleusId, setCaseNucleusId] = useState('');
  const [caseNotes, setCaseNotes] = useState('');
  const [caseAcolhedor, setCaseAcolhedor] = useState('');
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [processRefreshKey, setProcessRefreshKey] = useState(0);
  const [selectedProcesses, setSelectedProcesses] = useState<Set<string>>(new Set());

  const PREDEFINED_PROCESSES = [
    'Indenização',
    'Relatório de Acidente',
    'TRCT + Verbas',
    'Seguro de Vida',
    'Benefício INSS',
    'Inquérito Policial',
    'Organizar docs',
    'Onboarding',
  ];

  useEffect(() => {
    fetchCases();
  }, [leadId]);

  const resetCaseForm = () => {
    setCaseTitle('');
    setCaseCaseNumber('');
    setCaseDescription('');
    setCaseNucleusId('');
    setCaseNotes('');
    setCaseAcolhedor('');
    setEditingCase(null);
    setSelectedProcesses(new Set());
  };

  const toggleProcess = (name: string) => {
    setSelectedProcesses(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Mapping of process title → default assigned user for CASO-type cases
  const CASO_PROCESS_ASSIGNMENTS: Record<string, { userId: string; userName: string }> = {
    'Seguro de Vida': { userId: '807018be-a633-4d2c-8f89-30d1399e4df7', userName: 'Natasha' },
    'Benefício INSS': { userId: '4dba2de0-5357-49ab-8bf9-4c248a1440de', userName: 'Gisele' },
    'Inquérito Policial': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa' },
    'Organizar docs': { userId: '7f41a35e-7d98-4ade-8270-52d727433e6a', userName: 'Abderaman' },
    'Onboarding': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa' },
    'Indenização': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa' },
    'Relatório de Acidente': { userId: '807018be-a633-4d2c-8f89-30d1399e4df7', userName: 'Natasha' },
    'TRCT + Verbas': { userId: '44fd2301-47c6-4912-a583-0213b1c368eb', userName: 'João Vitor' },
  };

  const autoCreateProcesses = async (caseId: string, caseLeadId: string, caseNumber?: string) => {
    if (selectedProcesses.size === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    const isCaso = !caseNumber || caseNumber.startsWith('CASO');
    for (const title of selectedProcesses) {
      try {
        const { data: savedProcess } = await supabase.from('lead_processes').insert({
          lead_id: caseLeadId,
          case_id: caseId,
          process_type: 'administrativo',
          title,
          status: 'em_andamento',
          started_at: new Date().toISOString().slice(0, 10),
          created_by: user?.id,
        } as any).select('id').single();

        // Auto-create activity for CASO-type cases
        if (isCaso && CASO_PROCESS_ASSIGNMENTS[title]) {
          const assignment = CASO_PROCESS_ASSIGNMENTS[title];
          try {
            await supabase.from('lead_activities').insert({
              lead_id: caseLeadId,
              title: `Dar andamento - ${title}`,
              description: `Atividade criada automaticamente para o processo: ${title}`,
              activity_type: 'tarefa',
              status: 'pendente',
              priority: 'normal',
              assigned_to: assignment.userId,
              assigned_to_name: assignment.userName,
              created_by: user?.id,
              deadline: new Date().toISOString().slice(0, 10),
              process_id: savedProcess?.id || null,
            } as any);
          } catch (actErr) {
            console.warn(`Error creating activity for process "${title}":`, actErr);
          }
        }
      } catch (err) {
        console.warn(`Error creating process "${title}":`, err);
      }
    }
    toast.success(`${selectedProcesses.size} processo(s) criado(s) automaticamente`);
    if (isCaso && Array.from(selectedProcesses).some(t => CASO_PROCESS_ASSIGNMENTS[t])) {
      toast.success('Atividades atribuídas automaticamente');
    }
  };

  const handleSaveCase = async () => {
    if (!caseTitle.trim()) return;
    if (editingCase) {
      await updateCase(editingCase.id, {
        title: caseTitle.trim(),
        description: caseDescription || null,
        nucleus_id: caseNucleusId && caseNucleusId !== '__none__' ? caseNucleusId : null,
        notes: caseNotes || null,
        acolhedor: caseAcolhedor || null,
      } as Partial<LegalCase>);
      // Auto-create selected processes on edit too
      if (selectedProcesses.size > 0) {
        await autoCreateProcesses(editingCase.id, leadId, editingCase.case_number);
      }
    } else {
      const newCase = await createCase({
        lead_id: leadId,
        nucleus_id: caseNucleusId && caseNucleusId !== '__none__' ? caseNucleusId : null,
        title: caseTitle.trim(),
        description: caseDescription,
        notes: caseNotes,
        case_number: caseCaseNumber || undefined,
      });
      setExpandedCaseId(newCase.id);
      // Auto-create selected processes
      if (selectedProcesses.size > 0) {
        await autoCreateProcesses(newCase.id, leadId, newCase.case_number);
      }
    }
    setShowCaseDialog(false);
    resetCaseForm();
    // Force CaseCard to re-fetch processes
    setProcessRefreshKey(prev => prev + 1);
    await fetchCases();
  };

  const openEditCase = (c: LegalCase) => {
    setEditingCase(c);
    setCaseTitle(c.title);
    setCaseCaseNumber(c.case_number || '');
    setCaseDescription(c.description || '');
    setCaseNucleusId(c.nucleus_id || '');
    setCaseNotes(c.notes || '');
    setCaseAcolhedor(c.acolhedor || '');
    setShowCaseDialog(true);
  };

  const handleCaseStatusChange = async (c: LegalCase, status: string, outcome?: string) => {
    const updates: any = { status };
    if (outcome) {
      updates.outcome = outcome;
      updates.outcome_date = new Date().toISOString().slice(0, 10);
    }
    await updateCase(c.id, updates);
  };

  const caseStatusColors: Record<string, string> = {
    aberto: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    em_andamento: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    encerrado: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    arquivado: 'bg-muted text-muted-foreground',
  };

  const caseStatusLabels: Record<string, string> = {
    aberto: 'Aberto',
    em_andamento: 'Em Andamento',
    encerrado: 'Encerrado',
    arquivado: 'Arquivado',
  };

  if (casesLoading && cases.length === 0) {
    return <div className="text-center text-muted-foreground py-8">Carregando casos...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Briefcase className="h-4 w-4" />
          Casos ({cases.length})
        </h3>
        <Button size="sm" onClick={() => { resetCaseForm(); setShowCaseDialog(true); }}>
          <Plus className="h-4 w-4 mr-1" />
          Novo Caso
        </Button>
      </div>

      {cases.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Nenhum caso vinculado a este lead.</p>
          <p className="text-xs mt-1">Crie um caso quando o problema jurídico for definido.</p>
        </div>
      )}

      <div className="space-y-3">
        {cases.map(c => (
          <CaseCard
            key={c.id}
            legalCase={c}
            boards={boards}
            expanded={expandedCaseId === c.id}
            onToggle={() => setExpandedCaseId(expandedCaseId === c.id ? null : c.id)}
            onEdit={() => openEditCase(c)}
            onStatusChange={handleCaseStatusChange}
            onDelete={() => deleteCase(c.id)}
            statusColors={caseStatusColors}
            statusLabels={caseStatusLabels}
            onViewContact={onViewContact}
            refreshKey={processRefreshKey}
          />
        ))}
      </div>

      {/* Case Dialog */}
      <Dialog open={showCaseDialog} onOpenChange={setShowCaseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCase ? 'Editar Caso' : 'Novo Caso'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Número do Caso</Label>
              <Input value={caseCaseNumber} onChange={e => setCaseCaseNumber(e.target.value)} placeholder="Ex: CASO-0001 (deixe vazio para gerar automaticamente)" />
            </div>
            <div>
              <Label>Título *</Label>
              <Input value={caseTitle} onChange={e => setCaseTitle(e.target.value)} placeholder="Ex: Acidente de trabalho - João Silva" />
            </div>
            {nuclei.length > 0 && (
              <div>
                <Label>Núcleo Especializado</Label>
                <Select value={caseNucleusId} onValueChange={setCaseNucleusId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um núcleo..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhum (sequência geral)</SelectItem>
                    {nuclei.filter(n => n.is_active).map(n => (
                      <SelectItem key={n.id} value={n.id}>
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: n.color }} />
                          {n.name} ({n.prefix})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Descrição</Label>
              <Textarea value={caseDescription} onChange={e => setCaseDescription(e.target.value)} placeholder="Detalhes do caso..." rows={3} />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={caseNotes} onChange={e => setCaseNotes(e.target.value)} rows={2} />
            </div>
            <div>
              <Label>👤 Assessor Responsável</Label>
              <Select value={caseAcolhedor} onValueChange={setCaseAcolhedor}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o assessor..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {profiles.map(p => (
                    <SelectItem key={p.user_id} value={p.full_name || p.email || p.user_id}>
                      {p.full_name || p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-4 w-4" />
                Criar processos automaticamente
              </Label>
              <div className="border rounded-md p-2 space-y-1 max-h-48 overflow-y-auto">
                {PREDEFINED_PROCESSES.map(name => (
                  <label key={name} className="flex items-center gap-2 cursor-pointer hover:bg-accent/50 rounded px-2 py-1.5">
                    <Checkbox
                      checked={selectedProcesses.has(name)}
                      onCheckedChange={() => toggleProcess(name)}
                    />
                    <span className="text-sm">{name}</span>
                  </label>
                ))}
              </div>
              {selectedProcesses.size > 0 && (
                <p className="text-xs text-muted-foreground mt-1">{selectedProcesses.size} processo(s) será(ão) criado(s)</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCaseDialog(false); resetCaseForm(); }}>Cancelar</Button>
            <Button onClick={handleSaveCase} disabled={!caseTitle.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ========= Case Card with expandable processes =========

interface CaseCardProps {
  legalCase: LegalCase;
  boards: KanbanBoard[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onStatusChange: (c: LegalCase, status: string, outcome?: string) => void;
  onDelete: () => void;
  statusColors: Record<string, string>;
  statusLabels: Record<string, string>;
  onViewContact?: (contactId: string) => void;
  refreshKey?: number;
}

function CaseCard({ legalCase, boards, expanded, onToggle, onEdit, onStatusChange, onDelete, statusColors, statusLabels, onViewContact, refreshKey }: CaseCardProps) {
  const { processes, loading: procLoading, fetchProcesses, addProcess, updateProcess, deleteProcess } = useLeadProcesses(legalCase.id);
  const [showProcessDialog, setShowProcessDialog] = useState(false);
  const [editingProcess, setEditingProcess] = useState<LeadProcess | null>(null);

  // Process form
  const [processType, setProcessType] = useState<'judicial' | 'administrativo'>('judicial');
  const [processNumber, setProcessNumber] = useState('');
  const [processTitle, setProcessTitle] = useState('');
  const [processDescription, setProcessDescription] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [startedAt, setStartedAt] = useState(new Date().toISOString().slice(0, 10));
  const [processNotes, setProcessNotes] = useState('');
  const [processFeePercentage, setProcessFeePercentage] = useState('');

  useEffect(() => {
    if (expanded) fetchProcesses();
  }, [expanded, refreshKey]);

  const resetProcessForm = () => {
    setProcessType('judicial');
    setProcessNumber('');
    setProcessTitle('');
    setProcessDescription('');
    setWorkflowId('');
    setStartedAt(new Date().toISOString().slice(0, 10));
    setProcessNotes('');
    setProcessFeePercentage('');
    setEditingProcess(null);
  };

  const openEditProcess = (p: LeadProcess) => {
    setEditingProcess(p);
    setProcessType(p.process_type);
    setProcessNumber(p.process_number || '');
    setProcessTitle(p.title);
    setProcessDescription(p.description || '');
    setWorkflowId(p.workflow_id || '');
    setStartedAt(p.started_at || '');
    setProcessNotes(p.notes || '');
    setProcessFeePercentage(p.fee_percentage != null ? String(p.fee_percentage) : '');
    setShowProcessDialog(true);
  };

  const handleSaveProcess = async () => {
    if (!processTitle.trim()) return;
    const selectedBoard = boards.find(b => b.id === workflowId);
    const payload: Partial<LeadProcess> = {
      lead_id: legalCase.lead_id!,
      case_id: legalCase.id,
      process_type: processType,
      process_number: processNumber || null,
      title: processTitle.trim(),
      description: processDescription || null,
      workflow_id: workflowId || null,
      workflow_name: selectedBoard?.name || null,
      started_at: startedAt || null,
      notes: processNotes || null,
      fee_percentage: processFeePercentage ? parseFloat(processFeePercentage) : null,
    };
    let savedProcess: LeadProcess | undefined;
    if (editingProcess) {
      await updateProcess(editingProcess.id, payload);
    } else {
      savedProcess = await addProcess(payload);
      
      // Auto-create "Dar andamento" activity for the new process
      if (savedProcess) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          await supabase.from('lead_activities').insert({
            lead_id: legalCase.lead_id,
            lead_name: processTitle.trim(),
            title: 'Dar andamento',
            description: `Atividade criada automaticamente para o processo: ${processTitle.trim()}${processNumber ? ` (Nº ${processNumber})` : ''}`,
            activity_type: 'tarefa',
            status: 'pendente',
            priority: 'normal',
            assigned_to: user?.id,
            created_by: user?.id,
            deadline: new Date().toISOString().slice(0, 10),
          } as any);
          toast.success('Atividade "Dar andamento" criada automaticamente');
        } catch (actErr) {
          console.error('Error auto-creating activity for process:', actErr);
        }
      }
    }
    setShowProcessDialog(false);
    resetProcessForm();
  };

  const handleProcessStatusChange = async (p: LeadProcess, status: LeadProcess['status']) => {
    const updates: Partial<LeadProcess> = { status };
    if (status === 'concluido' || status === 'arquivado') {
      updates.finished_at = new Date().toISOString().slice(0, 10);
    }
    await updateProcess(p.id, updates);
  };

  const processStatusColors: Record<string, string> = {
    em_andamento: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    concluido: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    arquivado: 'bg-muted text-muted-foreground',
  };
  const processStatusLabels: Record<string, string> = {
    em_andamento: 'Em Andamento',
    concluido: 'Concluído',
    arquivado: 'Arquivado',
  };

  return (
    <Card className="overflow-hidden">
      <Collapsible open={expanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <div className="p-3 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {legalCase.nucleus_color && (
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: legalCase.nucleus_color }} />
              )}
              <div>
                <p className="text-sm font-medium">{legalCase.case_number} — {legalCase.title}</p>
                {legalCase.nucleus_name && (
                  <p className="text-xs text-muted-foreground">{legalCase.nucleus_name}</p>
                )}
              </div>
            </div>
            <Badge variant="secondary" className={`text-xs ${statusColors[legalCase.status]}`}>
              {statusLabels[legalCase.status]}
            </Badge>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3 border-t pt-3">
            {legalCase.description && (
              <p className="text-xs text-muted-foreground">{legalCase.description}</p>
            )}

            {/* Case actions */}
            <div className="flex items-center gap-1 flex-wrap">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}>
                <Edit3 className="h-3 w-3 mr-1" /> Editar
              </Button>
              {legalCase.status !== 'encerrado' && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-green-600"
                  onClick={() => onStatusChange(legalCase, 'encerrado')}>
                  <CheckCircle className="h-3 w-3 mr-1" /> Encerrar
                </Button>
              )}
              {legalCase.status !== 'em_andamento' && legalCase.status !== 'encerrado' && (
                <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => onStatusChange(legalCase, 'em_andamento')}>
                  Em Andamento
                </Button>
              )}
              {legalCase.status === 'encerrado' && (
                <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => onStatusChange(legalCase, 'aberto')}>
                  Reabrir
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={onDelete}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>

            {/* Processes within case */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5" />
                  Processos ({processes.length})
                </h4>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => { resetProcessForm(); setShowProcessDialog(true); }}>
                  <Plus className="h-3 w-3 mr-1" /> Processo
                </Button>
              </div>

              {procLoading && processes.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">Carregando...</p>
              )}

              {!procLoading && processes.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Nenhum processo neste caso.
                </p>
              )}

              <div className="space-y-2">
                {processes.map(p => (
                  <ProcessCard
                    key={p.id}
                    process={p}
                    statusColors={processStatusColors}
                    statusLabels={processStatusLabels}
                    onEdit={() => openEditProcess(p)}
                    onStatusChange={handleProcessStatusChange}
                    onDelete={() => deleteProcess(p.id)}
                    onUpdate={updateProcess}
                    onViewContact={onViewContact}
                  />
                ))}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Process Dialog - Edit mode (inline) */}
      {editingProcess && (
        <Dialog open={showProcessDialog} onOpenChange={setShowProcessDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Editar Processo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Tipo *</Label>
                <Select value={processType} onValueChange={(v) => setProcessType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="judicial"><span className="flex items-center gap-2"><Gavel className="h-3 w-3" /> Judicial</span></SelectItem>
                    <SelectItem value="administrativo"><span className="flex items-center gap-2"><FileText className="h-3 w-3" /> Administrativo</span></SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Título *</Label>
                <Input value={processTitle} onChange={e => setProcessTitle(e.target.value)} placeholder="Ex: Reclamatória trabalhista" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Nº do Processo</Label>
                  <Input value={processNumber} onChange={e => setProcessNumber(e.target.value)} placeholder="0000000-00.0000.0.00.0000" />
                </div>
                <div>
                  <Label>Honorários (%)</Label>
                  <Input type="number" min="0" max="100" step="0.1" value={processFeePercentage} onChange={e => setProcessFeePercentage(e.target.value)} placeholder="Ex: 30" />
                </div>
              </div>
              <div>
                <Label>Fluxo de Trabalho</Label>
                <Select value={workflowId} onValueChange={setWorkflowId}>
                  <SelectTrigger><SelectValue placeholder="Selecione um fluxo..." /></SelectTrigger>
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
                <Textarea value={processDescription} onChange={e => setProcessDescription(e.target.value)} rows={3} />
              </div>
              <div>
                <Label>Observações</Label>
                <Textarea value={processNotes} onChange={e => setProcessNotes(e.target.value)} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowProcessDialog(false); resetProcessForm(); }}>Cancelar</Button>
              <Button onClick={handleSaveProcess} disabled={!processTitle.trim()}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Process Dialog - New mode (with Escavador) */}
      {!editingProcess && (
        <AddProcessDialog
          open={showProcessDialog}
          onOpenChange={(open) => {
            setShowProcessDialog(open);
            if (!open) resetProcessForm();
          }}
          caseId={legalCase.id}
          leadId={legalCase.lead_id!}
          onProcessAdded={fetchProcesses}
          boards={boards}
        />
      )}
    </Card>
  );
}

// ========= Process Card =========

interface ProcessCardProps {
  process: LeadProcess;
  statusColors: Record<string, string>;
  statusLabels: Record<string, string>;
  onEdit: () => void;
  onStatusChange: (p: LeadProcess, status: LeadProcess['status']) => void;
  onDelete: () => void;
  onUpdate: (id: string, updates: Partial<LeadProcess>) => Promise<LeadProcess | undefined>;
  onViewContact?: (contactId: string) => void;
}

function ProcessCard({ process, statusColors, statusLabels, onEdit, onStatusChange, onDelete, onUpdate, onViewContact }: ProcessCardProps) {
  const [showParties, setShowParties] = useState(false);
  const { parties, loading: partiesLoading, fetchParties, addParty, removeParty } = useProcessParties(process.id);
  const [showAddParty, setShowAddParty] = useState(false);
  const [searchContact, setSearchContact] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedRole, setSelectedRole] = useState<PartyRole>('autor');
  const [refreshing, setRefreshing] = useState(false);
  const [showMovimentacoes, setShowMovimentacoes] = useState(false);
  const [showPetitionDialog, setShowPetitionDialog] = useState(false);
  const [petitionText, setPetitionText] = useState('');
  const [analyzingPetition, setAnalyzingPetition] = useState(false);
  const [showMonitorDialog, setShowMonitorDialog] = useState(false);

  useEffect(() => {
    fetchParties();
  }, []);

  useEffect(() => {
    if (showParties) fetchParties();
  }, [showParties]);

  const handleSearchContacts = async (query: string) => {
    setSearchContact(query);
    if (!query.trim()) { setSearchResults([]); return; }
    const { data } = await supabase
      .from('contacts')
      .select('id, full_name, phone')
      .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
      .limit(5);
    setSearchResults(data || []);
  };

  const handleAddParty = async (contactId: string) => {
    await addParty({ process_id: process.id, contact_id: contactId, role: selectedRole });
    setShowAddParty(false);
    setSearchContact('');
    setSearchResults([]);
  };

   // mapParticipationToRole now imported from shared utility

  const handleRefreshFromEscavador = async () => {
    if (!process.process_number) {
      toast.error('Este processo não tem número CNJ para buscar no Escavador');
      return;
    }
    setRefreshing(true);
    try {
      const { data, error } = await cloudFunctions.invoke('search-escavador', {
        body: { action: 'buscar_completo', numero_cnj: process.process_number },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      const result = data.data;
      const fonte = result.fontes?.[0];
      const movimentacoes = result.movimentacoes_detalhadas || (fonte as any)?.movimentacoes || [];

      // Update the process with fresh data
      const updates: Partial<LeadProcess> = {
        polo_ativo: result.titulo_polo_ativo || process.polo_ativo,
        polo_passivo: result.titulo_polo_passivo || process.polo_passivo,
        ano_inicio: result.ano_inicio || process.ano_inicio,
        tribunal: fonte?.tribunal || fonte?.nome || process.tribunal,
        grau: fonte?.grau || process.grau,
        classe: fonte?.classe?.nome || process.classe,
        area: fonte?.area?.nome || process.area,
        assuntos: fonte?.assuntos?.map((a: any) => a.nome) || process.assuntos,
        valor_causa: (result as any).valor_causa || process.valor_causa,
        envolvidos: fonte?.envolvidos || process.envolvidos,
        movimentacoes: movimentacoes.length > 0 ? movimentacoes : process.movimentacoes,
        fonte_nome: fonte?.nome || process.fonte_nome,
        fonte_tipo: fonte?.tipo || process.fonte_tipo,
        fonte_data_inicio: fonte?.data_inicio || process.fonte_data_inicio,
        fonte_data_fim: fonte?.data_fim || process.fonte_data_fim,
        escavador_raw: result,
      };

      await onUpdate(process.id, updates as any);

      // Auto-create contacts and parties from envolvidos using shared utility
      if (fonte?.envolvidos?.length) {
        const { data: { user } } = await supabase.auth.getUser();
        const partiesCreated = await autoCreatePartiesFromEnvolvidos(process.id, fonte.envolvidos, user?.id);
        if (partiesCreated > 0) fetchParties();
      }

      toast.success(`Processo atualizado com ${movimentacoes.length} movimentações e ${fonte?.envolvidos?.length || 0} envolvidos`);
    } catch (err: any) {
      console.error('Refresh error:', err);
      toast.error(err.message || 'Erro ao atualizar do Escavador');
    } finally {
      setRefreshing(false);
    }
  };

  const handleAnalyzePetition = async () => {
    if (!petitionText.trim()) {
      toast.error('Cole o texto da petição inicial');
      return;
    }
    setAnalyzingPetition(true);
    try {
      const { data: fnData, error: fnError } = await cloudFunctions.invoke('analyze-petition', {
        body: { text: petitionText, processNumber: process.process_number },
      });
      if (fnError) throw fnError;
      const extracted = fnData?.data;
      if (!extracted) throw new Error('Sem dados extraídos');

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      let created = 0;

      // Create contacts from extracted parties
      const allParties = [
        ...(extracted.partes || []),
        ...(extracted.advogados || []).map((a: any) => ({
          nome: a.nome,
          tipo: a.lado === 'autor' ? 'advogado' : 'advogado',
          profissao: 'Advogado(a)',
          oab: a.oab_numero ? `OAB ${a.oab_uf || ''} ${a.oab_numero}` : null,
        })),
      ];

      // Also create victim if found
      if (extracted.vitima?.nome) {
        const victimData: Record<string, any> = {
          full_name: extracted.vitima.nome,
          created_by: currentUser?.id || null,
          classifications: ['client'],
          classification: 'client',
          relationship_date: new Date().toISOString(),
        };
        if (extracted.vitima.cpf) victimData.notes = `CPF: ${extracted.vitima.cpf}`;
        if (extracted.vitima.profissao) victimData.profession = extracted.vitima.profissao;
        if (extracted.vitima.endereco) {
          if (extracted.vitima.endereco.rua) victimData.street = extracted.vitima.endereco.rua;
          if (extracted.vitima.endereco.bairro) victimData.neighborhood = extracted.vitima.endereco.bairro;
          if (extracted.vitima.endereco.cidade) victimData.city = extracted.vitima.endereco.cidade;
          if (extracted.vitima.endereco.estado) victimData.state = extracted.vitima.endereco.estado;
          if (extracted.vitima.endereco.cep) victimData.cep = extracted.vitima.endereco.cep;
        }

        const { data: existingVictim } = await supabase
          .from('contacts').select('id').ilike('full_name', extracted.vitima.nome).limit(1);
        
        if (!existingVictim?.length) {
          const { data: newContact } = await supabase.from('contacts').insert(victimData as any).select('id').single();
          if (newContact) {
            await supabase.from('process_parties').insert({
              process_id: process.id,
              contact_id: newContact.id,
              role: 'autor',
              notes: 'Vítima (extraído da inicial)',
            } as any);
            created++;
          }
        }
      }

      for (const parte of allParties) {
        if (!parte.nome?.trim()) continue;
        const contactData: Record<string, any> = {
          full_name: parte.nome,
          created_by: currentUser?.id || null,
          classifications: ['parte_contraria'],
          classification: 'parte_contraria',
        };
        if (parte.profissao) contactData.profession = parte.profissao;
        if (parte.cpf) contactData.notes = `CPF: ${parte.cpf}`;
        if (parte.endereco) {
          if (parte.endereco.rua) contactData.street = parte.endereco.rua;
          if (parte.endereco.bairro) contactData.neighborhood = parte.endereco.bairro;
          if (parte.endereco.cidade) contactData.city = parte.endereco.cidade;
          if (parte.endereco.estado) contactData.state = parte.endereco.estado;
          if (parte.endereco.cep) contactData.cep = parte.endereco.cep;
        }

        const { data: existing } = await supabase
          .from('contacts').select('id').ilike('full_name', parte.nome).limit(1);
        
        let contactId: string;
        if (existing?.length) {
          contactId = existing[0].id;
        } else {
          const { data: newC } = await supabase.from('contacts').insert(contactData as any).select('id').single();
          if (!newC) continue;
          contactId = newC.id;
        }

        const role = parte.tipo?.includes('advogad') ? 'advogado' : 
                     parte.tipo?.includes('reu') ? 'reu' : 
                     parte.tipo?.includes('autor') ? 'autor' : 'outro';
        
        await supabase.from('process_parties').insert({
          process_id: process.id,
          contact_id: contactId,
          role,
          notes: parte.relacao_vitima ? `Relação com vítima: ${parte.relacao_vitima}` : parte.tipo,
        } as any).then(() => created++);
      }

      toast.success(`IA extraiu ${created} partes da petição${extracted.resumo_fatos ? '. Resumo adicionado.' : ''}`);
      
      // Save summary to process notes if available
      if (extracted.resumo_fatos) {
        const currentNotes = process.notes || '';
        const newNotes = currentNotes 
          ? `${currentNotes}\n\n--- Resumo da Inicial (IA) ---\n${extracted.resumo_fatos}` 
          : `--- Resumo da Inicial (IA) ---\n${extracted.resumo_fatos}`;
        await onUpdate(process.id, { notes: newNotes } as any);
      }

      setShowPetitionDialog(false);
      setPetitionText('');
      fetchParties();
    } catch (err: any) {
      console.error('Petition analysis error:', err);
      toast.error(err.message || 'Erro ao analisar petição');
    } finally {
      setAnalyzingPetition(false);
    }
  };

  return (
    <div className="border rounded-lg p-2.5 space-y-2 bg-card">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {process.process_type === 'judicial' ? (
            <Gavel className="h-3.5 w-3.5 text-orange-500" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-blue-500" />
          )}
          <div>
            <p className="text-xs font-medium">{process.title}</p>
            {process.process_number && (
              <p className="text-[10px] text-muted-foreground">Nº {process.process_number}</p>
            )}
            {process.fee_percentage != null && (
              <p className="text-[10px] text-muted-foreground">Honorários: {process.fee_percentage}%</p>
            )}
          </div>
        </div>
        <Badge variant="secondary" className={`text-[10px] ${statusColors[process.status]}`}>
          {statusLabels[process.status]}
        </Badge>
      </div>

      {process.workflow_name && (
        <p className="text-[10px] text-muted-foreground">Fluxo: {process.workflow_name}</p>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={onEdit}>
          <Edit3 className="h-2.5 w-2.5 mr-0.5" /> Editar
        </Button>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2"
          onClick={() => setShowParties(!showParties)}>
          <Users className="h-2.5 w-2.5 mr-0.5" /> Partes ({parties.length})
        </Button>
        {process.status === 'em_andamento' && (
          <>
            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-green-600"
              onClick={() => onStatusChange(process, 'concluido')}>
              <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> Concluir
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2"
              onClick={() => onStatusChange(process, 'arquivado')}>
              <Archive className="h-2.5 w-2.5 mr-0.5" /> Arquivar
            </Button>
          </>
        )}
        {process.status !== 'em_andamento' && (
          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2"
            onClick={() => onStatusChange(process, 'em_andamento')}>
            Reabrir
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-destructive" onClick={onDelete}>
          <Trash2 className="h-2.5 w-2.5" />
        </Button>
        {process.process_number && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2 text-primary"
            onClick={handleRefreshFromEscavador}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5 mr-0.5" />}
            Atualizar Escavador
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2 text-amber-600"
          onClick={() => setShowPetitionDialog(true)}
        >
          <Sparkles className="h-2.5 w-2.5 mr-0.5" /> Analisar Petição
        </Button>
        {process.process_number && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2 text-emerald-600"
            onClick={() => setShowMonitorDialog(true)}
          >
            <BellRing className="h-2.5 w-2.5 mr-0.5" /> Notificar
          </Button>
        )}
        {process.movimentacoes && (process.movimentacoes as any[]).length > 0 && (
          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2"
            onClick={() => setShowMovimentacoes(!showMovimentacoes)}>
            <ScrollText className="h-2.5 w-2.5 mr-0.5" /> Movimentações ({(process.movimentacoes as any[]).length})
          </Button>
        )}
      </div>

      {/* Movimentações section */}
      {showMovimentacoes && process.movimentacoes && (process.movimentacoes as any[]).length > 0 && (
        <div className="border-t pt-2 space-y-1.5 max-h-[200px] overflow-y-auto">
          <h5 className="text-[10px] font-semibold flex items-center gap-1">
            <ScrollText className="h-3 w-3" /> Movimentações
          </h5>
          {(process.movimentacoes as any[]).slice(0, 20).map((mov: any, i: number) => (
            <div key={i} className="p-1.5 border rounded text-[10px] space-y-0.5 bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="font-medium">{mov.tipo || mov.type || 'Movimentação'}</span>
                <span className="text-muted-foreground">{mov.data || mov.date || ''}</span>
              </div>
              {(mov.conteudo || mov.content || mov.descricao) && (
                <p className="text-muted-foreground line-clamp-2">{mov.conteudo || mov.content || mov.descricao}</p>
              )}
            </div>
          ))}
          {(process.movimentacoes as any[]).length > 20 && (
            <p className="text-[10px] text-muted-foreground text-center">
              ... e mais {(process.movimentacoes as any[]).length - 20} movimentações
            </p>
          )}
        </div>
      )}

      {/* Parties section */}
      {showParties && (
        <div className="border-t pt-2 space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="text-[10px] font-semibold">Partes do Processo</h5>
            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => setShowAddParty(!showAddParty)}>
              <Plus className="h-2.5 w-2.5 mr-0.5" /> Parte
            </Button>
          </div>

          {showAddParty && (
            <div className="space-y-2 p-2 border rounded bg-muted/30">
              <Select value={selectedRole} onValueChange={v => setSelectedRole(v as PartyRole)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(partyRoleLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-7 text-xs"
                placeholder="Buscar contato..."
                value={searchContact}
                onChange={e => handleSearchContacts(e.target.value)}
              />
              {searchResults.map(c => (
                <div key={c.id} className="flex items-center justify-between p-1.5 border rounded text-xs hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleAddParty(c.id)}>
                  <span>{c.full_name}</span>
                  <span className="text-muted-foreground">{c.phone}</span>
                </div>
              ))}
            </div>
          )}

          {parties.length === 0 && !showAddParty && (
            <p className="text-[10px] text-muted-foreground text-center py-1">Nenhuma parte cadastrada.</p>
          )}

          <div className="max-h-[200px] overflow-y-auto space-y-1.5">
            {parties.map(party => (
              <div key={party.id} className="flex items-center justify-between text-xs p-1.5 border rounded">
                <div className="flex items-center gap-1 min-w-0 flex-1">
                  <button
                    className="font-medium text-left hover:text-primary hover:underline truncate transition-colors"
                    onClick={() => onViewContact?.(party.contact_id)}
                    title="Abrir contato"
                  >
                    {party.contact_name}
                  </button>
                  <Badge variant="outline" className="ml-1 text-[9px] shrink-0">
                    {partyRoleLabels[party.role] || party.role}
                  </Badge>
                </div>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0" onClick={() => removeParty(party.id)}>
                  <XCircle className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Process Monitor Dialog */}
      <ProcessMonitorDialog
        open={showMonitorDialog}
        onOpenChange={setShowMonitorDialog}
        processId={process.id}
        processNumber={process.process_number || ''}
        processTitle={process.title}
      />

      {/* Petition Analysis Dialog */}
      <Dialog open={showPetitionDialog} onOpenChange={setShowPetitionDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              Analisar Petição Inicial com IA
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Cole o texto da petição inicial abaixo. A IA irá extrair automaticamente as partes, endereços, profissões e relações.
            </p>
            <Textarea
              value={petitionText}
              onChange={(e) => setPetitionText(e.target.value)}
              placeholder="Cole aqui o texto completo da petição inicial..."
              rows={12}
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPetitionDialog(false)}>Cancelar</Button>
            <Button onClick={handleAnalyzePetition} disabled={analyzingPetition || !petitionText.trim()}>
              {analyzingPetition ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analisando...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> Analisar</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
