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
  ChevronUp, ChevronDown, Eye
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AIShortcutGenerator } from './AIShortcutGenerator';
import { SuperPromptDiagnostic } from './SuperPromptDiagnostic';
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
  partial_min_fields: string[];
  history_limit: number;
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

/** Typed form state — every key used in setForm/form.X must exist here */
interface ShortcutFormState {
  shortcut_name: string;
  description: string;
  template_token: string;
  template_name: string;
  prompt_instructions: string;
  media_extraction_prompt: string;
  notify_on_signature: boolean;
  send_signed_pdf: boolean;
  request_documents: boolean;
  document_types: string[];
  custom_document_names: string[];
  document_type_modes: Record<string, 'required' | 'optional'>;
  assistant_type: string;
  base_prompt: string;
  agent_name: string;
  model: string;
  temperature: number;
  max_tokens: number;
  response_delay_seconds: number;
  skip_confirmation: boolean;
  partial_min_fields: string[];
  history_limit: number;
  split_messages: boolean;
  split_delay_seconds: number;
  reply_with_audio: boolean;
  reply_voice_id: string | null;
  respond_in_groups: boolean;
  max_tts_chars: number;
  send_window_start_hour: number;
  send_window_end_hour: number;
  send_call_followup_audio: boolean;
  zapsign_mode: 'final_document' | 'prefilled_form';
  zapsign_settings: Record<string, any>;
}

const DEFAULT_FORM: ShortcutFormState = {
  shortcut_name: '', description: '', template_token: '', template_name: '',
  prompt_instructions: '', media_extraction_prompt: '',
  notify_on_signature: true, send_signed_pdf: true,
  request_documents: false, document_types: [], custom_document_names: [],
  document_type_modes: {},
  assistant_type: 'document', base_prompt: '', agent_name: '',
  model: 'google/gemini-2.5-flash', temperature: 0.7, max_tokens: 2048,
  response_delay_seconds: 2, skip_confirmation: false, partial_min_fields: [],
  history_limit: 50, split_messages: false, split_delay_seconds: 3,
  reply_with_audio: false, reply_voice_id: null, respond_in_groups: false,
  max_tts_chars: 1000, send_window_start_hour: 8, send_window_end_hour: 20,
  send_call_followup_audio: false, zapsign_mode: 'final_document', zapsign_settings: {},
};

interface Profile { user_id: string; full_name: string | null; }
interface ZapSignTemplateOption { token: string; name: string; }
type PredefinedFieldMode = 'today' | 'brazilian_nationality' | 'client_phone' | 'fixed_value';
interface PredefinedFieldConfig {
  field: string;
  mode: PredefinedFieldMode;
  value?: string;
}

const PREDEFINED_FIELD_MODE_OPTIONS: { value: PredefinedFieldMode; label: string; description: string }[] = [
  { value: 'today', label: 'Data de hoje', description: 'Preenche com a data atual no formato DD/MM/AAAA' },
  { value: 'brazilian_nationality', label: 'Nacionalidade brasileira', description: 'Preenche com Brasileiro(a)' },
  { value: 'client_phone', label: 'Telefone do cliente (WhatsApp)', description: 'Preenche com o número do cliente na conversa' },
  { value: 'fixed_value', label: 'Valor fixo', description: 'Permite definir qualquer valor manualmente' },
];

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
        history_limit: (s as any).history_limit ?? 50,
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
  
  const [form, setForm] = useState<ShortcutFormState>({ ...DEFAULT_FORM });
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
  const [superPromptPreviewOpen, setSuperPromptPreviewOpen] = useState(false);

  const templateFieldOptions = templateFields.map((field) => ({
    key: field.variable.replace(/\{\{|\}\}/g, ''),
    label: field.label || field.variable.replace(/\{\{|\}\}/g, ''),
    required: field.required,
  }));

  const predefinedFieldConfigs = Array.isArray((form.zapsign_settings as any)?.predefined_fields)
    ? ((form.zapsign_settings as any).predefined_fields as PredefinedFieldConfig[])
    : [];

  const updatePredefinedFields = (updater: (current: PredefinedFieldConfig[]) => PredefinedFieldConfig[]) => {
    setForm((currentForm) => {
      const current = Array.isArray((currentForm.zapsign_settings as any)?.predefined_fields)
        ? ([...(currentForm.zapsign_settings as any).predefined_fields] as PredefinedFieldConfig[])
        : [];
      const next = updater(current);
      const nextSettings = { ...(currentForm.zapsign_settings || {}) } as Record<string, any>;

      if (next.length > 0) {
        nextSettings.predefined_fields = next;
      } else {
        delete nextSettings.predefined_fields;
      }

      return {
        ...currentForm,
        zapsign_settings: nextSettings,
      };
    });
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

  const loadTemplateFields = useCallback(async (templateToken: string) => {
    if (!templateToken) {
      setTemplateFields([]);
      return;
    }

    setLoadingFields(true);
    try {
      const { data, error } = await cloudFunctions.invoke('zapsign-api', {
        body: { action: 'get_template', template_token: templateToken }
      });

      if (!error && data?.success && Array.isArray(data.fields)) {
        setTemplateFields(data.fields);
      } else {
        setTemplateFields([]);
      }
    } catch (e) {
      console.error('Error fetching template fields:', e);
      setTemplateFields([]);
    } finally {
      setLoadingFields(false);
    }
  }, []);

  useEffect(() => {
    if (showForm && (form.assistant_type === 'document' || form.assistant_type === 'hybrid')) {
      loadZapSignTemplates();
    }
  }, [showForm, form.assistant_type, loadZapSignTemplates]);

  useEffect(() => {
    if (!showForm || !(form.assistant_type === 'document' || form.assistant_type === 'hybrid')) {
      return;
    }

    if (!form.template_token) {
      setTemplateFields([]);
      return;
    }

    void loadTemplateFields(form.template_token);
  }, [showForm, form.assistant_type, form.template_token, loadTemplateFields]);

  const showDocumentFields = form.assistant_type === 'document' || form.assistant_type === 'hybrid';
  const showAssistantFields = form.assistant_type === 'assistant' || form.assistant_type === 'hybrid';

  const resetForm = () => {
    setTemplateFields([]);
    setForm({ ...DEFAULT_FORM });
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
      ...DEFAULT_FORM,
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
      agent_name: (s as any).agent_name || s.shortcut_name || '',
      model: s.model || 'google/gemini-2.5-flash',
      temperature: s.temperature ?? 0.7,
      max_tokens: (s as any).max_tokens ?? 2048,
      response_delay_seconds: s.response_delay_seconds ?? 2,
      skip_confirmation: (s as any).skip_confirmation ?? false,
      partial_min_fields: (s as any).partial_min_fields || [],
      history_limit: (s as any).history_limit ?? 50,
      split_messages: s.split_messages ?? false,
      split_delay_seconds: s.split_delay_seconds ?? 3,
      reply_with_audio: (s as any).reply_with_audio ?? false,
      reply_voice_id: (s as any).reply_voice_id || null,
      respond_in_groups: (s as any).respond_in_groups ?? false,
      max_tts_chars: (s as any).max_tts_chars ?? 1000,
      send_window_start_hour: (s as any).send_window_start_hour ?? 8,
      send_window_end_hour: (s as any).send_window_end_hour ?? 20,
      send_call_followup_audio: (s as any).send_call_followup_audio ?? false,
      zapsign_mode: (s as any).zapsign_mode || 'final_document',
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
      partial_min_fields: (form as any).partial_min_fields || [],
      history_limit: (form as any).history_limit ?? 50,
      zapsign_mode: (form as any).zapsign_mode || 'final_document',
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs gap-1.5"
                    onClick={() => setSuperPromptPreviewOpen(true)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    🔍 Diagnóstico do Agente
                  </Button>
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
                <div className="space-y-1">
                  <Label className="text-xs">Mensagens do histórico para extração</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={0} max={200}
                      value={(form as any).history_limit ?? 50}
                      onChange={e => setForm(f => ({ ...f, history_limit: parseInt(e.target.value) || 0 } as any))}
                      className="h-9 text-xs w-24"
                    />
                    <p className="text-[10px] text-muted-foreground">0 = não usa histórico</p>
                  </div>
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
                            await loadTemplateFields(v);
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
