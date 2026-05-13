import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Briefcase, ArrowLeft, ExternalLink, Scale, FileText, Loader2,
  Calendar, User as UserIcon, AlertCircle,
} from 'lucide-react';
import { CopyableText } from '@/components/ui/copyable-text';
import { toast } from 'sonner';
import { useLeads, Lead } from '@/hooks/useLeads';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';

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

interface CaseFull {
  id: string;
  case_number: string;
  title: string;
  description: string | null;
  status: keyof typeof statusLabels;
  notes: string | null;
  closed_at: string | null;
  created_at: string;
  lead_id: string | null;
  nucleus_id: string | null;
  acolhedor: string | null;
  benefit_type: string | null;
  outcome: string | null;
  specialized_nuclei?: { name: string | null; prefix: string | null; color: string | null } | null;
  leads?: { id: string; lead_name: string | null; lead_phone: string | null; became_client_date: string | null } | null;
}

interface ProcessRow {
  id: string;
  process_number: string | null;
  court: string | null;
  status: string | null;
  case_type: string | null;
}

interface ActivityRow {
  id: string;
  title: string;
  status: string | null;
  deadline: string | null;
  assigned_to_name: string | null;
}

export default function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [legalCase, setLegalCase] = useState<CaseFull | null>(null);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Lead sheet
  const { boards } = useKanbanBoards();
  const { updateLead } = useLeads();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadSheetOpen, setLeadSheetOpen] = useState(false);

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const { data, error } = await externalSupabase
          .from('legal_cases')
          .select('*, specialized_nuclei(name, prefix, color), leads(id, lead_name, lead_phone, became_client_date)')
          .eq('id', caseId)
          .maybeSingle();
        if (error) throw error;
        if (!data) { if (!cancelled) setNotFound(true); return; }
        if (!cancelled) setLegalCase(data as CaseFull);

        const [procRes, actRes] = await Promise.all([
          externalSupabase
            .from('lead_processes')
            .select('id, process_number, court, status, case_type')
            .eq('case_id', caseId)
            .order('created_at', { ascending: false }),
          externalSupabase
            .from('lead_activities')
            .select('id, title, status, deadline, assigned_to_name')
            .eq('case_id', caseId)
            .order('created_at', { ascending: false })
            .limit(20),
        ]);
        if (!cancelled) {
          setProcesses((procRes.data as ProcessRow[]) || []);
          setActivities((actRes.data as ActivityRow[]) || []);
        }
      } catch (err) {
        console.error('Erro carregando caso:', err);
        toast.error('Erro ao carregar caso');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [caseId]);

  const openLeadSheet = async () => {
    if (!legalCase?.lead_id) return;
    try {
      const { data, error } = await externalSupabase
        .from('leads')
        .select('*')
        .eq('id', legalCase.lead_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) { toast.error('Lead não encontrado'); return; }
      setSelectedLead(data as Lead);
      setLeadSheetOpen(true);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao abrir lead');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando caso...
      </div>
    );
  }

  if (notFound || !legalCase) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Button variant="ghost" size="sm" onClick={() => navigate('/cases')} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar para Casos
        </Button>
        <Card className="p-6 text-center space-y-2">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="font-medium">Caso não encontrado</p>
          <p className="text-sm text-muted-foreground">O caso pode ter sido excluído ou o ID está incorreto.</p>
        </Card>
      </div>
    );
  }

  const nucleus = legalCase.specialized_nuclei;
  const lead = legalCase.leads;

  return (
    <ScrollArea className="h-[calc(100vh-3.5rem)]">
      <div className="max-w-4xl mx-auto p-4 space-y-4 pb-24">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/cases')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Casos
          </Button>
        </div>

        <Card className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Briefcase className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <CopyableText copyValue={legalCase.case_number} label="Número do caso" showIcon={false}>
                  <h1 className="text-xl font-semibold truncate">{legalCase.case_number}</h1>
                </CopyableText>
                <CopyableText as="p" copyValue={legalCase.title} label="Título" showIcon={false} className="text-sm text-muted-foreground truncate">
                  {legalCase.title}
                </CopyableText>
              </div>
            </div>
            <Badge className={`${statusColors[legalCase.status]} shrink-0`}>
              {statusLabels[legalCase.status]}
            </Badge>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {nucleus?.name && (
              <span className="flex items-center gap-1.5">
                {nucleus.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: nucleus.color }} />}
                {nucleus.name}
              </span>
            )}
            {legalCase.closed_at && (
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Fechado em {legalCase.closed_at}</span>
            )}
            {legalCase.acolhedor && (
              <span className="flex items-center gap-1"><UserIcon className="h-3 w-3" /> {legalCase.acolhedor}</span>
            )}
          </div>

          {legalCase.description && (
            <p className="text-sm whitespace-pre-line border-t pt-3">{legalCase.description}</p>
          )}
        </Card>

        {/* Lead vinculado — só renderiza se existir */}
        {lead ? (
          <Card
            className="p-4 cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={openLeadSheet}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" /> Lead vinculado
                </h3>
                <p className="text-base font-medium mt-1 truncate">{lead.lead_name || 'Sem nome'}</p>
                {lead.lead_phone && <p className="text-xs text-muted-foreground">{lead.lead_phone}</p>}
                {lead.became_client_date && (
                  <p className="text-xs text-muted-foreground">Tornou-se cliente em {lead.became_client_date}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground">Clique para abrir →</span>
            </div>
          </Card>
        ) : (
          <Card className="p-4 bg-muted/30 border-dashed">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Caso sem lead vinculado (caso antigo ou importado).
            </p>
          </Card>
        )}

        {/* Processos */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <Scale className="h-3.5 w-3.5" /> Processos ({processes.length})
          </h3>
          {processes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum processo vinculado.</p>
          ) : (
            <div className="space-y-2">
              {processes.map((p) => (
                <div key={p.id} className="border rounded p-2 text-sm">
                  <p className="font-medium">{p.process_number || 'Sem número'}</p>
                  <p className="text-xs text-muted-foreground">
                    {[p.court, p.case_type, p.status].filter(Boolean).join(' • ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Atividades */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <FileText className="h-3.5 w-3.5" /> Atividades recentes ({activities.length})
          </h3>
          {activities.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma atividade vinculada ao caso.</p>
          ) : (
            <div className="space-y-2">
              {activities.map((a) => (
                <Link
                  key={a.id}
                  to={`/?openActivity=${a.id}`}
                  className="block border rounded p-2 text-sm hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium truncate">{a.title}</p>
                    {a.status && <Badge variant="outline" className="text-[10px]">{a.status}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[a.assigned_to_name, a.deadline].filter(Boolean).join(' • ')}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {legalCase.notes && (
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-2">Notas internas</h3>
            <p className="text-sm whitespace-pre-line text-muted-foreground">{legalCase.notes}</p>
          </Card>
        )}
      </div>

      {/* Lead sheet */}
      {selectedLead && (
        <LeadEditDialog
          open={leadSheetOpen}
          onOpenChange={(v) => { setLeadSheetOpen(v); if (!v) setSelectedLead(null); }}
          lead={selectedLead}
          onSave={async (id, updates) => { await updateLead(id, updates); }}
          boards={boards}
          mode="sheet"
        />
      )}
    </ScrollArea>
  );
}
