import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Bot, Plus, Pencil, Trash2, Power, PowerOff, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface AIAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
  base_prompt: string;
  temperature: number;
  max_tokens: number;
  sign_messages: boolean;
  read_messages: boolean;
  is_active: boolean;
  uazapi_agent_id: string | null;
  uazapi_config: Record<string, any>;
  created_at: string;
}

const PROVIDERS = [
  { value: 'lovable_ai', label: 'Lovable AI (Integrado)' },
  { value: 'openai', label: 'OpenAI (via UazAPI)' },
  { value: 'anthropic', label: 'Anthropic (via UazAPI)' },
  { value: 'gemini', label: 'Google Gemini (via UazAPI)' },
  { value: 'deepseek', label: 'DeepSeek (via UazAPI)' },
];

const LOVABLE_MODELS = [
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (rápido)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (avançado)' },
  { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
  { value: 'openai/gpt-5', label: 'GPT-5 (avançado)' },
];

const UAZAPI_MODELS: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    { value: 'claude-3-opus-latest', label: 'Claude 3 Opus' },
  ],
  gemini: [
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  ],
};

const defaultAgent: Omit<AIAgent, 'id' | 'created_at'> = {
  name: '',
  provider: 'lovable_ai',
  model: 'google/gemini-3-flash-preview',
  base_prompt: '',
  temperature: 50,
  max_tokens: 2000,
  sign_messages: true,
  read_messages: true,
  is_active: true,
  uazapi_agent_id: null,
  uazapi_config: {},
};

export function WhatsAppAIAgents() {
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Partial<AIAgent> | null>(null);
  const [saving, setSaving] = useState(false);
  const [conversationCounts, setConversationCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('whatsapp_ai_agents')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Erro ao carregar agentes');
      console.error(error);
    }
    setAgents((data as any[]) || []);

    // Count active conversations per agent
    const { data: convData } = await supabase
      .from('whatsapp_conversation_agents')
      .select('agent_id')
      .eq('is_active', true);
    const counts: Record<string, number> = {};
    (convData || []).forEach((c: any) => {
      counts[c.agent_id] = (counts[c.agent_id] || 0) + 1;
    });
    setConversationCounts(counts);
    setLoading(false);
  };

  const handleNewAgent = () => {
    setEditingAgent({ ...defaultAgent });
    setShowEditor(true);
  };

  const handleEditAgent = (agent: AIAgent) => {
    setEditingAgent({ ...agent });
    setShowEditor(true);
  };

  const handleSave = async () => {
    if (!editingAgent?.name?.trim()) {
      toast.error('Informe o nome do agente');
      return;
    }
    if (!editingAgent?.base_prompt?.trim()) {
      toast.error('Informe o prompt base do agente');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: editingAgent.name,
        provider: editingAgent.provider || 'lovable_ai',
        model: editingAgent.model || 'google/gemini-3-flash-preview',
        base_prompt: editingAgent.base_prompt,
        temperature: editingAgent.temperature ?? 50,
        max_tokens: editingAgent.max_tokens ?? 2000,
        sign_messages: editingAgent.sign_messages ?? true,
        read_messages: editingAgent.read_messages ?? true,
        is_active: editingAgent.is_active ?? true,
        uazapi_config: editingAgent.uazapi_config || {},
      };

      if (editingAgent.id) {
        const { error } = await supabase
          .from('whatsapp_ai_agents')
          .update(payload as any)
          .eq('id', editingAgent.id);
        if (error) throw error;
        toast.success('Agente atualizado!');
      } else {
        const { error } = await supabase
          .from('whatsapp_ai_agents')
          .insert(payload as any);
        if (error) throw error;
        toast.success('Agente criado!');
      }
      setShowEditor(false);
      setEditingAgent(null);
      fetchAgents();
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e.message || ''));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (agent: AIAgent) => {
    const { error } = await supabase
      .from('whatsapp_ai_agents')
      .update({ is_active: !agent.is_active } as any)
      .eq('id', agent.id);
    if (error) {
      toast.error('Erro ao atualizar');
    } else {
      toast.success(agent.is_active ? 'Agente desativado' : 'Agente ativado');
      fetchAgents();
    }
  };

  const handleDelete = async (agent: AIAgent) => {
    if (!confirm(`Excluir agente "${agent.name}"?`)) return;
    const { error } = await supabase
      .from('whatsapp_ai_agents')
      .delete()
      .eq('id', agent.id);
    if (error) {
      toast.error('Erro ao excluir');
    } else {
      toast.success('Agente excluído');
      fetchAgents();
    }
  };

  const getModelsForProvider = (provider: string) => {
    if (provider === 'lovable_ai') return LOVABLE_MODELS;
    return UAZAPI_MODELS[provider] || [];
  };

  const providerLabel = (p: string) => PROVIDERS.find(pr => pr.value === p)?.label || p;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Agentes IA
          </h2>
          <p className="text-sm text-muted-foreground">
            Crie agentes para responder conversas automaticamente
          </p>
        </div>
        <Button onClick={handleNewAgent} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Novo Agente
        </Button>
      </div>

      {agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Bot className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">Nenhum agente criado</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Crie um agente IA para responder conversas do WhatsApp automaticamente
            </p>
            <Button onClick={handleNewAgent} className="mt-4 gap-1.5">
              <Plus className="h-4 w-4" />
              Criar Primeiro Agente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {agents.map(agent => (
            <Card key={agent.id} className={!agent.is_active ? 'opacity-60' : ''}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm">{agent.name}</h3>
                      <Badge variant={agent.is_active ? 'default' : 'secondary'} className="text-[10px]">
                        {agent.is_active ? 'Ativo' : 'Inativo'}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {providerLabel(agent.provider)}
                      </Badge>
                      {conversationCounts[agent.id] > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {conversationCounts[agent.id]} conversa{conversationCounts[agent.id] > 1 ? 's' : ''}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{agent.base_prompt}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Modelo: {agent.model} · Temp: {agent.temperature} · Tokens: {agent.max_tokens}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggleActive(agent)}>
                      {agent.is_active ? <Power className="h-4 w-4 text-green-600" /> : <PowerOff className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditAgent(agent)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(agent)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Agent Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={(open) => { if (!open) { setShowEditor(false); setEditingAgent(null); } }}>
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              {editingAgent?.id ? 'Editar Agente' : 'Novo Agente'}
            </DialogTitle>
          </DialogHeader>
          {editingAgent && (
            <div className="space-y-4">
              <div>
                <Label>Nome do Agente *</Label>
                <Input
                  value={editingAgent.name || ''}
                  onChange={e => setEditingAgent({ ...editingAgent, name: e.target.value })}
                  placeholder="Ex: Assistente de Vendas, Suporte Jurídico..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Provedor</Label>
                  <Select
                    value={editingAgent.provider || 'lovable_ai'}
                    onValueChange={v => {
                      const models = v === 'lovable_ai' ? LOVABLE_MODELS : (UAZAPI_MODELS[v] || []);
                      setEditingAgent({
                        ...editingAgent,
                        provider: v,
                        model: models[0]?.value || '',
                      });
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Modelo</Label>
                  <Select
                    value={editingAgent.model || ''}
                    onValueChange={v => setEditingAgent({ ...editingAgent, model: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {getModelsForProvider(editingAgent.provider || 'lovable_ai').map(m => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {editingAgent.provider !== 'lovable_ai' && (
                <div className="rounded-lg border p-3 bg-amber-500/10">
                  <p className="text-xs text-amber-700">
                    <strong>UazAPI:</strong> Agentes com provedores externos são gerenciados pela UazAPI.
                    A API key do provedor deve estar configurada na sua instância UazAPI.
                  </p>
                </div>
              )}

              <div>
                <Label>Prompt Base (instruções do agente) *</Label>
                <Textarea
                  value={editingAgent.base_prompt || ''}
                  onChange={e => setEditingAgent({ ...editingAgent, base_prompt: e.target.value })}
                  placeholder="Descreva como o agente deve se comportar, que informações fornecer, tom de voz, restrições..."
                  rows={6}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs">Criatividade (temperature): {editingAgent.temperature}</Label>
                </div>
                <Slider
                  value={[editingAgent.temperature ?? 50]}
                  onValueChange={([v]) => setEditingAgent({ ...editingAgent, temperature: v })}
                  min={0}
                  max={100}
                  step={5}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>Preciso</span>
                  <span>Criativo</span>
                </div>
              </div>

              <div>
                <Label className="text-xs">Max tokens por resposta</Label>
                <Input
                  type="number"
                  value={editingAgent.max_tokens ?? 2000}
                  onChange={e => setEditingAgent({ ...editingAgent, max_tokens: parseInt(e.target.value) || 2000 })}
                  min={100}
                  max={8000}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Assinar mensagens</Label>
                    <p className="text-[10px] text-muted-foreground">Adiciona identificação do agente</p>
                  </div>
                  <Switch
                    checked={editingAgent.sign_messages ?? true}
                    onCheckedChange={v => setEditingAgent({ ...editingAgent, sign_messages: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Marcar como lida</Label>
                    <p className="text-[10px] text-muted-foreground">Marca mensagens como lidas ao responder</p>
                  </div>
                  <Switch
                    checked={editingAgent.read_messages ?? true}
                    onCheckedChange={v => setEditingAgent({ ...editingAgent, read_messages: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Agente ativo</Label>
                    <p className="text-[10px] text-muted-foreground">Pode ser atribuído a conversas</p>
                  </div>
                  <Switch
                    checked={editingAgent.is_active ?? true}
                    onCheckedChange={v => setEditingAgent({ ...editingAgent, is_active: v })}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditor(false); setEditingAgent(null); }}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {saving ? 'Salvando...' : 'Salvar Agente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
