import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Hash, Type, Eye, MessageSquare, FileText, Volume2, Sparkles, Send, Zap, Scale, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { OnboardingMeetingConfig } from './OnboardingMeetingConfig';

interface Instance {
  id: string;
  instance_name: string;
  owner_phone: string | null;
}

interface Board {
  id: string;
  name: string;
  board_type?: string;
  product_service_id?: string | null;
}

interface InstanceConfig {
  role_title: string;
  role_description: string;
}

interface ProcessWorkflow {
  workflow_board_id: string;
  activities: ProcessActivity[];
  use_ai_activities?: boolean;
  ai_activities_prompt?: string;
}

interface GroupSettings {
  group_name_prefix: string;
  closed_group_name_prefix: string;
  sequence_start: number;
  current_sequence: number;
  closed_sequence_start: number;
  closed_current_sequence: number;
  lead_fields: string[];
  initial_message_template: string;
  use_ai_message: boolean;
  ai_generated_message: string;
  forward_document_types: string[];
  send_audio_message: boolean;
  audio_voice_id: string;
  auto_close_lead_on_sign: boolean;
  auto_create_group_on_sign: boolean;
  auto_create_process: boolean;
  process_nucleus_id: string;
  process_workflow_board_id: string;
  process_auto_activities: ProcessActivity[];
  process_workflows: ProcessWorkflow[];
}

interface ProcessActivity {
  title: string;
  activity_type: string;
  assigned_to: string;
  deadline_days: number;
  priority: string;
}

const LEAD_FIELD_OPTIONS = [
  { value: 'lead_name', label: 'Nome do Lead' },
  { value: 'victim_name', label: 'Nome da Vítima' },
  { value: 'lead_phone', label: 'Telefone' },
  { value: 'case_type', label: 'Tipo de Caso' },
  { value: 'city', label: 'Cidade' },
  { value: 'state', label: 'Estado' },
  { value: 'source', label: 'Origem' },
  { value: 'case_number', label: 'Número do Caso' },
  { value: 'main_company', label: 'Empresa Principal' },
  { value: 'contractor_company', label: 'Empresa Contratante' },
  { value: 'sector', label: 'Setor' },
  { value: 'neighborhood', label: 'Bairro' },
];

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'procuracao', label: 'Procuração' },
  { value: 'rg', label: 'RG' },
  { value: 'cpf', label: 'CPF' },
  { value: 'cnh', label: 'CNH' },
  { value: 'comprovante_endereco', label: 'Comprovante de Endereço' },
  { value: 'laudo_medico', label: 'Laudo Médico' },
  { value: 'cat', label: 'CAT' },
  { value: 'contrato', label: 'Contrato' },
  { value: 'zapsign_signed', label: 'Documento Assinado (ZapSign)' },
  { value: 'outros', label: 'Outros documentos' },
];

const MESSAGE_VARIABLES = [
  { var: '{lead_name}', label: 'Nome do Lead' },
  { var: '{victim_name}', label: 'Nome da Vítima' },
  { var: '{case_type}', label: 'Tipo de Caso' },
  { var: '{city}', label: 'Cidade' },
  { var: '{state}', label: 'Estado' },
  { var: '{case_number}', label: 'Nº do Caso' },
  { var: '{group_name}', label: 'Nome do Grupo' },
  { var: '{board_name}', label: 'Nome do Funil' },
];

const VOICE_OPTIONS = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Feminina)' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George (Masculina)' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel (Masculina)' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily (Feminina)' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda (Feminina)' },
  { id: 'bIHbv24MWmeRgasZH58o', name: 'Will (Masculina)' },
];

export function BoardGroupInstancesConfig() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<string>('');
  const [linkedInstances, setLinkedInstances] = useState<string[]>([]);
  const [instanceConfigs, setInstanceConfigs] = useState<Record<string, InstanceConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customVoices, setCustomVoices] = useState<{id: string; name: string}[]>([]);
  const [settings, setSettings] = useState<GroupSettings>({
    group_name_prefix: '',
    closed_group_name_prefix: '',
    sequence_start: 1,
    current_sequence: 0,
    closed_sequence_start: 1,
    closed_current_sequence: 0,
    lead_fields: ['lead_name'],
    initial_message_template: '',
    use_ai_message: false,
    ai_generated_message: '',
    forward_document_types: [],
    send_audio_message: false,
    audio_voice_id: '',
    auto_close_lead_on_sign: false,
    auto_create_group_on_sign: false,
    auto_create_process: false,
    process_nucleus_id: '',
    process_workflow_board_id: '',
    process_auto_activities: [],
    process_workflows: [],
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [refineInput, setRefineInput] = useState('');
  const [refineLoading, setRefineLoading] = useState(false);
  const [adminNotes, setAdminNotes] = useState<string | null>(null);
  const [nuclei, setNuclei] = useState<{id: string; name: string; prefix: string}[]>([]);
  const [teamMembers, setTeamMembers] = useState<{user_id: string; full_name: string}[]>([]);
  const [products, setProducts] = useState<{id: string; name: string; nucleus_id: string | null}[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedBoard) {
      fetchLinked();
      fetchSettings();
    }
  }, [selectedBoard]);

  const fetchData = async () => {
    setLoading(true);
    const [boardsRes, instancesRes, voicesRes, nucleiRes, profilesRes, productsRes] = await Promise.all([
      (supabase as any).from('kanban_boards').select('id, name, board_type, product_service_id').order('display_order'),
      (supabase as any).from('whatsapp_instances').select('id, instance_name, owner_phone').eq('is_active', true),
      (supabase as any).from('custom_voices').select('id, name, elevenlabs_voice_id').eq('status', 'ready'),
      (supabase as any).from('specialized_nuclei').select('id, name, prefix').eq('is_active', true).order('name'),
      (supabase as any).from('profiles').select('user_id, full_name').order('full_name'),
      (supabase as any).from('products_services').select('id, name, nucleus_id'),
    ]);
    setBoards((boardsRes.data as any[]) || []);
    setInstances((instancesRes.data as any[]) || []);
    setCustomVoices((voicesRes.data || []).map((v: any) => ({ id: v.elevenlabs_voice_id, name: `🎤 ${v.name}` })));
    setNuclei((nucleiRes.data || []).map((n: any) => ({ id: n.id, name: n.name, prefix: n.prefix })));
    setTeamMembers((profilesRes.data || []).filter((p: any) => p.full_name));
    setProducts((productsRes.data || []).map((p: any) => ({ id: p.id, name: p.name, nucleus_id: p.nucleus_id })));
    if (boardsRes.data && boardsRes.data.length > 0) {
      setSelectedBoard(boardsRes.data[0].id);
    }
    setLoading(false);
  };

  const fetchLinked = async () => {
    const { data } = await (supabase as any)
      .from('board_group_instances')
      .select('instance_id, role_title, role_description')
      .eq('board_id', selectedBoard);
    setLinkedInstances((data || []).map((d: any) => d.instance_id));
    const configs: Record<string, InstanceConfig> = {};
    (data || []).forEach((d: any) => {
      configs[d.instance_id] = {
        role_title: d.role_title || '',
        role_description: d.role_description || '',
      };
    });
    setInstanceConfigs(configs);
  };

  const fetchSettings = async () => {
    const { data } = await (supabase as any)
      .from('board_group_settings')
      .select('*')
      .eq('board_id', selectedBoard)
      .maybeSingle();
    if (data) {
      setSettings({
        group_name_prefix: data.group_name_prefix || '',
        closed_group_name_prefix: data.closed_group_name_prefix || '',
        sequence_start: data.sequence_start || 1,
        current_sequence: data.current_sequence || 0,
        closed_sequence_start: data.closed_sequence_start || 1,
        closed_current_sequence: data.closed_current_sequence || 0,
        lead_fields: data.lead_fields || ['lead_name'],
        initial_message_template: data.initial_message_template || '',
        use_ai_message: data.use_ai_message || false,
        ai_generated_message: data.ai_generated_message || '',
        forward_document_types: data.forward_document_types || [],
        send_audio_message: data.send_audio_message || false,
        audio_voice_id: data.audio_voice_id || '',
        auto_close_lead_on_sign: data.auto_close_lead_on_sign || false,
        auto_create_group_on_sign: data.auto_create_group_on_sign || false,
        auto_create_process: data.auto_create_process || false,
        process_nucleus_id: data.process_nucleus_id || '',
        process_workflow_board_id: data.process_workflow_board_id || '',
        process_auto_activities: data.process_auto_activities || [],
        process_workflows: data.process_workflows || [],
      });
      if (data.ai_generated_message) {
        setPreviewMessage(data.ai_generated_message);
      } else {
        setPreviewMessage(null);
      }
    } else {
      setSettings({
        group_name_prefix: '', closed_group_name_prefix: '', sequence_start: 1, current_sequence: 0,
        closed_sequence_start: 1, closed_current_sequence: 0, lead_fields: ['lead_name'],
        initial_message_template: '', use_ai_message: false, ai_generated_message: '',
        forward_document_types: [],
        send_audio_message: false, audio_voice_id: '',
        auto_close_lead_on_sign: false, auto_create_group_on_sign: false,
        auto_create_process: false, process_nucleus_id: '', process_workflow_board_id: '',
        process_auto_activities: [], process_workflows: [],
      });
      setPreviewMessage(null);
    }
  };

  const toggleInstance = async (instanceId: string) => {
    setSaving(true);
    try {
      if (linkedInstances.includes(instanceId)) {
        await (supabase as any)
          .from('board_group_instances')
          .delete()
          .eq('board_id', selectedBoard)
          .eq('instance_id', instanceId);
        setLinkedInstances(prev => prev.filter(id => id !== instanceId));
        setInstanceConfigs(prev => {
          const next = { ...prev };
          delete next[instanceId];
          return next;
        });
      } else {
        await (supabase as any)
          .from('board_group_instances')
          .insert({ board_id: selectedBoard, instance_id: instanceId });
        setLinkedInstances(prev => [...prev, instanceId]);
      }
      toast.success('Configuração atualizada');
    } catch (e: any) {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const updateInstanceConfig = (instanceId: string, field: keyof InstanceConfig, value: string) => {
    setInstanceConfigs(prev => ({
      ...prev,
      [instanceId]: { ...(prev[instanceId] || { role_title: '', role_description: '' }), [field]: value },
    }));
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      // Save group settings
      const { data: existing } = await (supabase as any)
        .from('board_group_settings')
        .select('id')
        .eq('board_id', selectedBoard)
        .maybeSingle();

      const payload = {
        group_name_prefix: settings.group_name_prefix,
        closed_group_name_prefix: settings.closed_group_name_prefix || null,
        sequence_start: settings.sequence_start,
        closed_sequence_start: settings.closed_sequence_start,
        lead_fields: settings.lead_fields,
        initial_message_template: settings.initial_message_template || null,
        use_ai_message: settings.use_ai_message,
        ai_generated_message: settings.use_ai_message && previewMessage ? previewMessage : null,
        forward_document_types: settings.forward_document_types,
        send_audio_message: settings.send_audio_message,
        audio_voice_id: settings.audio_voice_id || null,
        auto_close_lead_on_sign: settings.auto_close_lead_on_sign,
        auto_create_group_on_sign: settings.auto_create_group_on_sign,
        auto_create_process: settings.auto_create_process,
        process_nucleus_id: settings.process_nucleus_id || null,
        process_workflow_board_id: settings.process_workflow_board_id || null,
        process_auto_activities: settings.process_auto_activities,
        process_workflows: settings.process_workflows,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        await (supabase as any)
          .from('board_group_settings')
          .update(payload)
          .eq('board_id', selectedBoard);
      } else {
        await (supabase as any)
          .from('board_group_settings')
          .insert({
            board_id: selectedBoard,
            ...payload,
            current_sequence: settings.sequence_start > 1 ? settings.sequence_start - 1 : 0,
          });
      }

      // Save instance configs (role_title, role_description)
      for (const instanceId of linkedInstances) {
        const config = instanceConfigs[instanceId];
        if (config) {
          await (supabase as any)
            .from('board_group_instances')
            .update({
              role_title: config.role_title || null,
              role_description: config.role_description || null,
            })
            .eq('board_id', selectedBoard)
            .eq('instance_id', instanceId);
        }
      }

      toast.success('Configuração salva!');
    } catch (e: any) {
      toast.error('Erro ao salvar configuração');
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleField = (field: string) => {
    setSettings(prev => {
      const fields = prev.lead_fields.includes(field)
        ? prev.lead_fields.filter(f => f !== field)
        : [...prev.lead_fields, field];
      return { ...prev, lead_fields: fields.length > 0 ? fields : ['lead_name'] };
    });
  };

  const toggleDocType = (docType: string) => {
    setSettings(prev => {
      const types = prev.forward_document_types.includes(docType)
        ? prev.forward_document_types.filter(t => t !== docType)
        : [...prev.forward_document_types, docType];
      return { ...prev, forward_document_types: types };
    });
  };

  const getPreviewName = (useClosed = false) => {
    const parts: string[] = [];
    const prefix = useClosed && settings.closed_group_name_prefix 
      ? settings.closed_group_name_prefix 
      : settings.group_name_prefix;
    if (prefix) parts.push(prefix);
    let seq: number;
    if (useClosed && settings.closed_group_name_prefix) {
      seq = settings.closed_current_sequence > 0 ? settings.closed_current_sequence + 1 : settings.closed_sequence_start;
    } else {
      seq = settings.current_sequence > 0 ? settings.current_sequence + 1 : settings.sequence_start;
    }
    parts.push(String(seq).padStart(4, '0'));
    const fieldLabels = settings.lead_fields.map(f => {
      const opt = LEAD_FIELD_OPTIONS.find(o => o.value === f);
      return opt ? `[${opt.label}]` : `[${f}]`;
    });
    parts.push(fieldLabels.join(' '));
    return parts.join(' ');
  };

  const allVoices = [...VOICE_OPTIONS, ...customVoices];

  const generatePreview = async () => {
    setPreviewLoading(true);
    setPreviewMessage(null);
    try {
      const boardName = boards.find(b => b.id === selectedBoard)?.name || 'Funil';
      const participants = linkedInstances.map(id => {
        const inst = instances.find(i => i.id === id);
        const config = instanceConfigs[id] || { role_title: '', role_description: '' };
        return `- ${inst?.instance_name || 'Instância'}: ${config.role_title || 'Sem cargo'} (${config.role_description || 'Sem descrição'})`;
      }).join('\n');

      const { data, error } = await cloudFunctions.invoke('generate-group-message-preview', {
        body: {
          board_name: boardName,
          board_id: selectedBoard,
          instructions: settings.initial_message_template || '',
          participants,
          lead_fields: settings.lead_fields,
        },
      });

      if (error) throw error;
      setPreviewMessage(data?.message || 'Não foi possível gerar a pré-visualização.');
      setAdminNotes(data?.admin_notes || null);
    } catch (e: any) {
      toast.error('Erro ao gerar pré-visualização');
      console.error(e);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRefinePreview = async () => {
    if (!refineInput.trim() || !previewMessage) return;
    setRefineLoading(true);
    try {
      const boardName = boards.find(b => b.id === selectedBoard)?.name || 'Funil';
      const participants = linkedInstances.map(id => {
        const inst = instances.find(i => i.id === id);
        const config = instanceConfigs[id] || { role_title: '', role_description: '' };
        return `- ${inst?.instance_name || 'Instância'}: ${config.role_title || 'Sem cargo'} (${config.role_description || 'Sem descrição'})`;
      }).join('\n');

      const { data, error } = await cloudFunctions.invoke('generate-group-message-preview', {
        body: {
          board_name: boardName,
          board_id: selectedBoard,
          instructions: settings.initial_message_template || '',
          participants,
          lead_fields: settings.lead_fields,
          refinement: refineInput.trim(),
          current_message: previewMessage,
        },
      });

      if (error) throw error;
      setPreviewMessage(data?.message || previewMessage);
      setAdminNotes(data?.admin_notes || null);
      setRefineInput('');
      toast.success('Modelo refinado com IA!');
    } catch (e: any) {
      toast.error('Erro ao refinar modelo');
      console.error(e);
    } finally {
      setRefineLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Users className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-sm">Instâncias para Criação de Grupo</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Configure quais instâncias do WhatsApp serão automaticamente adicionadas aos grupos criados para leads de cada funil.
      </p>

      <Select value={selectedBoard} onValueChange={setSelectedBoard}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Selecione um funil" />
        </SelectTrigger>
        <SelectContent>
          {boards.map(b => (
            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedBoard && (
        <>
          {/* Group Name Configuration */}
          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <Type className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-xs">Nome do Grupo</h4>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Prefixo (antes de fechar)</Label>
                <Input
                  value={settings.group_name_prefix}
                  onChange={e => setSettings(prev => ({ ...prev, group_name_prefix: e.target.value }))}
                  placeholder="Ex: LEAD, GRP"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Seq. inicia em</Label>
                <Input
                  type="number"
                  min={1}
                  value={settings.sequence_start}
                  onChange={e => setSettings(prev => ({ ...prev, sequence_start: parseInt(e.target.value) || 1 }))}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Prefixo (após fechar)</Label>
                <Input
                  value={settings.closed_group_name_prefix}
                  onChange={e => setSettings(prev => ({ ...prev, closed_group_name_prefix: e.target.value }))}
                  placeholder="Ex: CASO, CLIENTE"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Seq. fechados inicia em</Label>
                <Input
                  type="number"
                  min={1}
                  value={settings.closed_sequence_start}
                  onChange={e => setSettings(prev => ({ ...prev, closed_sequence_start: parseInt(e.target.value) || 1 }))}
                  className="h-8 text-xs"
                />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Campos do lead no nome</Label>
              <div className="flex flex-wrap gap-1.5">
                {LEAD_FIELD_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleField(opt.value)}
                    className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                      settings.lead_fields.includes(opt.value)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50 border">
                <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[10px] text-muted-foreground">Antes:</span>
                <span className="text-[11px] font-medium truncate">{getPreviewName(false)}</span>
              </div>
              {settings.closed_group_name_prefix && (
                <div className="flex items-center gap-2 p-2 rounded bg-primary/10 border border-primary/20">
                  <Eye className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-[10px] text-primary">Após fechar:</span>
                  <span className="text-[11px] font-medium truncate">{getPreviewName(true)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Initial Message Configuration */}
          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-xs">Mensagem Inicial do Grupo</h4>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="use_ai_message"
                checked={settings.use_ai_message}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, use_ai_message: !!checked }))}
              />
              <Label htmlFor="use_ai_message" className="text-xs cursor-pointer">
                Gerar mensagem com IA (resumo do caso com dados do lead)
              </Label>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">
                {settings.use_ai_message ? 'Instruções adicionais para a IA' : 'Template da mensagem'}
              </Label>
              <Textarea
                value={settings.initial_message_template}
                onChange={e => setSettings(prev => ({ ...prev, initial_message_template: e.target.value }))}
                placeholder={settings.use_ai_message
                  ? 'Ex: Gere um resumo do caso incluindo dados do lead, tipo de acidente e empresa...'
                  : 'Ex: 📋 *Novo Caso* - {lead_name}\n\nTipo: {case_type}\nCidade: {city}/{state}'
                }
                className="text-xs min-h-[80px]"
              />
            </div>

            {!settings.use_ai_message && (
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Variáveis disponíveis</Label>
                <div className="flex flex-wrap gap-1">
                  {MESSAGE_VARIABLES.map(v => (
                    <button
                      key={v.var}
                      type="button"
                      onClick={() => {
                        setSettings(prev => ({
                          ...prev,
                          initial_message_template: prev.initial_message_template + ' ' + v.var,
                        }));
                      }}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-muted border border-border hover:bg-accent text-muted-foreground transition-colors"
                    >
                      {v.var} <span className="text-muted-foreground/60">({v.label})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {settings.use_ai_message && (
              <>
                <p className="text-[10px] text-muted-foreground">
                  ℹ️ A IA gerará um modelo de mensagem com dados fictícios. Este modelo será salvo e usado como base para a mensagem real de cada grupo, preenchendo com os dados reais do lead.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-7"
                  onClick={generatePreview}
                  disabled={previewLoading}
                >
                  {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {previewMessage ? 'Regenerar Modelo com IA' : 'Gerar Modelo com IA'}
                </Button>
                <div className="rounded-lg border bg-background">
                  <div className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-[10px] text-muted-foreground font-medium">
                    <Eye className="h-3 w-3" />
                    {previewMessage 
                      ? '✏️ Modelo editável — altere diretamente o texto abaixo (salve para aplicar):' 
                      : '📝 Clique em "Gerar Modelo com IA" para criar o modelo da mensagem inicial'}
                  </div>
                  <textarea
                    value={previewMessage || ''}
                    onChange={e => setPreviewMessage(e.target.value)}
                    className="w-full p-3 pt-1 text-xs bg-transparent border-0 outline-none resize-y min-h-[120px] max-h-[400px] whitespace-pre-wrap font-sans"
                    rows={12}
                    placeholder="O modelo gerado pela IA aparecerá aqui. Você pode editá-lo manualmente ou gerar um novo."
                  />
                  {previewMessage && (
                    <div className="flex gap-2 px-3 pb-3">
                      <Input
                        placeholder="Refine com IA: ex. mais formal, adicione seção de documentos pendentes..."
                        value={refineInput}
                        onChange={e => setRefineInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !refineLoading && handleRefinePreview()}
                        className="text-xs flex-1"
                        disabled={refineLoading}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="shrink-0 h-9 w-9"
                        onClick={handleRefinePreview}
                        disabled={!refineInput.trim() || refineLoading}
                      >
                        {refineLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  )}
                </div>
                {adminNotes && (
                  <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-xs text-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200 dark:border-yellow-700">
                    <div className="font-medium mb-1">⚠️ Observação para o Administrador:</div>
                    <div className="whitespace-pre-wrap">{adminNotes}</div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Audio Message */}
          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-xs">Áudio da Mensagem</h4>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="send_audio_message"
                checked={settings.send_audio_message}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, send_audio_message: !!checked }))}
              />
              <Label htmlFor="send_audio_message" className="text-xs cursor-pointer">
                Gerar e enviar áudio da mensagem inicial
              </Label>
            </div>

            {settings.send_audio_message && (
              <p className="text-[10px] text-muted-foreground">
                🎤 A voz utilizada será a configurada na instância que criou o grupo.
                <br />
                ⚠️ Links e URLs não serão incluídos no áudio, apenas no texto.
              </p>
            )}
          </div>

          {/* Post-Signature Automation */}
          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-xs">Automações ao Assinar Documento</h4>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Configure ações automáticas quando o documento ZapSign for assinado por leads deste funil.
            </p>

            <div className="flex items-center gap-2">
              <Checkbox
                id="auto_close_lead_on_sign"
                checked={settings.auto_close_lead_on_sign}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, auto_close_lead_on_sign: !!checked }))}
              />
              <Label htmlFor="auto_close_lead_on_sign" className="text-xs cursor-pointer">
                ✅ Marcar lead como <strong>Fechado</strong> automaticamente
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="auto_create_group_on_sign"
                checked={settings.auto_create_group_on_sign}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, auto_create_group_on_sign: !!checked }))}
              />
              <Label htmlFor="auto_create_group_on_sign" className="text-xs cursor-pointer">
                📱 Criar <strong>grupo WhatsApp</strong> automaticamente
              </Label>
            </div>

            {settings.auto_create_group_on_sign && (
              <p className="text-[10px] text-muted-foreground ml-6">
                ⚠️ Usará as configurações de grupo deste funil (instâncias, nome, mensagem, documentos).
              </p>
            )}
          </div>

          {/* Onboarding Meeting */}
          {selectedBoard && <OnboardingMeetingConfig boardId={selectedBoard} />}

          {/* Auto-Create Process */}
          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-xs">Criação Automática de Processos</h4>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Selecione os fluxos de trabalho que devem ser criados automaticamente ao criar o grupo. Cada fluxo gera um processo separado com seu núcleo correspondente.
            </p>

            <div className="flex items-center gap-2">
              <Checkbox
                id="auto_create_process"
                checked={settings.auto_create_process}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, auto_create_process: !!checked }))}
              />
              <Label htmlFor="auto_create_process" className="text-xs cursor-pointer">
                ⚖️ Criar <strong>processos jurídicos</strong> automaticamente ao criar grupo
              </Label>
            </div>

            {settings.auto_create_process && (
              <div className="space-y-3 pl-2 border-l-2 border-primary/20 ml-1">
                <Label className="text-[11px] text-muted-foreground">Selecione os fluxos de trabalho:</Label>
                
                {boards.filter(b => b.board_type === 'workflow').length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-2">
                    Nenhum fluxo de trabalho cadastrado. Crie fluxos na página de Configurações.
                  </p>
                )}

                {boards.filter(b => b.board_type === 'workflow').map(workflow => {
                  const isSelected = settings.process_workflows.some(w => w.workflow_board_id === workflow.id);
                  const workflowEntry = settings.process_workflows.find(w => w.workflow_board_id === workflow.id);
                  
                  const product = products.find(p => p.id === workflow.product_service_id);
                  const nucleus = product?.nucleus_id ? nuclei.find(n => n.id === product.nucleus_id) : null;

                  return (
                    <div key={workflow.id} className="rounded-lg border bg-background">
                      <label className="flex items-center gap-2 p-2 cursor-pointer">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            setSettings(prev => {
                              if (checked) {
                                return { ...prev, process_workflows: [...prev.process_workflows, { workflow_board_id: workflow.id, activities: [] }] };
                              }
                              return { ...prev, process_workflows: prev.process_workflows.filter(w => w.workflow_board_id !== workflow.id) };
                            });
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium">{workflow.name}</span>
                          {nucleus && (
                            <span className="text-[10px] text-muted-foreground ml-2">({nucleus.prefix} - {nucleus.name})</span>
                          )}
                        </div>
                      </label>

                      {isSelected && workflowEntry && (
                        <div className="px-2 pb-2 space-y-2 border-t mx-2 pt-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] text-muted-foreground">Atividades automáticas</Label>
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <Checkbox
                                  checked={workflowEntry.use_ai_activities || false}
                                  onCheckedChange={(checked) => setSettings(prev => ({
                                    ...prev,
                                    process_workflows: prev.process_workflows.map(w =>
                                      w.workflow_board_id === workflow.id
                                        ? { ...w, use_ai_activities: !!checked }
                                        : w
                                    ),
                                  }))}
                                  className="h-3 w-3"
                                />
                                <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                                  <Sparkles className="h-2.5 w-2.5" /> Gerar com IA
                                </span>
                              </label>
                              {!workflowEntry.use_ai_activities && (
                                <Button type="button" variant="outline" size="sm" className="h-5 text-[9px] gap-1 px-2"
                                  onClick={() => setSettings(prev => ({
                                    ...prev,
                                    process_workflows: prev.process_workflows.map(w =>
                                      w.workflow_board_id === workflow.id
                                        ? { ...w, activities: [...w.activities, { title: '', activity_type: 'tarefa', assigned_to: '', deadline_days: 1, priority: 'normal' }] }
                                        : w
                                    ),
                                  }))}
                                >+ Atividade</Button>
                              )}
                            </div>
                          </div>

                          {workflowEntry.use_ai_activities ? (
                            <div className="space-y-1.5">
                              <p className="text-[9px] text-muted-foreground">
                                A IA gerará atividades automaticamente com base no prompt do agente, mensagens e cargos da equipe.
                              </p>
                              <Textarea
                                value={workflowEntry.ai_activities_prompt || ''}
                                onChange={e => setSettings(prev => ({
                                  ...prev,
                                  process_workflows: prev.process_workflows.map(w =>
                                    w.workflow_board_id === workflow.id
                                      ? { ...w, ai_activities_prompt: e.target.value }
                                      : w
                                  ),
                                }))}
                                rows={4}
                                className="text-[9px] font-mono leading-relaxed"
                                placeholder="Instruções adicionais para a IA (opcional). Ex: Foque em prazos administrativos, priorize atividades de protocolo..."
                              />
                            </div>
                          ) : (
                            <>
                          {workflowEntry.activities.map((act, actIdx) => (
                            <div key={actIdx} className="p-1.5 rounded border bg-muted/30 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-medium text-muted-foreground">Atividade {actIdx + 1}</span>
                                <button type="button" className="text-destructive hover:text-destructive/80 text-[9px]"
                                  onClick={() => setSettings(prev => ({
                                    ...prev,
                                    process_workflows: prev.process_workflows.map(w =>
                                      w.workflow_board_id === workflow.id
                                        ? { ...w, activities: w.activities.filter((_, i) => i !== actIdx) }
                                        : w
                                    ),
                                  }))}
                                >✕</button>
                              </div>
                              <Input value={act.title} placeholder="Título da atividade" className="h-6 text-[10px]"
                                onChange={e => setSettings(prev => ({
                                  ...prev,
                                  process_workflows: prev.process_workflows.map(w =>
                                    w.workflow_board_id === workflow.id
                                      ? { ...w, activities: w.activities.map((a, i) => i === actIdx ? { ...a, title: e.target.value } : a) }
                                      : w
                                  ),
                                }))}
                              />
                              <div className="grid grid-cols-3 gap-1.5">
                                <div>
                                  <Label className="text-[9px] text-muted-foreground">Responsável</Label>
                                  <Select value={act.assigned_to} onValueChange={v => setSettings(prev => ({
                                    ...prev,
                                    process_workflows: prev.process_workflows.map(w =>
                                      w.workflow_board_id === workflow.id
                                        ? { ...w, activities: w.activities.map((a, i) => i === actIdx ? { ...a, assigned_to: v } : a) }
                                        : w
                                    ),
                                  }))}>
                                    <SelectTrigger className="h-6 text-[9px]"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                                    <SelectContent>
                                      {teamMembers.map(m => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-[9px] text-muted-foreground">Prazo (dias)</Label>
                                  <Input type="number" min={0} value={act.deadline_days} className="h-6 text-[9px]"
                                    onChange={e => setSettings(prev => ({
                                      ...prev,
                                      process_workflows: prev.process_workflows.map(w =>
                                        w.workflow_board_id === workflow.id
                                          ? { ...w, activities: w.activities.map((a, i) => i === actIdx ? { ...a, deadline_days: parseInt(e.target.value) || 1 } : a) }
                                          : w
                                      ),
                                    }))}
                                  />
                                </div>
                                <div>
                                  <Label className="text-[9px] text-muted-foreground">Prioridade</Label>
                                  <Select value={act.priority} onValueChange={v => setSettings(prev => ({
                                    ...prev,
                                    process_workflows: prev.process_workflows.map(w =>
                                      w.workflow_board_id === workflow.id
                                        ? { ...w, activities: w.activities.map((a, i) => i === actIdx ? { ...a, priority: v } : a) }
                                        : w
                                    ),
                                  }))}>
                                    <SelectTrigger className="h-6 text-[9px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="baixa">Baixa</SelectItem>
                                      <SelectItem value="normal">Normal</SelectItem>
                                      <SelectItem value="alta">Alta</SelectItem>
                                      <SelectItem value="urgente">Urgente</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </div>
                          ))}

                          {workflowEntry.activities.length === 0 && (
                            <p className="text-[9px] text-muted-foreground text-center py-1">Sem atividades automáticas.</p>
                          )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {settings.process_workflows.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    ✅ {settings.process_workflows.length} processo(s) será(ão) criado(s) automaticamente.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-xs">Documentos para Enviar ao Grupo</h4>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Selecione quais documentos da conversa privada devem ser enviados automaticamente ao grupo em formato PDF, nomeados com o nome do lead.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {DOCUMENT_TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleDocType(opt.value)}
                  className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                    settings.forward_document_types.includes(opt.value)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {settings.forward_document_types.length > 0 && (
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50 border">
                <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[10px] text-muted-foreground">Arquivos serão nomeados como:</span>
                <span className="text-[10px] font-medium">RG - João Silva.pdf, Procuração - João Silva.pdf</span>
              </div>
            )}
          </div>

          {/* Save Button */}
          <Button size="sm" onClick={saveSettings} disabled={savingSettings} className="w-full h-8 text-xs">
            {savingSettings ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Salvar Todas as Configurações
          </Button>

          {/* Instances */}
          <div className="space-y-2 mt-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-xs">Instâncias Participantes</h4>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Defina o cargo e a descrição de cada instância para identificar os responsáveis na mensagem do grupo.
            </p>
            {instances.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma instância ativa encontrada.</p>
            ) : (
              instances.map(inst => {
                const isLinked = linkedInstances.includes(inst.id);
                const config = instanceConfigs[inst.id] || { role_title: '', role_description: '' };
                return (
                  <div key={inst.id} className="rounded-lg border hover:bg-muted/50 transition-colors">
                    <label className="flex items-center gap-3 p-2.5 cursor-pointer">
                      <Checkbox
                        checked={isLinked}
                        onCheckedChange={() => toggleInstance(inst.id)}
                        disabled={saving}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{inst.instance_name}</p>
                        {inst.owner_phone && (
                          <p className="text-[11px] text-muted-foreground">{inst.owner_phone}</p>
                        )}
                      </div>
                      {isLinked && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">Incluída</Badge>
                      )}
                    </label>
                    {isLinked && (
                      <div className="px-2.5 pb-2.5 space-y-1.5 border-t pt-2 mx-2.5">
                        <Input
                          value={config.role_title}
                          onChange={e => updateInstanceConfig(inst.id, 'role_title', e.target.value)}
                          placeholder="Cargo (ex: Advogado, Assistente, Perito)"
                          className="h-7 text-[11px]"
                        />
                        <Input
                          value={config.role_description}
                          onChange={e => updateInstanceConfig(inst.id, 'role_description', e.target.value)}
                          placeholder="Descrição (ex: Responsável pela análise processual)"
                          className="h-7 text-[11px]"
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
