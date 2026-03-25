import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Search, User, Link2, Smartphone, PhoneCall, Unlink, Clock, CheckSquare, ChevronDown, ArrowDownAZ, ArrowDownUp, ArrowDown, Lock, ArrowUpFromLine, ArrowDownToLine, Users, UserCheck } from 'lucide-react';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { KanbanBoard } from '@/hooks/useKanbanBoards';

interface LeadInfo {
  id: string;
  board_id: string | null;
  current_stage: string | null;
  completed_checklist_ids: string[];
  checkedItemIds: string[]; // individual item IDs that are checked across all instances
}

interface Props {
  conversations: WhatsAppConversation[];
  loading: boolean;
  selectedPhone: string | null;
  onSelect: (conv: WhatsAppConversation) => void;
  boards: KanbanBoard[];
  selectedInstanceId: string;
  bulkMode?: boolean;
  selectedPhones?: Set<string>;
  onToggleBulkPhone?: (phone: string) => void;
  onSelectAllFiltered?: (phones: string[]) => void;
  privatePhones?: Set<string>;
}

type QuickFilter = 'all' | 'has_lead' | 'no_lead' | 'unanswered' | 'calls' | 'groups';
type SortMode = 'alpha' | 'last_received' | 'last_sent';
type DirectionFilter = 'all' | 'inbound' | 'outbound';

export function WhatsAppConversationList({ conversations, loading, selectedPhone, onSelect, boards, selectedInstanceId, bulkMode, selectedPhones, onToggleBulkPhone, onSelectAllFiltered, privatePhones }: Props) {
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [selectedBoardId, setSelectedBoardId] = useState<string>('all');
  const [selectedStageId, setSelectedStageId] = useState<string>('all');
  // Multi-select passos (individual item IDs now)
  const [selectedChecklistItemIds, setSelectedChecklistItemIds] = useState<string[]>([]);
  const [checklistPopoverOpen, setChecklistPopoverOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('last_received');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');

  const [phonesWithCalls, setPhonesWithCalls] = useState<Set<string>>(new Set());
  const [leadInfoMap, setLeadInfoMap] = useState<Map<string, LeadInfo>>(new Map());
  const [checklistTemplates, setChecklistTemplates] = useState<{ id: string; name: string; items: { id: string; label: string }[] }[]>([]);

  // Track lead IDs to avoid unnecessary re-fetches
  const prevLeadIdsRef = useRef<string>('');
  
  useEffect(() => {
    const leadIds = conversations.filter(c => c.lead_id).map(c => c.lead_id as string);
    const leadIdsKey = leadIds.sort().join(',');
    const shouldFetchLeadInfo = leadIdsKey !== prevLeadIdsRef.current;
    
    const fetchData = async () => {
      // Only fetch call phones once (or when instance changes)
      const { data: callData } = await supabase
        .from('call_records')
        .select('contact_phone')
        .not('contact_phone', 'is', null);
      if (callData) {
        setPhonesWithCalls(new Set(callData.map((r: any) => r.contact_phone as string)));
      }

      if (!shouldFetchLeadInfo) return;
      prevLeadIdsRef.current = leadIdsKey;

      if (leadIds.length === 0) {
        setLeadInfoMap(new Map());
        return;
      }

      const [leadsRes, stageRes, checklistInstancesRes, templatesRes] = await Promise.all([
        supabase.from('leads').select('id, board_id').in('id', leadIds),
        supabase.from('lead_stage_history')
          .select('lead_id, to_stage, changed_at')
          .in('lead_id', leadIds)
          .order('changed_at', { ascending: false }),
        supabase.from('lead_checklist_instances')
          .select('lead_id, checklist_template_id, is_completed, items')
          .in('lead_id', leadIds),
        supabase.from('checklist_templates').select('id, name, items').order('name'),
      ]);

      const map = new Map<string, LeadInfo>();
      for (const lead of (leadsRes.data || [])) {
        const latestStage = stageRes.data?.find(s => s.lead_id === lead.id);
        const leadInstances = (checklistInstancesRes.data || []).filter(c => c.lead_id === lead.id);
        const completedIds = leadInstances
          .filter(c => c.is_completed)
          .map(c => c.checklist_template_id);
        
        // Collect all individually checked item IDs
        const checkedItemIds: string[] = [];
        for (const inst of leadInstances) {
          const items = (inst.items as any[]) || [];
          for (const item of items) {
            if (item.checked) checkedItemIds.push(item.id);
          }
        }

        map.set(lead.id, {
          id: lead.id,
          board_id: lead.board_id,
          current_stage: latestStage?.to_stage || null,
          completed_checklist_ids: completedIds,
          checkedItemIds,
        });
      }
      setLeadInfoMap(map);
      // Parse template items for hierarchical display
      setChecklistTemplates((templatesRes.data || []).map(t => ({
        id: t.id,
        name: t.name,
        items: ((t.items as any[]) || []).map((item: any) => ({ id: item.id, label: item.label })),
      })));
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

  const isGroupConversation = (conv: WhatsAppConversation) => {
    if (conv.phone.includes('@g.us')) return true;
    return conv.messages.some(msg => {
      const meta = msg.metadata;
      if (!meta) return false;
      return meta?.chat?.wa_isGroup === true
        || meta?.message?.isGroup === true
        || (meta?.chat?.wa_chatid || '').includes('@g.us');
    });
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

    if (quickFilter === 'has_lead' && !c.lead_id) return false;
    if (quickFilter === 'no_lead' && c.lead_id) return false;
    if (quickFilter === 'unanswered' && !isUnanswered(c)) return false;
    if (quickFilter === 'calls' && !hasCalls(c)) return false;
    if (quickFilter === 'groups' && !isGroupConversation(c)) return false;

    // Direction filter: only show conversations that have messages in the selected direction
    if (directionFilter === 'inbound' && !c.messages.some(m => m.direction === 'inbound')) return false;
    if (directionFilter === 'outbound' && !c.messages.some(m => m.direction === 'outbound')) return false;

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
  }), [conversations, search, quickFilter, directionFilter, selectedBoardId, selectedStageId, selectedChecklistIds, leadInfoMap, phonesWithCalls]);

  // Sort conversations based on mode
  const sortedFiltered = useMemo(() => {
    if (sortMode === 'last_received') {
      // Sort by most recent message (any direction) — like WhatsApp
      return [...filtered].sort((a, b) => {
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      });
    }
    if (sortMode === 'last_sent') {
      return [...filtered].sort((a, b) => {
        const aTime = a.messages.filter(m => m.direction === 'outbound').sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime())[0]?.created_at || '0';
        const bTime = b.messages.filter(m => m.direction === 'outbound').sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime())[0]?.created_at || '0';
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
    }
    return filtered; // alpha uses groupedByLetter
  }, [filtered, sortMode]);

  // Group by first letter for alphabet navigation (only used in alpha mode)
  const groupedByLetter = useMemo(() => {
    if (sortMode !== 'alpha') return [];
    const groups = new Map<string, WhatsAppConversation[]>();
    for (const conv of filtered) {
      const name = conv.contact_name || conv.phone;
      const letter = name.charAt(0).toUpperCase();
      const key = /[A-Z]/.test(letter) ? letter : '#';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(conv);
    }
    const sorted = Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '#') return 1;
      if (b[0] === '#') return -1;
      return a[0].localeCompare(b[0]);
    });
    return sorted;
  }, [filtered, sortMode]);

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
    { key: 'has_lead', label: 'Com lead', icon: <UserCheck className="h-3 w-3" /> },
    { key: 'no_lead', label: 'Sem lead', icon: <Unlink className="h-3 w-3" /> },
    { key: 'unanswered', label: 'Não respondidas', icon: <Clock className="h-3 w-3" /> },
    { key: 'calls', label: 'Ligações', icon: <PhoneCall className="h-3 w-3" /> },
    { key: 'groups', label: 'Grupos', icon: <Users className="h-3 w-3" /> },
  ];

  const counts: Record<QuickFilter, number> = {
    all: conversations.length,
    has_lead: conversations.filter(c => !!c.lead_id).length,
    no_lead: conversations.filter(c => !c.lead_id).length,
    unanswered: conversations.filter(c => isUnanswered(c)).length,
    calls: conversations.filter(c => hasCalls(c)).length,
    groups: conversations.filter(c => isGroupConversation(c)).length,
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
        {/* Direction filter chips */}
        {[
          { key: 'all' as DirectionFilter, label: 'Todas', icon: null },
          { key: 'inbound' as DirectionFilter, label: 'Recebidas', icon: <ArrowDownToLine className="h-3 w-3" /> },
          { key: 'outbound' as DirectionFilter, label: 'Enviadas', icon: <ArrowUpFromLine className="h-3 w-3" /> },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setDirectionFilter(f.key)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors",
              directionFilter === f.key
                ? "bg-secondary text-secondary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {f.icon}
            {f.label}
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
      <div className="px-3 py-1 text-[10px] text-muted-foreground border-b bg-muted/30 flex items-center gap-2">
        {bulkMode && (
          <Checkbox
            checked={filtered.length > 0 && filtered.every(c => selectedPhones?.has(c.phone))}
            onCheckedChange={() => onSelectAllFiltered?.(filtered.map(c => c.phone))}
            className="h-3.5 w-3.5"
          />
        )}
        <span>{filtered.length} conversa{filtered.length !== 1 ? 's' : ''}</span>
        {bulkMode && selectedPhones && selectedPhones.size > 0 && (
          <Badge variant="secondary" className="text-[9px] ml-auto">{selectedPhones.size} selecionada{selectedPhones.size > 1 ? 's' : ''}</Badge>
        )}
        {!bulkMode && (
          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={() => setSortMode('alpha')}
              className={cn("p-1 rounded", sortMode === 'alpha' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              title="Ordenar por nome (A-Z)"
            >
              <ArrowDownAZ className="h-3 w-3" />
            </button>
            <button
              onClick={() => setSortMode('last_received')}
              className={cn("p-1 rounded", sortMode === 'last_received' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              title="Ordenar por última mensagem recebida"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
            <button
              onClick={() => setSortMode('last_sent')}
              className={cn("p-1 rounded", sortMode === 'last_sent' ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              title="Ordenar por última mensagem enviada"
            >
              <ArrowDownUp className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Nenhuma conversa encontrada
          </div>
        ) : sortMode === 'alpha' ? (
          groupedByLetter.map(([letter, convs]) => (
            <div key={letter}>
              <div className="sticky top-0 z-10 px-3 py-1 text-[11px] font-bold text-muted-foreground bg-muted/60 backdrop-blur-sm border-b border-border/20">
                {letter}
              </div>
              {convs.map(conv => renderConversationCard(conv))}
            </div>
          ))
        ) : (
          sortedFiltered.map(conv => renderConversationCard(conv))
        )}
      </div>
    </div>
  );

  function renderConversationCard(conv: WhatsAppConversation) {
    const unansweredAt = isUnanswered(conv) ? getLastInboundAt(conv) : null;
    const convHasCalls = hasCalls(conv);
    const info = getLeadInfo(conv);
    const board = info?.board_id ? boards.find(b => b.id === info.board_id) : null;
    const stage = board?.stages.find(s => s.id === info?.current_stage);
    const isSelected = selectedPhone === conv.phone;
    const isLocked = privatePhones?.has(`${conv.phone}__${conv.instance_name}`) || false;

    return (
      <div key={conv.phone} className="flex items-center">
        {bulkMode && (
          <div className="pl-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <Checkbox
              checked={selectedPhones?.has(conv.phone) || false}
              onCheckedChange={() => onToggleBulkPhone?.(conv.phone)}
              className="h-4 w-4"
            />
          </div>
        )}
        <button
          onClick={() => bulkMode ? onToggleBulkPhone?.(conv.phone) : onSelect(conv)}
          className={cn(
            "flex-1 flex items-start gap-3 p-3 text-left border-b border-border/30",
            isSelected && !bulkMode
              ? "bg-primary border-l-2 border-l-primary shadow-sm"
              : bulkMode && selectedPhones?.has(conv.phone)
                ? "bg-accent/60 border-l-2 border-l-primary"
                : "hover:bg-accent/40 border-l-2 border-l-transparent"
          )}
        >
          <div className={cn(
            "h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0",
            isSelected
              ? "bg-primary-foreground/20"
              : "bg-green-100 dark:bg-green-900/30"
          )}>
            <User className={cn("h-5 w-5", isSelected ? "text-primary-foreground" : "text-green-600")} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className={cn(
                "font-semibold text-sm truncate",
                isSelected ? "text-primary-foreground" : "text-foreground"
              )}>
                {conv.contact_name || formatPhone(conv.phone)}
              </span>
              <span className={cn(
                "text-[10px] flex-shrink-0",
                isSelected ? "text-primary-foreground/70" : "text-muted-foreground"
              )}>
                {(() => {
                  const d = new Date(conv.last_message_at);
                  if (isToday(d)) return format(d, 'HH:mm');
                  if (isYesterday(d)) return 'Ontem';
                  return format(d, 'dd/MM/yyyy');
                })()}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <p className={cn(
                "text-xs truncate",
                isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
              )}>
                {conv.last_message || '(mídia)'}
              </p>
              <div className="flex items-center gap-1 flex-shrink-0">
                {isLocked && <Lock className={cn("h-3 w-3", isSelected ? "text-primary-foreground/80" : "text-amber-500")} />}
                {conv.lead_id && <Link2 className={cn("h-3 w-3", isSelected ? "text-primary-foreground/80" : "text-blue-500")} />}
                {convHasCalls && <PhoneCall className={cn("h-3 w-3", isSelected ? "text-primary-foreground/80" : "text-purple-500")} />}
                {conv.unread_count > 0 && (
                  <Badge className={cn(
                    "h-5 min-w-5 flex items-center justify-center text-[10px] p-0 px-1.5",
                    isSelected
                      ? "bg-primary-foreground text-primary hover:bg-primary-foreground"
                      : "bg-green-600 hover:bg-green-600"
                  )}>
                    {conv.unread_count}
                  </Badge>
                )}
              </div>
            </div>

            {(board || stage) && (
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {board && (
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded",
                    isSelected
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {board.name}
                  </span>
                )}
                {stage && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={isSelected
                      ? { background: 'rgba(255,255,255,0.25)', color: 'white' }
                      : { background: `${stage.color}22`, color: stage.color }
                    }
                  >
                    {stage.name}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-1 mt-0.5">
              {conv.contact_name && (
                <p className={cn(
                  "text-[10px]",
                  isSelected ? "text-primary-foreground/60" : "text-muted-foreground"
                )}>{formatPhone(conv.phone)}</p>
              )}
              {conv.instance_name && (
                <span className={cn(
                  "text-[9px] flex items-center gap-0.5 ml-auto",
                  isSelected ? "text-primary-foreground/60" : "text-muted-foreground/70"
                )}>
                  <Smartphone className="h-2.5 w-2.5" />
                  {conv.instance_name}
                </span>
              )}
            </div>

            {unansweredAt && (
              <div className="flex items-center gap-1 mt-1">
                <span className={cn(
                  "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border",
                  isSelected
                    ? "border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground"
                    : ""
                )}
                  style={!isSelected ? { color: 'hsl(38 92% 40%)', borderColor: 'hsl(38 92% 50% / 0.3)', background: 'hsl(38 92% 50% / 0.08)' } : {}}
                >
                  <Clock className="h-2.5 w-2.5" />
                  Sem resposta há {formatDistanceToNow(new Date(unansweredAt), { locale: ptBR })}
                </span>
              </div>
            )}
          </div>
        </button>
      </div>
    );
  }
}
