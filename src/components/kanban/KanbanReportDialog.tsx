import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Trophy, 
  Clock, 
  Users, 
  Target, 
  ArrowRight,
  Copy, 
  Check,
  Share2,
  TrendingUp,
  Calendar,
  RefreshCw,
  User
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { KanbanBoard } from "@/hooks/useKanbanBoards";
import { Lead } from "@/hooks/useLeads";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StageMovement {
  id: string;
  lead_id: string;
  from_stage: string | null;
  to_stage: string;
  from_board_id: string | null;
  to_board_id: string | null;
  changed_at: string;
  notes: string | null;
  lead_name?: string;
  changed_by_name?: string;
  changed_by_email?: string;
}

interface KanbanReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: KanbanBoard;
  leads: Lead[];
  leadsPerStage: Record<string, number>;
}

export function KanbanReportDialog({
  open,
  onOpenChange,
  board,
  leads,
  leadsPerStage,
}: KanbanReportDialogProps) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [movements, setMovements] = useState<StageMovement[]>([]);
  const [period, setPeriod] = useState("today");

  // Fetch stage movements with user info
  useEffect(() => {
    if (open && board) {
      fetchMovements();
    }
  }, [open, board, period]);

  const fetchMovements = async () => {
    setLoading(true);
    try {
      let startDate: Date;
      const now = new Date();

      switch (period) {
        case "today":
          startDate = startOfDay(now);
          break;
        case "yesterday":
          startDate = startOfDay(subDays(now, 1));
          break;
        case "week":
          startDate = startOfDay(subDays(now, 7));
          break;
        case "month":
          startDate = startOfDay(subDays(now, 30));
          break;
        default:
          startDate = startOfDay(now);
      }

      // Fetch stage history
      const { data: historyData, error: historyError } = await supabase
        .from("lead_stage_history")
        .select("*")
        .gte("changed_at", startDate.toISOString())
        .order("changed_at", { ascending: false });

      if (historyError) throw historyError;

      // Get unique lead IDs and fetch lead names
      const leadIds = [...new Set(historyData?.map(h => h.lead_id) || [])];
      
      let leadsMap: Record<string, { name: string; created_by: string | null }> = {};
      if (leadIds.length > 0) {
        const { data: leadsData } = await supabase
          .from("leads")
          .select("id, lead_name, created_by")
          .in("id", leadIds);
        
        leadsData?.forEach(l => {
          leadsMap[l.id] = { name: l.lead_name || "Sem nome", created_by: l.created_by };
        });
      }

      // Get user profiles for changed_by
      const userIds = [...new Set(Object.values(leadsMap).filter(l => l.created_by).map(l => l.created_by!))] ;
      let usersMap: Record<string, { name: string; email: string }> = {};
      
      if (userIds.length > 0) {
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", userIds);
        
        profilesData?.forEach(p => {
          usersMap[p.user_id] = { name: p.full_name || p.email || "Usuário", email: p.email || "" };
        });
      }

      // Filter movements for the current board and enrich with names
      const enrichedMovements = (historyData || [])
        .filter(h => h.to_board_id === board.id || h.from_board_id === board.id)
        .map(h => ({
          ...h,
          lead_name: leadsMap[h.lead_id]?.name || "Lead removido",
          changed_by_name: leadsMap[h.lead_id]?.created_by 
            ? usersMap[leadsMap[h.lead_id].created_by!]?.name || "Usuário"
            : "Sistema",
          changed_by_email: leadsMap[h.lead_id]?.created_by 
            ? usersMap[leadsMap[h.lead_id].created_by!]?.email || ""
            : "",
        }));

      setMovements(enrichedMovements);
    } catch (error) {
      console.error("Error fetching movements:", error);
      toast.error("Erro ao carregar movimentações");
    } finally {
      setLoading(false);
    }
  };

  // Stats calculations
  const stats = useMemo(() => {
    const totalLeads = leads.length;
    const stageNames = board.stages.reduce((acc, s) => ({ ...acc, [s.id]: s.name }), {} as Record<string, string>);
    
    // Count movements by type
    const movementsByStage: Record<string, { in: number; out: number }> = {};
    board.stages.forEach(s => {
      movementsByStage[s.id] = { in: 0, out: 0 };
    });

    movements.forEach(m => {
      if (m.to_stage && movementsByStage[m.to_stage]) {
        movementsByStage[m.to_stage].in++;
      }
      if (m.from_stage && movementsByStage[m.from_stage]) {
        movementsByStage[m.from_stage].out++;
      }
    });

    // First and last stages
    const firstStage = board.stages[0];
    const lastStage = board.stages[board.stages.length - 1];
    
    const newLeadsCount = movementsByStage[firstStage?.id]?.in || 0;
    const convertedCount = movementsByStage[lastStage?.id]?.in || 0;

    return {
      totalLeads,
      totalMovements: movements.length,
      newLeadsCount,
      convertedCount,
      stageNames,
      movementsByStage,
    };
  }, [leads, board, movements]);

  // Get stage name helper
  const getStageName = (stageId: string | null) => {
    if (!stageId) return "Nenhum";
    return stats.stageNames[stageId] || stageId;
  };

  // Get stage color helper
  const getStageColor = (stageId: string | null) => {
    if (!stageId) return "#6b7280";
    const stage = board.stages.find(s => s.id === stageId);
    return stage?.color || "#6b7280";
  };

  // Generate WhatsApp report message
  const generateReportMessage = () => {
    const date = new Date().toLocaleDateString("pt-BR");
    const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    
    const periodLabels: Record<string, string> = {
      today: "Hoje",
      yesterday: "Ontem",
      week: "Últimos 7 dias",
      month: "Últimos 30 dias",
    };

    let message = `📊 *RELATÓRIO DO KANBAN*\n`;
    message += `📋 Quadro: ${board.name}\n`;
    message += `📅 ${date} às ${time}\n`;
    message += `⏰ Período: ${periodLabels[period]}\n\n`;

    message += `📈 *Resumo:*\n`;
    message += `   📦 Total de Leads: ${stats.totalLeads}\n`;
    message += `   🔄 Movimentações: ${stats.totalMovements}\n`;
    message += `   ➕ Novos: ${stats.newLeadsCount}\n`;
    message += `   ✅ Convertidos: ${stats.convertedCount}\n\n`;

    message += `📊 *Leads por Estágio:*\n`;
    board.stages.forEach(stage => {
      const count = leadsPerStage[stage.id] || 0;
      message += `   • ${stage.name}: ${count}\n`;
    });

    if (movements.length > 0) {
      message += `\n🔄 *Últimas Movimentações:*\n`;
      movements.slice(0, 10).forEach(m => {
        const time = format(new Date(m.changed_at), "HH:mm", { locale: ptBR });
        message += `   ${time} - ${m.lead_name}\n`;
        message += `      ${getStageName(m.from_stage)} → ${getStageName(m.to_stage)}\n`;
        if (m.changed_by_name && m.changed_by_name !== "Sistema") {
          message += `      👤 Por: ${m.changed_by_name}\n`;
        }
      });
      if (movements.length > 10) {
        message += `   ... e mais ${movements.length - 10} movimentações\n`;
      }
    }

    message += `\n🚀 _Enviado via Adscore Keeper_`;

    return message;
  };

  const copyReport = () => {
    const message = generateReportMessage();
    navigator.clipboard.writeText(message);
    setCopied(true);
    toast.success("Relatório copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  const sendToWhatsApp = () => {
    const message = generateReportMessage();
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
  };

  const periodLabels: Record<string, string> = {
    today: "Hoje",
    yesterday: "Ontem",
    week: "7 dias",
    month: "30 dias",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Relatório do Kanban
          </DialogTitle>
          <DialogDescription>
            Resumo do quadro "{board.name}"
          </DialogDescription>
        </DialogHeader>

        {/* Period Selector */}
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="yesterday">Ontem</SelectItem>
              <SelectItem value="week">Últimos 7 dias</SelectItem>
              <SelectItem value="month">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchMovements}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>

        <ScrollArea className="flex-1 pr-2">
          <div className="space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Users className="h-4 w-4" />
                  <span className="text-xs">Total de Leads</span>
                </div>
                <p className="text-lg font-bold">{stats.totalLeads}</p>
              </div>

              <div className="p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <ArrowRight className="h-4 w-4" />
                  <span className="text-xs">Movimentações ({periodLabels[period]})</span>
                </div>
                <p className="text-lg font-bold">{stats.totalMovements}</p>
              </div>

              <div className="p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-xs">Novos Leads</span>
                </div>
                <p className="text-lg font-bold text-green-500">{stats.newLeadsCount}</p>
              </div>

              <div className="p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Target className="h-4 w-4" />
                  <span className="text-xs">Convertidos</span>
                </div>
                <p className="text-lg font-bold text-primary">{stats.convertedCount}</p>
              </div>
            </div>

            {/* Leads por Estágio */}
            <div className="p-3 rounded-lg border bg-muted/30">
              <p className="text-sm font-medium mb-3">Leads por Estágio</p>
              <div className="space-y-2">
                {board.stages.map(stage => {
                  const count = leadsPerStage[stage.id] || 0;
                  const movement = stats.movementsByStage[stage.id];
                  
                  return (
                    <div
                      key={stage.id}
                      className="flex items-center justify-between p-2 rounded-md bg-background"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        <span className="text-sm font-medium">{stage.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{count}</span>
                        {movement && (movement.in > 0 || movement.out > 0) && (
                          <div className="flex items-center gap-1 text-[10px]">
                            {movement.in > 0 && (
                              <Badge variant="secondary" className="bg-green-100 text-green-700 text-[10px] px-1">
                                +{movement.in}
                              </Badge>
                            )}
                            {movement.out > 0 && (
                              <Badge variant="secondary" className="bg-red-100 text-red-700 text-[10px] px-1">
                                -{movement.out}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Movimentações Recentes */}
            {movements.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Movimentações Recentes</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {movements.slice(0, 15).map((movement) => (
                    <div
                      key={movement.id}
                      className="flex flex-col gap-1 p-2 rounded-md bg-muted/30 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate">{movement.lead_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(movement.changed_at), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Badge
                          variant="outline"
                          style={{ borderColor: getStageColor(movement.from_stage), color: getStageColor(movement.from_stage) }}
                        >
                          {getStageName(movement.from_stage)}
                        </Badge>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <Badge
                          variant="outline"
                          style={{ borderColor: getStageColor(movement.to_stage), color: getStageColor(movement.to_stage) }}
                        >
                          {getStageName(movement.to_stage)}
                        </Badge>
                      </div>
                      {movement.changed_by_name && movement.changed_by_name !== "Sistema" && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          <span>Por: {movement.changed_by_name}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {movements.length === 0 && !loading && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                Nenhuma movimentação no período selecionado
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          <Button variant="outline" className="flex-1 gap-2" onClick={copyReport}>
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "Copiado!" : "Copiar"}
          </Button>

          <Button
            className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
            onClick={sendToWhatsApp}
          >
            <Share2 className="h-4 w-4" />
            WhatsApp
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
