import { useState, useEffect } from 'react';
import { PromptBuilderChat } from './PromptBuilderChat';
import { PromptVariableSelector } from './PromptVariableSelector';
import { AgentAutomationRules } from './AgentAutomationRules';
import { AgentStageConfig } from './AgentStageConfig';

import { supabase } from '@/integrations/supabase/client';
import { logAudit } from '@/hooks/useAuditLog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bot, Plus, Pencil, Trash2, Power, PowerOff, Sparkles, Loader2, Phone, Clock, Megaphone, X, FileText, Zap, Layers, Volume2 } from 'lucide-react';
import { AgentKnowledgeDocs } from './AgentKnowledgeDocs';
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
  response_delay_seconds: number;
  followup_enabled: boolean;
  followup_interval_minutes: number;
  followup_max_attempts: number;
  followup_message: string | null;
  followup_prompt: string | null;
  auto_call_enabled: boolean;
  auto_call_mode: string;
  auto_call_delay_seconds: number;
  auto_call_no_response_minutes: number;
  auto_call_instance_name: string | null;
  call_assigned_to: string | null;
  split_messages: boolean;
  split_delay_seconds: number;
  human_pause_minutes: number;
  respond_in_groups: boolean;
  reply_with_audio: boolean;
  reply_voice_id: string | null;
  stt_prompt: string | null;
  send_window_start_hour: number;
  send_window_end_hour: number;
  send_call_followup_audio: boolean;
  forward_questions_to_group: boolean;
  notify_instance_name: string | null;
  created_at: string;
}

interface CampaignLink {
  id: string;
  agent_id: string;
  campaign_id: string;
  campaign_name: string | null;
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
  ],
  anthropic: [
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
  ],
  gemini: [
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  ],
};

const AUTO_CALL_MODES = [
  { value: 'immediate', label: 'Ligar imediatamente' },
  { value: 'on_no_response', label: 'Ligar após falta de resposta' },
  { value: 'delayed', label: 'Ligar após X segundos' },
];

export function WhatsAppAIAgents() {
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Partial<AIAgent> | null>(null);
  const [saving, setSaving] = useState(false);
  const [conversationCounts, setConversationCounts] = useState<Record<string, number>>({});
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [campaignLinks, setCampaignLinks] = useState<CampaignLink[]>([]);
  const [availableCampaigns, setAvailableCampaigns] = useState<{ campaign_id: string; campaign_name: string }[]>([]);
  const [instances, setInstances] = useState<{ id: string; instance_name: string }[]>([]);
  const [callQueueCount, setCallQueueCount] = useState(0);
  const [teamMembers, setTeamMembers] = useState<{ user_id: string; full_name: string }[]>([]);
  const [availableVoices, setAvailableVoices] = useState<{ id: string; name: string; type: 'builtin' | 'custom' }[]>([]);
  const [boards, setBoards] = useState<{ id: string; name: string; stages: any[] }[]>([]);

  useEffect(() => {
    fetchAgents();
    fetchInstances();
    fetchCallQueueCount();
    fetchTeamMembers();
    fetchVoices();
    fetchBoards();
  }, []);

  const fetchAgents = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('whatsapp_ai_agents')
      .select('*')
      .order('created_at', { ascending: false });
    setAgents((data as any[]) || []);

    const { data: convData } = await supabase
      .from('whatsapp_conversation_agents')
      .select('agent_id')
      .eq('is_active', true);
    const counts: Record<string, number> = {};
    (convData || []).forEach((c: any) => { counts[c.agent_id] = (counts[c.agent_id] || 0) + 1; });
    setConversationCounts(counts);

    const { data: links } = await supabase.from('whatsapp_agent_campaign_links').select('*');
    setCampaignLinks((links as any[]) || []);

    setLoading(false);
  };

  const fetchInstances = async () => {
    const { data } = await supabase.from('whatsapp_instances').select('id, instance_name').eq('is_active', true);
    setInstances((data as any[]) || []);
  };

  const fetchBoards = async () => {
    const { data } = await (supabase.from('kanban_boards') as any).select('id, name, stages').eq('is_active', true).order('display_order');
    setBoards((data as any[]) || []);
  };

  const fetchCallQueueCount = async () => {
    const { count } = await supabase.from('whatsapp_call_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    setCallQueueCount(count || 0);
  };

  const fetchTeamMembers = async () => {
    const { data } = await supabase.from('profiles').select('user_id, full_name').order('full_name');
    setTeamMembers((data as any[]) || []);
  };

  const BUILTIN_VOICES = [
    { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura (padrão)' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },
    { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam' },
  ];

  const fetchVoices = async () => {
    const instanceOwner = { id: 'instance_owner', name: '👤 Dono da instância', type: 'builtin' as const };
    const builtins = BUILTIN_VOICES.map(v => ({ id: v.id, name: v.name, type: 'builtin' as const }));
    const { data: customs } = await supabase
      .from('custom_voices')
      .select('id, name, elevenlabs_voice_id, status')
      .eq('status', 'ready');
    const customList = (customs || []).map((v: any) => ({ id: v.id, name: `🎤 ${v.name} (personalizada)`, type: 'custom' as const }));
    setAvailableVoices([instanceOwner, ...builtins, ...customList]);
  };

  const fetchAvailableCampaigns = async () => {
    const { data } = await supabase
      .from('leads')
      .select('campaign_id, campaign_name')
      .not('campaign_id', 'is', null)
      .limit(500);
    const unique = new Map<string, string>();
    (data || []).forEach((l: any) => {
      if (l.campaign_id && !unique.has(l.campaign_id)) {
        unique.set(l.campaign_id, l.campaign_name || l.campaign_id);
      }
    });
    setAvailableCampaigns(Array.from(unique.entries()).map(([campaign_id, campaign_name]) => ({ campaign_id, campaign_name })));
  };

  const handleNewAgent = () => {
    setEditingAgent({
      name: '', provider: 'lovable_ai', model: 'google/gemini-3-flash-preview',
      base_prompt: '', temperature: 50, max_tokens: 2000, sign_messages: true,
      read_messages: true, is_active: true, uazapi_config: {},
      response_delay_seconds: 0, followup_enabled: false, followup_interval_minutes: 60,
      followup_max_attempts: 3, followup_message: '', followup_prompt: '', auto_call_enabled: false,
      auto_call_mode: 'on_no_response', auto_call_delay_seconds: 0,
      auto_call_no_response_minutes: 30, auto_call_instance_name: null,
      call_assigned_to: null, human_pause_minutes: 30, split_messages: false, split_delay_seconds: 2,
      respond_in_groups: false, reply_with_audio: false, reply_voice_id: null,
      stt_prompt: null, send_window_start_hour: 8, send_window_end_hour: 20,
      send_call_followup_audio: false,
      forward_questions_to_group: false,
      notify_instance_name: null,
    });
    fetchAvailableCampaigns();
    setShowEditor(true);
  };

  const handleEditAgent = (agent: AIAgent) => {
    setEditingAgent({ ...agent });
    fetchAvailableCampaigns();
    setShowEditor(true);
  };

  const handleSave = async () => {
    if (!editingAgent?.name?.trim()) { toast.error('Informe o nome do agente'); return; }
    if (!editingAgent?.base_prompt?.trim()) { toast.error('Informe o prompt base'); return; }
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
        response_delay_seconds: editingAgent.response_delay_seconds ?? 0,
        followup_enabled: editingAgent.followup_enabled ?? false,
        followup_interval_minutes: editingAgent.followup_interval_minutes ?? 60,
        followup_max_attempts: editingAgent.followup_max_attempts ?? 3,
        followup_message: editingAgent.followup_message || null,
        followup_prompt: editingAgent.followup_prompt || null,
        auto_call_enabled: editingAgent.auto_call_enabled ?? false,
        auto_call_mode: editingAgent.auto_call_mode || 'on_no_response',
        auto_call_delay_seconds: editingAgent.auto_call_delay_seconds ?? 0,
        auto_call_no_response_minutes: editingAgent.auto_call_no_response_minutes ?? 30,
        auto_call_instance_name: editingAgent.auto_call_instance_name || null,
        call_assigned_to: editingAgent.call_assigned_to || null,
        human_pause_minutes: editingAgent.human_pause_minutes ?? 30,
        split_messages: editingAgent.split_messages ?? false,
        split_delay_seconds: editingAgent.split_delay_seconds ?? 2,
        respond_in_groups: editingAgent.respond_in_groups ?? false,
        reply_with_audio: editingAgent.reply_with_audio ?? false,
        reply_voice_id: editingAgent.reply_voice_id || null,
        stt_prompt: editingAgent.stt_prompt || null,
        send_window_start_hour: editingAgent.send_window_start_hour ?? 8,
        send_window_end_hour: editingAgent.send_window_end_hour ?? 20,
        send_call_followup_audio: editingAgent.send_call_followup_audio ?? false,
        forward_questions_to_group: editingAgent.forward_questions_to_group ?? false,
        notify_instance_name: editingAgent.notify_instance_name || null,
        max_repeat_cycles: (editingAgent as any).max_repeat_cycles ?? 3,
        min_call_delay_minutes: (editingAgent as any).min_call_delay_minutes ?? 30,
        max_consecutive_call_failures: (editingAgent as any).max_consecutive_call_failures ?? 3,
        max_call_attempts: (editingAgent as any).max_call_attempts ?? 2,
      };

      if (editingAgent.id) {
        const { error } = await supabase.from('whatsapp_ai_agents').update(payload as any).eq('id', editingAgent.id);
        if (error) throw error;
        toast.success('Agente atualizado!');
        logAudit({ action: 'update', entityType: 'agent', entityId: editingAgent.id, entityName: editingAgent.name });
      } else {
        const { data: created, error } = await supabase.from('whatsapp_ai_agents').insert(payload as any).select('id').single();
        if (error) throw error;
        toast.success('Agente criado!');
        logAudit({ action: 'create', entityType: 'agent', entityId: (created as any)?.id, entityName: editingAgent.name });
      }
      setShowEditor(false);
      setEditingAgent(null);
      fetchAgents();
    } catch (e: any) {
      toast.error('Erro: ' + (e.message || ''));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (agent: AIAgent) => {
    await supabase.from('whatsapp_ai_agents').update({ is_active: !agent.is_active } as any).eq('id', agent.id);
    toast.success(agent.is_active ? 'Agente desativado' : 'Agente ativado');
    logAudit({ action: 'update', entityType: 'agent', entityId: agent.id, entityName: agent.name, details: { field: 'is_active', value: !agent.is_active } });
    fetchAgents();
  };

  const [deleteTarget, setDeleteTarget] = useState<AIAgent | null>(null);

  const confirmDeleteAgent = async () => {
    if (!deleteTarget) return;
    await supabase.from('whatsapp_ai_agents').delete().eq('id', deleteTarget.id);
    toast.success('Agente excluído');
    logAudit({ action: 'delete', entityType: 'agent', entityId: deleteTarget.id, entityName: deleteTarget.name });
    setDeleteTarget(null);
    fetchAgents();
  };

  const handleLinkCampaign = async (agentId: string, campaignId: string, campaignName: string) => {
    const { error } = await supabase.from('whatsapp_agent_campaign_links').upsert({
      agent_id: agentId, campaign_id: campaignId, campaign_name: campaignName,
    } as any, { onConflict: 'campaign_id' });
    if (error) toast.error('Erro ao vincular');
    else { toast.success('Campanha vinculada!'); fetchAgents(); }
  };

  const handleUnlinkCampaign = async (linkId: string) => {
    await supabase.from('whatsapp_agent_campaign_links').delete().eq('id', linkId);
    toast.success('Campanha desvinculada');
    fetchAgents();
  };

  const getModelsForProvider = (provider: string) => {
    if (provider === 'lovable_ai') return LOVABLE_MODELS;
    return UAZAPI_MODELS[provider] || [];
  };

  const providerLabel = (p: string) => PROVIDERS.find(pr => pr.value === p)?.label || p;

  const agentCampaigns = (agentId: string) => campaignLinks.filter(l => l.agent_id === agentId);

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Bot className="h-5 w-5" />Agentes IA</h2>
          <p className="text-sm text-muted-foreground">Crie agentes para responder conversas automaticamente</p>
        </div>
        <div className="flex gap-2">
          {callQueueCount > 0 && (
            <Badge variant="outline" className="gap-1"><Phone className="h-3 w-3" />{callQueueCount} na fila</Badge>
          )}
          <Button onClick={handleNewAgent} className="gap-1.5"><Plus className="h-4 w-4" />Novo Agente</Button>
        </div>
      </div>

      {agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Bot className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">Nenhum agente criado</p>
            <Button onClick={handleNewAgent} className="mt-4 gap-1.5"><Plus className="h-4 w-4" />Criar Primeiro Agente</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {agents.map(agent => {
            const campaigns = agentCampaigns(agent.id);
            return (
              <Card key={agent.id} className={!agent.is_active ? 'opacity-60' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm">{agent.name}</h3>
                        <Badge variant={agent.is_active ? 'default' : 'secondary'} className="text-[10px]">{agent.is_active ? 'Ativo' : 'Inativo'}</Badge>
                        <Badge variant="outline" className="text-[10px]">{providerLabel(agent.provider)}</Badge>
                        {conversationCounts[agent.id] > 0 && <Badge variant="secondary" className="text-[10px]">{conversationCounts[agent.id]} conversa{conversationCounts[agent.id] > 1 ? 's' : ''}</Badge>}
                        {agent.auto_call_enabled && <Badge variant="outline" className="text-[10px] gap-0.5"><Phone className="h-2.5 w-2.5" />Discadora</Badge>}
                        {agent.followup_enabled && <Badge variant="outline" className="text-[10px] gap-0.5"><Clock className="h-2.5 w-2.5" />Follow-up</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{agent.base_prompt}</p>
                      {campaigns.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {campaigns.map(c => (
                            <Badge key={c.id} variant="secondary" className="text-[9px] gap-0.5">
                              <Megaphone className="h-2.5 w-2.5" />{c.campaign_name || c.campaign_id}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Modelo: {agent.model} · Delay: {agent.response_delay_seconds}s
                        {agent.auto_call_enabled && ` · Chamada: ${agent.auto_call_mode === 'immediate' ? 'imediata' : agent.auto_call_no_response_minutes + 'min'}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggleActive(agent)}>
                        {agent.is_active ? <Power className="h-4 w-4 text-green-600" /> : <PowerOff className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditAgent(agent)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteTarget(agent)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Agent Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={(open) => { if (!open) { setShowEditor(false); setEditingAgent(null); } }}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />{editingAgent?.id ? 'Editar Agente' : 'Novo Agente'}</DialogTitle>
          </DialogHeader>
          {editingAgent && (
            <Tabs defaultValue="general" className="w-full">
              <TabsList className="w-full grid grid-cols-7">
                <TabsTrigger value="general" className="text-xs">⚙️ Geral</TabsTrigger>
                <TabsTrigger value="ia" className="text-xs">🧠 IA</TabsTrigger>
                <TabsTrigger value="ai_assistant" className="text-xs gap-1">
                  <Sparkles className="h-3 w-3" />
                  Assistente
                </TabsTrigger>
                <TabsTrigger value="automations" className="text-xs">⚡ Automações</TabsTrigger>
                <TabsTrigger value="timing" className="text-xs">⏱️ Tempos</TabsTrigger>
                <TabsTrigger value="calls" className="text-xs">📞 Chamadas</TabsTrigger>
                <TabsTrigger value="campaigns" className="text-xs">📢 Campanhas</TabsTrigger>
              </TabsList>

              {/* TAB: General - only name, description, type, stages, knowledge */}
              <TabsContent value="general" className="space-y-4 mt-4">
                <div>
                  <Label>Nome do Agente *</Label>
                  <Input value={editingAgent.name || ''} onChange={e => setEditingAgent({ ...editingAgent, name: e.target.value })} placeholder="Ex: Assistente de Vendas" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Agente ativo</Label>
                  <Switch checked={editingAgent.is_active ?? true} onCheckedChange={v => setEditingAgent({ ...editingAgent, is_active: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Assinar mensagens</Label>
                  <Switch checked={editingAgent.sign_messages ?? true} onCheckedChange={v => setEditingAgent({ ...editingAgent, sign_messages: v })} />
                </div>
                
                {/* Stages */}
                <div className="border rounded-lg p-3">
                  <Label className="text-sm font-medium">🎯 Etapas vinculadas</Label>
                  <p className="text-[10px] text-muted-foreground mb-2">Configure em quais etapas do funil este agente é ativado automaticamente</p>
                  {editingAgent.id ? (
                    <AgentStageConfig agentId={editingAgent.id} />
                  ) : (
                    <div className="text-sm text-muted-foreground p-4">
                      <p>Salve o agente primeiro para configurar etapas.</p>
                    </div>
                  )}
                </div>


                {/* Knowledge Base */}
                <div className="border rounded-lg p-3">
                  <Label className="text-sm font-medium">📚 Base de Conhecimento</Label>
                  <p className="text-[10px] text-muted-foreground mb-2">Documentos que o agente pode consultar para responder perguntas</p>
                  {editingAgent.id ? (
                    <AgentKnowledgeDocs agentId={editingAgent.id} />
                  ) : (
                    <div className="text-sm text-muted-foreground p-4">
                      <p>Salve o agente primeiro para adicionar documentos.</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* TAB: IA - prompt, model, variables, audio, group forwarding */}
              <TabsContent value="ia" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Provedor</Label>
                    <Select value={editingAgent.provider || 'lovable_ai'} onValueChange={v => {
                      const models = v === 'lovable_ai' ? LOVABLE_MODELS : (UAZAPI_MODELS[v] || []);
                      setEditingAgent({ ...editingAgent, provider: v, model: models[0]?.value || '' });
                    }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Modelo</Label>
                    <Select value={editingAgent.model || ''} onValueChange={v => setEditingAgent({ ...editingAgent, model: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{getModelsForProvider(editingAgent.provider || 'lovable_ai').map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>🧠 Prompt do Agente *</Label>
                    <div className="flex items-center gap-2">
                      <PromptVariableSelector onInsert={(variable) => {
                        const textarea = document.querySelector<HTMLTextAreaElement>('#agent-prompt-textarea');
                        if (textarea) {
                          const start = textarea.selectionStart;
                          const end = textarea.selectionEnd;
                          const currentVal = editingAgent.base_prompt || '';
                          const newVal = currentVal.substring(0, start) + variable + currentVal.substring(end);
                          setEditingAgent({ ...editingAgent, base_prompt: newVal });
                          setTimeout(() => { textarea.focus(); textarea.setSelectionRange(start + variable.length, start + variable.length); }, 50);
                        } else {
                          setEditingAgent({ ...editingAgent, base_prompt: (editingAgent.base_prompt || '') + ' ' + variable });
                        }
                      }} />
                    </div>
                  </div>
                  <Textarea id="agent-prompt-textarea" value={editingAgent.base_prompt || ''} onChange={e => setEditingAgent({ ...editingAgent, base_prompt: e.target.value })} placeholder="Instruções do agente... Use {lead.nome}, {contato.telefone}, {grupo.link_convite} etc." rows={6} />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Use o botão "Inserir campo" para adicionar dados dinâmicos do lead, contato, processo ou grupo diretamente no prompt.
                  </p>

                  <div className="mt-3">
                    <PromptBuilderChat
                      currentPrompt={editingAgent.base_prompt || ''}
                      onApply={(prompt) => { setEditingAgent({ ...editingAgent, base_prompt: prompt }); }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Temperatura: {(editingAgent.temperature ?? 50) / 100}</Label>
                    <Slider value={[editingAgent.temperature ?? 50]} onValueChange={([v]) => setEditingAgent({ ...editingAgent, temperature: v })} min={0} max={100} step={5} />
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>Preciso</span><span>Criativo</span></div>
                  </div>
                  <div>
                    <Label className="text-xs">Tamanho da resposta: {editingAgent.max_tokens ?? 2048}</Label>
                    <Slider
                      value={[editingAgent.max_tokens ?? 2048]}
                      onValueChange={([v]) => setEditingAgent({ ...editingAgent, max_tokens: v })}
                      min={256}
                      max={8192}
                      step={256}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                      <span>Curta</span>
                      <span>~{Math.round((editingAgent.max_tokens ?? 2048) * 0.75)} palavras</span>
                    </div>
                  </div>
                </div>

                {/* Group forwarding */}
                <div className="border rounded-lg p-3 space-y-2">
                  <Label className="text-sm font-medium">📨 Redirecionamento ao Grupo</Label>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs">Encaminhar perguntas ao grupo</Label>
                      <p className="text-[10px] text-muted-foreground">Quando o cliente perguntar sobre o processo no privado, o agente envia a pergunta/resposta no grupo vinculado ao lead</p>
                    </div>
                    <Switch checked={editingAgent.forward_questions_to_group ?? false} onCheckedChange={v => setEditingAgent({ ...editingAgent, forward_questions_to_group: v })} />
                  </div>
                  {editingAgent.forward_questions_to_group && (
                    <div className="space-y-1 pl-2 border-l-2 border-primary/20">
                      <Label className="text-xs">Instância para notificação privada</Label>
                      <p className="text-[10px] text-muted-foreground">Selecione a instância que receberá um aviso privado alertando a equipe para responder no grupo</p>
                      <Select value={editingAgent.notify_instance_name || '__none__'} onValueChange={v => setEditingAgent({ ...editingAgent, notify_instance_name: v === '__none__' ? null : v })}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Nenhuma (só envia no grupo)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs">Nenhuma (só envia no grupo)</SelectItem>
                          {instances.map((inst: any) => (
                            <SelectItem key={inst.id} value={inst.instance_name} className="text-xs">{inst.instance_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* Respond in groups */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Responder em grupos</Label>
                    <p className="text-[10px] text-muted-foreground">Permitir que este agente responda mensagens em grupos do WhatsApp</p>
                  </div>
                  <Switch checked={editingAgent.respond_in_groups ?? false} onCheckedChange={v => setEditingAgent({ ...editingAgent, respond_in_groups: v })} />
                </div>

                {/* Audio response */}
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs">🔊 Responder com áudio</Label>
                      <p className="text-[10px] text-muted-foreground">Quando o contato enviar áudio, o agente responde com áudio também (via ElevenLabs TTS)</p>
                    </div>
                    <Switch checked={editingAgent.reply_with_audio ?? false} onCheckedChange={v => setEditingAgent({ ...editingAgent, reply_with_audio: v })} />
                  </div>
                  {editingAgent.reply_with_audio && (
                    <div className="space-y-1 pl-2 border-l-2 border-primary/20">
                      <Label className="text-xs flex items-center gap-1"><Volume2 className="h-3 w-3" />Voz do agente</Label>
                      <Select value={editingAgent.reply_voice_id || 'FGY2WhTYpPnrIDTdsKH5'} onValueChange={v => setEditingAgent({ ...editingAgent, reply_voice_id: v })}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione a voz" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableVoices.map(v => (
                            <SelectItem key={v.id} value={v.id} className="text-xs">{v.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">Escolha a voz para respostas em áudio. Vozes personalizadas aparecem com 🎤</p>
                    </div>
                  )}
                </div>
                   
                {/* STT Prompt */}
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">🎙️ Prompt de Transcrição (STT)</Label>
                  <Textarea
                    className="text-xs min-h-[60px]"
                    placeholder="Transcreva fielmente esta mensagem de voz. Retorne SOMENTE o texto exato..."
                    value={editingAgent.stt_prompt || ''}
                    onChange={e => setEditingAgent({ ...editingAgent, stt_prompt: e.target.value || null })}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Prompt usado como fallback (Gemini) quando ElevenLabs Scribe não está disponível. Deixe vazio para usar o padrão.
                  </p>
                </div>

                {/* Split messages */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Dividir mensagens longas</Label>
                    <p className="text-[10px] text-muted-foreground">Quebra a resposta em partes menores para parecer mais natural</p>
                  </div>
                  <Switch checked={editingAgent.split_messages ?? false} onCheckedChange={v => setEditingAgent({ ...editingAgent, split_messages: v })} />
                </div>
                {editingAgent.split_messages && (
                  <div className="space-y-1 pl-2 border-l-2 border-primary/20">
                    <Label className="text-xs">Delay entre partes: {editingAgent.split_delay_seconds ?? 2}s</Label>
                    <Slider min={1} max={10} step={1} value={[editingAgent.split_delay_seconds ?? 2]} onValueChange={v => setEditingAgent({ ...editingAgent, split_delay_seconds: v[0] })} />
                    <p className="text-[10px] text-muted-foreground">Tempo de espera entre cada parte da mensagem</p>
                  </div>
                )}
              </TabsContent>

              {/* TAB: AI Assistant - dedicated prompt builder */}
              <TabsContent value="ai_assistant" className="mt-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span>Use a IA para criar ou melhorar o prompt do seu agente. Ela conhece todos os campos, ações e comandos disponíveis no sistema.</span>
                  </div>
                  <PromptBuilderChat
                    currentPrompt={editingAgent.base_prompt || ''}
                    onApply={(prompt) => {
                      setEditingAgent({ ...editingAgent, base_prompt: prompt });
                      toast.success('Prompt aplicado! Vá para a aba IA para revisar.');
                    }}
                    onClose={() => {}}
                    hideHeader
                  />
                </div>
              </TabsContent>


              {/* TAB: Automations */}
              <TabsContent value="automations" className="mt-4">
                {editingAgent.id ? (
                  <AgentAutomationRules agentId={editingAgent.id} />
                ) : (
                  <div className="text-center py-8">
                    <Zap className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Salve o agente primeiro para configurar automações</p>
                  </div>
                )}
              </TabsContent>

              {/* TAB: Timing */}
              <TabsContent value="timing" className="space-y-4 mt-4">
                <div>
                  <Label>Delay de agrupamento (segundos)</Label>
                  <p className="text-[10px] text-muted-foreground mb-1">Aguarda esse tempo para juntar várias mensagens do contato antes de processar. Ex: se o contato mandar 3 msgs em 5s e o delay for 8s, todas serão processadas juntas.</p>
                  <Input type="number" value={editingAgent.response_delay_seconds ?? 0} onChange={e => setEditingAgent({ ...editingAgent, response_delay_seconds: parseInt(e.target.value) || 0 })} min={0} max={60} />
                </div>
                <div className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Follow-up automático</Label>
                      <p className="text-[10px] text-muted-foreground">Reenvia mensagem se o lead não responder</p>
                    </div>
                    <Switch checked={editingAgent.followup_enabled ?? false} onCheckedChange={v => setEditingAgent({ ...editingAgent, followup_enabled: v })} />
                  </div>
                  <div className="border-t pt-3 space-y-2">
                    <Label className="text-xs font-semibold">🕐 Janela de follow-up</Label>
                    <p className="text-[10px] text-muted-foreground">Horário permitido para envio de follow-ups. Respostas a mensagens do cliente funcionam em qualquer horário.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Início</Label>
                        <Input type="number" value={editingAgent.send_window_start_hour ?? 8} onChange={e => setEditingAgent({ ...editingAgent, send_window_start_hour: parseInt(e.target.value) || 8 })} min={0} max={23} />
                        <p className="text-[10px] text-muted-foreground mt-0.5">{String(editingAgent.send_window_start_hour ?? 8).padStart(2, '0')}:00</p>
                      </div>
                      <div>
                        <Label className="text-xs">Fim</Label>
                        <Input type="number" value={editingAgent.send_window_end_hour ?? 20} onChange={e => setEditingAgent({ ...editingAgent, send_window_end_hour: parseInt(e.target.value) || 20 })} min={0} max={23} />
                        <p className="text-[10px] text-muted-foreground mt-0.5">{String(editingAgent.send_window_end_hour ?? 20).padStart(2, '0')}:00</p>
                      </div>
                    </div>
                  </div>
                  {editingAgent.followup_enabled && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Intervalo (minutos)</Label>
                          <Input type="number" value={editingAgent.followup_interval_minutes ?? 60} onChange={e => setEditingAgent({ ...editingAgent, followup_interval_minutes: parseInt(e.target.value) || 60 })} min={5} />
                        </div>
                        <div>
                          <Label className="text-xs">Máximo de tentativas</Label>
                          <Input type="number" value={editingAgent.followup_max_attempts ?? 3} onChange={e => setEditingAgent({ ...editingAgent, followup_max_attempts: parseInt(e.target.value) || 3 })} min={1} max={10} />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Mensagem de follow-up (opcional)</Label>
                        <Textarea value={editingAgent.followup_message || ''} onChange={e => setEditingAgent({ ...editingAgent, followup_message: e.target.value })} placeholder="Mensagem fixa de follow-up (deixe vazio para usar o prompt IA)..." rows={2} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label className="text-xs">Prompt de Follow-up (IA)</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px] gap-1"
                            onClick={() => {
                              const suggestion = `Você é um assistente de follow-up. Seu objetivo é retomar o contato com o lead de forma amigável e natural, sem ser invasivo. 

Diretrizes:
- Relembre brevemente o assunto da última conversa
- Demonstre interesse genuíno em ajudar
- Faça uma pergunta aberta para reengajar
- Mantenha o tom profissional mas acolhedor
- Varie a abordagem a cada tentativa (não repita a mesma mensagem)
- Na primeira tentativa, seja mais casual. Na segunda, mais direto. Na terceira, ofereça uma última oportunidade.

Contexto: Use o histórico da conversa para personalizar a mensagem de retorno.`;
                              setEditingAgent({ ...editingAgent, followup_prompt: suggestion });
                            }}
                          >
                            <Sparkles className="h-3 w-3" />
                            Gerar sugestão
                          </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground mb-1">
                          Prompt específico para a IA gerar mensagens de follow-up contextualizadas. O objetivo é retomar ou manter o relacionamento.
                        </p>
                        <Textarea 
                          value={editingAgent.followup_prompt || ''} 
                          onChange={e => setEditingAgent({ ...editingAgent, followup_prompt: e.target.value })} 
                          placeholder="Instruções para a IA gerar mensagens de follow-up personalizadas..." 
                          rows={4} 
                        />
                      </div>
                    </>
                  )}
                  <div className="border-t pt-3 space-y-2">
                    <Label className="text-xs font-semibold">⚙️ Regras avançadas de follow-up</Label>
                    <p className="text-[10px] text-muted-foreground">Limites e controles do processador automático de follow-up.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Máx. ciclos de repetição</Label>
                        <p className="text-[10px] text-muted-foreground">0 = infinito (até o cliente responder ou bloquear). Padrão: 3 ciclos.</p>
                        <Input type="number" value={(editingAgent as any).max_repeat_cycles ?? 3} onChange={e => setEditingAgent({ ...editingAgent, max_repeat_cycles: parseInt(e.target.value) >= 0 ? parseInt(e.target.value) : 0 } as any)} min={0} max={999} />
                        {(editingAgent as any).max_repeat_cycles === 0 && (
                          <p className="text-[10px] text-orange-500 font-medium mt-1">⚠️ Modo infinito: o follow-up só para quando o cliente responder ou bloquear.</p>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs">Delay mín. para ligação (min)</Label>
                        <p className="text-[10px] text-muted-foreground">Intervalo mínimo entre tentativas de ligação, mesmo se o passo definir menos</p>
                        <Input type="number" value={(editingAgent as any).min_call_delay_minutes ?? 30} onChange={e => setEditingAgent({ ...editingAgent, min_call_delay_minutes: parseInt(e.target.value) || 30 } as any)} min={5} max={1440} />
                      </div>
                      <div>
                        <Label className="text-xs">Falhas consecutivas p/ pular</Label>
                        <p className="text-[10px] text-muted-foreground">Após X ligações sem atender, pula o passo de ligação</p>
                        <Input type="number" value={(editingAgent as any).max_consecutive_call_failures ?? 3} onChange={e => setEditingAgent({ ...editingAgent, max_consecutive_call_failures: parseInt(e.target.value) || 3 } as any)} min={1} max={10} />
                      </div>
                      <div>
                        <Label className="text-xs">Tentativas por ligação</Label>
                        <p className="text-[10px] text-muted-foreground">Máximo de tentativas na fila de ligações</p>
                        <Input type="number" value={(editingAgent as any).max_call_attempts ?? 2} onChange={e => setEditingAgent({ ...editingAgent, max_call_attempts: parseInt(e.target.value) || 2 } as any)} min={1} max={5} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="border rounded-lg p-3 space-y-3">
                  <div>
                    <Label className="text-sm">Pausa quando humano entra</Label>
                    <p className="text-[10px] text-muted-foreground mb-1">Quando alguém da equipe envia uma mensagem manual, o agente IA pausa por este tempo para não atrapalhar a conversa</p>
                    <div className="flex items-center gap-2">
                      <Input type="number" value={editingAgent.human_pause_minutes ?? 30} onChange={e => setEditingAgent({ ...editingAgent, human_pause_minutes: parseInt(e.target.value) || 30 })} min={1} max={1440} className="w-24" />
                      <span className="text-xs text-muted-foreground">minutos</span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* TAB: Calls (Auto-dialer) */}
              <TabsContent value="calls" className="space-y-4 mt-4">
                <div className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Discadora automática</Label>
                      <p className="text-[10px] text-muted-foreground">Liga automaticamente para o lead via UazAPI</p>
                    </div>
                    <Switch checked={editingAgent.auto_call_enabled ?? false} onCheckedChange={v => setEditingAgent({ ...editingAgent, auto_call_enabled: v })} />
                   </div>
                   <p className="text-[9px] text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-1.5 rounded">
                     📞 Ligação automática: o sistema liga para o lead e aguarda até a chamada ser finalizada (atendida ou não). Após a ligação, pode enviar um áudio de follow-up no WhatsApp.
                   </p>
                   {editingAgent.auto_call_enabled && (
                     <>
                       <div className="flex items-center justify-between">
                         <div>
                           <Label className="text-xs">📞 Áudio pós-ligação</Label>
                           <p className="text-[10px] text-muted-foreground">Após o toque, envia áudio automático avisando que tentou ligar</p>
                         </div>
                         <Switch checked={editingAgent.send_call_followup_audio ?? false} onCheckedChange={v => setEditingAgent({ ...editingAgent, send_call_followup_audio: v })} />
                       </div>
                      <div>
                        <Label className="text-xs">Quando ligar</Label>
                        <Select value={editingAgent.auto_call_mode || 'on_no_response'} onValueChange={v => setEditingAgent({ ...editingAgent, auto_call_mode: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{AUTO_CALL_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      {editingAgent.auto_call_mode === 'immediate' && (
                        <div className="rounded-lg bg-amber-500/10 p-2">
                          <p className="text-xs text-amber-700">O sistema ligará imediatamente ao receber a primeira mensagem do lead. Se outra chamada estiver em andamento, enfileira a próxima.</p>
                        </div>
                      )}
                      {editingAgent.auto_call_mode === 'delayed' && (
                        <div>
                          <Label className="text-xs">Delay antes de ligar (segundos)</Label>
                          <Input type="number" value={editingAgent.auto_call_delay_seconds ?? 0} onChange={e => setEditingAgent({ ...editingAgent, auto_call_delay_seconds: parseInt(e.target.value) || 0 })} min={0} />
                        </div>
                      )}
                      {editingAgent.auto_call_mode === 'on_no_response' && (
                        <div>
                          <Label className="text-xs">Tempo sem resposta (minutos)</Label>
                          <p className="text-[10px] text-muted-foreground">Liga se o lead não responder após este tempo</p>
                          <Input type="number" value={editingAgent.auto_call_no_response_minutes ?? 30} onChange={e => setEditingAgent({ ...editingAgent, auto_call_no_response_minutes: parseInt(e.target.value) || 30 })} min={1} />
                        </div>
                      )}
                      <div>
                        <Label className="text-xs">Instância para ligar</Label>
                        <Select value={editingAgent.auto_call_instance_name || ''} onValueChange={v => setEditingAgent({ ...editingAgent, auto_call_instance_name: v })}>
                          <SelectTrigger><SelectValue placeholder="Selecionar instância" /></SelectTrigger>
                          <SelectContent>
                            {instances.map(i => <SelectItem key={i.id} value={i.instance_name}>{i.instance_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Responsável pela ligação</Label>
                        <p className="text-[10px] text-muted-foreground mb-1">Quando a IA identificar necessidade de ligar, uma atividade será criada para este usuário</p>
                        <Select value={editingAgent.call_assigned_to || ''} onValueChange={v => setEditingAgent({ ...editingAgent, call_assigned_to: v || null })}>
                          <SelectTrigger><SelectValue placeholder="Selecionar responsável" /></SelectTrigger>
                          <SelectContent>
                            {teamMembers.map(m => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name || 'Sem nome'}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                </div>
              </TabsContent>

              {/* TAB: Campaigns */}
              <TabsContent value="campaigns" className="space-y-4 mt-4">
                <div>
                  <Label>Campanhas vinculadas</Label>
                  <p className="text-[10px] text-muted-foreground mb-2">Quando um lead chega de uma campanha vinculada, este agente é ativado e o lead pode ser criado automaticamente no funil escolhido</p>
                  
                  {editingAgent.id && (
                    <>
                      {agentCampaigns(editingAgent.id).map(link => {
                        const linkAny = link as any;
                        const selectedBoard = boards.find(b => b.id === linkAny.board_id);
                        const boardStages = selectedBoard?.stages || [];
                        return (
                          <div key={link.id} className="p-3 border rounded mb-2 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-sm font-medium">{link.campaign_name || link.campaign_id}</span>
                              </div>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleUnlinkCampaign(link.id)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`auto-lead-${link.id}`}
                                checked={linkAny.auto_create_lead || false}
                                onChange={async (e) => {
                                  await supabase.from('whatsapp_agent_campaign_links').update({ auto_create_lead: e.target.checked } as any).eq('id', link.id);
                                  fetchAgents();
                                }}
                                className="rounded border-input"
                              />
                              <label htmlFor={`auto-lead-${link.id}`} className="text-xs">Criar lead automaticamente</label>
                            </div>

                            {linkAny.auto_create_lead && (
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-[10px]">Funil</Label>
                                  <Select value={linkAny.board_id || ''} onValueChange={async (v) => {
                                    await supabase.from('whatsapp_agent_campaign_links').update({ board_id: v || null, stage_id: null } as any).eq('id', link.id);
                                    fetchAgents();
                                  }}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar funil..." /></SelectTrigger>
                                    <SelectContent>
                                      {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-[10px]">Etapa inicial</Label>
                                  <Select value={linkAny.stage_id || ''} onValueChange={async (v) => {
                                    await supabase.from('whatsapp_agent_campaign_links').update({ stage_id: v || null } as any).eq('id', link.id);
                                    fetchAgents();
                                  }}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Primeira etapa..." /></SelectTrigger>
                                    <SelectContent>
                                      {boardStages.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      
                      {availableCampaigns.length > 0 && (
                        <div className="mt-3">
                          <Label className="text-xs">Adicionar campanha</Label>
                          <Select onValueChange={v => {
                            const camp = availableCampaigns.find(c => c.campaign_id === v);
                            if (camp && editingAgent.id) handleLinkCampaign(editingAgent.id, camp.campaign_id, camp.campaign_name);
                          }}>
                            <SelectTrigger><SelectValue placeholder="Selecionar campanha..." /></SelectTrigger>
                            <SelectContent>
                              {availableCampaigns
                                .filter(c => !campaignLinks.some(l => l.campaign_id === c.campaign_id))
                                .map(c => <SelectItem key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </>
                  )}
                  {!editingAgent.id && (
                    <p className="text-xs text-muted-foreground italic">Salve o agente primeiro para vincular campanhas</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditor(false); setEditingAgent(null); }}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {saving ? 'Salvando...' : 'Salvar Agente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agente "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. O agente, suas configurações, automações e histórico de follow-up serão permanentemente removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteAgent} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Sim, excluir agente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
