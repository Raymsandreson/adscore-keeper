import { useState, useEffect } from 'react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useLegalCases, LegalCase } from '@/hooks/useLegalCases';
import { useLeadProcesses, LeadProcess } from '@/hooks/useLeadProcesses';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { useProcessParties, partyRoleLabels, PartyRole } from '@/hooks/useProcessParties';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { supabase } from '@/integrations/supabase/client';
import {
  Plus, Scale, Gavel, FileText, Trash2, Edit3, Archive, CheckCircle,
  ChevronDown, ChevronRight, FolderOpen, Users, Briefcase, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

interface LegalCasesTabProps {
  leadId: string;
  boards: KanbanBoard[];
}

export function LegalCasesTab({ leadId, boards }: LegalCasesTabProps) {
  const { cases, loading: casesLoading, fetchCases, createCase, updateCase, deleteCase } = useLegalCases(leadId);
  const { nuclei } = useSpecializedNuclei();

  const [showCaseDialog, setShowCaseDialog] = useState(false);
  const [editingCase, setEditingCase] = useState<LegalCase | null>(null);
  const [caseTitle, setCaseTitle] = useState('');
  const [caseDescription, setCaseDescription] = useState('');
  const [caseNucleusId, setCaseNucleusId] = useState('');
  const [caseNotes, setCaseNotes] = useState('');
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);

  useEffect(() => {
    fetchCases();
  }, [leadId]);

  const resetCaseForm = () => {
    setCaseTitle('');
    setCaseDescription('');
    setCaseNucleusId('');
    setCaseNotes('');
    setEditingCase(null);
  };

  const handleSaveCase = async () => {
    if (!caseTitle.trim()) return;
    if (editingCase) {
      await updateCase(editingCase.id, {
        title: caseTitle.trim(),
        description: caseDescription || null,
        nucleus_id: caseNucleusId || null,
        notes: caseNotes || null,
      } as Partial<LegalCase>);
    } else {
      const newCase = await createCase({
        lead_id: leadId,
        nucleus_id: caseNucleusId || null,
        title: caseTitle.trim(),
        description: caseDescription,
        notes: caseNotes,
      });
      setExpandedCaseId(newCase.id);
    }
    setShowCaseDialog(false);
    resetCaseForm();
  };

  const openEditCase = (c: LegalCase) => {
    setEditingCase(c);
    setCaseTitle(c.title);
    setCaseDescription(c.description || '');
    setCaseNucleusId(c.nucleus_id || '');
    setCaseNotes(c.notes || '');
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
                    <SelectItem value="">Nenhum (sequência geral)</SelectItem>
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
}

function CaseCard({ legalCase, boards, expanded, onToggle, onEdit, onStatusChange, onDelete, statusColors, statusLabels }: CaseCardProps) {
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
  }, [expanded]);

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
                  />
                ))}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Process Dialog */}
      <Dialog open={showProcessDialog} onOpenChange={setShowProcessDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProcess ? 'Editar Processo' : 'Novo Processo'}</DialogTitle>
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
}

function ProcessCard({ process, statusColors, statusLabels, onEdit, onStatusChange, onDelete }: ProcessCardProps) {
  const [showParties, setShowParties] = useState(false);
  const { parties, loading: partiesLoading, fetchParties, addParty, removeParty } = useProcessParties(process.id);
  const [showAddParty, setShowAddParty] = useState(false);
  const [searchContact, setSearchContact] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedRole, setSelectedRole] = useState<PartyRole>('autor');

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
      </div>

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

          {parties.map(party => (
            <div key={party.id} className="flex items-center justify-between text-xs p-1.5 border rounded">
              <div>
                <span className="font-medium">{party.contact_name}</span>
                <Badge variant="outline" className="ml-1.5 text-[9px]">
                  {partyRoleLabels[party.role] || party.role}
                </Badge>
              </div>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => removeParty(party.id)}>
                <XCircle className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
