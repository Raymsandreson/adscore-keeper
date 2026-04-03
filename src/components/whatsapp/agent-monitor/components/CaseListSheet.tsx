import { useState, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Search, AlertCircle, MessageCircle, CheckCircle, XCircle, Eye, StopCircle, PauseCircle, Inbox, Zap, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { ConversationDetail, CaseStatus } from '../types';
import { getCaseStatus, statusLabel } from '../utils';
import { CaseCard } from './CaseCard';

interface CaseListSheetProps {
  statusFilter: CaseStatus | null;
  conversations: ConversationDetail[];
  applyBaseFilters: (c: ConversationDetail) => boolean;
  onClose: () => void;
  onOpenChat: (c: ConversationDetail) => void;
  generatingLeadId?: string | null;
  onGenerateActivity?: (c: ConversationDetail) => void;
}

export function CaseListSheet({ statusFilter, conversations, applyBaseFilters, onClose, onOpenChat, generatingLeadId, onGenerateActivity }: CaseListSheetProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [responseFilter, setResponseFilter] = useState<'all' | 'responded' | 'waiting'>('all');
  const [leadFilter, setLeadFilter] = useState<'all' | 'com_lead' | 'sem_lead'>('all');
  const [agentStatusFilter, setAgentStatusFilter] = useState<'all' | 'ativo' | 'pausado'>('all');
  const [followupFilter, setFollowupFilter] = useState<'all' | 'com_followup' | 'sem_followup'>('all');
  const [followupProcessing, setFollowupProcessing] = useState(false);

  const sheetCases = useMemo(() => {
    if (!statusFilter) return [];
    return conversations.filter(c => {
      if (!applyBaseFilters(c)) return false;
      return getCaseStatus(c) === statusFilter;
    }).sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });
  }, [conversations, statusFilter, applyBaseFilters]);

  const filteredCases = useMemo(() => {
    return sheetCases.filter(c => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!c.phone.includes(q) && !c.contact_name?.toLowerCase().includes(q) && !c.lead_name?.toLowerCase().includes(q)) return false;
      }
      if (responseFilter === 'responded' && !(c.inbound_count > 0 && c.outbound_count > 0)) return false;
      if (responseFilter === 'waiting' && !(c.outbound_count > 0 && c.inbound_count === 0)) return false;
      if (leadFilter === 'com_lead' && !c.lead_id) return false;
      if (leadFilter === 'sem_lead' && c.lead_id) return false;
      if (agentStatusFilter === 'ativo' && !c.is_active) return false;
      if (agentStatusFilter === 'pausado' && (c.is_active || c.is_blocked)) return false;
      if (followupFilter === 'com_followup' && !c.has_followup_config) return false;
      if (followupFilter === 'sem_followup' && c.has_followup_config) return false;
      return true;
    });
  }, [sheetCases, searchQuery, responseFilter, leadFilter, agentStatusFilter, followupFilter]);

  const followupCases = useMemo(() => filteredCases.filter(c => c.has_followup_config && c.is_active), [filteredCases]);
  const [followupProgress, setFollowupProgress] = useState({ current: 0, total: 0, success: 0, fail: 0 });

  const handleBulkFollowup = async () => {
    if (followupCases.length === 0) return;
    setFollowupProcessing(true);
    const total = followupCases.length;
    setFollowupProgress({ current: 0, total, success: 0, fail: 0 });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      let success = 0;
      let fail = 0;
      for (let i = 0; i < followupCases.length; i++) {
        const c = followupCases[i];
        setFollowupProgress({ current: i + 1, total, success, fail });
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 25000);
          const url = `https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/wjia-followup-processor`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || ''}`,
              'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38',
            },
            body: JSON.stringify({ target_phone: c.phone, target_instance: c.instance_name, force_immediate: true }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (!res.ok) throw new Error(`${res.status}`);
          const result = await res.json();
          if (result.actions_executed > 0) {
            success++;
          } else {
            fail++;
          }
        } catch {
          fail++;
        }
        // Wait 2.5s between calls to avoid overwhelming the function
        if (i < followupCases.length - 1) {
          await new Promise(r => setTimeout(r, 2500));
        }
      }
      setFollowupProgress({ current: total, total, success, fail });
      toast({
        title: 'Follow-up antecipado concluído',
        description: `${success} sucesso${fail > 0 ? `, ${fail} falha(s)` : ''}`,
        variant: fail > 0 && success === 0 ? 'destructive' : 'default',
      });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setFollowupProcessing(false);
      setFollowupProgress({ current: 0, total: 0, success: 0, fail: 0 });
    }
  };

  const icons: Record<CaseStatus, typeof AlertCircle> = {
    sem_resposta: AlertCircle, em_andamento: MessageCircle, fechado: CheckCircle,
    recusado: XCircle, inviavel: Eye, bloqueado: StopCircle, pausado: PauseCircle,
  };

  const handleClose = () => {
    setSearchQuery('');
    setResponseFilter('all');
    setLeadFilter('all');
    setAgentStatusFilter('all');
    setFollowupFilter('all');
    onClose();
  };

  const FilterChips = ({ options, value, onChange, cases }: {
    options: readonly [string, string][];
    value: string;
    onChange: (v: any) => void;
    cases: ConversationDetail[];
  }) => (
    <div className="flex flex-wrap gap-1">
      {options.map(([k, label]) => {
        const count = cases.filter(c => {
          if (k === 'responded') return c.inbound_count > 0 && c.outbound_count > 0;
          if (k === 'waiting') return c.outbound_count > 0 && c.inbound_count === 0;
          if (k === 'com_lead') return !!c.lead_id;
          if (k === 'sem_lead') return !c.lead_id;
          if (k === 'ativo') return c.is_active;
          if (k === 'pausado') return !c.is_active && !c.is_blocked;
          if (k === 'com_followup') return c.has_followup_config;
          if (k === 'sem_followup') return !c.has_followup_config;
          return true;
        }).length;
        return (
          <Badge key={k} variant={value === k ? 'default' : 'outline'}
            className="cursor-pointer text-[10px] px-1.5 py-0 h-5"
            onClick={() => onChange(k)}>{label} ({count})</Badge>
        );
      })}
    </div>
  );

  return (
    <Sheet open={!!statusFilter} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <SheetContent side="right" className="w-full sm:w-[450px] sm:max-w-[450px] p-0 flex flex-col">
        <SheetHeader className="p-4 pb-2 border-b">
          <SheetTitle className="flex items-center gap-2">
            {statusFilter && (() => { const Icon = icons[statusFilter]; return <Icon className="h-5 w-5" />; })()}
            {statusFilter ? statusLabel(statusFilter) : ''} ({sheetCases.length})
          </SheetTitle>
        </SheetHeader>
        <div className="px-3 pt-2 pb-1 border-b space-y-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Buscar por nome ou telefone..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-7 text-xs" />
          </div>
          <FilterChips options={[['all', 'Todas'], ['responded', 'Respondidas'], ['waiting', 'Aguardando']]} value={responseFilter} onChange={setResponseFilter} cases={sheetCases} />
          <FilterChips options={[['all', 'Todos'], ['com_lead', 'Com Lead'], ['sem_lead', 'Sem Lead']]} value={leadFilter} onChange={setLeadFilter} cases={sheetCases} />
          <FilterChips options={[['all', 'Todos'], ['ativo', 'Ativo'], ['pausado', 'Pausado']]} value={agentStatusFilter} onChange={setAgentStatusFilter} cases={sheetCases} />
          <div className="pb-1">
            <FilterChips options={[['all', 'Todos'], ['com_followup', 'Com Follow-up'], ['sem_followup', 'Sem Follow-up']]} value={followupFilter} onChange={setFollowupFilter} cases={sheetCases} />
          </div>
        </div>
        {followupCases.length > 0 && (
          <div className="px-3 py-2 border-b">
            <Button size="sm" variant="outline" className="w-full text-xs h-8 gap-1.5 bg-green-50 border-green-200 hover:bg-green-100"
              disabled={followupProcessing} onClick={handleBulkFollowup}>
              {followupProcessing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Processando {followupProgress.current}/{followupProgress.total} ({followupProgress.success}✓ {followupProgress.fail}✗)
                </>
              ) : (
                <>
                  <Zap className="h-3 w-3" />
                  Antecipar Follow-up ({followupCases.length} conversas)
                </>
              )}
            </Button>
          </div>
        )}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1.5">
            {filteredCases.map((c, idx) => (
              <CaseCard key={`sheet-${c.phone}-${c.instance_name}-${idx}`} c={c} onOpenChat={onOpenChat}
                generatingLeadId={generatingLeadId} onGenerateActivity={onGenerateActivity} />
            ))}
            {filteredCases.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Nenhum caso encontrado</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
