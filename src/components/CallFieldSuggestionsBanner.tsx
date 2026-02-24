import { useState } from 'react';
import { useCallFieldSuggestions, CallFieldSuggestion } from '@/hooks/useCallFieldSuggestions';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, ChevronDown, ChevronUp, Sparkles, ArrowRight, User, Briefcase, Phone, CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function CallFieldSuggestionsBanner() {
  const { user } = useAuthContext();
  const { suggestions, acceptSuggestion, rejectSuggestion, acceptAll, rejectAll } = useCallFieldSuggestions();
  const [expanded, setExpanded] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [createdActivities, setCreatedActivities] = useState<Set<string>>(new Set());

  if (suggestions.length === 0) return null;

  // Group by call_record_id
  const grouped = suggestions.reduce((acc, s) => {
    if (!acc[s.call_record_id]) acc[s.call_record_id] = [];
    acc[s.call_record_id].push(s);
    return acc;
  }, {} as Record<string, CallFieldSuggestion[]>);

  const getGroupInfo = (items: CallFieldSuggestion[]) => {
    const first = items[0];
    return {
      contactName: first?.contact_name,
      leadName: first?.lead_name,
      callerName: first?.caller_name,
      leadId: first?.lead_id,
      nextStep: first?.next_step,
    };
  };

  const handleAccept = async (s: CallFieldSuggestion) => {
    setProcessing(s.id);
    try {
      await acceptSuggestion(s);
      toast.success(`Campo "${s.field_label}" atualizado para "${s.suggested_value}"`);
    } catch {
      toast.error('Erro ao atualizar campo');
    }
    setProcessing(null);
  };

  const handleReject = async (id: string) => {
    setProcessing(id);
    await rejectSuggestion(id);
    setProcessing(null);
  };

  const handleAcceptAll = async () => {
    setProcessing('all');
    try {
      await acceptAll(suggestions.map(s => s.id));
      toast.success('Todos os campos foram atualizados!');
    } catch {
      toast.error('Erro ao atualizar campos');
    }
    setProcessing(null);
  };

  const handleRejectAll = async () => {
    setProcessing('all');
    await rejectAll(suggestions.map(s => s.id));
    toast.info('Sugestões descartadas');
    setProcessing(null);
  };

  const handleCreateActivity = async (callId: string, leadId: string, leadName: string, nextStep: string) => {
    if (!user) return;
    setProcessing(`act_${callId}`);
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const { error } = await supabase.from('lead_activities').insert({
        lead_id: leadId,
        lead_name: leadName,
        title: nextStep.length > 100 ? nextStep.substring(0, 100) + '...' : nextStep,
        description: `Próximo passo identificado pela IA na ligação:\n\n${nextStep}`,
        activity_type: 'tarefa',
        status: 'pendente',
        priority: 'normal',
        assigned_to: user.id,
        created_by: user.id,
        deadline: tomorrow.toISOString().split('T')[0],
      } as any);

      if (error) throw error;
      setCreatedActivities(prev => new Set(prev).add(callId));
      toast.success('Atividade criada com sucesso!');
    } catch (err) {
      console.error('Error creating activity:', err);
      toast.error('Erro ao criar atividade');
    }
    setProcessing(null);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[9998] max-w-[420px] w-full animate-in slide-in-from-bottom-5 duration-300">
      <Card className="border-2 border-amber-500/50 bg-background shadow-2xl">
        {/* Header */}
        <div
          className="flex items-center gap-2 px-4 py-3 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold flex-1">
            IA identificou {suggestions.length} campo{suggestions.length > 1 ? 's' : ''} para atualizar
          </span>
          <Badge variant="secondary" className="text-xs">{suggestions.length}</Badge>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </div>

        {expanded && (
          <div className="px-4 pb-3 space-y-2">
            {Object.entries(grouped).map(([callId, items]) => {
              const { contactName, leadName, callerName, leadId, nextStep } = getGroupInfo(items);
              return (
                <div key={callId} className="space-y-1.5">
                  {/* Caller + Contact + Lead info */}
                  <div className="flex flex-col gap-0.5 text-xs text-muted-foreground px-1">
                    {callerName && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3 text-green-600" />
                        <span className="text-foreground font-medium">{callerName}</span>
                        <span>ligou para</span>
                        <span className="text-foreground font-medium">{contactName || 'contato'}</span>
                      </span>
                    )}
                    {!callerName && contactName && (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span className="font-medium text-foreground">{contactName}</span>
                      </span>
                    )}
                    {leadName && (
                      <span className="flex items-center gap-1">
                        <Briefcase className="h-3 w-3" />
                        <span className="font-medium text-foreground">{leadName}</span>
                      </span>
                    )}
                  </div>

                  {items.map((s) => (
                    <div
                      key={s.id}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-xs",
                        processing === s.id && "opacity-50 pointer-events-none"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {s.entity_type === 'lead' ? 'Lead' : 'Contato'}
                          </Badge>
                          <span className="font-medium">{s.field_label}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-muted-foreground">
                          <span className="truncate">{s.current_value || '(vazio)'}</span>
                          <ArrowRight className="h-3 w-3 shrink-0" />
                          <span className="truncate font-medium text-foreground">{s.suggested_value}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/20"
                          onClick={() => handleAccept(s)}
                          title="Confirmar alteração"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          onClick={() => handleReject(s.id)}
                          title="Rejeitar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {/* Next step → create activity */}
                  {nextStep && leadId && leadName && !createdActivities.has(callId) && (
                    <div className="flex items-start gap-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs">
                      <CalendarPlus className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-blue-800 dark:text-blue-300">Próximo passo:</span>
                        <p className="text-blue-700 dark:text-blue-400 mt-0.5 line-clamp-2">{nextStep}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2 gap-1 border-blue-300 text-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/30 shrink-0"
                        onClick={() => handleCreateActivity(callId, leadId, leadName, nextStep)}
                        disabled={processing === `act_${callId}`}
                      >
                        <CalendarPlus className="h-3 w-3" />
                        Agendar
                      </Button>
                    </div>
                  )}
                  {createdActivities.has(callId) && nextStep && (
                    <div className="flex items-center gap-1 text-[10px] text-green-600 px-1">
                      <Check className="h-3 w-3" /> Atividade criada
                    </div>
                  )}
                </div>
              );
            })}

            {/* Bulk actions */}
            {suggestions.length > 1 && (
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs gap-1 text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-900/20"
                  onClick={handleAcceptAll}
                  disabled={processing === 'all'}
                >
                  <Check className="h-3 w-3" />
                  Aceitar todos
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs gap-1"
                  onClick={handleRejectAll}
                  disabled={processing === 'all'}
                >
                  <X className="h-3 w-3" />
                  Rejeitar todos
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}