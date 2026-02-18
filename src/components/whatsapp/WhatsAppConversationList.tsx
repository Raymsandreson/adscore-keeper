import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, User, Link2, Smartphone, PhoneCall, Unlink, Clock, ChevronDown } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { KanbanBoard } from '@/hooks/useKanbanBoards';

interface LeadInfo {
  id: string;
  board_id: string | null;
  current_stage: string | null;
  checklist_stage_ids: string[];
}

interface Props {
  conversations: WhatsAppConversation[];
  loading: boolean;
  selectedPhone: string | null;
  onSelect: (conv: WhatsAppConversation) => void;
  boards: KanbanBoard[];
  selectedInstanceId: string;
}

type QuickFilter = 'all' | 'no_lead' | 'unanswered' | 'calls';

export function WhatsAppConversationList({ conversations, loading, selectedPhone, onSelect, boards, selectedInstanceId }: Props) {
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [selectedBoardId, setSelectedBoardId] = useState<string>('all');
  const [selectedStageId, setSelectedStageId] = useState<string>('all');
  const [selectedChecklistId, setSelectedChecklistId] = useState<string>('all');

  // Phones that have call records
  const [phonesWithCalls, setPhonesWithCalls] = useState<Set<string>>(new Set());
  // Lead details by lead_id
  const [leadInfoMap, setLeadInfoMap] = useState<Map<string, LeadInfo>>(new Map());
  // Checklist templates
  const [checklistTemplates, setChecklistTemplates] = useState<{ id: string; name: string }[]>([]);

  // Fetch call phones and lead info
  useEffect(() => {
    const fetchData = async () => {
      // Call records
      const { data: callData } = await supabase
        .from('call_records')
        .select('contact_phone')
        .not('contact_phone', 'is', null);
      if (callData) {
        setPhonesWithCalls(new Set(callData.map((r: any) => r.contact_phone as string)));
      }

      // Lead info for conversations that have lead_id
      const leadIds = conversations.filter(c => c.lead_id).map(c => c.lead_id as string);
      if (leadIds.length > 0) {
        // Fetch leads board_id
        const { data: leadsData } = await supabase
          .from('leads')
          .select('id, board_id')
          .in('id', leadIds);

        // Fetch latest stage per lead from stage history
        const { data: stageData } = await supabase
          .from('lead_stage_history')
          .select('lead_id, to_stage, to_board_id, changed_at')
          .in('lead_id', leadIds)
          .order('changed_at', { ascending: false });

        // Fetch checklist instances
        const { data: checklistData } = await supabase
          .from('lead_checklist_instances')
          .select('lead_id, checklist_template_id, is_completed')
          .in('lead_id', leadIds);

        const map = new Map<string, LeadInfo>();
        for (const lead of leadsData || []) {
          // Latest stage (first in desc order)
          const latestStage = stageData?.find(s => s.lead_id === lead.id);
          // Checklist template ids with incomplete items
          const checklistIds = (checklistData || [])
            .filter(c => c.lead_id === lead.id && !c.is_completed)
            .map(c => c.checklist_template_id);

          map.set(lead.id, {
            id: lead.id,
            board_id: lead.board_id,
            current_stage: latestStage?.to_stage || null,
            checklist_stage_ids: checklistIds,
          });
        }
        setLeadInfoMap(map);

        // Checklist templates
        const { data: templates } = await supabase
          .from('checklist_templates')
          .select('id, name')
          .order('name');
        setChecklistTemplates(templates || []);
      }
    };
    fetchData();
  }, [conversations, selectedInstanceId]);

  // Boards filtered by instance (if instance selected, filter; otherwise all)
  // For now we show all boards since instance <-> board linking isn't direct in schema
  const availableBoards = boards;

  // Stages for selected board
  const availableStages = useMemo(() => {
    if (selectedBoardId === 'all') return [];
    const board = boards.find(b => b.id === selectedBoardId);
    return board?.stages || [];
  }, [selectedBoardId, boards]);

  const isUnanswered = (conv: WhatsAppConversation) => {
    const sorted = [...conv.messages].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return sorted.length > 0 && sorted[0].direction === 'inbound';
  };

  const getLastInboundAt = (conv: WhatsAppConversation) => {
    const sorted = [...conv.messages].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    if (sorted.length > 0 && sorted[0].direction === 'inbound') return sorted[0].created_at;
    return null;
  };

  const hasCalls = (conv: WhatsAppConversation) => phonesWithCalls.has(conv.phone);

  const getLeadInfo = (conv: WhatsAppConversation) =>
    conv.lead_id ? leadInfoMap.get(conv.lead_id) : undefined;

  const filtered = useMemo(() => conversations.filter(c => {
    // Text search
    const term = search.toLowerCase();
    if (term && !(
      c.phone.includes(term) ||
      c.contact_name?.toLowerCase().includes(term) ||
      c.last_message?.toLowerCase().includes(term) ||
      c.instance_name?.toLowerCase().includes(term)
    )) return false;

    // Quick filter
    if (quickFilter === 'no_lead' && c.lead_id) return false;
    if (quickFilter === 'unanswered' && !isUnanswered(c)) return false;
    if (quickFilter === 'calls' && !hasCalls(c)) return false;

    // Board filter
    if (selectedBoardId !== 'all') {
      const info = getLeadInfo(c);
      if (!info || info.board_id !== selectedBoardId) return false;
    }

    // Stage filter
    if (selectedStageId !== 'all') {
      const info = getLeadInfo(c);
      if (!info || info.current_stage !== selectedStageId) return false;
    }

    // Checklist/Passos filter
    if (selectedChecklistId !== 'all') {
      const info = getLeadInfo(c);
      if (!info || !info.checklist_stage_ids.includes(selectedChecklistId)) return false;
    }

    return true;
  }), [conversations, search, quickFilter, selectedBoardId, selectedStageId, selectedChecklistId, leadInfoMap, phonesWithCalls]);

  const formatPhone = (phone: string) => {
    if (phone.length === 13) return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
    if (phone.length === 12) return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 8)}-${phone.slice(8)}`;
    return phone;
  };

  const quickFilters: { key: QuickFilter; label: string; icon: React.ReactNode }[] = [
    { key: 'all', label: 'Todas', icon: null },
    { key: 'no_lead', label: 'Sem lead', icon: <Unlink className="h-3 w-3" /> },
    { key: 'unanswered', label: 'Não respondidas', icon: <Clock className="h-3 w-3" /> },
    { key: 'calls', label: 'Ligações', icon: <PhoneCall className="h-3 w-3" /> },
  ];

  const counts: Record<QuickFilter, number> = {
    all: conversations.length,
    no_lead: conversations.filter(c => !c.lead_id).length,
    unanswered: conversations.filter(c => isUnanswered(c)).length,
    calls: conversations.filter(c => hasCalls(c)).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      {/* Quick filter chips */}
      <div className="px-2 py-2 border-b flex gap-1 flex-wrap">
        {quickFilters.map(f => (
          <button
            key={f.key}
            onClick={() => setQuickFilter(f.key)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors",
              quickFilter === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {f.icon}
            {f.label}
            <span className={cn(
              "ml-0.5 rounded-full px-1 text-[10px]",
              quickFilter === f.key ? "bg-primary-foreground/20" : "bg-background/60"
            )}>
              {counts[f.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Advanced filters: Funil / Fase / Passos */}
      <div className="px-2 py-2 border-b space-y-1.5">
        {/* Funil */}
        <Select value={selectedBoardId} onValueChange={v => { setSelectedBoardId(v); setSelectedStageId('all'); }}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Funil" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os funis</SelectItem>
            {availableBoards.map(b => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Fase - only shown when board selected */}
        {selectedBoardId !== 'all' && availableStages.length > 0 && (
          <Select value={selectedStageId} onValueChange={setSelectedStageId}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Fase" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as fases</SelectItem>
              {availableStages.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Passos */}
        {checklistTemplates.length > 0 && (
          <Select value={selectedChecklistId} onValueChange={setSelectedChecklistId}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Passos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os passos</SelectItem>
              {checklistTemplates.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Count */}
      <div className="px-3 py-1 text-[10px] text-muted-foreground border-b bg-muted/30">
        {filtered.length} conversa{filtered.length !== 1 ? 's' : ''}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Nenhuma conversa encontrada
          </div>
        ) : (
          filtered.map(conv => {
            const unansweredAt = isUnanswered(conv) ? getLastInboundAt(conv) : null;
            const convHasCalls = hasCalls(conv);
            const info = getLeadInfo(conv);
            const board = info?.board_id ? boards.find(b => b.id === info.board_id) : null;
            const stage = board?.stages.find(s => s.id === info?.current_stage);

            return (
              <button
                key={conv.phone}
                onClick={() => onSelect(conv)}
                className={cn(
                  "w-full flex items-start gap-3 p-3 text-left hover:bg-accent/50 transition-colors border-b border-border/30",
                  selectedPhone === conv.phone && "bg-accent"
                )}
              >
                <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                  <User className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {conv.contact_name || formatPhone(conv.phone)}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {format(new Date(conv.last_message_at), 'HH:mm', { locale: ptBR })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-muted-foreground truncate">
                      {conv.last_message || '(mídia)'}
                    </p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {conv.lead_id && <Link2 className="h-3 w-3 text-blue-500" />}
                      {convHasCalls && <PhoneCall className="h-3 w-3 text-purple-500" />}
                      {conv.unread_count > 0 && (
                        <Badge className="h-5 min-w-5 flex items-center justify-center text-[10px] bg-green-600 hover:bg-green-600 p-0 px-1.5">
                          {conv.unread_count}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Board / Stage badge */}
                  {(board || stage) && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {board && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {board.name}
                        </span>
                      )}
                      {stage && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{ background: `${stage.color}22`, color: stage.color }}
                        >
                          {stage.name}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-1 mt-0.5">
                    {conv.contact_name && (
                      <p className="text-[10px] text-muted-foreground">{formatPhone(conv.phone)}</p>
                    )}
                    {conv.instance_name && (
                      <span className="text-[9px] text-muted-foreground/70 flex items-center gap-0.5 ml-auto">
                        <Smartphone className="h-2.5 w-2.5" />
                        {conv.instance_name}
                      </span>
                    )}
                  </div>

                  {/* Unanswered time */}
                  {unansweredAt && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border"
                        style={{ color: 'hsl(38 92% 40%)', borderColor: 'hsl(38 92% 50% / 0.3)', background: 'hsl(38 92% 50% / 0.08)' }}>
                        <Clock className="h-2.5 w-2.5" />
                        Sem resposta há {formatDistanceToNow(new Date(unansweredAt), { locale: ptBR })}
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
