import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Hash, Type, Eye, MessageSquare, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface Instance {
  id: string;
  instance_name: string;
  owner_phone: string | null;
}

interface Board {
  id: string;
  name: string;
}

interface GroupSettings {
  group_name_prefix: string;
  sequence_start: number;
  current_sequence: number;
  lead_fields: string[];
  initial_message_template: string;
  use_ai_message: boolean;
  forward_document_types: string[];
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

export function BoardGroupInstancesConfig() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<string>('');
  const [linkedInstances, setLinkedInstances] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<GroupSettings>({
    group_name_prefix: '',
    sequence_start: 1,
    current_sequence: 0,
    lead_fields: ['lead_name'],
    initial_message_template: '',
    use_ai_message: false,
    forward_document_types: [],
  });
  const [savingSettings, setSavingSettings] = useState(false);

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
    const boardsRes = await (supabase as any).from('kanban_boards').select('id, name').order('display_order');
    const instancesRes = await (supabase as any).from('whatsapp_instances').select('id, instance_name, owner_phone').eq('is_active', true);
    setBoards((boardsRes.data as any[]) || []);
    setInstances((instancesRes.data as any[]) || []);
    if (boardsRes.data && boardsRes.data.length > 0) {
      setSelectedBoard(boardsRes.data[0].id);
    }
    setLoading(false);
  };

  const fetchLinked = async () => {
    const { data } = await (supabase as any)
      .from('board_group_instances')
      .select('instance_id')
      .eq('board_id', selectedBoard);
    setLinkedInstances((data || []).map((d: any) => d.instance_id));
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
        sequence_start: data.sequence_start || 1,
        current_sequence: data.current_sequence || 0,
        lead_fields: data.lead_fields || ['lead_name'],
        initial_message_template: data.initial_message_template || '',
        use_ai_message: data.use_ai_message || false,
        forward_document_types: data.forward_document_types || [],
      });
    } else {
      setSettings({
        group_name_prefix: '', sequence_start: 1, current_sequence: 0, lead_fields: ['lead_name'],
        initial_message_template: '', use_ai_message: false, forward_document_types: [],
      });
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

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const { data: existing } = await (supabase as any)
        .from('board_group_settings')
        .select('id')
        .eq('board_id', selectedBoard)
        .maybeSingle();

      const payload = {
        group_name_prefix: settings.group_name_prefix,
        sequence_start: settings.sequence_start,
        lead_fields: settings.lead_fields,
        initial_message_template: settings.initial_message_template || null,
        use_ai_message: settings.use_ai_message,
        forward_document_types: settings.forward_document_types,
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

  const getPreviewName = () => {
    const parts: string[] = [];
    if (settings.group_name_prefix) parts.push(settings.group_name_prefix);
    const seq = settings.current_sequence > 0 ? settings.current_sequence + 1 : settings.sequence_start;
    parts.push(String(seq).padStart(4, '0'));
    const fieldLabels = settings.lead_fields.map(f => {
      const opt = LEAD_FIELD_OPTIONS.find(o => o.value === f);
      return opt ? `[${opt.label}]` : `[${f}]`;
    });
    parts.push(fieldLabels.join(' '));
    return parts.join(' ');
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
                <Label className="text-[11px] text-muted-foreground">Prefixo</Label>
                <Input
                  value={settings.group_name_prefix}
                  onChange={e => setSettings(prev => ({ ...prev, group_name_prefix: e.target.value }))}
                  placeholder="Ex: CASO, GRP"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Sequência inicia em</Label>
                <Input
                  type="number"
                  min={1}
                  value={settings.sequence_start}
                  onChange={e => setSettings(prev => ({ ...prev, sequence_start: parseInt(e.target.value) || 1 }))}
                  className="h-8 text-xs"
                />
              </div>
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

            <div className="flex items-center gap-2 p-2 rounded bg-muted/50 border">
              <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground">Preview:</span>
              <span className="text-[11px] font-medium truncate">{getPreviewName()}</span>
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
          </div>

          {/* Document Forwarding */}
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
            {instances.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma instância ativa encontrada.</p>
            ) : (
              instances.map(inst => (
                <label key={inst.id} className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors">
                  <Checkbox
                    checked={linkedInstances.includes(inst.id)}
                    onCheckedChange={() => toggleInstance(inst.id)}
                    disabled={saving}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{inst.instance_name}</p>
                    {inst.owner_phone && (
                      <p className="text-[11px] text-muted-foreground">{inst.owner_phone}</p>
                    )}
                  </div>
                  {linkedInstances.includes(inst.id) && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">Incluída</Badge>
                  )}
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
