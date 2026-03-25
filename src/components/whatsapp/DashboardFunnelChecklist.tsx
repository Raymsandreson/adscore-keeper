import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { CheckSquare, ChevronRight, Filter, Loader2, MessageSquare, Phone, ExternalLink, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

interface KanbanStage {
  id: string;
  name: string;
  color: string;
}

interface Board {
  id: string;
  name: string;
  stages: KanbanStage[];
}

interface ChecklistTemplate {
  id: string;
  name: string;
  items: { id: string; label: string }[];
}

interface LeadWithChecklist {
  id: string;
  lead_name: string;
  lead_phone: string | null;
  status: string;
  stageName: string;
  stageColor: string;
  checklistProgress: number;
  checklistTotal: number;
  checklistCompleted: number;
  lastMessageAt: string | null;
  lastMessageText: string | null;
}

interface StageChecklistSummary {
  stageId: string;
  stageName: string;
  stageColor: string;
  templates: {
    templateId: string;
    templateName: string;
    items: {
      itemId: string;
      label: string;
      completedCount: number;
      totalLeads: number;
    }[];
  }[];
  leads: LeadWithChecklist[];
  totalLeads: number;
}

interface DashboardFunnelChecklistProps {
  selectedInstance: string;
  onOpenChat?: (phone: string) => void;
}

export function DashboardFunnelChecklist({ selectedInstance, onOpenChat }: DashboardFunnelChecklistProps) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stagesSummary, setStagesSummary] = useState<StageChecklistSummary[]>([]);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [selectedItemFilter, setSelectedItemFilter] = useState<{ itemId: string; completed: boolean } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Fetch funnel boards
  useEffect(() => {
    const fetchBoards = async () => {
      const { data } = await supabase
        .from('kanban_boards')
        .select('id, name, stages, board_type')
        .or('board_type.eq.funnel,board_type.is.null')
        .order('name');
      
      const parsed = (data || []).map(b => ({
        id: b.id,
        name: b.name,
        stages: (b.stages as unknown as KanbanStage[]) || [],
      }));
      setBoards(parsed);

      // Try to auto-select based on instance link
      if (selectedInstance !== 'all') {
        const { data: links } = await supabase
          .from('board_group_instances')
          .select('board_id, whatsapp_instances!inner(instance_name)')
          .eq('whatsapp_instances.instance_name', selectedInstance) as any;
        
        if (links && links.length > 0) {
          const linkedBoard = parsed.find(b => b.id === links[0].board_id);
          if (linkedBoard) {
            setSelectedBoardId(linkedBoard.id);
            return;
          }
        }
      }
      
      // Default: select first board if only one, or none
      if (parsed.length === 1) {
        setSelectedBoardId(parsed[0].id);
      }
    };
    fetchBoards();
  }, [selectedInstance]);

  // Load data when board is selected
  const loadData = useCallback(async () => {
    if (!selectedBoardId) {
      setStagesSummary([]);
      return;
    }
    setLoading(true);

    const board = boards.find(b => b.id === selectedBoardId);
    if (!board) { setLoading(false); return; }

    // Fetch leads for this board
    const { data: leadsData } = await supabase
      .from('leads')
      .select('id, lead_name, lead_phone, status, board_id')
      .eq('board_id', selectedBoardId);

    const leads = leadsData || [];

    // Fetch checklist templates linked to this board's stages
    const { data: stageLinks } = await supabase
      .from('checklist_stage_links')
      .select('stage_id, checklist_template_id, display_order')
      .eq('board_id', selectedBoardId)
      .order('display_order');

    const templateIds = [...new Set((stageLinks || []).map(l => l.checklist_template_id))];
    
    let templates: { id: string; name: string; items: any }[] = [];
    if (templateIds.length > 0) {
      const { data: tData } = await supabase
        .from('checklist_templates')
        .select('id, name, items')
        .in('id', templateIds);
      templates = tData || [];
    }

    // Fetch checklist instances for all leads in this board
    const leadIds = leads.map(l => l.id);
    let instances: any[] = [];
    if (leadIds.length > 0) {
      for (let i = 0; i < leadIds.length; i += 200) {
        const batch = leadIds.slice(i, i + 200);
        const { data: instData } = await supabase
          .from('lead_checklist_instances')
          .select('*')
          .eq('board_id', selectedBoardId)
          .in('lead_id', batch);
        instances.push(...(instData || []));
      }
    }

    // Fetch last messages for these leads
    const leadPhones = leads.filter(l => l.lead_phone).map(l => l.lead_phone!.replace(/\D/g, ''));
    const lastMsgMap = new Map<string, { at: string; text: string }>();
    
    if (leadPhones.length > 0) {
      for (let i = 0; i < leadPhones.length; i += 100) {
        const batch = leadPhones.slice(i, i + 100);
        const suffixes = batch.map(p => p.slice(-8));
        // Get latest message per phone
        const { data: msgs } = await supabase
          .from('whatsapp_messages')
          .select('phone, message_text, created_at')
          .order('created_at', { ascending: false })
          .limit(500);
        
        for (const msg of (msgs || [])) {
          const msgSuffix = msg.phone.slice(-8);
          if (suffixes.some(s => msgSuffix === s) && !lastMsgMap.has(msgSuffix)) {
            lastMsgMap.set(msgSuffix, { at: msg.created_at, text: msg.message_text || '' });
          }
        }
      }
    }

    // Build summary per stage
    const summary: StageChecklistSummary[] = board.stages.map(stage => {
      const stageLeads = leads.filter(l => l.status === stage.id);
      const stageStageLinks = (stageLinks || []).filter(sl => sl.stage_id === stage.id);
      const stageTemplateIds = stageStageLinks.map(sl => sl.checklist_template_id);
      const stageTemplates = templates.filter(t => stageTemplateIds.includes(t.id));

      // For each template, compute per-item completion
      const templateSummaries = stageTemplates.map(tmpl => {
        const tmplItems = (tmpl.items as any[]) || [];
        const itemSummaries = tmplItems.map(item => {
          let completedCount = 0;
          for (const lead of stageLeads) {
            const inst = instances.find(i => 
              i.lead_id === lead.id && 
              i.checklist_template_id === tmpl.id && 
              i.stage_id === stage.id
            );
            if (inst) {
              const instItems = (inst.items as any[]) || [];
              const match = instItems.find((ii: any) => ii.id === item.id);
              if (match?.checked) completedCount++;
            }
          }
          return {
            itemId: item.id,
            label: item.label,
            completedCount,
            totalLeads: stageLeads.length,
          };
        });
        return { templateId: tmpl.id, templateName: tmpl.name, items: itemSummaries };
      });

      // Build lead details
      const leadDetails: LeadWithChecklist[] = stageLeads.map(lead => {
        const leadInstances = instances.filter(i => 
          i.lead_id === lead.id && i.stage_id === stage.id
        );
        let total = 0, completed = 0;
        for (const inst of leadInstances) {
          const items = (inst.items as any[]) || [];
          total += items.length;
          completed += items.filter((it: any) => it.checked).length;
        }

        const phoneSuffix = lead.lead_phone ? lead.lead_phone.replace(/\D/g, '').slice(-8) : '';
        const lastMsg = phoneSuffix ? lastMsgMap.get(phoneSuffix) : undefined;

        return {
          id: lead.id,
          lead_name: lead.lead_name,
          lead_phone: lead.lead_phone,
          status: lead.status,
          stageName: stage.name,
          stageColor: stage.color,
          checklistProgress: total > 0 ? Math.round((completed / total) * 100) : 0,
          checklistTotal: total,
          checklistCompleted: completed,
          lastMessageAt: lastMsg?.at || null,
          lastMessageText: lastMsg?.text || null,
        };
      });

      return {
        stageId: stage.id,
        stageName: stage.name,
        stageColor: stage.color,
        templates: templateSummaries,
        leads: leadDetails,
        totalLeads: stageLeads.length,
      };
    });

    setStagesSummary(summary);
    setLoading(false);
  }, [selectedBoardId, boards]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const currentStageSummary = stagesSummary.find(s => s.stageId === selectedStage);

  // Filter leads based on selected checklist item
  const filteredLeads = currentStageSummary ? (() => {
    if (!selectedItemFilter) return currentStageSummary.leads;
    
    const { itemId, completed } = selectedItemFilter;
    // Need to check each lead's checklist instances for this item
    return currentStageSummary.leads.filter(lead => {
      // We'll re-check from the stage summary, which already has the data embedded
      // For simplicity, since we already have progress data, we match via the summary
      // Actually we need the raw instances... Let's use a simpler approach
      return true; // placeholder - will filter from state
    });
  })() : [];

  if (boards.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Funil & Checklist</span>
          </div>
          <Select value={selectedBoardId || ''} onValueChange={setSelectedBoardId}>
            <SelectTrigger className="w-[220px] h-8 text-xs">
              <SelectValue placeholder="Selecionar funil..." />
            </SelectTrigger>
            <SelectContent>
              {boards.map(b => (
                <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : selectedBoardId && stagesSummary.length > 0 ? (
          <div className="space-y-2">
            {stagesSummary.filter(s => s.totalLeads > 0).map(stage => (
              <div
                key={stage.stageId}
                className="rounded-lg border bg-card/50 p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => { setSelectedStage(stage.stageId); setSelectedItemFilter(null); setSheetOpen(true); }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.stageColor }} />
                    <span className="text-xs font-medium">{stage.stageName}</span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 h-4">{stage.totalLeads} leads</Badge>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                
                {/* Checklist items summary */}
                {stage.templates.map(tmpl => (
                  <div key={tmpl.templateId} className="mt-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{tmpl.templateName}</span>
                    <div className="mt-1 space-y-0.5">
                      {tmpl.items.map(item => {
                        const pct = item.totalLeads > 0 ? Math.round((item.completedCount / item.totalLeads) * 100) : 0;
                        return (
                          <div key={item.itemId} className="flex items-center gap-2 text-[11px]">
                            <CheckSquare className={cn("h-3 w-3 shrink-0", pct === 100 ? "text-emerald-500" : "text-muted-foreground")} />
                            <span className="flex-1 truncate">{item.label}</span>
                            <span className={cn("text-[10px] font-medium shrink-0", pct === 100 ? "text-emerald-600" : "text-muted-foreground")}>
                              {item.completedCount}/{item.totalLeads}
                            </span>
                            <div className="w-12 shrink-0">
                              <Progress value={pct} className="h-1" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {stagesSummary.every(s => s.totalLeads === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum lead neste funil</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">Selecione um funil para visualizar</p>
        )}
      </CardContent>

      {/* Stage detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open) { setSheetOpen(false); setSelectedItemFilter(null); } }}>
        <SheetContent className="w-[420px] sm:w-[480px]">
          {currentStageSummary && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: currentStageSummary.stageColor }} />
                  {currentStageSummary.stageName}
                  <Badge variant="secondary" className="text-xs">{currentStageSummary.totalLeads} leads</Badge>
                </SheetTitle>
              </SheetHeader>

              {/* Checklist filter buttons */}
              {currentStageSummary.templates.length > 0 && (
                <div className="mt-3 space-y-2">
                  {currentStageSummary.templates.map(tmpl => (
                    <div key={tmpl.templateId}>
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{tmpl.templateName}</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <button
                          onClick={() => setSelectedItemFilter(null)}
                          className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                            !selectedItemFilter
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted/50 text-muted-foreground border-border hover:bg-accent"
                          )}
                        >
                          Todos ({currentStageSummary.totalLeads})
                        </button>
                        {tmpl.items.map(item => (
                          <div key={item.itemId} className="flex gap-0.5">
                            <button
                              onClick={() => setSelectedItemFilter({ itemId: item.itemId, completed: true })}
                              className={cn(
                                "text-[10px] px-2 py-0.5 rounded-l-full border transition-colors",
                                selectedItemFilter?.itemId === item.itemId && selectedItemFilter?.completed
                                  ? "bg-emerald-600 text-white border-emerald-600"
                                  : "bg-muted/50 text-muted-foreground border-border hover:bg-accent"
                              )}
                              title={`${item.label} - Concluído`}
                            >
                              ✅ {item.label.length > 15 ? item.label.slice(0, 15) + '…' : item.label} ({item.completedCount})
                            </button>
                            <button
                              onClick={() => setSelectedItemFilter({ itemId: item.itemId, completed: false })}
                              className={cn(
                                "text-[10px] px-2 py-0.5 rounded-r-full border border-l-0 transition-colors",
                                selectedItemFilter?.itemId === item.itemId && !selectedItemFilter?.completed
                                  ? "bg-amber-600 text-white border-amber-600"
                                  : "bg-muted/50 text-muted-foreground border-border hover:bg-accent"
                              )}
                              title={`${item.label} - Pendente`}
                            >
                              ⏳ ({item.totalLeads - item.completedCount})
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <ScrollArea className="h-[calc(100vh-220px)] mt-3">
                <LeadsList
                  stageSummary={currentStageSummary}
                  selectedItemFilter={selectedItemFilter}
                  boardId={selectedBoardId!}
                  onOpenChat={onOpenChat}
                />
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

// Separate component to handle filtered lead list with instance data
function LeadsList({ 
  stageSummary, 
  selectedItemFilter, 
  boardId,
  onOpenChat 
}: { 
  stageSummary: StageChecklistSummary; 
  selectedItemFilter: { itemId: string; completed: boolean } | null;
  boardId: string;
  onOpenChat?: (phone: string) => void;
}) {
  const [checklistInstances, setChecklistInstances] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fetchInstances = async () => {
      const leadIds = stageSummary.leads.map(l => l.id);
      if (leadIds.length === 0) { setLoaded(true); return; }
      
      const { data } = await supabase
        .from('lead_checklist_instances')
        .select('*')
        .eq('board_id', boardId)
        .eq('stage_id', stageSummary.stageId)
        .in('lead_id', leadIds);
      
      setChecklistInstances(data || []);
      setLoaded(true);
    };
    fetchInstances();
  }, [stageSummary.stageId, boardId]);

  if (!loaded) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Filter leads based on selected item
  const filteredLeads = selectedItemFilter
    ? stageSummary.leads.filter(lead => {
        const leadInsts = checklistInstances.filter(i => i.lead_id === lead.id);
        for (const inst of leadInsts) {
          const items = (inst.items as any[]) || [];
          const match = items.find((it: any) => it.id === selectedItemFilter.itemId);
          if (match) {
            return selectedItemFilter.completed ? !!match.checked : !match.checked;
          }
        }
        // If no instance found, consider it as "not completed"
        return !selectedItemFilter.completed;
      })
    : stageSummary.leads;

  return (
    <div className="space-y-2 pr-4">
      {filteredLeads.map(lead => (
        <div
          key={lead.id}
          className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
          onClick={() => {
            if (lead.lead_phone && onOpenChat) {
              const phone = lead.lead_phone.replace(/\D/g, '');
              onOpenChat(phone);
            }
          }}
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium truncate">{lead.lead_name}</p>
                <Badge 
                  variant="outline" 
                  className="text-[8px] px-1 py-0 h-3.5 shrink-0"
                  style={{ borderColor: lead.stageColor, color: lead.stageColor }}
                >
                  {lead.stageName}
                </Badge>
              </div>
              {lead.lead_phone && (
                <p className="text-xs text-muted-foreground mt-0.5" data-callface-ignore="true">{lead.lead_phone}</p>
              )}
            </div>
            <div className="shrink-0 ml-2 flex flex-col items-end gap-1">
              {lead.checklistTotal > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">{lead.checklistCompleted}/{lead.checklistTotal}</span>
                  <div className="w-14">
                    <Progress value={lead.checklistProgress} className="h-1.5" />
                  </div>
                </div>
              )}
              {lead.lastMessageAt && (
                <span className="text-[10px] text-muted-foreground">
                  {format(parseISO(lead.lastMessageAt), 'dd/MM HH:mm')}
                </span>
              )}
            </div>
          </div>
          {lead.lastMessageText && (
            <p className="text-[11px] text-muted-foreground mt-1 truncate">
              💬 {lead.lastMessageText.slice(0, 80)}{lead.lastMessageText.length > 80 ? '…' : ''}
            </p>
          )}
        </div>
      ))}
      {filteredLeads.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6">Nenhum lead encontrado com este filtro</p>
      )}
    </div>
  );
}
