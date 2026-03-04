import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
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
  Gavel, FileText, Users, ArrowLeft, ExternalLink,
} from 'lucide-react';
import { LegalCase } from '@/hooks/useLegalCases';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { toast } from 'sonner';

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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [nucleusFilter, setNucleusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { nuclei } = useSpecializedNuclei();

  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('legal_cases')
        .select('*, specialized_nuclei(name, prefix, color)')
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (nucleusFilter !== 'all') {
        query = query.eq('nucleus_id', nucleusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      let filtered = (data || []).map((c: any) => ({
        ...c,
        nucleus_name: c.specialized_nuclei?.name,
        nucleus_prefix: c.specialized_nuclei?.prefix,
        nucleus_color: c.specialized_nuclei?.color,
      }));

      if (search.trim()) {
        const q = search.toLowerCase();
        filtered = filtered.filter((c: any) =>
          c.title?.toLowerCase().includes(q) ||
          c.case_number?.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q)
        );
      }

      setCases(filtered);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar casos');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, nucleusFilter]);

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
          />
        ))}
      </div>
    </div>
  );
}

function CaseListItem({ legalCase, expanded, onToggle }: { legalCase: any; expanded: boolean; onToggle: () => void }) {
  const [processes, setProcesses] = useState<any[]>([]);
  const [leadInfo, setLeadInfo] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    setLoadingDetails(true);
    Promise.all([
      supabase.from('lead_processes').select('*').eq('case_id', legalCase.id).order('created_at'),
      legalCase.lead_id
        ? supabase.from('leads').select('id, lead_name, lead_phone, status, board_id, became_client_date').eq('id', legalCase.lead_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]).then(([procRes, leadRes]) => {
      setProcesses(procRes.data || []);
      setLeadInfo(leadRes.data || null);
    }).finally(() => setLoadingDetails(false));
  }, [expanded, legalCase.id, legalCase.lead_id]);

  return (
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
                <p className="text-sm font-medium truncate">{legalCase.case_number} — {legalCase.title}</p>
                {legalCase.nucleus_name && (
                  <p className="text-xs text-muted-foreground">{legalCase.nucleus_name}</p>
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
              <p className="text-xs text-muted-foreground whitespace-pre-line">{legalCase.description}</p>
            )}

            {/* Lead tab */}
            {leadInfo && (
              <div className="border rounded-lg p-3 space-y-1 bg-muted/30">
                <h4 className="text-xs font-semibold flex items-center gap-1.5">
                  <ExternalLink className="h-3 w-3" /> Lead Vinculado
                </h4>
                <p className="text-sm font-medium">{leadInfo.lead_name}</p>
                {leadInfo.lead_phone && <p className="text-xs text-muted-foreground">{leadInfo.lead_phone}</p>}
                {leadInfo.became_client_date && (
                  <p className="text-xs text-muted-foreground">Fechado em: {leadInfo.became_client_date}</p>
                )}
              </div>
            )}

            {/* Processes */}
            <div>
              <h4 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
                <Scale className="h-3.5 w-3.5" /> Processos ({processes.length})
              </h4>
              {processes.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">Nenhum processo neste caso.</p>
              )}
              <div className="space-y-2">
                {processes.map(p => (
                  <div key={p.id} className="border rounded-lg p-2.5 bg-card space-y-1">
                    <div className="flex items-center gap-2">
                      {p.process_type === 'judicial' ? (
                        <Gavel className="h-3.5 w-3.5 text-orange-500" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-blue-500" />
                      )}
                      <span className="text-xs font-medium">{p.title}</span>
                      <Badge variant="secondary" className="text-[10px] ml-auto">
                        {p.status === 'em_andamento' ? 'Em Andamento' : p.status === 'concluido' ? 'Concluído' : 'Arquivado'}
                      </Badge>
                    </div>
                    {p.process_number && (
                      <p className="text-[10px] text-muted-foreground">Nº {p.process_number}</p>
                    )}
                    {p.fee_percentage != null && (
                      <p className="text-[10px] text-muted-foreground">Honorários: {p.fee_percentage}%</p>
                    )}
                    {p.workflow_name && (
                      <p className="text-[10px] text-muted-foreground">Fluxo de Trabalho: {p.workflow_name}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
