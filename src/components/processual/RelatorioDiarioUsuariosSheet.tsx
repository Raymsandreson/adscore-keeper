import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { ChevronRight, FileText, Loader2 } from "lucide-react";
import { useTeamProductivity, type UserProductivity } from "@/hooks/useTeamProductivity";
import { DailyReportDialog } from "@/components/team/DailyReportDialog";
import type { MyProductivity, MyDailyGoals } from "@/hooks/useMyProductivity";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const DEFAULT_GOALS: MyDailyGoals = {
  target_replies: 10,
  target_dms: 20,
  target_leads: 10,
  target_session_minutes: 480,
  target_contacts: 10,
  target_calls: 10,
  target_activities: 3,
  target_stage_changes: 7,
  target_leads_closed: 5,
  target_checklist_items: 7,
};

function toMyProductivity(u: UserProductivity): MyProductivity {
  return {
    commentReplies: u.commentReplies,
    dmsSent: u.dmsSent,
    contactsCreated: u.contactsCreated,
    leadsCreated: u.leadsCreated,
    leadsClosed: u.leadsClosed,
    leadsProgressed: u.leadsProgressed,
    callsMade: u.callsMade,
    callsAnswered: 0,
    callsUnanswered: 0,
    stageChanges: u.stageChanges,
    checklistItemsChecked: u.checklistItemsChecked,
    activitiesCompleted: u.activitiesCompleted,
    activitiesOverdue: u.activitiesOverdue,
    sessionMinutes: u.sessionMinutes,
    totalActions: u.totalActions,
    metaLeadsGenerated: u.metaLeadsReceived || 0,
    metaROAS: 0,
  };
}

function computeProgress(p: MyProductivity, g: MyDailyGoals): number {
  // Tempo de sessão intencionalmente ignorado no cálculo de meta.
  const ratios = [
    p.commentReplies / g.target_replies,
    p.dmsSent / g.target_dms,
    p.contactsCreated / g.target_contacts,
    p.leadsCreated / g.target_leads,
    p.callsMade / g.target_calls,
    p.stageChanges / g.target_stage_changes,
    p.checklistItemsChecked / g.target_checklist_items,
    p.activitiesCompleted / g.target_activities,
    p.leadsClosed / g.target_leads_closed,
  ].map((r) => Math.min(1, isFinite(r) ? r : 0));
  const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  return Math.round(avg * 100);
}

type Period = "day" | "week" | "month";

export function RelatorioDiarioUsuariosSheet({ open, onOpenChange }: Props) {
  const [period, setPeriod] = useState<Period>("day");

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (period) {
      case "week":
        return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
      case "month":
        return { start: startOfMonth(now), end: endOfMonth(now) };
      default:
        return { start: startOfDay(now), end: endOfDay(now) };
    }
  }, [period]);

  const { productivity, loading } = useTeamProductivity(dateRange);
  const [selected, setSelected] = useState<UserProductivity | null>(null);

  const rows = useMemo(() => {
    return [...productivity]
      .filter((u) => u.userName || u.email)
      .map((u) => {
        const my = toMyProductivity(u);
        const progress = computeProgress(my, DEFAULT_GOALS);
        return { u, my, progress };
      })
      .sort((a, b) => b.progress - a.progress);
  }, [productivity]);

  const tone = (p: number) =>
    p >= 80
      ? { dot: "bg-emerald-500", text: "text-emerald-600", label: "Alto" }
      : p >= 50
        ? { dot: "bg-amber-500", text: "text-amber-600", label: "Médio" }
        : { dot: "bg-red-500", text: "text-red-600", label: "Baixo" };

  return (
    <>
      <Sheet open={open && !selected} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Relatório de Atividades
            </SheetTitle>
            <SheetDescription>
              Selecione um usuário para abrir o relatório completo.
            </SheetDescription>
          </SheetHeader>

          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)} className="mt-4">
            <TabsList className="w-full">
              <TabsTrigger value="day" className="flex-1">Diária</TabsTrigger>
              <TabsTrigger value="week" className="flex-1">Semanal</TabsTrigger>
              <TabsTrigger value="month" className="flex-1">Mensal</TabsTrigger>
            </TabsList>
          </Tabs>

          <ScrollArea className="mt-4 h-[calc(100vh-180px)] pr-3">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando equipe...
              </div>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Nenhum usuário com atividade hoje.
              </div>
            ) : (
              <div className="space-y-2">
                {rows.map(({ u, progress }) => {
                  const t = tone(progress);
                  return (
                    <button
                      key={u.userId}
                      onClick={() => setSelected(u)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left transition hover:bg-accent"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {u.userName || u.email}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {u.email}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="gap-1.5">
                          <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
                          <span className={cn("font-medium", t.text)}>{progress}%</span>
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {selected && (
        <DailyReportDialog
          open={!!selected}
          onOpenChange={(v) => !v && setSelected(null)}
          userId={selected.userId}
          userName={selected.userName || selected.email || "Usuário"}
          productivity={toMyProductivity(selected)}
          goals={DEFAULT_GOALS}
          goalProgress={computeProgress(toMyProductivity(selected), DEFAULT_GOALS)}
        />
      )}
    </>
  );
}
