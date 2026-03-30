import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Bot, BotOff, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface Agent {
  id: string;
  name: string;
  provider: string;
  is_active: boolean;
}

interface Props {
  phone: string;
  instanceName: string;
}

export function WhatsAppAgentToggle({ phone, instanceName }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeAgentName, setActiveAgentName] = useState<string | null>(null);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchState();
  }, [phone, instanceName]);

  const fetchState = async () => {
    // Fetch available agents
    const { data: agentsData } = await supabase
      .from('whatsapp_ai_agents')
      .select('id, name, provider, is_active')
      .eq('is_active', true)
      .order('name');
    setAgents((agentsData as any[]) || []);

    // Fetch current assignment
    const { data: assignment } = await supabase
      .from('whatsapp_conversation_agents')
      .select('agent_id, is_active')
      .eq('phone', phone)
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (assignment) {
      setActiveAgentId((assignment as any).agent_id);
      setAgentEnabled((assignment as any).is_active);
      const agent = (agentsData as any[])?.find((a: any) => a.id === (assignment as any).agent_id);
      setActiveAgentName(agent?.name || null);
    } else {
      setActiveAgentId(null);
      setAgentEnabled(false);
      setActiveAgentName(null);
    }
  };

  const handleToggle = async () => {
    if (!activeAgentId) {
      toast.info('Selecione um agente primeiro');
      return;
    }
    setLoading(true);
    try {
      const newState = !agentEnabled;
      const { error } = await supabase
        .from('whatsapp_conversation_agents')
        .update({ is_active: newState } as any)
        .eq('phone', phone)
        .eq('instance_name', instanceName);
      if (error) throw error;
      setAgentEnabled(newState);
      toast.success(newState ? `🤖 Agente "${activeAgentName}" ativado` : 'Agente desativado nesta conversa');
    } catch (e: any) {
      toast.error('Erro: ' + (e.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAgent = async (agentId: string) => {
    setLoading(true);
    try {
      const agent = agents.find(a => a.id === agentId);
      // Upsert the assignment
      const { error } = await supabase
        .from('whatsapp_conversation_agents')
        .upsert({
          phone,
          instance_name: instanceName,
          agent_id: agentId,
          is_active: true,
        } as any, { onConflict: 'phone,instance_name' });
      if (error) throw error;
      setActiveAgentId(agentId);
      setActiveAgentName(agent?.name || null);
      setAgentEnabled(true);
      toast.success(`🤖 Agente "${agent?.name}" ativado nesta conversa`);

      // Trigger on_activation automations
      try {
        // Get contact name from conversation
        const { data: lastMsg } = await supabase
          .from('whatsapp_messages')
          .select('contact_name')
          .eq('phone', phone)
          .eq('instance_name', instanceName)
          .not('contact_name', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        cloudFunctions.invoke('execute-agent-automations', {
          body: {
            agent_id: agentId,
            trigger_type: 'on_activation',
            phone,
            instance_name: instanceName,
            contact_name: (lastMsg as any)?.contact_name || phone,
          },
        }).then(res => {
          if (res.data?.executed > 0) {
            toast.info(`⚡ ${res.data.executed} automação(ões) executada(s)`);
          }
        }).catch(e => console.error('Automation error:', e));
      } catch (e) {
        console.error('Automation trigger error:', e);
      }
    } catch (e: any) {
      toast.error('Erro: ' + (e.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAgent = async () => {
    setLoading(true);
    try {
      await supabase
        .from('whatsapp_conversation_agents')
        .delete()
        .eq('phone', phone)
        .eq('instance_name', instanceName);
      setActiveAgentId(null);
      setActiveAgentName(null);
      setAgentEnabled(false);
      toast.success('Agente removido desta conversa');
    } catch (e: any) {
      toast.error('Erro: ' + (e.message || ''));
    } finally {
      setLoading(false);
    }
  };

  if (agents.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {/* Quick toggle */}
      <Button
        variant={agentEnabled ? 'default' : 'ghost'}
        size="icon"
        className={`h-7 w-7 ${agentEnabled ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
        onClick={handleToggle}
        disabled={loading}
        title={agentEnabled ? `Agente ativo: ${activeAgentName}` : 'Ativar agente IA'}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : agentEnabled ? (
          <Bot className="h-3.5 w-3.5" />
        ) : (
          <BotOff className="h-3.5 w-3.5" />
        )}
      </Button>

      {/* Agent selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-5 px-0">
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-xs font-semibold">Selecionar Agente IA</p>
            {activeAgentName && (
              <p className="text-[10px] text-muted-foreground">Atual: {activeAgentName}</p>
            )}
          </div>
          <DropdownMenuSeparator />
          {agents.map(agent => (
            <DropdownMenuItem
              key={agent.id}
              onClick={() => handleSelectAgent(agent.id)}
              className="gap-2"
            >
              <Bot className="h-3.5 w-3.5" />
              <span className="flex-1 text-sm">{agent.name}</span>
              {activeAgentId === agent.id && (
                <Badge variant="default" className="text-[9px] h-4 px-1">ativo</Badge>
              )}
            </DropdownMenuItem>
          ))}
          {activeAgentId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleRemoveAgent} className="gap-2 text-destructive">
                <BotOff className="h-3.5 w-3.5" />
                Remover agente
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
