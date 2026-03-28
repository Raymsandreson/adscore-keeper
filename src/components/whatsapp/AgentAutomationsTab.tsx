import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Bot, Loader2 } from 'lucide-react';
import { AgentAutomationRules } from './AgentAutomationRules';

export function AgentAutomationsTab() {
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('whatsapp_ai_agents')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      setAgents(data || []);
      setLoading(false);
    };
    fetch();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Configure ações automáticas por agente IA: criar lead, contato, caso jurídico, mover etapa e mais — usando os dados coletados na conversa.
        </p>
      </div>

      <div>
        <Label className="text-sm font-medium flex items-center gap-1.5 mb-2">
          <Bot className="h-4 w-4" />
          Selecione um agente
        </Label>
        <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um agente IA..." />
          </SelectTrigger>
          <SelectContent>
            {agents.map(a => (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5" />
                  {a.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedAgentId && (
        <div className="border rounded-lg p-4 bg-card">
          <AgentAutomationRules agentId={selectedAgentId} />
        </div>
      )}

      {!selectedAgentId && agents.length > 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Selecione um agente acima para configurar suas automações
        </p>
      )}

      {agents.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Nenhum agente IA ativo encontrado. Crie um agente na aba "Agentes IA".
        </p>
      )}
    </div>
  );
}
