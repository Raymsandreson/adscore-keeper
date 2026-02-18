import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Search, User, Link2, Smartphone, PhoneCall, Unlink, Clock, CheckSquare, ChevronDown } from 'lucide-react';
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
  completed_checklist_ids: string[];
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
  // Multi-select passos
  const [selectedChecklistIds, setSelectedChecklistIds] = useState<string[]>([]);
  const [checklistPopoverOpen, setChecklistPopoverOpen] = useState(false);

  const [phonesWithCalls, setPhonesWithCalls] = useState<Set<string>>(new Set());
  const [leadInfoMap, setLeadInfoMap] = useState<Map<string, LeadInfo>>(new Map());
  const [checklistTemplates, setChecklistTemplates] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const { data: callData } = await supabase
        .from('call_records')
        .select('contact_phone')
        .not('contact_phone', 'is', null);
      if (callData) {
        setPhonesWithCalls(new Set(callData.map((r: any) => r.contact_phone as string)));
      }

      const leadIds = conversations.filter(c => c.lead_id).map(c => c.lead_id as string);
      if (leadIds.length > 0) {
        const [leadsRes, stageRes, checklistRes, templatesRes] = await Promise.all([
          supabase.from('leads').select('id, board_id').in('id', leadIds),
          supabase.from('lead_stage_history')
            .select('lead_id, to_stage, changed_at')
            .in('lead_id', leadIds)
            .order('changed_at', { ascending: false }),
          supabase.from('lead_checklist_instances')
            .select('lead_id, checklist_template_id, is_completed')
            .in('lead_id', leadIds)
            .eq('is_completed', true),  // only completed
          supabase.from('checklist_templates').select('id, name').order('name'),
        ]);

        const map = new Map<string, LeadInfo>();
        for (const lead of leadsRes.data || []) {
          const latestStage = stageRes.data?.find(s => s.lead_id === lead.id);
          const completedIds = (checklistRes.data || [])
            .filter(c => c.lead_id === lead.id)
            .map(c => c.checklist_template_id);

          map.set(lead.id, {
            id: lead.id,
            board_id: lead.board_id,
            current_stage: latestStage?.to_stage || null,
            completed_checklist_ids: completedIds,
          });
        }
        setLeadInfoMap(map);
        setChecklistTemplates(templatesRes.data || []);
      }
    };
    fetchData();
  }, [conversations, selectedInstanceId]);

  const availableStages = useMemo(() => {
    if (selectedBoardId === 'all') return [];
    return boards.find(b => b.id === selectedBoardId)?.stages || [];
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
    return sorted.length > 0 && sorted[0].direction === 'inbound' ? sorted[0].created_at : null;
  };

  const hasCalls = (conv: WhatsAppConversation) => phonesWithCalls.has(conv.phone);
  const getLeadInfo = (conv: WhatsAppConversation) =>
    conv.lead_id ? leadInfoMap.get(conv.lead_id) : undefined;

  const filtered = useMemo(() => conversations.filter(c => {
    const term = search.toLowerCase();
    if (term && !(
      c.phone.includes(term) ||
      c.contact_name?.toLowerCase().includes(term) ||
      c.last_message?.toLowerCase().includes(term) ||
      c.instance_name?.toLowerCase().includes(term)
    )) return false;

    if (quickFilter === 'no_lead' && c.lead_id) return false;
    if (quickFilter === 'unanswered' && !isUnanswered(c)) return false;
    if (quickFilter === 'calls' && !hasCalls(c)) return false;

    if (selectedBoardId !== 'all') {
      const info = getLeadInfo(c);
      if (!info || info.board_id !== selectedBoardId) return false;
    }

    if (selectedStageId !== 'all') {
      const info = getLeadInfo(c);
      if (!info || info.current_stage !== selectedStageId) return false;
    }

    // Multi-select passos: lead must have ALL selected checklists completed
    if (selectedChecklistIds.length > 0) {
      const info = getLeadInfo(c);
      if (!info) return false;
      const allCompleted = selectedChecklistIds.every(id =>
        info.completed_checklist_ids.includes(id)
      );
      if (!allCompleted) return false;
    }

    return true;
  }), [conversations, search, quickFilter, selectedBoardId, selectedStageId, selectedChecklistIds, leadInfoMap, phonesWithCalls]);

  const formatPhone = (phone: string) => {
    if (phone.length === 13) return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
    if (phone.length === 12) return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 8)}-${phone.slice(8)}`;
    return phone;
  };

  const toggleChecklist = (id: string) => {
    setSelectedChecklistIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedChecklistIds.length === checklistTemplates.length) {
      setSelectedChecklistIds([]);
    } else {
      setSelectedChecklistIds(checklistTemplates.map(t => t.id));
    }
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

      {/* Advanced filters */}
      <div className="px-2 py-2 border-b space-y-1.5">
        {/* Funil */}
        <Select value={selectedBoardId} onValueChange={v => { setSelectedBoardId(v); setSelectedStageId('all'); }}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Funil" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os funis</SelectItem>
            {boards.map(b => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Fase */}
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

        {/* Passos — multi-select popover */}
        {checklistTemplates.length > 0 && (
          <Popover open={checklistPopoverOpen} onOpenChange={setChecklistPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs justify-between font-normal px-2"
              >
                <span className="flex items-center gap-1.5">
                  <CheckSquare className="h-3 w-3 text-muted-foreground" />
                  {selectedChecklistIds.length === 0
                    ? 'Passos concluídos'
                    : selectedChecklistIds.length === checklistTemplates.length
                      ? 'Todos os passos'
                      : `${selectedChecklistIds.length} passo${selectedChecklistIds.length > 1 ? 's' : ''} selecionado${selectedChecklistIds.length > 1 ? 's' : ''}`
                  }
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
              <div className="space-y-1">
                {/* Select all */}
                <div
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                  onClick={toggleAll}
                >
                  <Checkbox
                    checked={selectedChecklistIds.length === checklistTemplates.length && checklistTemplates.length > 0}
                    onCheckedChange={toggleAll}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="text-xs font-medium text-muted-foreground">Selecionar todos</span>
                </div>
                <div className="border-t my-1" />
                {checklistTemplates.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                    onClick={() => toggleChecklist(t.id)}
                  >
                    <Checkbox
                      checked={selectedChecklistIds.includes(t.id)}
                      onCheckedChange={() => toggleChecklist(t.id)}
                      onClick={e => e.stopPropagation()}
                    />
                    <span className="text-xs">{t.name}</span>
                  </div>
                ))}
                {selectedChecklistIds.length > 0 && (
                  <>
                    <div className="border-t my-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-7 text-xs text-muted-foreground"
                      onClick={() => setSelectedChecklistIds([])}
                    >
                      Limpar seleção
                    </Button>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
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

                  {unansweredAt && (
                    <div className="flex items-center gap-1 mt-1">
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border"
                        style={{ color: 'hsl(38 92% 40%)', borderColor: 'hsl(38 92% 50% / 0.3)', background: 'hsl(38 92% 50% / 0.08)' }}
                      >
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
