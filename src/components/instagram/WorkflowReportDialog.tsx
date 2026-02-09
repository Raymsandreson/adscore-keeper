import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Trophy, 
  Clock, 
  MessageCircle, 
  UserPlus, 
  Target, 
  Send as SendIcon, 
  Copy, 
  Check,
  Share2,
  MapPin,
  Zap,
  Save,
  History
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { WorkflowReportHistory } from "./WorkflowReportHistory";

export interface WorkflowAction {
  id: string;
  type: 'reply' | 'follow' | 'lead' | 'dm' | 'contact_registered' | 'skip';
  username: string;
  timestamp: Date;
  details?: string;
}

interface WorkflowReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: WorkflowAction[];
  startTime: Date | null;
  endTime: Date | null;
  totalComments: number;
  repliedCount: number;
}

export const WorkflowReportDialog = ({ 
  open, 
  onOpenChange, 
  actions,
  startTime,
  endTime,
  totalComments,
  repliedCount
}: WorkflowReportDialogProps) => {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
  // Calculate duration
  const getDuration = () => {
    if (!startTime || !endTime) return "0m 0s";
    const diffMs = endTime.getTime() - startTime.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    return `${minutes}m ${seconds}s`;
  };
  
  // Calculate average response time
  const getAverageTime = () => {
    if (repliedCount === 0 || !startTime || !endTime) return "N/A";
    const diffMs = endTime.getTime() - startTime.getTime();
    const avgMs = diffMs / repliedCount;
    const avgSeconds = Math.floor(avgMs / 1000);
    
    if (avgSeconds >= 60) {
      const mins = Math.floor(avgSeconds / 60);
      const secs = avgSeconds % 60;
      return `${mins}m ${secs}s`;
    }
    return `${avgSeconds}s`;
  };
  
  // Count actions by type
  const actionCounts = {
    replies: actions.filter(a => a.type === 'reply').length,
    follows: actions.filter(a => a.type === 'follow').length,
    leads: actions.filter(a => a.type === 'lead').length,
    dms: actions.filter(a => a.type === 'dm').length,
    contacts: actions.filter(a => a.type === 'contact_registered').length,
    skips: actions.filter(a => a.type === 'skip').length,
  };
  
  // Generate report message
  const generateReportMessage = () => {
    const date = new Date().toLocaleDateString('pt-BR');
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    let message = `📊 *RELATÓRIO DE ENGAJAMENTO*\n`;
    message += `📅 ${date} às ${time}\n\n`;
    
    message += `⏱️ *Tempo Total:* ${getDuration()}\n`;
    message += `⚡ *Tempo Médio/Resposta:* ${getAverageTime()}\n\n`;
    
    message += `💬 *Comentários:*\n`;
    message += `   ✅ Respondidos: ${actionCounts.replies}\n`;
    if (actionCounts.skips > 0) {
      message += `   ⏭️ Pulados: ${actionCounts.skips}\n`;
    }
    message += `\n`;
    
    message += `📈 *Ações Realizadas:*\n`;
    if (actionCounts.follows > 0) {
      message += `   👥 Seguindo: ${actionCounts.follows}\n`;
    }
    if (actionCounts.leads > 0) {
      message += `   🎯 Leads criados: ${actionCounts.leads}\n`;
    }
    if (actionCounts.dms > 0) {
      message += `   💬 DMs enviados: ${actionCounts.dms}\n`;
    }
    if (actionCounts.contacts > 0) {
      message += `   📍 Contatos cadastrados: ${actionCounts.contacts}\n`;
    }
    message += `\n`;
    
    // List usernames interacted with
    const uniqueUsernames = [...new Set(actions.filter(a => a.type === 'reply').map(a => a.username))];
    if (uniqueUsernames.length > 0) {
      message += `👤 *Perfis respondidos:*\n`;
      uniqueUsernames.slice(0, 10).forEach(u => {
        message += `   @${u.replace('@', '')}\n`;
      });
      if (uniqueUsernames.length > 10) {
        message += `   ... e mais ${uniqueUsernames.length - 10}\n`;
      }
    }
    
    message += `\n🚀 _Enviado via ABRACI.IA_`;
    
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
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  };

  // Save report to database
  const saveReport = async () => {
    if (!startTime || !endTime) return;
    
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast.error("Você precisa estar logado para salvar relatórios");
        return;
      }

      const durationSeconds = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);
      
      const { error } = await supabase
        .from('workflow_reports')
        .insert({
          user_id: user.id,
          started_at: startTime.toISOString(),
          ended_at: endTime.toISOString(),
          duration_seconds: durationSeconds,
          total_comments: totalComments,
          replies_count: actionCounts.replies,
          leads_created: actionCounts.leads,
          follows_count: actionCounts.follows,
          dms_sent: actionCounts.dms,
          skips_count: actionCounts.skips,
          registrations_count: actionCounts.contacts,
          actions_detail: actions.map(a => ({
            type: a.type,
            username: a.username,
            timestamp: a.timestamp.toISOString(),
            details: a.details
          }))
        });
      
      if (error) throw error;
      
      setSaved(true);
      toast.success("Relatório salvo com sucesso!");
    } catch (error) {
      console.error('Error saving report:', error);
      toast.error("Erro ao salvar relatório");
    } finally {
      setSaving(false);
    }
  };

  // Reset saved state when dialog opens with new data
  useEffect(() => {
    if (open) {
      setSaved(false);
    }
  }, [open, startTime]);
  
  const getActionIcon = (type: WorkflowAction['type']) => {
    switch (type) {
      case 'reply': return <MessageCircle className="h-3 w-3" />;
      case 'follow': return <UserPlus className="h-3 w-3" />;
      case 'lead': return <Target className="h-3 w-3" />;
      case 'dm': return <SendIcon className="h-3 w-3" />;
      case 'contact_registered': return <MapPin className="h-3 w-3" />;
      case 'skip': return <Zap className="h-3 w-3" />;
    }
  };
  
  const getActionLabel = (type: WorkflowAction['type']) => {
    switch (type) {
      case 'reply': return 'Resposta enviada';
      case 'follow': return 'Marcado como seguindo';
      case 'lead': return 'Lead criado';
      case 'dm': return 'DM enviado';
      case 'contact_registered': return 'Contato cadastrado';
      case 'skip': return 'Pulado';
    }
  };
  
  const getActionColor = (type: WorkflowAction['type']) => {
    switch (type) {
      case 'reply': return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400';
      case 'follow': return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400';
      case 'lead': return 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400';
      case 'dm': return 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-400';
      case 'contact_registered': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400';
      case 'skip': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Relatório do Fluxo
          </DialogTitle>
          <DialogDescription>
            Resumo das ações realizadas durante o fluxo de respostas
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-2">
          <div className="space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Clock className="h-4 w-4" />
                  <span className="text-xs">Tempo Total</span>
                </div>
                <p className="text-lg font-bold">{getDuration()}</p>
              </div>
              
              <div className="p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Zap className="h-4 w-4" />
                  <span className="text-xs">Tempo Médio</span>
                </div>
                <p className="text-lg font-bold">{getAverageTime()}</p>
              </div>
            </div>
            
            {/* Action Summary */}
            <div className="p-3 rounded-lg border bg-muted/30">
              <p className="text-sm font-medium mb-3">Resumo de Ações</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col items-center p-2 rounded-md bg-background">
                  <MessageCircle className="h-4 w-4 text-green-500 mb-1" />
                  <span className="text-lg font-bold">{actionCounts.replies}</span>
                  <span className="text-xs text-muted-foreground">Respostas</span>
                </div>
                
                <div className="flex flex-col items-center p-2 rounded-md bg-background">
                  <UserPlus className="h-4 w-4 text-blue-500 mb-1" />
                  <span className="text-lg font-bold">{actionCounts.follows}</span>
                  <span className="text-xs text-muted-foreground">Seguindo</span>
                </div>
                
                <div className="flex flex-col items-center p-2 rounded-md bg-background">
                  <Target className="h-4 w-4 text-purple-500 mb-1" />
                  <span className="text-lg font-bold">{actionCounts.leads}</span>
                  <span className="text-xs text-muted-foreground">Leads</span>
                </div>
                
                <div className="flex flex-col items-center p-2 rounded-md bg-background">
                  <SendIcon className="h-4 w-4 text-pink-500 mb-1" />
                  <span className="text-lg font-bold">{actionCounts.dms}</span>
                  <span className="text-xs text-muted-foreground">DMs</span>
                </div>
                
                <div className="flex flex-col items-center p-2 rounded-md bg-background">
                  <MapPin className="h-4 w-4 text-amber-500 mb-1" />
                  <span className="text-lg font-bold">{actionCounts.contacts}</span>
                  <span className="text-xs text-muted-foreground">Contatos</span>
                </div>
                
                <div className="flex flex-col items-center p-2 rounded-md bg-background">
                  <Zap className="h-4 w-4 text-gray-500 mb-1" />
                  <span className="text-lg font-bold">{actionCounts.skips}</span>
                  <span className="text-xs text-muted-foreground">Pulados</span>
                </div>
              </div>
            </div>
            
            {/* Action Timeline */}
            {actions.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Histórico de Ações</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {actions.slice().reverse().map((action, index) => (
                    <div 
                      key={action.id} 
                      className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-sm"
                    >
                      <Badge 
                        variant="secondary" 
                        className={cn("gap-1 text-xs", getActionColor(action.type))}
                      >
                        {getActionIcon(action.type)}
                        {getActionLabel(action.type)}
                      </Badge>
                      <span className="font-medium truncate flex-1">@{action.username.replace('@', '')}</span>
                      <span className="text-xs text-muted-foreground">
                        {action.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="space-y-2 pt-4 border-t">
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={copyReport}
            >
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
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={saveReport}
              disabled={saving || saved}
            >
              {saved ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : saving ? (
                <div className="h-4 w-4 animate-spin border-2 border-current border-t-transparent rounded-full" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saved ? "Salvo!" : saving ? "Salvando..." : "Salvar no Histórico"}
            </Button>
            
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => setShowHistory(true)}
            >
              <History className="h-4 w-4" />
              Ver Histórico
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* History Dialog */}
      <WorkflowReportHistory 
        open={showHistory} 
        onOpenChange={setShowHistory} 
      />
    </Dialog>
  );
};
