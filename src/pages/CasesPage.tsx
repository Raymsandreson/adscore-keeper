import { useState, useEffect, useCallback, useMemo } from 'react';
import { resolveProcessAssignment } from '@/lib/processAssignment';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Briefcase, Search, Scale, ChevronDown, ChevronRight,
  Gavel, FileText, Users, ArrowLeft, ExternalLink, Plus,
  Edit3, CheckCircle, Archive, Trash2, XCircle, Upload, Loader2,
} from 'lucide-react';
import { LegalCase } from '@/hooks/useLegalCases';
import { CopyableText } from '@/components/ui/copyable-text';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { toast } from 'sonner';
import AddProcessDialog from '@/components/cases/AddProcessDialog';
import ProcessDetailSheet from '@/components/cases/ProcessDetailSheet';
import { CaseWorkflowBoard } from '@/components/cases/CaseWorkflowBoard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useNavigate } from 'react-router-dom';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

const statusColors: Record<string, string> = {
  aberto: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  em_andamento: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  encerrado: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  arquivado: 'bg-muted text-muted-foreground',
};

const statusLabels: Record<string, string> = {
  aberto: 'Aberto',
  em_andamento: 'Em Andamento',
  encerrado: 'Encerrado',
  arquivado: 'Arquivado',
};

export default function CasesPage() {
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState('all');
  const [nucleusFilter, setNucleusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { nuclei } = useSpecializedNuclei();
  const navigate = useNavigate();

  // Export to Google Sheets state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [exporting, setExporting] = useState(false);

  const handleExportToSheets = async () => {
    if (!spreadsheetId.trim()) {
      toast.error('Informe o ID da planilha');
      return;
    }
    setExporting(true);
    try {
      // Extract spreadsheet ID from URL if full URL is pasted
      let sheetId = spreadsheetId.trim();
      const urlMatch = sheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (urlMatch) sheetId = urlMatch[1];

      const { data: { session } } = await supabase.auth.getSession();
      const response = await cloudFunctions.invoke('export-cases-to-sheets', {
        body: {
          spreadsheet_id: sheetId,
          sheet_name: sheetName.trim() || undefined,
          nucleus_filter: nucleusFilter !== 'all' ? nucleusFilter : undefined,
        },
        authToken: session?.access_token,
      });

      if (response.error) throw new Error(response.error.message);
      const result = response.data;
      if (result.error) throw new Error(result.error);

      toast.success(result.message || `${result.rows_exported} casos exportados!`);
      setShowExportDialog(false);
    } catch (err: any) {
      console.error('Export error:', err);
      toast.error(err.message || 'Erro ao exportar');
    } finally {
      setExporting(false);
    }
  };

  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      const buildBase = () => {
        let q = externalSupabase
          .from('legal_cases')
          .select('*, specialized_nuclei(name, prefix, color), leads(lead_name)')
          .order('created_at', { ascending: false });
        if (statusFilter !== 'all') q = q.eq('status', statusFilter);
        if (nucleusFilter !== 'all') q = q.eq('nucleus_id', nucleusFilter);
        return q;
      };

      const q = search.trim();

      // Paginate in chunks of 1000 to bypass PostgREST db-max-rows cap on Externo.
      const PAGE = 1000;
      const HARD_CAP = 10000;
      const aggregated: any[] = [];
      for (let from = 0; from < HARD_CAP; from += PAGE) {
        let query = buildBase().range(from, from + PAGE - 1);
        if (q) {
          const safe = q.replace(/[,()]/g, ' ');
          query = query.or(
            [
              `title.ilike.%${safe}%`,
              `case_number.ilike.%${safe}%`,
              `description.ilike.%${safe}%`,
            ].join(','),
          );
        }
        const { data, error } = await query;
        if (error) throw error;
        const rows = data || [];
        aggregated.push(...rows);
        if (rows.length < PAGE) break;
      }

      let mapped = aggregated.map((c: any) => ({
        ...c,
        nucleus_name: c.specialized_nuclei?.name,
        nucleus_prefix: c.specialized_nuclei?.prefix,
        nucleus_color: c.specialized_nuclei?.color,
        lead_name: c.leads?.lead_name || null,
      }));

      if (q) {
        const lower = q.toLowerCase();
        const { data: leadMatches } = await externalSupabase
          .from('legal_cases')
          .select('*, specialized_nuclei(name, prefix, color), leads!inner(lead_name)')
          .ilike('leads.lead_name', `%${safeFilter(q)}%`)
          .limit(500);
        const extra = (leadMatches || []).map((c: any) => ({
          ...c,
          nucleus_name: c.specialized_nuclei?.name,
          nucleus_prefix: c.specialized_nuclei?.prefix,
          nucleus_color: c.specialized_nuclei?.color,
          lead_name: c.leads?.lead_name || null,
        }));
        const seen = new Set(mapped.map((c: any) => c.id));
        for (const c of extra) if (!seen.has(c.id)) { mapped.push(c); seen.add(c.id); }
        mapped = mapped.filter((c: any) =>
          c.title?.toLowerCase().includes(lower) ||
          c.case_number?.toLowerCase().includes(lower) ||
          c.description?.toLowerCase().includes(lower) ||
          c.lead_name?.toLowerCase().includes(lower)
        );
      }

      setCases(mapped);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar casos');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, nucleusFilter]);

  function safeFilter(s: string) {
    return s.replace(/[,()%]/g, ' ');
  }

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          <Briefcase className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Setor Processual — Casos</h1>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setShowExportDialog(true)}>
            <Upload className="h-4 w-4 mr-1" />
            Exportar
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar caso..."
              className="pl-9 h-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {Object.entries(statusLabels).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={nucleusFilter} onValueChange={setNucleusFilter}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="Núcleo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {nuclei.filter(n => n.is_active).map(n => (
                <SelectItem key={n.id} value={n.id}>
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: n.color }} />
                    {n.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Cases list */}
      <div className="p-4 space-y-3">
        {loading && (
          <div className="text-center py-12 text-muted-foreground">Carregando casos...</div>
        )}

        {!loading && cases.length === 0 && (
          <div className="text-center py-16 text-muted-foreground space-y-2">
            <Briefcase className="h-10 w-10 mx-auto opacity-40" />
            <p className="text-sm">Nenhum caso encontrado</p>
          </div>
        )}

          {cases.map(c => (
            <CaseListItem
              key={c.id}
              legalCase={c}
              expanded={expandedId === c.id}
              onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
              onCaseUpdated={fetchCases}
              onOpenLead={(leadId) => navigate(`/leads?openLead=${leadId}`)}
            />
        ))}
      </div>

      {/* Export to Google Sheets Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exportar para Google Sheets</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>URL ou ID da planilha *</Label>
              <Input
                value={spreadsheetId}
                onChange={e => setSpreadsheetId(e.target.value)}
                placeholder="Cole a URL ou ID da planilha do Google Sheets"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Ex: https://docs.google.com/spreadsheets/d/1WQC...
              </p>
            </div>
            <div>
              <Label>Nome da aba (opcional)</Label>
              <Input
                value={sheetName}
                onChange={e => setSheetName(e.target.value)}
                placeholder="Ex: PREVIDENCIÁRIO"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Se não informado, usa a primeira aba da planilha
              </p>
            </div>
            {nucleusFilter !== 'all' && (
              <p className="text-sm text-muted-foreground">
                📌 Filtrando por núcleo selecionado: apenas casos do filtro ativo serão exportados
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportDialog(false)}>Cancelar</Button>
            <Button onClick={handleExportToSheets} disabled={exporting || !spreadsheetId.trim()}>
              {exporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Exportando...</> : 'Exportar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CaseListItem({ legalCase, expanded, onToggle, onCaseUpdated, onOpenLead }: { 
  legalCase: any; expanded: boolean; onToggle: () => void; onCaseUpdated: () => void; onOpenLead: (leadId: string) => void;
}) {
  const navigate = useNavigate();
  const [processes, setProcesses] = useState<any[]>([]);
  const [mentionedProcesses, setMentionedProcesses] = useState<string[]>([]);
  const [registeringTitle, setRegisteringTitle] = useState<string | null>(null);
  const [registeringAll, setRegisteringAll] = useState(false);
  const [leadInfo, setLeadInfo] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showAddProcess, setShowAddProcess] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<any>(null);
  const [editCaseNumber, setEditCaseNumber] = useState(legalCase.case_number || '');
  const [editTitle, setEditTitle] = useState(legalCase.title || '');
  const [editDescription, setEditDescription] = useState(legalCase.description || '');
  const [editNotes, setEditNotes] = useState(legalCase.notes || '');
  const [selectedProcesses, setSelectedProcesses] = useState<Set<string>>(new Set());

  const PREDEFINED_PROCESSES = [
    'Indenização', 'Relatório de Acidente', 'TRCT + Verbas', 'Seguro de Vida',
    'Benefício INSS', 'Inquérito Policial', 'Organizar docs', 'Onboarding',
  ];

  // Atribuições centralizadas em src/lib/processAssignment.ts


  const toggleProcess = (name: string) => {
    setSelectedProcesses(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const loadDetails = useCallback(() => {
    if (!expanded) return;
    setLoadingDetails(true);
    Promise.all([
      externalSupabase.from('lead_processes').select('*').eq('case_id', legalCase.id).order('created_at'),
      legalCase.lead_id
        ? externalSupabase.from('leads').select('id, lead_name, lead_phone, status, board_id, became_client_date').eq('id', legalCase.lead_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      externalSupabase.from('lead_activities')
        .select('process_title')
        .eq('case_id', legalCase.id)
        .is('process_id', null)
        .is('deleted_at', null)
        .not('process_title', 'is', null)
        .limit(500),
    ]).then(([procRes, leadRes, actRes]: any) => {
      if (procRes?.error) {
        console.error('[CasesPage] lead_processes load failed', { caseId: legalCase.id, error: procRes.error });
        toast.error(`Erro ao carregar processos: ${procRes.error.message}`);
      } else {
        console.debug('[CasesPage] processes loaded', { caseId: legalCase.id, count: (procRes?.data || []).length });
      }
      if (leadRes?.error) {
        console.error('[CasesPage] lead info load failed', { leadId: legalCase.lead_id, error: leadRes.error });
      }
      const procs = procRes?.data || [];
      setProcesses(procs);
      setLeadInfo(leadRes?.data || null);
      // Processos citados em atividades mas nunca cadastrados em lead_processes
      const titles = Array.from(new Set(
        ((actRes?.data || []) as { process_title: string | null }[])
          .map(a => (a.process_title || '').trim())
          .filter(Boolean)
      )).filter(t =>
        !procs.some((p: any) =>
          (p.title || '').trim().toLowerCase() === t.toLowerCase() ||
          (p.process_number && t.includes(p.process_number))
        )
      );
      setMentionedProcesses(titles);
    }).catch(err => {
      console.error('[CasesPage] loadDetails unexpected error', err);
    }).finally(() => setLoadingDetails(false));
  }, [expanded, legalCase.id, legalCase.lead_id]);

  // Cadastra de verdade um processo que só existia como texto em atividades
  const registerMentionedProcess = async (title: string) => {
    if (!legalCase.lead_id) { toast.error('Caso sem lead vinculado'); return; }
    setRegisteringTitle(title);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const numMatch = title.match(/\d{7}-\d{2}\.\d{4}\.\d{1,2}\.\d{2}\.\d{4}/);
      const processNumber = numMatch ? numMatch[0] : null;
      const cleanTitle = processNumber
        ? (title.replace(processNumber, '').replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '') || title)
        : title;
      const { data: saved, error } = await externalSupabase.from('lead_processes').insert({
        lead_id: legalCase.lead_id,
        case_id: legalCase.id,
        title: cleanTitle,
        process_number: processNumber,
        process_type: processNumber ? 'judicial' : 'administrativo',
        status: 'em_andamento',
        started_at: new Date().toISOString().slice(0, 10),
        created_by: user?.id,
      } as any).select('id').single();
      if (error) throw error;
      // Vincula as atividades que citavam esse processo ao registro criado
      if (saved?.id) {
        await externalSupabase.from('lead_activities')
          .update({ process_id: saved.id } as any)
          .eq('case_id', legalCase.id)
          .eq('process_title', title)
          .is('process_id', null);
      }
      toast.success(`Processo "${cleanTitle}" cadastrado no caso`);
      loadDetails();
    } catch (err: any) {
      console.error('[CasesPage] registerMentionedProcess failed', err);
      toast.error(`Erro ao cadastrar processo: ${err?.message || err}`);
    } finally {
      setRegisteringTitle(null);
    }
  };

  // Cadastra em lote todos os processos citados (apenas os com conteúdo plausível)
  const registerAllMentioned = async () => {
    if (!legalCase.lead_id) { toast.error('Caso sem lead vinculado'); return; }
    const valid = mentionedProcesses.filter(t => t.trim().length >= 4);
    if (valid.length === 0) { toast.info('Nenhum processo válido para cadastrar'); return; }
    setRegisteringAll(true);
    let ok = 0, fail = 0;
    for (const title of valid) {
      try {
        await registerMentionedProcess(title);
        ok++;
      } catch { fail++; }
    }
    setRegisteringAll(false);
    toast.success(`${ok} cadastrado(s)${fail ? `, ${fail} falharam` : ''}`);
  };



  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      const updates: any = { status: newStatus };
      if (newStatus === 'encerrado') {
        updates.outcome_date = new Date().toISOString().slice(0, 10);
      }
      const { error } = await externalSupabase.from('legal_cases').update(updates).eq('id', legalCase.id);
      if (error) throw error;
      toast.success(`Status alterado para ${statusLabels[newStatus]}`);
      onCaseUpdated();
    } catch {
      toast.error('Erro ao alterar status');
    }
  };

  const handleEdit = async () => {
    try {
      const trimmedNumber = editCaseNumber.trim();
      if (!trimmedNumber) {
        toast.error('Número do caso é obrigatório');
        return;
      }
      // Check uniqueness if changed
      if (trimmedNumber !== legalCase.case_number) {
        const { data: existing } = await externalSupabase
          .from('legal_cases')
          .select('id')
          .eq('case_number', trimmedNumber)
          .neq('id', legalCase.id)
          .maybeSingle();
        if (existing) {
          toast.error(`Já existe um caso com o número "${trimmedNumber}"`);
          return;
        }
      }
      const { error } = await externalSupabase.from('legal_cases').update({
        case_number: trimmedNumber,
        title: editTitle.trim(),
        description: editDescription || null,
        notes: editNotes || null,
      }).eq('id', legalCase.id);
      if (error) throw error;
      // Auto-create selected processes
      if (selectedProcesses.size > 0 && legalCase.lead_id) {
        const { data: { user } } = await supabase.auth.getUser();
        for (const title of selectedProcesses) {
          try {
            const { data: savedProcess } = await externalSupabase.from('lead_processes').insert({
              lead_id: legalCase.lead_id,
              case_id: legalCase.id,
              process_type: 'administrativo',
              title,
              status: 'em_andamento',
              started_at: new Date().toISOString().slice(0, 10),
              created_by: user?.id,
            } as any).select('id').single();

            // Adota atividades-fantasma cujo process_title bate com este título (case-insensitive)
            if (savedProcess?.id) {
              try {
                await externalSupabase.from('lead_activities')
                  .update({ process_id: savedProcess.id } as any)
                  .eq('case_id', legalCase.id)
                  .is('process_id', null)
                  .ilike('process_title', title);
              } catch (linkErr) {
                console.warn(`[CasesPage] failed to link orphan activities for "${title}":`, linkErr);
              }
            }

            // Auto-create activity usando o resolver central.
            try {
              const { extAssignedTo, assignedName } = await resolveProcessAssignment(title, editTitle || legalCase.title, user?.id);
              const extCreatedBy = await remapToExternal(user?.id);
              const { error: actErr } = await externalSupabase.from('lead_activities').insert({
                lead_id: legalCase.lead_id,
                title: `Dar andamento - ${title}`,
                description: `Atividade criada automaticamente para o processo: ${title}`,
                activity_type: 'tarefa',
                status: 'pendente',
                priority: 'normal',
                assigned_to: extAssignedTo,
                assigned_to_name: assignedName,
                created_by: extCreatedBy,
                deadline: new Date().toISOString().slice(0, 10),
                process_id: savedProcess?.id || null,
                process_title: title,
              } as any);
              if (actErr) throw actErr;
            } catch (actErr: any) {
              console.error(`[CasesPage] activity "${title}" failed:`, actErr);
              toast.error(`Atividade de "${title}" não criada: ${actErr?.message || actErr?.code || 'erro'}`);
            }
          } catch (err) {
            console.warn(`Error creating process "${title}":`, err);
          }
        }
        toast.success(`${selectedProcesses.size} processo(s) criado(s)`);
        toast.success('Atividades atribuídas automaticamente');

      }
      toast.success('Caso atualizado');
      setShowEditDialog(false);
      setSelectedProcesses(new Set());
      // Reload processes immediately so they appear in the UI
      loadDetails();
      onCaseUpdated();
    } catch {
      toast.error('Erro ao atualizar caso');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Tem certeza que deseja excluir este caso?')) return;
    try {
      const { error } = await externalSupabase.from('legal_cases').delete().eq('id', legalCase.id);
      if (error) throw error;
      toast.success('Caso excluído');
      onCaseUpdated();
    } catch {
      toast.error('Erro ao excluir caso');
    }
  };

  return (
    <>
      <Card className="overflow-hidden">
        <Collapsible open={expanded} onOpenChange={onToggle}>
          <CollapsibleTrigger asChild>
            <div className="p-3 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                {legalCase.nucleus_color && (
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: legalCase.nucleus_color }} />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                    <CopyableText copyValue={legalCase.case_number} label="Número do caso" showIcon={false}>{legalCase.case_number}</CopyableText>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(`/cases/${legalCase.id}`); }}
                      className="text-[10px] text-primary hover:underline"
                      title="Abrir página do caso"
                    >
                      abrir →
                    </button>
                    <span>{' — '}</span>
                    <CopyableText copyValue={legalCase.title} label="Título" showIcon={false}>{legalCase.title}</CopyableText>
                  </p>
                  {legalCase.nucleus_name && (
                    <CopyableText as="p" copyValue={legalCase.nucleus_name} label="Núcleo" showIcon={false} className="text-xs text-muted-foreground">{legalCase.nucleus_name}</CopyableText>
                  )}
                </div>
              </div>
              <Badge variant="secondary" className={`text-xs shrink-0 ${statusColors[legalCase.status]}`}>
                {statusLabels[legalCase.status]}
              </Badge>
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="px-3 pb-3 border-t pt-3 space-y-4">
              {loadingDetails && <p className="text-xs text-muted-foreground">Carregando...</p>}

              {legalCase.description && (
                <CopyableText as="p" copyValue={legalCase.description} label="Descrição" showIcon={false} className="text-xs text-muted-foreground whitespace-pre-line">{legalCase.description}</CopyableText>
              )}

              {/* Case actions */}
              <div className="flex items-center gap-1 flex-wrap">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                  setEditCaseNumber(legalCase.case_number || '');
                  setEditTitle(legalCase.title || '');
                  setEditDescription(legalCase.description || '');
                  setEditNotes(legalCase.notes || '');
                  setShowEditDialog(true);
                }}>
                  <Edit3 className="h-3 w-3 mr-1" /> Editar
                </Button>
                {legalCase.status !== 'encerrado' && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-green-600" onClick={() => handleStatusChange('encerrado')}>
                    <CheckCircle className="h-3 w-3 mr-1" /> Encerrar
                  </Button>
                )}
                {legalCase.status !== 'em_andamento' && legalCase.status !== 'encerrado' && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleStatusChange('em_andamento')}>
                    Em Andamento
                  </Button>
                )}
                {legalCase.status !== 'arquivado' && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleStatusChange('arquivado')}>
                    <Archive className="h-3 w-3 mr-1" /> Arquivar
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={handleDelete}>
                  <Trash2 className="h-3 w-3 mr-1" /> Excluir
                </Button>
              </div>

              {/* Lead vinculado - clicável */}
              {leadInfo && (
                <div
                  className="border rounded-lg p-3 space-y-1 bg-muted/30 cursor-pointer hover:bg-muted/60 transition-colors"
                  onClick={() => onOpenLead(leadInfo.id)}
                >
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <ExternalLink className="h-3 w-3" /> Lead Vinculado
                    <span className="text-[10px] font-normal text-muted-foreground ml-auto">Clique para abrir →</span>
                  </h4>
                  <p className="text-sm font-medium">{leadInfo.lead_name}</p>
                  {leadInfo.lead_phone && <p className="text-xs text-muted-foreground">{leadInfo.lead_phone}</p>}
                  {leadInfo.became_client_date && (
                    <p className="text-xs text-muted-foreground">Fechado em: {leadInfo.became_client_date}</p>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Scale className="h-3.5 w-3.5" /> Processos ({processes.length})
                  </h4>
                  {legalCase.lead_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] gap-1"
                      onClick={(e) => { e.stopPropagation(); setShowAddProcess(true); }}
                    >
                      <Plus className="h-3 w-3" /> Cadastrar Processo
                    </Button>
                  )}
                </div>
                {processes.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">Nenhum processo neste caso.</p>
                )}
                <div className="space-y-2">
                  {processes.map(p => (
                    <div
                      key={p.id}
                      className="border rounded-lg p-2.5 bg-card space-y-1 cursor-pointer hover:bg-muted/50 transition-colors group"
                      onClick={() => setSelectedProcess(p)}
                    >
                      <div className="flex items-center gap-2">
                        {p.process_type === 'judicial' ? (
                          <Gavel className="h-3.5 w-3.5 text-orange-500" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 text-blue-500" />
                        )}
                        <CopyableText copyValue={p.title} label="Processo" showIcon={false} className="text-xs font-medium">{p.title}</CopyableText>
                        <Badge variant="secondary" className="text-[10px] ml-auto">
                          {p.status === 'em_andamento' ? 'Em Andamento' : p.status === 'concluido' ? 'Concluído' : 'Arquivado'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`Excluir o processo "${p.title}"?`)) return;
                            await externalSupabase.from('lead_processes').delete().eq('id', p.id);
                            toast.success('Processo excluído');
                            loadDetails();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {p.process_number && (
                        <CopyableText as="p" copyValue={p.process_number} label="Nº Processo" noPhoneDetect className="text-[10px] text-muted-foreground">Nº {p.process_number}</CopyableText>
                      )}
                      {p.fee_percentage != null && (
                        <CopyableText as="p" copyValue={`${p.fee_percentage}%`} label="Honorários" showIcon={false} className="text-[10px] text-muted-foreground">Honorários: {p.fee_percentage}%</CopyableText>
                      )}
                      {p.workflow_name && (
                        <CopyableText as="p" copyValue={p.workflow_name} label="Fluxo" showIcon={false} className="text-[10px] text-muted-foreground">Fluxo de Trabalho: {p.workflow_name}</CopyableText>
                      )}
                      {p.orgao_julgador && (
                        <p className="text-[10px] text-muted-foreground">🏛️ {p.orgao_julgador}</p>
                      )}
                      {p.situacao && (
                        <Badge variant="outline" className="text-[9px]">{p.situacao}</Badge>
                      )}
                    </div>
                  ))}
                </div>

                {/* Processos citados em atividades mas nunca cadastrados */}
                {mentionedProcesses.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                        <FileText className="h-3.5 w-3.5" /> Citados em atividades, sem cadastro ({mentionedProcesses.length})
                      </h4>
                      {legalCase.lead_id && mentionedProcesses.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] gap-1"
                          disabled={registeringAll}
                          onClick={(e) => { e.stopPropagation(); registerAllMentioned(); }}
                        >
                          {registeringAll
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Plus className="h-3 w-3" />} Cadastrar todos
                        </Button>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {mentionedProcesses.map(title => (
                        <div key={title} className="border border-dashed rounded-lg p-2 flex items-center gap-2 bg-muted/20">
                          <CopyableText copyValue={title} label="Processo citado" showIcon={false} className="text-xs flex-1 min-w-0 truncate">{title}</CopyableText>
                          {legalCase.lead_id && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px] gap-1 shrink-0"
                              disabled={registeringTitle === title}
                              onClick={(e) => { e.stopPropagation(); registerMentionedProcess(title); }}
                            >
                              {registeringTitle === title
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Plus className="h-3 w-3" />} Cadastrar
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Esses processos foram digitados em atividades, mas não existem no cadastro do caso. Clique em "Cadastrar" para criá-los e vinculá-los às atividades.
                    </p>
                  </div>
                )}
              </div>


              {/* Workflow Board */}
              <CaseWorkflowBoard
                caseId={legalCase.id}
                processes={processes}
                onProcessUpdated={loadDetails}
              />

              {legalCase.lead_id && (
                <AddProcessDialog
                  open={showAddProcess}
                  onOpenChange={setShowAddProcess}
                  caseId={legalCase.id}
                  leadId={legalCase.lead_id}
                  onProcessAdded={loadDetails}
                />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Caso — {legalCase.case_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Número do Caso *</Label>
              <Input value={editCaseNumber} onChange={e => setEditCaseNumber(e.target.value)} placeholder="Ex: 0001-2025" />
            </div>
            <div>
              <Label>Título *</Label>
              <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2} />
            </div>
            <div>
              <Label className="flex items-center gap-2 mb-2">Criar processos automaticamente</Label>
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
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancelar</Button>
            <Button onClick={handleEdit} disabled={!editTitle.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProcessDetailSheet
        open={!!selectedProcess}
        onOpenChange={(open) => { if (!open) setSelectedProcess(null); }}
        process={selectedProcess}
        onUpdated={onCaseUpdated}
        mode="dialog"
        defaultTab="atividades"
      />
    </>
  );
}
