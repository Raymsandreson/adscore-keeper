import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { resolveProcessAssignment, createOrAttachAndamentoActivity } from '@/lib/processAssignment';
import { useSearchParams, useParams } from 'react-router-dom';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import { ActivityFullSheet } from '@/components/activities/ActivityFullSheet';
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

/**
 * Neutraliza os caracteres que quebram o parser de filtros do PostgREST
 * (`,` e `()` separam termos no `or=`) e o `%`, que viraria curinga do ilike.
 * Antes o caminho principal só limpava `,()` e o auxiliar limpava `,()%` —
 * digitar `%` se comportava diferente em cada um.
 */
function safeFilter(s: string) {
  return s.replace(/[,()%]/g, ' ');
}

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
  // Só o valor debounced dispara fetch: sem isso, digitar "silva" rodava a
  // busca inteira 5 vezes (2 páginas de legal_cases + 2 queries auxiliares
  // cada uma).
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const fetchSeqRef = useRef(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [nucleusFilter, setNucleusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { caseId: routeCaseId } = useParams<{ caseId?: string }>();
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
    // Guarda de corrida: a busca dispara vários fetches sobrepostos e o último
    // a *responder* não é necessariamente o último a ser *pedido*. Sem isso a
    // lista ficava mostrando o resultado de um termo anterior.
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const buildBase = () => {
        let q = externalSupabase
          .from('legal_cases')
          .select('*, specialized_nuclei(name, prefix, color), leads(lead_name)')
          .is('deleted_at', null)
          .order('created_at', { ascending: false });
        if (statusFilter !== 'all') q = q.eq('status', statusFilter);
        if (nucleusFilter !== 'all') q = q.eq('nucleus_id', nucleusFilter);
        return q;
      };

      const q = debouncedSearch.trim();
      const safe = safeFilter(q);

      // Paginate in chunks of 1000 to bypass PostgREST db-max-rows cap on Externo.
      const PAGE = 1000;
      const HARD_CAP = 10000;
      const aggregated: any[] = [];
      for (let from = 0; from < HARD_CAP; from += PAGE) {
        let query = buildBase().range(from, from + PAGE - 1);
        if (q) {
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
        if (seq !== fetchSeqRef.current) return; // busca mais nova já partiu
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
        // Mesmo termo que foi pro banco: sem isso o filtro client-side
        // procurava um `%`/`,` literal que o ilike nem chegou a buscar.
        const lower = safe.trim().toLowerCase();
        let leadQuery = externalSupabase
          .from('legal_cases')
          .select('*, specialized_nuclei(name, prefix, color), leads!inner(lead_name)')
          .ilike('leads.lead_name', `%${safe}%`)
          .is('deleted_at', null)
          .limit(500);
        // Antes esta query ignorava os filtros da barra: buscar por nome com
        // "Núcleo = X" selecionado trazia casos de outros núcleos.
        if (statusFilter !== 'all') leadQuery = leadQuery.eq('status', statusFilter);
        if (nucleusFilter !== 'all') leadQuery = leadQuery.eq('nucleus_id', nucleusFilter);
        const { data: leadMatches, error: leadErr } = await leadQuery;
        if (leadErr) throw leadErr;
        if (seq !== fetchSeqRef.current) return;
        const extra = (leadMatches || []).map((c: any) => ({
          ...c,
          nucleus_name: c.specialized_nuclei?.name,
          nucleus_prefix: c.specialized_nuclei?.prefix,
          nucleus_color: c.specialized_nuclei?.color,
          lead_name: c.leads?.lead_name || null,
        }));
        const seen = new Set(mapped.map((c: any) => c.id));
        for (const c of extra) if (!seen.has(c.id)) { mapped.push(c); seen.add(c.id); }

        // Casos encontrados pelo número/título do processo (lead_processes).
        // O nº CNJ mora aqui, não em legal_cases — sem isso, buscar por CNJ não acha nada.
        let procQuery = externalSupabase
          .from('lead_processes')
          .select('case_id, legal_cases!inner(*, specialized_nuclei(name, prefix, color), leads(lead_name))')
          .or(`process_number.ilike.%${safe}%,title.ilike.%${safe}%`)
          .is('deleted_at', null)
          .not('case_id', 'is', null)
          .limit(500);
        if (statusFilter !== 'all') procQuery = procQuery.eq('legal_cases.status', statusFilter);
        if (nucleusFilter !== 'all') procQuery = procQuery.eq('legal_cases.nucleus_id', nucleusFilter);
        // O erro era descartado: quando esta query falhava, buscar por número
        // CNJ simplesmente não achava nada e ninguém ficava sabendo.
        const { data: procMatches, error: procErr } = await procQuery;
        if (procErr) throw procErr;
        if (seq !== fetchSeqRef.current) return;
        const procCaseIds = new Set<string>();
        for (const pm of (procMatches || []) as any[]) {
          const c = pm.legal_cases;
          if (!c || c.deleted_at) continue;
          procCaseIds.add(c.id);
          if (!seen.has(c.id)) {
            mapped.push({
              ...c,
              nucleus_name: c.specialized_nuclei?.name,
              nucleus_prefix: c.specialized_nuclei?.prefix,
              nucleus_color: c.specialized_nuclei?.color,
              lead_name: c.leads?.lead_name || null,
            });
            seen.add(c.id);
          }
        }

        mapped = mapped.filter((c: any) =>
          procCaseIds.has(c.id) ||
          c.title?.toLowerCase().includes(lower) ||
          c.case_number?.toLowerCase().includes(lower) ||
          c.description?.toLowerCase().includes(lower) ||
          c.lead_name?.toLowerCase().includes(lower)
        );
      }

      setCases(mapped);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return; // erro de uma busca já superada
      console.error('[CasesPage] fetchCases failed', err);
      toast.error('Erro ao carregar casos');
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [debouncedSearch, statusFilter, nucleusFilter]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Rota /cases/:caseId → carrega e expande só esse caso (substitui a antiga
  // página de detalhe; busca global e página de atividades apontam pra cá).
  useEffect(() => {
    if (!routeCaseId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await externalSupabase
        .from('legal_cases')
        .select('*, specialized_nuclei(name, prefix, color), leads(lead_name)')
        .eq('id', routeCaseId)
        .is('deleted_at', null)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setCases([{
          ...data,
          nucleus_name: (data as any).specialized_nuclei?.name,
          nucleus_prefix: (data as any).specialized_nuclei?.prefix,
          nucleus_color: (data as any).specialized_nuclei?.color,
          lead_name: (data as any).leads?.lead_name || null,
        }]);
        setExpandedId(routeCaseId);
      } else {
        setCases([]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [routeCaseId]);

  useEffect(() => {
    if (routeCaseId) return; // rota de caso único cuida do fetch
    fetchCases();
  }, [fetchCases, routeCaseId]);

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
  const [processes, setProcesses] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [actStatusFilter, setActStatusFilter] = useState('all');
  const [actProcessFilter, setActProcessFilter] = useState('all');
  const [mentionedProcesses, setMentionedProcesses] = useState<string[]>([]);
  const [registeringTitle, setRegisteringTitle] = useState<string | null>(null);
  const [registeringAll, setRegisteringAll] = useState(false);
  const [leadInfo, setLeadInfo] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showAddProcess, setShowAddProcess] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<any>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
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
      externalSupabase.from('lead_processes').select('*').eq('case_id', legalCase.id).is('deleted_at', null).order('created_at'),
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
      // Histórico do caso: atividades com case_id deste caso OU atividades órfãs
      // do lead (case_id nulo) — cobre atividades que perderam o vínculo de caso.
      // Não mistura outros casos: as amarradas a outro caso já têm case_id.
      (legalCase.lead_id
        ? externalSupabase.from('lead_activities')
            .select('id, title, status, activity_type, deadline, assigned_to_name, process_id, process_title, created_at, completed_at')
            .or(`case_id.eq.${legalCase.id},and(lead_id.eq.${legalCase.lead_id},case_id.is.null)`)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(50)
        : externalSupabase.from('lead_activities')
            .select('id, title, status, activity_type, deadline, assigned_to_name, process_id, process_title, created_at, completed_at')
            .eq('case_id', legalCase.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(50)),
    ]).then(([procRes, leadRes, actRes, histRes]: any) => {
      if (histRes?.error) {
        console.error('[CasesPage] case activities load failed', { caseId: legalCase.id, error: histRes.error });
      }
      setActivities(histRes?.data || []);
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
        const extCreatedByForProcess = await remapToExternal(user?.id);

        // Herda o fluxo de trabalho do caso, para o processo automático nascer
        // com os mesmos campos do cadastrado à mão (antes: workflow sempre null).
        let inheritedWorkflowId: string | null = null;
        let inheritedWorkflowName: string | null = null;
        try {
          const { data: caseWf } = await externalSupabase
            .from('legal_cases')
            .select('workflow_board_id')
            .eq('id', legalCase.id)
            .maybeSingle();
          if ((caseWf as any)?.workflow_board_id) {
            inheritedWorkflowId = (caseWf as any).workflow_board_id;
            const { data: board } = await externalSupabase
              .from('kanban_boards')
              .select('name')
              .eq('id', inheritedWorkflowId)
              .maybeSingle();
            inheritedWorkflowName = (board as any)?.name || null;
          }
        } catch (wfErr) {
          console.warn('[CasesPage] failed to inherit workflow from case:', wfErr);
        }

        // Evita duplicar quando o dialog é salvo duas vezes (duplo clique).
        const { data: alreadyThere } = await externalSupabase
          .from('lead_processes')
          .select('title')
          .eq('case_id', legalCase.id)
          .is('deleted_at', null);
        const existingTitles = new Set(
          (alreadyThere || []).map((p: any) => String(p.title || '').trim().toLowerCase()),
        );

        for (const title of selectedProcesses) {
          try {
            if (existingTitles.has(title.trim().toLowerCase())) {
              toast.info(`"${title}" já existe neste caso — não duplicado`);
              continue;
            }
            existingTitles.add(title.trim().toLowerCase());

            // Resolvido antes do insert para gravar o responsável no processo,
            // e não só na atividade "Dar andamento".
            const { extAssignedTo, assignedName } = await resolveProcessAssignment(title, editTitle || legalCase.title, user?.id, legalCase.case_number);

            // O erro do insert era descartado: quando ele falhava, savedProcess
            // vinha undefined e a atividade nascia sem process_id, órfã e sem
            // ninguém saber. Agora estoura e cai no catch abaixo, que avisa.
            const { data: savedProcess, error: procErr } = await externalSupabase.from('lead_processes').insert({
              lead_id: legalCase.lead_id,
              case_id: legalCase.id,
              process_type: 'administrativo',
              title,
              status: 'em_andamento',
              started_at: new Date().toISOString().slice(0, 10),
              created_by: extCreatedByForProcess,
              workflow_id: inheritedWorkflowId,
              workflow_name: inheritedWorkflowName,
              responsible_user_id: extAssignedTo,
            } as any).select('id').single();
            if (procErr) throw procErr;
            if (!savedProcess?.id) throw new Error('processo criado sem id');

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

            // Auto-create/attach activity via helper central (lida com índice único).
            // Reusa o responsável já resolvido acima — antes era resolvido duas
            // vezes, reabrindo o prompt de escolha do Benefício INSS.
            try {
              const extCreatedBy = extCreatedByForProcess;
              const result = await createOrAttachAndamentoActivity({
                leadId: legalCase.lead_id,
                caseId: legalCase.id,
                caseTitle: editTitle || legalCase.title,
                processId: savedProcess?.id || null,
                processTitle: title,
                extAssignedTo,
                assignedName,
                extCreatedBy,
              });
              if (!result.ok) {
                console.error(`[CasesPage] activity "${title}" failed:`, result.error);
                toast.error(`Atividade de "${title}" não criada: ${result.error || 'erro'}`);
              }
            } catch (actErr: any) {
              console.error(`[CasesPage] activity "${title}" failed:`, actErr);
              toast.error(`Atividade de "${title}" não criada: ${actErr?.message || actErr?.code || 'erro'}`);
            }

          } catch (err: any) {
            console.error(`[CasesPage] Error creating process "${title}":`, err);
            toast.error(`Processo "${title}" falhou: ${err?.message || err?.code || 'erro'}`);
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
      // Soft-delete: não destrói processos/movimentações do caso (antes o CASCADE apagava tudo).
      const { error } = await externalSupabase.from('legal_cases').update({ deleted_at: new Date().toISOString() } as any).eq('id', legalCase.id);
      if (error) throw error;
      toast.success('Caso excluído');
      onCaseUpdated();
    } catch {
      toast.error('Erro ao excluir caso');
    }
  };

  // Status distintos presentes nas atividades (para o filtro)
  const activityStatuses = useMemo(
    () => Array.from(new Set(activities.map(a => a.status).filter(Boolean))),
    [activities],
  );

  // Data de hoje (YYYY-MM-DD local) para comparar com o prazo (DATE).
  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  // Atrasada = mesma regra de OverdueActivitiesToday: não concluída + prazo vencido.
  const isOverdue = useCallback((a: any) => {
    if (!a?.deadline || a.status === 'concluida') return false;
    return String(a.deadline).slice(0, 10) < todayStr;
  }, [todayStr]);

  const overdueCount = useMemo(
    () => activities.filter(isOverdue).length,
    [activities, isOverdue],
  );

  // Atividades após aplicar filtros de status e processo
  const filteredActivities = useMemo(() => {
    return activities.filter(a => {
      if (actStatusFilter === 'overdue') {
        if (!isOverdue(a)) return false;
      } else if (actStatusFilter !== 'all' && a.status !== actStatusFilter) {
        return false;
      }
      if (actProcessFilter !== 'all') {
        if (actProcessFilter === 'none') return !a.process_id && !a.process_title;
        return a.process_id === actProcessFilter;
      }
      return true;
    });
  }, [activities, actStatusFilter, actProcessFilter, isOverdue]);

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

              <Tabs defaultValue="processos" className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-8">
                  <TabsTrigger value="processos" className="text-xs gap-1.5">
                    <Scale className="h-3.5 w-3.5" /> Processos ({processes.length})
                  </TabsTrigger>
                  <TabsTrigger value="atividades" className="text-xs gap-1.5">
                    <FileText className="h-3.5 w-3.5" /> Atividades ({activities.length})
                  </TabsTrigger>
                </TabsList>

                {/* Aba: Processos */}
                <TabsContent value="processos" className="mt-3 space-y-4">
                  <div>
                    <div className="flex items-center justify-end mb-2">
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
                            await externalSupabase.from('lead_processes').update({ deleted_at: new Date().toISOString() } as any).eq('id', p.id);
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

                  {/* Workflow Board dentro da aba Processos */}
                  <CaseWorkflowBoard
                    caseId={legalCase.id}
                    processes={processes}
                    onProcessUpdated={loadDetails}
                  />
                </TabsContent>

                {/* Aba: Atividades / Histórico */}
                <TabsContent value="atividades" className="mt-3 space-y-2">
                  {/* Filtros: status e processo */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={actStatusFilter} onValueChange={setActStatusFilter}>
                      <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os status</SelectItem>
                        <SelectItem value="overdue">
                          ⚠ Atrasadas{overdueCount ? ` (${overdueCount})` : ''}
                        </SelectItem>
                        {activityStatuses.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={actProcessFilter} onValueChange={setActProcessFilter}>
                      <SelectTrigger className="h-7 text-xs flex-1 min-w-[160px]"><SelectValue placeholder="Processo" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os processos</SelectItem>
                        <SelectItem value="none">Sem processo</SelectItem>
                        {processes.map(p => {
                          const assunto = (p.assunto_principal || p.classe || p.title || '').replace(/^[\s\-–—]+/, '').trim();
                          const numero = p.process_number || p.title || 'Processo';
                          return (
                            <SelectItem key={p.id} value={p.id}>
                              {numero}
                              {assunto && assunto !== numero && (
                                <span className="text-muted-foreground"> — {assunto}</span>
                              )}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {activities.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">Nenhuma atividade neste caso.</p>
                  ) : filteredActivities.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">Nenhuma atividade com esses filtros.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {filteredActivities.map(a => {
                        const overdue = isOverdue(a);
                        return (
                        <div
                          key={a.id}
                          className={
                            'border rounded-lg p-2 space-y-0.5 cursor-pointer transition-colors ' +
                            (overdue
                              ? 'border-l-2 border-l-red-500 bg-red-500/5 hover:bg-red-500/10'
                              : 'bg-card hover:bg-muted/50')
                          }
                          onClick={(e) => { e.stopPropagation(); setSelectedActivityId(a.id); }}
                        >
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium truncate flex-1 min-w-0">{a.title}</p>
                            {overdue && (
                              <Badge className="text-[9px] shrink-0 gap-1 bg-red-500/15 text-red-700 hover:bg-red-500/20 dark:text-red-400">
                                ⚠ Atrasada
                              </Badge>
                            )}
                            {a.status && (
                              <Badge variant="outline" className="text-[9px] shrink-0">{a.status}</Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {[
                              a.deadline ? `Prazo ${new Date(String(a.deadline).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR')}` : null,
                              a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR') : null,
                              a.activity_type,
                              a.assigned_to_name,
                              a.process_title,
                            ].filter(Boolean).join(' • ')}
                          </p>
                        </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground text-right">
                    Mostrando {filteredActivities.length} de {activities.length}
                  </p>
                </TabsContent>
              </Tabs>

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

      {/* Montados só quando abertos. Antes ficavam sempre no DOM: com ~1.600
          casos na lista, os hooks de config desses dois componentes (OABs,
          tipos de atividade, perfis, campos) disparavam ~5 requisições por
          item — ~8.000 no load da página, o que saturava o navegador. Mesmo
          padrão já usado em ProcessesPage. */}
      {selectedProcess && (
        <ProcessDetailSheet
          open
          onOpenChange={(open) => { if (!open) setSelectedProcess(null); }}
          process={selectedProcess}
          onUpdated={onCaseUpdated}
          mode="dialog"
          defaultTab="atividades"
        />
      )}

      {/* Detalhe da atividade em aba lateral com formulário completo */}
      {selectedActivityId && (
        <ActivityFullSheet
          open
          onOpenChange={(open) => { if (!open) setSelectedActivityId(null); }}
          activityId={selectedActivityId}
          onUpdated={loadDetails}
        />
      )}
    </>
  );
}
