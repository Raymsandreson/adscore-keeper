import { useState } from 'react';
import { useCallFieldSuggestions, CallFieldSuggestion } from '@/hooks/useCallFieldSuggestions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, ChevronDown, ChevronUp, Sparkles, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function CallFieldSuggestionsBanner() {
  const { suggestions, acceptSuggestion, rejectSuggestion, acceptAll, rejectAll } = useCallFieldSuggestions();
  const [expanded, setExpanded] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  if (suggestions.length === 0) return null;

  // Group by call_record_id
  const grouped = suggestions.reduce((acc, s) => {
    if (!acc[s.call_record_id]) acc[s.call_record_id] = [];
    acc[s.call_record_id].push(s);
    return acc;
  }, {} as Record<string, CallFieldSuggestion[]>);

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
            {Object.entries(grouped).map(([, items]) => (
              items.map((s) => (
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
              ))
            ))}

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
