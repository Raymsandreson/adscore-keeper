import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Bot, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Agent {
  id: string;
  name: string;
}

interface Props {
  boardId: string;
  /** Called when the user clicks "Editar agente" — should switch to the Agentes tab */
  onOpenAgents?: (agentId?: string) => void;
}

export function OnboardingPostCloseConfig({ boardId, onOpenAgents }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [agentsRes, settingsRes] = await Promise.all([
        (supabase as any).from('whatsapp_ai_agents').select('id, name').eq('is_active', true).order('name'),
        (supabase as any)
          .from('board_group_settings')
          .select('id, post_close_agent_id')
          .eq('board_id', boardId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setAgents((agentsRes.data as Agent[]) || []);
      setAgentId(settingsRes.data?.post_close_agent_id || '');
      setSettingsId(settingsRes.data?.id || null);
      setLoading(false);
    };
    if (boardId) load();
    return () => { cancelled = true; };
  }, [boardId]);

  const save = async (newAgentId: string) => {
    setSaving(true);
    try {
      if (settingsId) {
        await (supabase as any)
          .from('board_group_settings')
          .update({ post_close_agent_id: newAgentId || null, updated_at: new Date().toISOString() })
          .eq('id', settingsId);
      } else {
        const { data } = await (supabase as any)
          .from('board_group_settings')
          .insert({ board_id: boardId, post_close_agent_id: newAgentId || null })
          .select('id')
          .single();
        if (data?.id) setSettingsId(data.id);
      }
      setAgentId(newAgentId);
      toast.success('Agente de pós-fechamento salvo');
    } catch (e) {
      toast.error('Erro ao salvar');
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h4 className="font-medium text-xs">Agente de Atendimento Pós-Fechamento</h4>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Escolha qual agente de IA assume a conversa <strong>depois que o lead deste funil for fechado</strong>.
          O prompt, base de conhecimento, voz e regras de follow-up são gerenciados na aba <strong>Agentes</strong>.
        </p>

        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Agente vinculado a este funil</Label>
          <div className="flex gap-2">
            <Select value={agentId || 'none'} onValueChange={(v) => save(v === 'none' ? '' : v)} disabled={saving}>
              <SelectTrigger className="text-xs h-9 flex-1">
                <SelectValue placeholder="Selecione um agente…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Nenhum (manter agente da etapa anterior) —</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {onOpenAgents && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => onOpenAgents(agentId || undefined)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {agentId ? 'Editar agente' : 'Criar agente'}
              </Button>
            )}
          </div>
        </div>

        {agents.length === 0 && (
          <div className="flex items-start gap-2 p-2 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700">
            <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 dark:text-amber-200">
              Nenhum agente ativo encontrado. Crie um agente na aba <strong>Agentes</strong> e ele aparecerá aqui.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
