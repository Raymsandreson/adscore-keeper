import { useState, useEffect } from 'react';
import { db } from '@/integrations/supabase';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Hash, Type, Eye, MessageSquare, FileText, Volume2, Sparkles, Send, Zap, Scale, Plus, Trash2, Lock, Archive, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';


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

type AppliesTo = 'both' | 'open' | 'closed';

interface InstanceConfig {
  role_title: string;
  role_description: string;
  applies_to: AppliesTo;
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
  post_sign_mode: 'group' | 'private';
  auto_archive_on_sign: boolean;
  processual_acolhedor_id: string;
  auto_create_process: boolean;
  process_nucleus_id: string;
  process_workflow_board_id: string;
  process_auto_activities: ProcessActivity[];
  process_workflows: ProcessWorkflow[];
  bridge_approach_prompt: string;
  sync_lead_name_with_group: boolean;
}

interface ProcessActivity {
  title: string;
  activity_type: string;
  assigned_to: string;
  deadline_days: number;
  priority: string;
}

const LEAD_FIELD_OPTIONS = [
  { value: 'closed_seq', label: 'Nº do Caso (ex: 0047)' },
  { value: 'board_name', label: 'Nome do Funil' },
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

interface BoardGroupInstancesConfigProps {
  boardId?: string;
  hideBoardSelector?: boolean;
}

export function BoardGroupInstancesConfig({ boardId, hideBoardSelector }: BoardGroupInstancesConfigProps = {}) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [internalSelectedBoard, setInternalSelectedBoard] = useState<string>('');
  const selectedBoard = boardId ?? internalSelectedBoard;
  const setSelectedBoard = (v: string) => {
    if (boardId === undefined) setInternalSelectedBoard(v);
  };
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
    post_sign_mode: 'group',
    auto_archive_on_sign: false,
    processual_acolhedor_id: '',
    auto_create_process: false,
    process_nucleus_id: '',
    process_workflow_board_id: '',
    process_auto_activities: [],
    process_workflows: [],
    bridge_approach_prompt: '',
    sync_lead_name_with_group: false,
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
  const [boardCustomFields, setBoardCustomFields] = useState<{ id: string; field_name: string; field_type: string }[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedBoard) {
      fetchLinked();
      fetchSettings();
      fetchBoardCustomFields();
    }
  }, [selectedBoard]);

  const fetchBoardCustomFields = async () => {
    try {
      // Apenas campos personalizados deste funil específico (board_id = selectedBoard).
      // Globais (board_id NULL) ficam de fora pra evitar poluir com campos que não
      // pertencem a esse funil — exatamente o que o usuário pediu.
      const { data, error } = await (db as any)
        .from('lead_custom_fields')
        .select('id, field_name, field_type')
        .eq('board_id', selectedBoard)
        .order('display_order', { ascending: true });
      if (error) throw error;
      setBoardCustomFields((data || []) as any[]);
    } catch (e) {
      console.warn('[BoardGroupInstancesConfig] fetch custom fields failed:', e);
      setBoardCustomFields([]);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    const [boardsRes, instancesRes, voicesRes, nucleiRes, profilesRes, productsRes] = await Promise.all([
      (db as any).from('kanban_boards').select('id, name, board_type, product_service_id').order('display_order'),
      (db as any).from('whatsapp_instances').select('id, instance_name, owner_phone').eq('is_active', true),
      (db as any).from('custom_voices').select('id, name, elevenlabs_voice_id').eq('status', 'ready'),
      (db as any).from('specialized_nuclei').select('id, name, prefix').eq('is_active', true).order('name'),
      (db as any).from('profiles').select('user_id, full_name').order('full_name'),
      (db as any).from('products_services').select('id, name, nucleus_id'),
    ]);
    setBoards((boardsRes.data as any[]) || []);
    setInstances((instancesRes.data as any[]) || []);
    setCustomVoices((voicesRes.data || []).map((v: any) => ({ id: v.elevenlabs_voice_id, name: `🎤 ${v.name}` })));
    setNuclei((nucleiRes.data || []).map((n: any) => ({ id: n.id, name: n.name, prefix: n.prefix })));
    setTeamMembers((profilesRes.data || []).filter((p: any) => p.full_name));
    setProducts((productsRes.data || []).map((p: any) => ({ id: p.id, name: p.name, nucleus_id: p.nucleus_id })));
    const funnelBoards = ((boardsRes.data as any[]) || []).filter(b => b.board_type === 'funnel');
    if (boardId === undefined && funnelBoards.length > 0) {
      setInternalSelectedBoard(funnelBoards[0].id);
    }
    setLoading(false);
  };

  const fetchLinked = async () => {
    const { data, error } = await (db as any)
      .from('board_group_instances')
      .select('instance_id, role_title, role_description, applies_to')
      .eq('board_id', selectedBoard);
    if (error) {
      console.error('Erro ao carregar instâncias do grupo:', error);
      toast.error('Erro ao carregar participantes do grupo');
      setLinkedInstances([]);
      setInstanceConfigs({});
      return;
    }
    setLinkedInstances((data || []).map((d: any) => d.instance_id));
    const configs: Record<string, InstanceConfig> = {};
    (data || []).forEach((d: any) => {
      configs[d.instance_id] = {
        role_title: d.role_title || '',
        role_description: d.role_description || '',
        applies_to: (d.applies_to as AppliesTo) || 'both',
      };
    });
    setInstanceConfigs(configs);
  };

  const fetchSettings = async () => {
    const { data } = await (db as any)
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
        post_sign_mode: (data.post_sign_mode as 'group' | 'private') || 'group',
        auto_archive_on_sign: data.auto_archive_on_sign || false,
        processual_acolhedor_id: data.processual_acolhedor_id || '',
        auto_create_process: data.auto_create_process || false,
        process_nucleus_id: data.process_nucleus_id || '',
        process_workflow_board_id: data.process_workflow_board_id || '',
        process_auto_activities: data.process_auto_activities || [],
        process_workflows: data.process_workflows || [],
        bridge_approach_prompt: data.bridge_approach_prompt || '',
        sync_lead_name_with_group: data.sync_lead_name_with_group ?? false,
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
        post_sign_mode: 'group', auto_archive_on_sign: false, processual_acolhedor_id: '',
        auto_create_process: false, process_nucleus_id: '', process_workflow_board_id: '',
        process_auto_activities: [], process_workflows: [],
        bridge_approach_prompt: '',
        sync_lead_name_with_group: false,
      });
      setPreviewMessage(null);
    }
  };

  const toggleInstance = async (instanceId: string) => {
    setSaving(true);
    try {
      if (linkedInstances.includes(instanceId)) {
        const { error } = await (db as any)
          .from('board_group_instances')
          .delete()
          .eq('board_id', selectedBoard)
          .eq('instance_id', instanceId);
        if (error) throw error;
        setLinkedInstances(prev => prev.filter(id => id !== instanceId));
        setInstanceConfigs(prev => {
          const next = { ...prev };
          delete next[instanceId];
          return next;
        });
      } else {
        const { error } = await (db as any)
          .from('board_group_instances')
          .upsert(
            { board_id: selectedBoard, instance_id: instanceId, applies_to: 'both' },
            { onConflict: 'board_id,instance_id' }
          );
        if (error) throw error;
        setLinkedInstances(prev => [...prev, instanceId]);
        setInstanceConfigs(prev => ({
          ...prev,
          [instanceId]: { role_title: '', role_description: '', applies_to: 'both' },
        }));
      }
      toast.success('Configuração atualizada');
    } catch (e: any) {
      console.error('Erro ao salvar instância do grupo:', e);
      toast.error('Erro ao salvar');
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const updateInstanceConfig = (instanceId: string, field: keyof InstanceConfig, value: string) => {
    setInstanceConfigs(prev => ({
      ...prev,
      [instanceId]: {
        ...(prev[instanceId] || { role_title: '', role_description: '', applies_to: 'both' as AppliesTo }),
        [field]: value,
      },
    }));
  };

  const updateInstanceAppliesTo = async (instanceId: string, value: AppliesTo) => {
    setInstanceConfigs(prev => ({
      ...prev,
      [instanceId]: {
        ...(prev[instanceId] || { role_title: '', role_description: '', applies_to: 'both' as AppliesTo }),
        applies_to: value,
      },
    }));
    try {
      const { error } = await (db as any)
        .from('board_group_instances')
        .update({ applies_to: value })
        .eq('board_id', selectedBoard)
        .eq('instance_id', instanceId);
      if (error) throw error;
    } catch (e) {
      console.error('Erro ao atualizar regra da instância:', e);
      toast.error('Erro ao atualizar regra');
      throw e;
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      // Save group settings
      const { data: existing, error: existingError } = await (db as any)
        .from('board_group_settings')
        .select('id')
        .eq('board_id', selectedBoard)
        .maybeSingle();
      if (existingError) throw existingError;

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
        post_sign_mode: settings.post_sign_mode,
        auto_archive_on_sign: settings.auto_archive_on_sign,
        processual_acolhedor_id: settings.processual_acolhedor_id || null,
        auto_create_process: settings.auto_create_process,
        process_nucleus_id: settings.process_nucleus_id || null,
        process_workflow_board_id: settings.process_workflow_board_id || null,
        process_auto_activities: settings.process_auto_activities,
        process_workflows: settings.process_workflows,
        bridge_approach_prompt: settings.bridge_approach_prompt || null,
        sync_lead_name_with_group: settings.sync_lead_name_with_group,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const { error } = await (db as any)
          .from('board_group_settings')
          .update(payload)
          .eq('board_id', selectedBoard);
        if (error) throw error;
      } else {
        const { error } = await (db as any)
          .from('board_group_settings')
          .insert({
            board_id: selectedBoard,
            ...payload,
            current_sequence: settings.sequence_start > 1 ? settings.sequence_start - 1 : 0,
          });
        if (error) throw error;
      }

      // Save instance configs (role_title, role_description)
      for (const instanceId of linkedInstances) {
        const config = instanceConfigs[instanceId];
        if (config) {
          const { error } = await (db as any)
            .from('board_group_instances')
            .upsert(
              {
                board_id: selectedBoard,
                instance_id: instanceId,
                applies_to: config.applies_to || 'both',
                role_title: config.role_title || null,
                role_description: config.role_description || null,
              },
              { onConflict: 'board_id,instance_id' }
            );
          if (error) throw error;
        }
      }

      await fetchLinked();

      toast.success('Configuração salva!');
    } catch (e: any) {
      console.error('Erro ao salvar configuração de grupo:', e);
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
    const seqStr = String(seq).padStart(4, '0');
    const fields = settings.lead_fields || [];
    // Legacy: se não houver token closed_seq, injeta a sequência logo após o prefixo
    if (!fields.includes('closed_seq')) parts.push(seqStr);
    for (const f of fields) {
      if (f === 'closed_seq') {
        parts.push(seqStr);
      } else if (f.startsWith('cf:')) {
        const cfId = f.slice(3);
        const cf = boardCustomFields.find(c => c.id === cfId);
        parts.push(cf ? `[${cf.field_name}]` : `[campo personalizado]`);
      } else {
        const opt = LEAD_FIELD_OPTIONS.find(o => o.value === f);
        parts.push(opt ? `[${opt.label}]` : `[${f}]`);
      }
    }
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

      {!hideBoardSelector && (
        <Select value={selectedBoard} onValueChange={setSelectedBoard}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione um funil" />
          </SelectTrigger>
          <SelectContent>
            {boards.filter(b => b.board_type === 'funnel').map(b => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

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

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Prefixo (após fechar)</Label>
              <Input
                value={settings.closed_group_name_prefix}
                onChange={e => setSettings(prev => ({ ...prev, closed_group_name_prefix: e.target.value }))}
                placeholder="Ex: CASO, CLIENTE"
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                A sequência de fechados é automática: usa a posição do lead na fila pela data de assinatura no ZapSign (ex: 47º caso assinado = "0047").
              </p>
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

            <div className="flex items-start gap-2 p-2 rounded-md border bg-background">
              <Checkbox
                id="sync_lead_name_with_group"
                checked={settings.sync_lead_name_with_group}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, sync_lead_name_with_group: !!checked }))}
                className="mt-0.5"
              />
              <Label htmlFor="sync_lead_name_with_group" className="text-xs cursor-pointer flex-1">
                <div className="font-medium">Sincronizar nome do lead com o nome do grupo</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Quando ativo, ao criar/renomear o grupo o nome do lead será atualizado para ficar igual. Desligue para manter o nome do lead independente.
                </div>
              </Label>
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

            {/* Modo pós-assinatura: Grupo OU Privado (exclusivo) */}
            <div className="space-y-2 pt-2 border-t border-border/50">
              <Label className="text-xs font-medium">Modo de atendimento pós-assinatura</Label>
              <RadioGroup
                value={settings.post_sign_mode}
                onValueChange={(value) => setSettings(prev => ({
                  ...prev,
                  post_sign_mode: value as 'group' | 'private',
                  // Sincroniza o checkbox legado para o webhook continuar funcionando
                  auto_create_group_on_sign: value === 'group',
                }))}
                className="space-y-2"
              >
                <div className="flex items-start gap-2 p-2 rounded-md border bg-background hover:bg-accent/30 cursor-pointer">
                  <RadioGroupItem value="group" id="mode_group" className="mt-0.5" />
                  <Label htmlFor="mode_group" className="text-xs cursor-pointer flex-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Users className="h-3.5 w-3.5" />
                      📱 Criar grupo WhatsApp
                    </div>
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">
                      Cria um grupo com a equipe e envia mensagem inicial + documentos no grupo.
                    </p>
                  </Label>
                </div>
                <div className="flex items-start gap-2 p-2 rounded-md border bg-background hover:bg-accent/30 cursor-pointer">
                  <RadioGroupItem value="private" id="mode_private" className="mt-0.5" />
                  <Label htmlFor="mode_private" className="text-xs cursor-pointer flex-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Lock className="h-3.5 w-3.5" />
                      🔒 Continuar no privado (1:1)
                    </div>
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">
                      Sem grupo. Mensagem inicial, documentos e atualizações vão direto no chat individual.
                      Ideal pra leads que se assustam com grupos ou que respondem melhor 1:1.
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Configurações específicas do modo Privado */}
            {settings.post_sign_mode === 'private' && (
              <div className="space-y-3 pl-3 border-l-2 border-primary/30 ml-1">
                <div className="space-y-1.5">
                  <Label htmlFor="processual_acolhedor" className="text-xs flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5" />
                    Acolhedor processual (assume a conversa)
                  </Label>
                  <Select
                    value={settings.processual_acolhedor_id}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, processual_acolhedor_id: value }))}
                  >
                    <SelectTrigger className="text-xs h-9">
                      <SelectValue placeholder="Selecione o responsável processual..." />
                    </SelectTrigger>
                    <SelectContent>
                      {teamMembers.map(m => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Esse usuário receberá o lead reatribuído após a assinatura. Equipe processual assume daqui.
                  </p>
                </div>

                <div className="flex items-start gap-2 pt-1">
                  <Checkbox
                    id="auto_archive_on_sign"
                    checked={settings.auto_archive_on_sign}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, auto_archive_on_sign: !!checked }))}
                    className="mt-0.5"
                  />
                  <Label htmlFor="auto_archive_on_sign" className="text-xs cursor-pointer flex-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Archive className="h-3.5 w-3.5" />
                      Arquivar conversa ao assinar
                    </div>
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">
                      Arquiva no Inbox interno e também no WhatsApp (via API). A conversa sai da lista ativa
                      mas continua acessível em "Arquivadas".
                    </p>
                  </Label>
                </div>
              </div>
            )}

            {settings.post_sign_mode === 'group' && (
              <p className="text-[10px] text-muted-foreground">
                ⚠️ Usará as configurações de grupo deste funil (instâncias, nome, mensagem, documentos).
              </p>
            )}
          </div>

          {/* Bridge Approach Prompt */}
          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-xs">Prompt de Abordagem de Pontes</h4>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Configure o prompt que a IA usará para gerar comentários e DMs de abordagem para pontes (familiares, amigos, testemunhas) identificadas nos comentários de posts do Instagram.
            </p>
            <Textarea
              value={settings.bridge_approach_prompt}
              onChange={(e) => setSettings(prev => ({ ...prev, bridge_approach_prompt: e.target.value }))}
              rows={5}
              placeholder="Ex: Você é um assistente que gera mensagens para se conectar com pessoas que podem ser pontes para chegar até famílias de vítimas..."
              className="text-xs"
            />
            <p className="text-[10px] text-muted-foreground italic">
              💡 Deixe vazio para usar o prompt padrão. Inclua instruções sobre tom, estratégia de abordagem e o que NÃO fazer.
            </p>
          </div>

          {/* Criação Automática de Processos foi movida para a aba "Caso" do Onboarding */}

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

          {/* Instâncias — divididas em Antes / Depois / Ambos */}
          <InstanceParticipantsSection
            instances={instances}
            linkedInstances={linkedInstances}
            instanceConfigs={instanceConfigs}
            saving={saving}
            toggleInstance={toggleInstance}
            updateInstanceConfig={updateInstanceConfig}
            updateInstanceAppliesTo={updateInstanceAppliesTo}
          />

          {/* Save Button — final */}
          <Button size="sm" onClick={saveSettings} disabled={savingSettings} className="w-full h-9 text-xs sticky bottom-2 shadow-md">
            {savingSettings ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Salvar Todas as Configurações
          </Button>
        </>
      )}
    </div>
  );
}

interface InstanceParticipantsSectionProps {
  instances: Instance[];
  linkedInstances: string[];
  instanceConfigs: Record<string, InstanceConfig>;
  saving: boolean;
  toggleInstance: (id: string) => Promise<void>;
  updateInstanceConfig: (id: string, field: keyof InstanceConfig, value: string) => void;
  updateInstanceAppliesTo: (id: string, value: AppliesTo) => Promise<void>;
}

function InstanceParticipantsSection({
  instances,
  linkedInstances,
  instanceConfigs,
  saving,
  toggleInstance,
  updateInstanceConfig,
  updateInstanceAppliesTo,
}: InstanceParticipantsSectionProps) {
  const [phase, setPhase] = useState<AppliesTo>('both');

  const isInPhase = (instId: string): boolean => {
    if (!linkedInstances.includes(instId)) return false;
    const a = instanceConfigs[instId]?.applies_to || 'both';
    if (phase === 'both') return a === 'both';
    if (phase === 'open') return a === 'open' || a === 'both';
    if (phase === 'closed') return a === 'closed' || a === 'both';
    return false;
  };

  const togglePhase = async (instId: string, checked: boolean) => {
    const isLinked = linkedInstances.includes(instId);
    const current: AppliesTo = instanceConfigs[instId]?.applies_to || 'both';

    if (phase === 'both') {
      if (checked) {
        if (!isLinked) await toggleInstance(instId);
        if (current !== 'both') await updateInstanceAppliesTo(instId, 'both');
      } else if (isLinked) {
        await toggleInstance(instId);
      }
      return;
    }

    const otherPhase: 'open' | 'closed' = phase === 'open' ? 'closed' : 'open';
    const wasInOther = current === otherPhase || current === 'both';

    if (checked) {
      if (!isLinked) {
        await toggleInstance(instId);
        // toggleInstance insere com applies_to='both'; ajusta para a fase atual
        await updateInstanceAppliesTo(instId, phase);
      } else {
        await updateInstanceAppliesTo(instId, wasInOther ? 'both' : phase);
      }
    } else {
      if (!isLinked) return;
      if (current === 'both') {
        await updateInstanceAppliesTo(instId, otherPhase);
      } else if (current === phase) {
        await toggleInstance(instId);
      }
    }
  };

  const phaseTabs: { value: AppliesTo; label: string; hint: string }[] = [
    { value: 'open', label: 'Antes do fechamento', hint: 'Instâncias no grupo enquanto o lead está em captação.' },
    { value: 'closed', label: 'Depois do fechamento', hint: 'Instâncias no grupo após assinatura/fechamento.' },
    { value: 'both', label: 'Em ambos', hint: 'Instâncias que ficam o tempo todo, antes e depois.' },
  ];

  const currentTab = phaseTabs.find((t) => t.value === phase)!;

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h4 className="font-medium text-xs">Instâncias Participantes</h4>
      </div>

      <div className="grid grid-cols-3 gap-1 p-1 rounded-lg border bg-muted/30">
        {phaseTabs.map((t) => {
          const count = instances.filter((i) => {
            if (!linkedInstances.includes(i.id)) return false;
            const a = instanceConfigs[i.id]?.applies_to || 'both';
            if (t.value === 'both') return a === 'both';
            if (t.value === 'open') return a === 'open' || a === 'both';
            if (t.value === 'closed') return a === 'closed' || a === 'both';
            return false;
          }).length;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setPhase(t.value)}
              className={`text-[11px] px-2 py-1.5 rounded transition-colors flex items-center justify-center gap-1.5 ${
                phase === t.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent text-muted-foreground'
              }`}
            >
              {t.label}
              {count > 0 && (
                <Badge variant={phase === t.value ? 'secondary' : 'outline'} className="h-4 text-[9px] px-1.5">
                  {count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground">{currentTab.hint}</p>

      {instances.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma instância ativa encontrada.</p>
      ) : (
        [...instances]
          .sort((a, b) => {
            const aSel = isInPhase(a.id) ? 0 : linkedInstances.includes(a.id) ? 1 : 2;
            const bSel = isInPhase(b.id) ? 0 : linkedInstances.includes(b.id) ? 1 : 2;
            if (aSel !== bSel) return aSel - bSel;
            return a.instance_name.localeCompare(b.instance_name);
          })
          .map((inst) => {
          const checked = isInPhase(inst.id);
          const isLinked = linkedInstances.includes(inst.id);
          const config: InstanceConfig =
            instanceConfigs[inst.id] || { role_title: '', role_description: '', applies_to: 'both' };
          return (
            <div key={inst.id} className="rounded-lg border hover:bg-muted/50 transition-colors">
              <label className="flex items-center gap-3 p-2.5 cursor-pointer">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => togglePhase(inst.id, !!v)}
                  disabled={saving}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{inst.instance_name}</p>
                  {inst.owner_phone && (
                    <p className="text-[11px] text-muted-foreground">{inst.owner_phone}</p>
                  )}
                </div>
                {isLinked && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {config.applies_to === 'both' ? 'Ambos' : config.applies_to === 'open' ? 'Antes' : 'Depois'}
                  </Badge>
                )}
              </label>
              {checked && (
                <div className="px-2.5 pb-2.5 space-y-1.5 border-t pt-2 mx-2.5">
                  <Input
                    value={config.role_title}
                    onChange={(e) => updateInstanceConfig(inst.id, 'role_title', e.target.value)}
                    placeholder="Cargo (ex: Advogado, Assistente, Perito)"
                    className="h-7 text-[11px]"
                  />
                  <Input
                    value={config.role_description}
                    onChange={(e) => updateInstanceConfig(inst.id, 'role_description', e.target.value)}
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
  );
}
