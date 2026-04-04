import { useState, useEffect, useCallback } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { 
  Bot, Plus, Trash2, MessageSquare, Sparkles, 
  Zap, Phone, FileText, Bell, Pencil, Wand2, Settings2, Volume2, Maximize2, RefreshCw,
  ChevronUp, ChevronDown
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AIShortcutGenerator } from './AIShortcutGenerator';
import { MemberAssistantSettings } from './MemberAssistantSettings';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

// ==================== TYPES ====================

interface Shortcut {
  id: string;
  shortcut_name: string;
  description: string | null;
  template_token: string | null;
  template_name: string | null;
  prompt_instructions: string | null;
  media_extraction_prompt: string | null;
  is_active: boolean;
  display_order: number;
  followup_steps: FollowupStep[];
  notify_on_signature: boolean;
  send_signed_pdf: boolean;
  request_documents: boolean;
  document_types: string[];
  custom_document_names: string[];
  document_type_modes: Record<string, 'required' | 'optional'>;
  // Agent fields
  assistant_type: string;
  base_prompt: string | null;
  model: string;
  temperature: number;
  response_delay_seconds: number;
  split_messages: boolean;
  split_delay_seconds: number;
  human_reply_pause_minutes: number;
  skip_confirmation: boolean;
  command_scope: string;
  reply_with_audio: boolean;
  reply_voice_id: string | null;
  respond_in_groups: boolean;
  send_window_start_hour: number;
  send_window_end_hour: number;
  send_call_followup_audio: boolean;
  
}

interface FollowupStep {
  action_type: 'whatsapp_message' | 'call' | 'create_activity';
  delay_minutes: number;
  message_template?: string;
  assigned_to?: string;
  activity_type?: string;
  priority?: string;
}


interface Profile { user_id: string; full_name: string | null; }
interface ZapSignTemplateOption { token: string; name: string; }

const MODELS = [
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (rápido)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (avançado)' },
  { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
  { value: 'openai/gpt-5', label: 'GPT-5 (avançado)' },
];

const ASSISTANT_TYPES = [
  { value: 'document', label: '📄 Gerador de Documentos', desc: 'Coleta dados e gera documentos ZapSign' },
  { value: 'assistant', label: '🤖 Agente IA', desc: 'Responde e interage com clientes/leads' },
  { value: 'hybrid', label: '🔄 Híbrido', desc: 'Agente que também gera documentos' },
];

// ==================== COMPONENT ====================
export function WhatsAppCommandConfig() {
  const [activeTab, setActiveTab] = useState('shortcuts');
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [profilesRes, shortcutsRes] = await Promise.all([
      supabase.from('profiles').select('user_id, full_name').order('full_name'),
      supabase.from('wjia_command_shortcuts').select('*').order('display_order') as any,
    ]);
    setProfiles((profilesRes.data || []).filter((p: any) => p.full_name));
    
    setShortcuts((shortcutsRes.data || []).map((s: any) => {
      return {
        ...s,
        followup_steps: s.followup_steps || [],
        assistant_type: s.assistant_type || 'document',
        model: s.model || 'google/gemini-2.5-flash',
        temperature: s.temperature ?? 0.7,
        max_tokens: (s as any).max_tokens ?? 2048,
        response_delay_seconds: s.response_delay_seconds ?? 2,
        split_messages: s.split_messages ?? false,
        split_delay_seconds: s.split_delay_seconds ?? 3,
        human_reply_pause_minutes: s.human_reply_pause_minutes ?? 0,
        skip_confirmation: (s as any).skip_confirmation ?? false,
        partial_min_fields: (s as any).partial_min_fields || [],
        command_scope: s.command_scope || 'client',
        reply_with_audio: s.reply_with_audio ?? false,
        reply_voice_id: s.reply_voice_id || null,
        respond_in_groups: s.respond_in_groups ?? false,
        send_window_start_hour: (s as any).send_window_start_hour ?? 8,
        send_window_end_hour: (s as any).send_window_end_hour ?? 20,
        lead_status_board_ids: s.lead_status_board_ids || [],
        lead_status_filter: s.lead_status_filter || [],
      };
    }) as Shortcut[]);
    
    setLoading(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Central de Agentes IA</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Configure <strong>Agentes IA</strong> para contatos/clientes e a <strong>IA Interna</strong> para membros da equipe (CRM via WhatsApp).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="shortcuts" className="text-xs gap-1">
            <Zap className="h-3.5 w-3.5" /> Agentes IA
          </TabsTrigger>
          <TabsTrigger value="member" className="text-xs gap-1">
            <Bot className="h-3.5 w-3.5" /> IA Interna
          </TabsTrigger>
        </TabsList>

        <TabsContent value="shortcuts">
          <ShortcutsTab
            shortcuts={shortcuts.filter(s => s.command_scope === 'client')}
            profiles={profiles}
            onReload={loadData}
            commandScope="client"
          />
        </TabsContent>

        <TabsContent value="member">
          <MemberAssistantSettings
            shortcuts={shortcuts.filter(s => s.command_scope === 'internal')}
            profiles={profiles}
            onReload={loadData}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ==================== SHORTCUTS TAB (UNIFIED ASSISTANT + DOCUMENT) ====================
function ShortcutsTab({ shortcuts, profiles, onReload, commandScope = 'client' }: { shortcuts: Shortcut[]; profiles: Profile[]; onReload: () => void; commandScope?: string }) {
  const [showForm, setShowForm] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aiEditConfig, setAiEditConfig] = useState<{ shortcut_name: string; description: string; prompt_instructions: string; media_extraction_prompt?: string; followup_steps: FollowupStep[] } | null>(null);
  
  const [form, setForm] = useState({
    shortcut_name: '', description: '', template_token: '', template_name: '',
    prompt_instructions: '', media_extraction_prompt: '',
    notify_on_signature: true, send_signed_pdf: true,
    request_documents: false, document_types: [] as string[], custom_document_names: [] as string[],
    document_type_modes: {} as Record<string, 'required' | 'optional'>,
    // Agent fields
    assistant_type: 'document',
    base_prompt: '',
    model: 'google/gemini-2.5-flash',
    temperature: 0.7,
    max_tokens: 2048,
    response_delay_seconds: 2,
    skip_confirmation: false,
    split_messages: false,
    split_delay_seconds: 3,
    reply_with_audio: false,
    reply_voice_id: null as string | null,
    respond_in_groups: false,
    max_tts_chars: 1000,
    send_window_start_hour: 8,
    send_window_end_hour: 20,
    send_call_followup_audio: false,
    zapsign_settings: {} as Record<string, any>,
  });
  const [followupSteps, setFollowupSteps] = useState<FollowupStep[]>([]);
  const [humanReplyPauseMinutes, setHumanReplyPauseMinutes] = useState(0);
  const [followupRepeatForever, setFollowupRepeatForever] = useState(false);
  const [zapsignTemplates, setZapsignTemplates] = useState<ZapSignTemplateOption[]>([]);
  const [templateFields, setTemplateFields] = useState<{ variable: string; label: string; required: boolean }[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [formSection, setFormSection] = useState<'general' | 'ai' | 'document' | 'followup'>('general');
  const [availableVoices, setAvailableVoices] = useState<{ id: string; name: string }[]>([]);
  const [promptSheetOpen, setPromptSheetOpen] = useState(false);

  const BUILTIN_VOICES = [
    { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura (padrão)' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },
    { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam' },
  ];

  useEffect(() => {
    const fetchVoices = async () => {
      const instanceOwner = { id: 'instance_owner', name: '👤 Dono da instância' };
      const builtins = BUILTIN_VOICES.map(v => ({ id: v.id, name: v.name }));
      const { data: customs } = await supabase
        .from('custom_voices')
        .select('id, name, elevenlabs_voice_id, status')
        .eq('status', 'ready');
      const customList = (customs || []).map((v: any) => ({ id: v.id, name: `🎤 ${v.name} (personalizada)` }));
      setAvailableVoices([instanceOwner, ...builtins, ...customList]);
    };
    fetchVoices();
  }, []);

  const loadZapSignTemplates = useCallback(async () => {
    if (zapsignTemplates.length > 0) return;
    setLoadingTemplates(true);
    try {
      const { data, error } = await cloudFunctions.invoke('zapsign-api', {
        body: { action: 'list_templates' },
      });
      if (!error && data?.success) {
        const templates = Array.isArray(data.templates) ? data.templates : (data.templates?.results || []);
        setZapsignTemplates(templates.map((t: any) => ({ token: t.token, name: t.name })));
      }
    } catch (e) {
      console.error('Error loading ZapSign templates:', e);
    } finally {
      setLoadingTemplates(false);
    }
  }, [zapsignTemplates.length]);

  useEffect(() => {
    if (showForm && (form.assistant_type === 'document' || form.assistant_type === 'hybrid')) {
      loadZapSignTemplates();
    }
  }, [showForm, form.assistant_type, loadZapSignTemplates]);

  const showDocumentFields = form.assistant_type === 'document' || form.assistant_type === 'hybrid';
  const showAssistantFields = form.assistant_type === 'assistant' || form.assistant_type === 'hybrid';

  const resetForm = () => {
    setForm({
      shortcut_name: '', description: '', template_token: '', template_name: '',
      prompt_instructions: '', media_extraction_prompt: '',
      notify_on_signature: true, send_signed_pdf: true,
      request_documents: false, document_types: [], custom_document_names: [], document_type_modes: {},
      assistant_type: 'document', base_prompt: '',
      model: 'google/gemini-2.5-flash', temperature: 0.7,
      max_tokens: 2048, response_delay_seconds: 2, skip_confirmation: false, split_messages: false, split_delay_seconds: 3,
      reply_with_audio: false, reply_voice_id: null, respond_in_groups: false, max_tts_chars: 1000,
      send_window_start_hour: 8, send_window_end_hour: 20, send_call_followup_audio: false,
      zapsign_settings: {},
    });
    setFollowupSteps([]);
    setHumanReplyPauseMinutes(0);
    
    
    setEditingId(null);
    setShowForm(false);
    setAiEditConfig(null);
    setFormSection('general');
  };

  const startAIEdit = (s: Shortcut) => {
    setAiEditConfig({
      shortcut_name: s.shortcut_name,
      description: s.description || '',
      prompt_instructions: s.prompt_instructions || '',
      media_extraction_prompt: s.media_extraction_prompt || '',
      followup_steps: s.followup_steps || [],
    });
    setEditingId(s.id);
    setShowAI(true);
    setShowForm(false);
  };

  const startEdit = (s: Shortcut) => {
    setForm({
      shortcut_name: s.shortcut_name,
      description: s.description || '',
      template_token: s.template_token || '',
      template_name: s.template_name || '',
      prompt_instructions: s.prompt_instructions || '',
      media_extraction_prompt: s.media_extraction_prompt || '',
      notify_on_signature: s.notify_on_signature !== false,
      send_signed_pdf: s.send_signed_pdf !== false,
      request_documents: s.request_documents || false,
      document_types: s.document_types || [],
      custom_document_names: (s as any).custom_document_names || [],
      document_type_modes: (s as any).document_type_modes || {},
      assistant_type: s.assistant_type || 'document',
      base_prompt: s.base_prompt || '',
      model: s.model || 'google/gemini-2.5-flash',
      temperature: s.temperature ?? 0.7,
      max_tokens: (s as any).max_tokens ?? 2048,
      response_delay_seconds: s.response_delay_seconds ?? 2,
      skip_confirmation: (s as any).skip_confirmation ?? false,
      partial_min_fields: (s as any).partial_min_fields || [],
      split_messages: s.split_messages ?? false,
      split_delay_seconds: s.split_delay_seconds ?? 3,
      reply_with_audio: (s as any).reply_with_audio ?? false,
      reply_voice_id: (s as any).reply_voice_id || null,
      respond_in_groups: (s as any).respond_in_groups ?? false,
      max_tts_chars: (s as any).max_tts_chars ?? 1000,
      send_window_start_hour: (s as any).send_window_start_hour ?? 8,
      send_window_end_hour: (s as any).send_window_end_hour ?? 20,
      send_call_followup_audio: (s as any).send_call_followup_audio ?? false,
      zapsign_settings: (s as any).zapsign_settings || {},
    });
    setFollowupSteps(s.followup_steps || []);
    setHumanReplyPauseMinutes(s.human_reply_pause_minutes ?? 0);
    setFollowupRepeatForever((s as any).followup_repeat_forever ?? false);
    
    
    setEditingId(s.id);
    setShowForm(true);
    setFormSection('general');
  };

  const addStep = () => {
    setFollowupSteps(prev => [...prev, { action_type: 'whatsapp_message', delay_minutes: 60 }]);
  };

  const removeStep = (idx: number) => {
    setFollowupSteps(prev => prev.filter((_, i) => i !== idx));
  };

  const updateStep = (idx: number, field: string, value: any) => {
    setFollowupSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const moveStep = (idx: number, direction: 'up' | 'down') => {
    setFollowupSteps(prev => {
      const updated = [...prev];
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= updated.length) return prev;
      [updated[idx], updated[targetIdx]] = [updated[targetIdx], updated[idx]];
      return updated;
    });
  };

  const handleSave = async () => {
    if (!form.shortcut_name.trim()) { toast.error('Nome do agente é obrigatório'); return; }
    const payload = {
      shortcut_name: form.shortcut_name.trim(),
      description: form.description || null,
      template_token: showDocumentFields ? (form.template_token || null) : null,
      template_name: showDocumentFields ? (form.template_name || null) : null,
      prompt_instructions: form.prompt_instructions || null,
      media_extraction_prompt: form.media_extraction_prompt || null,
      followup_steps: followupSteps,
      human_reply_pause_minutes: humanReplyPauseMinutes,
      followup_repeat_forever: followupRepeatForever,
      notify_on_signature: form.notify_on_signature,
      send_signed_pdf: form.send_signed_pdf,
      request_documents: form.request_documents,
      document_types: form.document_types,
      custom_document_names: form.custom_document_names,
      document_type_modes: form.document_type_modes,
      assistant_type: form.assistant_type,
      base_prompt: form.base_prompt || null,
      model: form.model,
      temperature: form.temperature,
      max_tokens: form.max_tokens,
      response_delay_seconds: form.response_delay_seconds,
      split_messages: form.split_messages,
      split_delay_seconds: form.split_delay_seconds,
      command_scope: commandScope,
      reply_with_audio: form.reply_with_audio,
      reply_voice_id: form.reply_voice_id,
      respond_in_groups: form.respond_in_groups,
      max_tts_chars: form.max_tts_chars,
      send_window_start_hour: form.send_window_start_hour ?? 8,
      send_window_end_hour: form.send_window_end_hour ?? 20,
      send_call_followup_audio: form.send_call_followup_audio ?? false,
      skip_confirmation: form.skip_confirmation ?? false,
      zapsign_settings: form.zapsign_settings || {},
    };

    let error;
    if (editingId) {
      ({ error } = await (supabase.from('wjia_command_shortcuts') as any).update(payload).eq('id', editingId));
    } else {
      const { error: insertError } = await (supabase.from('wjia_command_shortcuts') as any)
        .insert({ ...payload, display_order: shortcuts.length }).select('id').single();
      error = insertError;
    }
    if (error) { toast.error(error.message); return; }

    // No separate filter save needed - filters are part of the view/base table

    toast.success(editingId ? 'Agente atualizado!' : 'Agente criado!');
    resetForm();
    onReload();
  };

  const handleDelete = async (id: string) => {
    await (supabase.from('wjia_command_shortcuts') as any).delete().eq('id', id);
    onReload();
    toast.success('Agente removido');
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await (supabase.from('wjia_command_shortcuts') as any).update({ is_active: !isActive }).eq('id', id);
    onReload();
  };

  const actionLabels: Record<string, { label: string; icon: any; color: string }> = {
    whatsapp_message: { label: 'Mensagem WhatsApp', icon: MessageSquare, color: 'text-green-500' },
    call: { label: 'Ligação', icon: Phone, color: 'text-blue-500' },
    create_activity: { label: 'Criar Atividade', icon: FileText, color: 'text-orange-500' },
  };

  const typeIcons: Record<string, string> = {
    document: '📄',
    assistant: '🤖',
    hybrid: '🔄',
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Agentes IA — cada um com IA, documentos e follow-up integrados.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setAiEditConfig(null); setEditingId(null); setShowAI(!showAI); setShowForm(false); }} className="gap-1">
            <Wand2 className="h-3.5 w-3.5" /> IA
          </Button>
          <Button size="sm" variant="outline" onClick={() => { resetForm(); setShowForm(!showForm); setShowAI(false); }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Novo
          </Button>
        </div>
      </div>

      {showAI && !aiEditConfig && (
        <AIShortcutGenerator
          existingConfig={null}
          templateFields={templateFields}
          templateName={form.template_name || undefined}
          onApply={(config) => {
            setForm(f => ({
              ...f,
              shortcut_name: config.shortcut_name,
              description: config.description || '',
              prompt_instructions: config.prompt_instructions,
              media_extraction_prompt: config.media_extraction_prompt || '',
            }));
            setFollowupSteps(config.followup_steps || []);
            setShowForm(true);
            setShowAI(false);
          }}
          onClose={() => { setShowAI(false); }}
        />
      )}

      {showForm && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-primary">{editingId ? '✏️ Editando agente' : '➕ Novo agente'}</p>
              <div className="flex gap-1">
                {(['general', 'ai', 'document', 'followup'] as const).map(sec => (
                  <Button
                    key={sec}
                    size="sm"
                    variant={formSection === sec ? 'default' : 'ghost'}
                    className="h-7 text-[10px] px-2"
                    onClick={() => setFormSection(sec)}
                  >
                    {sec === 'general' && '⚙️ Geral'}
                    {sec === 'ai' && '🧠 IA'}
                    {sec === 'document' && '📄 Documento'}
                    {sec === 'followup' && '🔔 Follow-up'}
                  </Button>
                ))}
              </div>
            </div>

            {/* GENERAL SECTION */}
            {formSection === 'general' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo de Assistente *</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {ASSISTANT_TYPES.map(t => (
                      <button
                        key={t.value}
                        onClick={() => setForm(f => ({ ...f, assistant_type: t.value }))}
                        className={`p-2 rounded-lg border text-left transition-all ${form.assistant_type === t.value ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border hover:border-primary/50'}`}
                      >
                        <p className="text-xs font-medium">{t.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nome do Agente *</Label>
                    <Input placeholder="Procuração Geral" value={form.shortcut_name} onChange={e => setForm(f => ({ ...f, shortcut_name: e.target.value }))} className="h-9" />
                    <p className="text-[10px] text-muted-foreground">Acionado por <strong>#nome</strong> no WhatsApp</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Descrição</Label>
                    <Input placeholder="Gera procuração ad judicia" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="h-9" />
                  </div>
                </div>
              </div>
            )}

            {/* AI SECTION */}
            {formSection === 'ai' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">🧠 Prompt do Agente</Label>
                  <p className="text-[10px] text-muted-foreground">Define a personalidade, tom, instruções de coleta e regras de comportamento do agente.</p>
                  <div className="relative">
                    <Textarea
                      placeholder="Você é um assistente jurídico profissional. Ao interagir com o cliente, colete nome completo, CPF, RG, endereço..."
                      value={form.prompt_instructions}
                      onChange={e => setForm(f => ({ ...f, prompt_instructions: e.target.value }))}
                      className="min-h-[120px] text-xs pr-8"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-primary"
                      onClick={() => setPromptSheetOpen(true)}
                      title="Expandir editor"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Modelo de IA</Label>
                    <Select value={form.model} onValueChange={v => setForm(f => ({ ...f, model: v }))}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MODELS.map(m => <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Temperatura: {form.temperature.toFixed(1)}</Label>
                    <Slider
                      value={[form.temperature]}
                      onValueChange={([v]) => setForm(f => ({ ...f, temperature: v }))}
                      min={0} max={1} step={0.1}
                      className="mt-2"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {form.temperature <= 0.3 ? 'Preciso e determinístico' : form.temperature >= 0.8 ? 'Criativo e variado' : 'Balanceado'}
                    </p>
                  </div>
                </div>
                {/* Response Limits Section */}
                <div className="space-y-3 border rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Maximize2 className="h-3.5 w-3.5 text-primary" />
                    <Label className="text-xs font-semibold">Limites de Resposta</Label>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px]">Tamanho máximo da resposta</Label>
                      <span className="text-[10px] font-mono text-muted-foreground">{form.max_tokens} tokens</span>
                    </div>
                    <Slider
                      value={[form.max_tokens]}
                      onValueChange={([v]) => setForm(f => ({ ...f, max_tokens: v }))}
                      min={256}
                      max={8192}
                      step={256}
                    />
                    {(() => {
                      const words = Math.floor(form.max_tokens * 0.75);
                      const readMin = Math.floor(words / 200);
                      const readSec = Math.round(((words / 200) % 1) * 60);
                      // Audio: ~130-160 palavras/min faladas, usamos 130 (min) e 160 (max)
                      const audioTotalSecLow = Math.round(words / 160 * 60);
                      const audioTotalSecHigh = Math.round(words / 130 * 60);
                      const fmtT = (s: number) => `${Math.floor(s / 60)}min ${s % 60}s`;
                      return (
                        <div className="text-[10px] text-muted-foreground text-center">
                          ≈ {words} palavras · {readMin}min {readSec}s de leitura
                          {form.reply_with_audio && (<> · {fmtT(audioTotalSecLow)}–{fmtT(audioTotalSecHigh)} de áudio total</>)}
                        </div>
                      );
                    })()}
                  </div>
                  {form.reply_with_audio && (() => {
                    const words = Math.floor(form.max_tokens * 0.75);
                    const totalChars = Math.floor(words * 0.8);
                    const parts = Math.max(1, Math.ceil(totalChars / form.max_tts_chars));
                    // Duração por parte baseada em palavras
                    const wordsPerPart = Math.round(words / parts);
                    const partSecLow = Math.round(wordsPerPart / 160 * 60);
                    const partSecHigh = Math.round(wordsPerPart / 130 * 60);
                    const fmtTime = (s: number) => s >= 60 ? `${Math.floor(s / 60)}min ${s % 60}s` : `${s}s`;
                    return (
                      <div className="space-y-1 pt-2 border-t border-border/50">
                        <Label className="text-[11px] flex items-center gap-1"><Volume2 className="h-3 w-3" />Dividir áudio em quantas partes?</Label>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={parts}
                          onChange={e => {
                            const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                            const newMax = Math.round(totalChars / v);
                            setForm(f => ({ ...f, max_tts_chars: Math.max(300, Math.min(5000, newMax)) }));
                          }}
                          className="h-9 text-xs w-20"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Cada parte ≈ {wordsPerPart} palavras · {fmtTime(partSecLow)}–{fmtTime(partSecHigh)} de áudio
                        </p>
                      </div>
                    );
                  })()}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Delay agrupamento (seg)</Label>
                    <Input
                      type="number" min={0} max={30}
                      value={form.response_delay_seconds}
                      onChange={e => setForm(f => ({ ...f, response_delay_seconds: parseInt(e.target.value) || 0 }))}
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-xs">Gerar com dados parciais</Label>
                        <p className="text-[10px] text-muted-foreground">Gera o link do documento mesmo com campos faltantes — o cliente preenche direto no formulário ZapSign</p>
                      </div>
                      <Switch checked={form.skip_confirmation ?? false} onCheckedChange={v => setForm(f => ({ ...f, skip_confirmation: v }))} />
                    </div>
                    {form.skip_confirmation && (
                      <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                        <Label className="text-[10px] font-semibold">Campos mínimos obrigatórios</Label>
                        <p className="text-[10px] text-muted-foreground">Selecione os campos que devem ser coletados antes de gerar o link</p>
                        <div className="grid grid-cols-2 gap-1">
                          {[
                            { key: 'NOME_COMPLETO', label: 'Nome completo' },
                            { key: 'CPF', label: 'CPF' },
                            { key: 'RG', label: 'RG' },
                            { key: 'NACIONALIDADE', label: 'Nacionalidade' },
                            { key: 'ESTADO_CIVIL', label: 'Estado civil' },
                            { key: 'PROFISSAO', label: 'Profissão' },
                            { key: 'ENDERECO_COMPLETO', label: 'Endereço' },
                            { key: 'CIDADE', label: 'Cidade' },
                            { key: 'UF', label: 'UF' },
                            { key: 'CEP', label: 'CEP' },
                            { key: 'DATA_NASCIMENTO', label: 'Data nascimento' },
                            { key: 'NOME_MAE', label: 'Nome da mãe' },
                            { key: 'EMAIL', label: 'E-mail' },
                            { key: 'TELEFONE', label: 'Telefone' },
                          ].map(field => {
                            const selected = (form as any).partial_min_fields || [];
                            const isChecked = selected.includes(field.key);
                            return (
                              <label key={field.key} className="flex items-center gap-1.5 text-[10px] cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    const newFields = isChecked
                                      ? selected.filter((f: string) => f !== field.key)
                                      : [...selected, field.key];
                                    setForm(f => ({ ...f, partial_min_fields: newFields } as any));
                                  }}
                                  className="rounded border-muted-foreground/30 h-3 w-3"
                                />
                                {field.label}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Dividir mensagens longas</Label>
                      <Switch checked={form.split_messages} onCheckedChange={v => setForm(f => ({ ...f, split_messages: v }))} />
                    </div>
                    {form.split_messages && (
                      <div className="space-y-1">
                        <Label className="text-[10px]">Delay entre partes (seg)</Label>
                        <Input
                          type="number" min={1} max={10}
                          value={form.split_delay_seconds}
                          onChange={e => setForm(f => ({ ...f, split_delay_seconds: parseInt(e.target.value) || 3 }))}
                          className="h-8 text-xs"
                        />
                      </div>
                    )}
                  </div>
                </div>
                {/* Respond in Groups + Audio Reply */}
                <div className="space-y-2 border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs">Responder em grupos</Label>
                      <p className="text-[10px] text-muted-foreground">Permite que o agente responda em grupos do WhatsApp</p>
                    </div>
                    <Switch checked={form.respond_in_groups} onCheckedChange={v => setForm(f => ({ ...f, respond_in_groups: v }))} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs">Responder com áudio</Label>
                      <p className="text-[10px] text-muted-foreground">Quando o contato enviar áudio, responde com áudio (ElevenLabs TTS)</p>
                    </div>
                    <Switch checked={form.reply_with_audio} onCheckedChange={v => setForm(f => ({ ...f, reply_with_audio: v }))} />
                  </div>
                  {form.reply_with_audio && (
                    <div className="space-y-1 pl-2 border-l-2 border-primary/20">
                      <Label className="text-xs flex items-center gap-1"><Volume2 className="h-3 w-3" />Voz do agente</Label>
                      <Select value={form.reply_voice_id || 'FGY2WhTYpPnrIDTdsKH5'} onValueChange={v => setForm(f => ({ ...f, reply_voice_id: v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione a voz" /></SelectTrigger>
                        <SelectContent>
                          {availableVoices.map(v => (
                            <SelectItem key={v.id} value={v.id} className="text-xs">{v.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">Vozes personalizadas aparecem com 🎤</p>
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">🔍 Prompt de Extração de Mídia</Label>
                    <Badge variant="outline" className="text-[9px] h-4">OCR</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Instruções de como a IA deve interpretar documentos (RG, CNH, comprovantes).
                  </p>
                  <Textarea
                    placeholder="Ex: O NOME DO TITULAR está em letras vermelhas no campo 'NOME'. O campo 'FILIAÇÃO' são os pais..."
                    value={form.media_extraction_prompt}
                    onChange={e => setForm(f => ({ ...f, media_extraction_prompt: e.target.value }))}
                    className="min-h-[80px] text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {/* DOCUMENT SECTION */}
            {formSection === 'document' && (
              <div className="space-y-3">
                {!showDocumentFields ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p>Seção de documentos disponível para assistentes do tipo</p>
                    <p className="font-medium">📄 Gerador de Documentos ou 🔄 Híbrido</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs">Modelo ZapSign</Label>
                      {loadingTemplates ? (
                        <div className="h-9 flex items-center text-xs text-muted-foreground">Carregando modelos...</div>
                      ) : (
                        <Select
                          value={form.template_token}
                          onValueChange={async (v) => {
                            const tmpl = zapsignTemplates.find(t => t.token === v);
                            setForm(f => ({ ...f, template_token: v, template_name: tmpl?.name || '' }));
                            // Fetch template fields
                            setTemplateFields([]);
                            setLoadingFields(true);
                            try {
                              const { data, error } = await cloudFunctions.invoke('zapsign-api', {
                                body: { action: 'get_template', template_token: v }
                              });
                              if (!error && data?.success && data.fields) {
                                setTemplateFields(data.fields);
                              }
                            } catch (e) { console.error('Error fetching template fields:', e); }
                            setLoadingFields(false);
                          }}
                        >
                          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione um modelo..." /></SelectTrigger>
                          <SelectContent>
                            {zapsignTemplates.map(t => (
                              <SelectItem key={t.token} value={t.token} className="text-xs">{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {form.template_name && (
                        <p className="text-[10px] text-muted-foreground">✅ {form.template_name}</p>
                      )}
                      {loadingFields && (
                        <p className="text-[10px] text-muted-foreground animate-pulse">Carregando campos do modelo...</p>
                      )}
                      {templateFields.length > 0 && (
                        <div className="border rounded-lg p-2 bg-muted/20 space-y-2">
                          <p className="text-[10px] font-medium text-muted-foreground">📋 Campos do modelo ({templateFields.length}):</p>
                          <div className="flex flex-wrap gap-1">
                            {templateFields.map((f, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                {f.variable.replace(/\{\{|\}\}/g, '')}
                                {f.required && <span className="text-destructive ml-0.5">*</span>}
                              </span>
                            ))}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full text-[10px] h-7"
                            onClick={() => {
                              const fieldsList = templateFields
                                .map(f => `- ${f.variable.replace(/\{\{|\}\}/g, '')} (${f.label || 'sem label'})${f.required ? ' [OBRIGATÓRIO]' : ' [opcional]'}`)
                                .join('\n');
                              const block = `\n\n=== CAMPOS DO DOCUMENTO ZAPSIGN ===\nEstes são os ÚNICOS campos que você precisa coletar do cliente para preencher o documento "${form.template_name || 'Procuração'}":\n${fieldsList}\n\nREGRAS IMPORTANTES:\n- Pergunte SOMENTE os campos listados acima. NÃO peça dados extras como nome da mãe, RG, etc. que não estejam na lista.\n- Campos como DATA_ASSINATURA ou DATA_PROCURACAO são preenchidos automaticamente com a data de hoje — NÃO pergunte.\n- NUNCA invente ou gere links de assinatura. O link será gerado automaticamente pelo sistema após a coleta.\n- Quando tiver todos os dados obrigatórios, confirme com o cliente e diga que vai preparar o documento.\n=== FIM DOS CAMPOS ===`;
                              
                              // Remove existing block if present
                              const existing = form.prompt_instructions || '';
                              const cleaned = existing.replace(/\n?\n?=== CAMPOS DO DOCUMENTO ZAPSIGN ===[\s\S]*?=== FIM DOS CAMPOS ===/g, '').trimEnd();
                              setForm(f => ({ ...f, prompt_instructions: cleaned + block }));
                              toast.success('Bloco de campos ZapSign inserido no prompt!');
                            }}
                          >
                            {(form.prompt_instructions || '').includes('=== CAMPOS DO DOCUMENTO ZAPSIGN ===')
                              ? '🔄 Atualizar bloco de campos no prompt'
                              : '📥 Inserir campos no prompt'}
                          </Button>
                        </div>
                      )}
                    </div>
                    {form.template_token && (
                      <>
                        <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                          <Label className="text-xs font-semibold">📋 Após assinatura do documento</Label>
                          <div className="flex items-center gap-2">
                            <Checkbox id="notify_on_signature" checked={form.notify_on_signature} onCheckedChange={(checked) => setForm(f => ({ ...f, notify_on_signature: !!checked }))} />
                            <Label htmlFor="notify_on_signature" className="text-xs cursor-pointer">Avisar quando o documento for assinado</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox id="send_signed_pdf" checked={form.send_signed_pdf} onCheckedChange={(checked) => setForm(f => ({ ...f, send_signed_pdf: !!checked }))} />
                            <Label htmlFor="send_signed_pdf" className="text-xs cursor-pointer">Enviar o PDF assinado via WhatsApp</Label>
                          </div>
                        </div>
                        <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                          <div className="flex items-center gap-2">
                            <Checkbox id="request_documents" checked={form.request_documents} onCheckedChange={(checked) => setForm(f => ({ ...f, request_documents: !!checked }))} />
                            <Label htmlFor="request_documents" className="text-xs font-semibold cursor-pointer">📎 Solicitar documentos do cliente</Label>
                          </div>
                          {form.request_documents && (
                            <div className="ml-6 space-y-2">
                              <p className="text-[10px] text-muted-foreground">Selecione os tipos:</p>
                              {[
                                { key: 'rg_cnh', label: 'RG / CNH (identidade)' },
                                { key: 'comprovante_endereco', label: 'Comprovante de endereço' },
                                { key: 'comprovante_renda', label: 'Comprovante de renda' },
                                { key: 'outros', label: 'Outros documentos' },
                              ].map(docType => (
                                <div key={docType.key} className="flex items-center gap-2 flex-wrap">
                                  <Checkbox
                                    id={`doc_${docType.key}`}
                                    checked={form.document_types.includes(docType.key)}
                                    onCheckedChange={(checked) => {
                                      setForm(f => ({
                                        ...f,
                                        document_types: checked
                                          ? [...f.document_types, docType.key]
                                          : f.document_types.filter(t => t !== docType.key),
                                        document_type_modes: checked
                                          ? { ...f.document_type_modes, [docType.key]: f.document_type_modes[docType.key] || 'required' }
                                          : (() => { const m = { ...f.document_type_modes }; delete m[docType.key]; return m; })(),
                                      }));
                                    }}
                                  />
                                  <Label htmlFor={`doc_${docType.key}`} className="text-xs cursor-pointer">{docType.label}</Label>
                                  {form.document_types.includes(docType.key) && (
                                    <Select
                                      value={form.document_type_modes[docType.key] || 'required'}
                                      onValueChange={(val) => setForm(f => ({
                                        ...f,
                                        document_type_modes: { ...f.document_type_modes, [docType.key]: val as 'required' | 'optional' },
                                      }))}
                                    >
                                      <SelectTrigger className="h-6 w-[110px] text-[10px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="required" className="text-xs">📎 Obrigatório</SelectItem>
                                        <SelectItem value="optional" className="text-xs">💬 Opcional</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  )}
                                  {form.document_types.includes(docType.key) && form.document_type_modes[docType.key] === 'optional' && (
                                    <p className="text-[9px] text-muted-foreground w-full ml-6">Cliente pode informar os dados por mensagem</p>
                                  )}
                                </div>
                              ))}
                              {form.document_types.includes('outros') && (
                                <div className="ml-6 space-y-2">
                                  <p className="text-[10px] text-muted-foreground">Nomes dos documentos adicionais:</p>
                                  {(form.custom_document_names || []).map((name, idx) => (
                                    <div key={idx} className="flex items-center gap-1">
                                      <Input
                                        value={name}
                                        onChange={e => {
                                          const updated = [...form.custom_document_names];
                                          updated[idx] = e.target.value;
                                          setForm(f => ({ ...f, custom_document_names: updated }));
                                        }}
                                        placeholder="Ex: Certidão de nascimento"
                                        className="h-7 text-xs flex-1"
                                      />
                                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
                                        setForm(f => ({ ...f, custom_document_names: f.custom_document_names.filter((_, i) => i !== idx) }));
                                      }}>
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ))}
                                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
                                    setForm(f => ({ ...f, custom_document_names: [...(f.custom_document_names || []), ''] }));
                                  }}>
                                    <Plus className="h-3 w-3 mr-1" /> Adicionar documento
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* ZAPSIGN ADVANCED SETTINGS */}
                        <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                          <Label className="text-xs font-semibold">⚙️ Configurações Avançadas ZapSign</Label>
                          
                          {/* Security */}
                          <div className="space-y-2">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase">🔒 Segurança</p>
                            <div className="flex items-center gap-2">
                              <Checkbox id="zs_lock_name" checked={form.zapsign_settings.lock_name || false} onCheckedChange={(c) => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, lock_name: !!c } }))} />
                              <Label htmlFor="zs_lock_name" className="text-xs cursor-pointer">Bloquear alteração do nome</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox id="zs_lock_phone" checked={form.zapsign_settings.lock_phone || false} onCheckedChange={(c) => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, lock_phone: !!c } }))} />
                              <Label htmlFor="zs_lock_phone" className="text-xs cursor-pointer">Bloquear alteração do telefone</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox id="zs_require_cpf" checked={form.zapsign_settings.require_cpf || false} onCheckedChange={(c) => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, require_cpf: !!c } }))} />
                              <Label htmlFor="zs_require_cpf" className="text-xs cursor-pointer">Solicitar CPF do signatário</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox id="zs_validate_cpf" checked={form.zapsign_settings.validate_cpf || false} onCheckedChange={(c) => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, validate_cpf: !!c } }))} />
                              <Label htmlFor="zs_validate_cpf" className="text-xs cursor-pointer">Validar CPF na Receita Federal</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox id="zs_require_selfie" checked={form.zapsign_settings.require_selfie_photo || false} onCheckedChange={(c) => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, require_selfie_photo: !!c } }))} />
                              <Label htmlFor="zs_require_selfie" className="text-xs cursor-pointer">Exigir selfie na assinatura</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox id="zs_require_doc_photo" checked={form.zapsign_settings.require_document_photo || false} onCheckedChange={(c) => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, require_document_photo: !!c } }))} />
                              <Label htmlFor="zs_require_doc_photo" className="text-xs cursor-pointer">Exigir foto de documento (RG/CNH)</Label>
                            </div>
                          </div>

                          {/* Branding */}
                          <div className="space-y-2">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase">🎨 Personalização</p>
                            <div className="space-y-1">
                              <Label className="text-[10px]">Nome da marca (e-mails)</Label>
                              <Input value={form.zapsign_settings.brand_name || ''} onChange={e => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, brand_name: e.target.value || undefined } }))} placeholder="Ex: Prudêncio Advocacia" className="h-7 text-xs" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px]">URL do logo</Label>
                              <Input value={form.zapsign_settings.brand_logo || ''} onChange={e => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, brand_logo: e.target.value || undefined } }))} placeholder="https://seusite.com/logo.png" className="h-7 text-xs" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px]">Cor primária (hex)</Label>
                              <Input value={form.zapsign_settings.brand_primary_color || ''} onChange={e => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, brand_primary_color: e.target.value || undefined } }))} placeholder="#0011ee" className="h-7 text-xs" />
                            </div>
                          </div>

                          {/* Organization */}
                          <div className="space-y-2">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase">📁 Organização</p>
                            <div className="space-y-1">
                              <Label className="text-[10px]">Pasta no ZapSign</Label>
                              <Input value={form.zapsign_settings.folder_path || ''} onChange={e => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, folder_path: e.target.value || undefined } }))} placeholder="/clientes/procuracoes/" className="h-7 text-xs" />
                              <p className="text-[9px] text-muted-foreground">Use {'{{LEAD_NAME}}'} para nome do lead</p>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px]">Prazo para assinar (dias)</Label>
                              <Input type="number" min={0} value={form.zapsign_settings.date_limit_days || ''} onChange={e => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, date_limit_days: parseInt(e.target.value) || undefined } }))} placeholder="7" className="h-7 text-xs w-24" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px]">Link de redirecionamento pós-assinatura</Label>
                              <Input value={form.zapsign_settings.redirect_link || ''} onChange={e => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, redirect_link: e.target.value || undefined } }))} placeholder="https://seusite.com/obrigado" className="h-7 text-xs" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px]">Observadores (e-mails, separados por vírgula)</Label>
                              <Input value={(form.zapsign_settings.observers || []).join(', ')} onChange={e => setForm(f => ({ ...f, zapsign_settings: { ...f.zapsign_settings, observers: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) } }))} placeholder="advogado@email.com, assistente@email.com" className="h-7 text-xs" />
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* FOLLOWUP SECTION */}
            {formSection === 'followup' && (
              <div className="space-y-3">
                <div className="border rounded-lg p-3 space-y-2">
                  <Label className="text-xs font-semibold">🕐 Janela de follow-up</Label>
                  <p className="text-[9px] text-muted-foreground">Horário permitido para follow-ups. Respostas ao cliente funcionam em qualquer horário.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Início ({String(form.send_window_start_hour ?? 8).padStart(2, '0')}:00)</Label>
                      <Input type="number" min={0} max={23} value={form.send_window_start_hour ?? 8} onChange={e => setForm(f => ({ ...f, send_window_start_hour: parseInt(e.target.value) || 8 }))} className="h-9 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Fim ({String(form.send_window_end_hour ?? 20).padStart(2, '0')}:00)</Label>
                      <Input type="number" min={0} max={23} value={form.send_window_end_hour ?? 20} onChange={e => setForm(f => ({ ...f, send_window_end_hour: parseInt(e.target.value) || 20 }))} className="h-9 text-xs" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-primary" />
                    <Label className="text-xs font-semibold">Follow-up Automático</Label>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Cobranças quando o cliente não responde/assina</p>
                </div>

                {followupSteps.map((step, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 p-3 rounded-lg border bg-muted/30"
                  >
                    <div className="flex flex-col items-center gap-0.5 mt-1">
                      <Badge variant="secondary" className="text-[10px] h-5 w-5 p-0 flex items-center justify-center">{idx + 1}</Badge>
                      <Button variant="ghost" size="icon" className="h-5 w-5" disabled={idx === 0} onClick={() => moveStep(idx, 'up')}>
                        <ChevronUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-5 w-5" disabled={idx === followupSteps.length - 1} onClick={() => moveStep(idx, 'down')}>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px]">Ação</Label>
                          <Select value={step.action_type} onValueChange={v => updateStep(idx, 'action_type', v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="whatsapp_message">📱 Mensagem WhatsApp</SelectItem>
                              <SelectItem value="call">📞 Ligação</SelectItem>
                              <SelectItem value="create_activity">📋 Criar Atividade</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px]">Aguardar (minutos)</Label>
                          <p className="text-[9px] text-muted-foreground">Após a ação anterior (ou última msg do cliente na 1ª etapa)</p>
                          <Input
                            type="number" min={5}
                            value={step.delay_minutes}
                            onChange={e => {
                              const val = e.target.value;
                              updateStep(idx, 'delay_minutes', val === '' ? '' : (parseInt(val) || 0));
                            }}
                            onBlur={() => {
                              if (!step.delay_minutes || step.delay_minutes < 1) {
                                updateStep(idx, 'delay_minutes', 5);
                              }
                            }}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                      {step.action_type === 'call' && (
                        <div className="space-y-1">
                          <p className="text-[9px] text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-1.5 rounded flex items-start gap-1">
                            📞 Ligação automática: o sistema liga para o lead e aguarda até a chamada ser finalizada (atendida ou não). Após a ligação, pode enviar um áudio de follow-up no WhatsApp.
                          </p>
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px]">📞 Enviar áudio pós-ligação</Label>
                            <Switch 
                              checked={form.send_call_followup_audio ?? false} 
                              onCheckedChange={v => setForm(f => ({ ...f, send_call_followup_audio: v }))} 
                            />
                          </div>
                          <p className="text-[9px] text-muted-foreground">Após o toque, envia um áudio automático avisando que tentou ligar</p>
                        </div>
                      )}
                      {step.action_type === 'create_activity' && (
                        <div className="space-y-1">
                          <Label className="text-[10px]">Atribuir a</Label>
                          <Select value={step.assigned_to || ''} onValueChange={v => updateStep(idx, 'assigned_to', v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__self__">👤 Próprio usuário</SelectItem>
                              {profiles.map(p => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => removeStep(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={addStep} className="w-full">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Etapa de Follow-up
                </Button>

                {followupSteps.length > 0 && (
                  <div className="p-2 rounded-lg border bg-muted/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                        <div>
                          <Label className="text-[10px]">Repetir infinitamente</Label>
                          <p className="text-[9px] text-muted-foreground">Repete as etapas em loop até o contato bloquear ou responder</p>
                        </div>
                      </div>
                      <Switch checked={followupRepeatForever} onCheckedChange={setFollowupRepeatForever} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                        <Label className="text-[10px]">Pausar follow-up quando humano responder</Label>
                      </div>
                      <Switch checked={humanReplyPauseMinutes > 0} onCheckedChange={(v) => setHumanReplyPauseMinutes(v ? 60 : 0)} />
                    </div>
                    {humanReplyPauseMinutes > 0 && (
                      <div className="flex items-center gap-2 ml-5">
                        <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Pausar por</Label>
                        <Input
                          type="number" min={1}
                          value={humanReplyPauseMinutes}
                          onChange={e => setHumanReplyPauseMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                          className="h-7 w-20 text-xs"
                        />
                        <span className="text-[10px] text-muted-foreground">minutos</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end border-t pt-3">
              <Button size="sm" variant="ghost" onClick={resetForm}>Cancelar</Button>
              <Button size="sm" onClick={handleSave}>{editingId ? 'Atualizar' : 'Salvar'}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {shortcuts.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
          <Zap className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
          Nenhum agente configurado
        </CardContent></Card>
      ) : shortcuts.map(s => (
        <Card key={s.id} className={!s.is_active ? 'opacity-50' : ''}>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <span className="text-lg shrink-0">{typeIcons[s.assistant_type] || '📄'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">#{s.shortcut_name}</span>
                  {s.template_name && <Badge variant="secondary" className="text-[10px]">{s.template_name}</Badge>}
                  <Badge variant="outline" className="text-[10px]">
                    {MODELS.find(m => m.value === s.model)?.label || s.model}
                  </Badge>
                </div>
                {s.description && <p className="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>}
                {s.prompt_instructions && (
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate max-w-[300px]">
                    💡 {s.prompt_instructions.slice(0, 80)}
                  </p>
                )}
              </div>
              <Switch checked={s.is_active} onCheckedChange={() => handleToggle(s.id, s.is_active)} />
              <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => startAIEdit(s)} title="Editar com IA">
                <Wand2 className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(s)} title="Editar manual">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(s.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {s.followup_steps && s.followup_steps.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap mt-2 ml-7">
                <Bell className="h-3 w-3 text-muted-foreground" />
                {s.followup_steps.map((step, idx) => {
                  const info = actionLabels[step.action_type] || actionLabels.whatsapp_message;
                  const Icon = info.icon;
                  return (
                    <div key={idx} className="flex items-center gap-1">
                      {idx > 0 && <span className="text-[10px] text-muted-foreground">→</span>}
                      <Badge variant="outline" className="text-[10px] h-5 gap-1">
                        <Icon className={`h-3 w-3 ${info.color}`} />
                        {step.delay_minutes >= 60 ? `${Math.round(step.delay_minutes / 60)}h` : `${step.delay_minutes}min`}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Inline AI editor */}
            {showAI && aiEditConfig?.shortcut_name === s.shortcut_name && (
              <div className="mt-3">
                <AIShortcutGenerator
                  existingConfig={aiEditConfig}
                  templateFields={templateFields}
                  templateName={form.template_name || s.template_name || undefined}
                  onApply={(config) => {
                    setForm(f => ({
                      ...f,
                      shortcut_name: config.shortcut_name,
                      description: config.description || '',
                      prompt_instructions: config.prompt_instructions,
                      media_extraction_prompt: config.media_extraction_prompt || f.media_extraction_prompt,
                    }));
                    setFollowupSteps(config.followup_steps || []);
                    setEditingId(s.id);
                    setShowForm(true);
                    setShowAI(false);
                    setAiEditConfig(null);
                  }}
                  onClose={() => { setShowAI(false); setAiEditConfig(null); }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Sheet open={promptSheetOpen} onOpenChange={setPromptSheetOpen}>
        <SheetContent side="right" className="w-[500px] sm:w-[600px] flex flex-col p-0">
          <SheetHeader className="px-6 py-4 border-b shrink-0">
            <SheetTitle className="text-sm flex items-center gap-2">
              🧠 Prompt do Agente
            </SheetTitle>
            <p className="text-xs text-muted-foreground">Edite o prompt com mais espaço. As alterações são aplicadas em tempo real.</p>
          </SheetHeader>
          <div className="flex-1 p-4 overflow-hidden">
            <Textarea
              value={form.prompt_instructions}
              onChange={e => setForm(f => ({ ...f, prompt_instructions: e.target.value }))}
              placeholder="Você é um assistente jurídico profissional..."
              className="h-full w-full resize-none text-sm font-mono leading-relaxed"
            />
          </div>
          <div className="px-6 py-3 border-t shrink-0 flex items-center justify-between text-xs text-muted-foreground">
            <span>{form.prompt_instructions?.length || 0} caracteres</span>
            <Button size="sm" onClick={() => setPromptSheetOpen(false)}>Fechar</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
