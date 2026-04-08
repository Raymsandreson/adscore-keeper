import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Zap, Plus, Trash2, UserPlus, FolderKanban, Briefcase, ListChecks, ChevronDown, ChevronUp, Users, MessageSquare, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';

interface AutomationAction {
  type: 'create_lead' | 'create_contact' | 'create_activity' | 'create_case' | 'move_lead_stage' | 'create_group' | 'send_group_message' | 'send_private_redirect';
  config: Record<string, any>;
  enabled: boolean;
}

interface Board {
  id: string;
  name: string;
}

interface Stage {
  id: string;
  name: string;
  board_id: string;
}

interface Nucleus {
  id: string;
  name: string;
  prefix: string;
}

const TRIGGER_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  on_activation: {
    label: '⚡ Ao ativar o agente',
    description: 'Executa quando o agente é ativado numa conversa',
    icon: '⚡',
  },
  on_document_signed: {
    label: '✍️ Ao assinar documento',
    description: 'Executa quando um documento ZapSign é assinado',
    icon: '✍️',
  },
};

const ACTION_TYPES = [
  { value: 'create_lead', label: 'Criar Lead', icon: UserPlus, description: 'Cria um lead com nome/telefone do WhatsApp' },
  { value: 'create_contact', label: 'Criar Contato', icon: UserPlus, description: 'Cria um contato com os dados do WhatsApp' },
  { value: 'create_activity', label: 'Criar Atividade', icon: ListChecks, description: 'Cria uma atividade vinculada ao lead' },
  { value: 'create_case', label: 'Criar Caso', icon: Briefcase, description: 'Cria um caso jurídico vinculado ao lead' },
  { value: 'move_lead_stage', label: 'Mover Lead de Etapa', icon: FolderKanban, description: 'Move o lead para um funil/etapa específico' },
  { value: 'create_group', label: 'Criar Grupo WhatsApp', icon: Users, description: 'Cria um grupo com as instâncias configuradas no funil' },
  { value: 'send_group_message', label: 'Enviar Mensagem no Grupo', icon: MessageSquare, description: 'Envia uma mensagem configurável no grupo vinculado ao lead' },
  { value: 'send_private_redirect', label: 'Redirecionar ao Grupo', icon: ArrowRightLeft, description: 'Envia mensagem no privado redirecionando o cliente para o grupo do processo' },
];

interface Props {
  agentId: string;
}

export function AgentAutomationRules({ agentId }: Props) {
  const [rules, setRules] = useState<Record<string, { id?: string; actions: AutomationAction[]; is_active: boolean }>>({});
  const [boards, setBoards] = useState<Board[]>([]);
  const [stagesByBoard, setStagesByBoard] = useState<Record<string, Stage[]>>({});
  const [nuclei, setNuclei] = useState<Nucleus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedTrigger, setExpandedTrigger] = useState<string | null>('on_activation');

  useEffect(() => {
    fetchAll();
  }, [agentId]);

  const fetchAll = async () => {
    setLoading(true);
    const rulesRes = await (supabase as any).from('agent_automation_rules').select('*').eq('agent_id', agentId);
    const boardsRes = await (supabase as any).from('kanban_boards').select('id, name, stages').order('display_order');
    const nucleiRes = await (supabase as any).from('specialized_nuclei').select('id, name, prefix').eq('is_active', true).order('name');

    const rulesMap: Record<string, any> = {};
    for (const trigger of Object.keys(TRIGGER_LABELS)) {
      const existing = (rulesRes.data as any[])?.find((r: any) => r.trigger_type === trigger);
      rulesMap[trigger] = existing
        ? { id: existing.id, actions: existing.actions || [], is_active: existing.is_active }
        : { actions: [], is_active: false };
    }
    setRules(rulesMap);
    const boardsList = (boardsRes.data as any[]) || [];
    setBoards(boardsList);
    setNuclei((nucleiRes.data as any[]) || []);

    // Extract stages from boards' stages JSON column
    const grouped: Record<string, Stage[]> = {};
    boardsList.forEach((b: any) => {
      const stages = Array.isArray(b.stages) ? b.stages : [];
      grouped[b.id] = stages.map((s: any) => ({ id: s.id, name: s.name, board_id: b.id }));
    });
    setStagesByBoard(grouped);
    setLoading(false);
  };

  const handleToggleTrigger = (trigger: string, active: boolean) => {
    setRules(prev => ({
      ...prev,
      [trigger]: { ...prev[trigger], is_active: active },
    }));
  };

  const handleAddAction = (trigger: string, actionType: string) => {
    const defaultConfig: Record<string, any> = {};
    if (actionType === 'create_lead' || actionType === 'move_lead_stage') {
      defaultConfig.board_id = boards[0]?.id || '';
      defaultConfig.stage_id = '';
    }
    if (actionType === 'create_activity') {
      defaultConfig.title = 'Dar andamento';
      defaultConfig.activity_type = 'tarefa';
      defaultConfig.priority = 'normal';
    }
    if (actionType === 'create_case') {
      defaultConfig.nucleus_id = nuclei[0]?.id || '';
    }
    if (actionType === 'send_group_message') {
      defaultConfig.message_template = 'Olá! {nome_cliente} foi orientado(a) a acompanhar o processo por aqui. Qualquer atualização será compartilhada neste grupo. 🙌';
    }
    if (actionType === 'send_private_redirect') {
      defaultConfig.message_template = 'Oi {nome_cliente}! 😊 Para o acompanhamento do seu processo, nosso grupo é o melhor canal — lá toda a equipe jurídica está pronta pra te atualizar de forma proativa sobre tudo que acontece. Mas fico à disposição se precisar de algo!';
      defaultConfig.deactivate_private_agent = true;
    }

    setRules(prev => ({
      ...prev,
      [trigger]: {
        ...prev[trigger],
        actions: [...(prev[trigger]?.actions || []), { type: actionType as any, config: defaultConfig, enabled: true }],
      },
    }));
  };

  const handleRemoveAction = (trigger: string, index: number) => {
    setRules(prev => ({
      ...prev,
      [trigger]: {
        ...prev[trigger],
        actions: prev[trigger].actions.filter((_, i) => i !== index),
      },
    }));
  };

  const handleUpdateActionConfig = (trigger: string, index: number, key: string, value: any) => {
    setRules(prev => {
      const actions = [...prev[trigger].actions];
      actions[index] = { ...actions[index], config: { ...actions[index].config, [key]: value } };
      return { ...prev, [trigger]: { ...prev[trigger], actions } };
    });
  };

  const handleToggleAction = (trigger: string, index: number, enabled: boolean) => {
    setRules(prev => {
      const actions = [...prev[trigger].actions];
      actions[index] = { ...actions[index], enabled };
      return { ...prev, [trigger]: { ...prev[trigger], actions } };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [trigger, rule] of Object.entries(rules)) {
        console.log(`[Automation Save] trigger=${trigger}, id=${rule.id}, actions=${rule.actions.length}, is_active=${rule.is_active}`);
        const payload = {
          agent_id: agentId,
          trigger_type: trigger,
          actions: JSON.parse(JSON.stringify(rule.actions)),
          is_active: rule.is_active,
        };

        if (rule.id) {
          const { error } = await (supabase as any)
            .from('agent_automation_rules')
            .update({ actions: payload.actions, is_active: rule.is_active } as any)
            .eq('id', rule.id);
          if (error) {
            console.error('Update automation error:', error);
            throw error;
          }
        } else if (rule.actions.length > 0 || rule.is_active) {
          const { data, error } = await (supabase as any)
            .from('agent_automation_rules')
            .insert(payload as any)
            .select()
            .single();
          if (error) {
            console.error('Insert automation error:', error);
            throw error;
          }
          if (data) {
            setRules(prev => ({
              ...prev,
              [trigger]: { ...prev[trigger], id: (data as any).id },
            }));
          }
        }
      }
      toast.success('Automações salvas!');
    } catch (e: any) {
      console.error('Save automation failed:', e);
      toast.error('Erro ao salvar: ' + (e.message || JSON.stringify(e)));
    } finally {
      setSaving(false);
    }
  };

  const renderActionConfig = (trigger: string, action: AutomationAction, index: number) => {
    const actionDef = ACTION_TYPES.find(a => a.value === action.type);
    const Icon = actionDef?.icon || Zap;

    return (
      <div key={index} className="border rounded-lg p-3 space-y-2 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{actionDef?.label}</span>
          </div>
          <div className="flex items-center gap-1">
            <Switch checked={action.enabled} onCheckedChange={v => handleToggleAction(trigger, index, v)} />
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveAction(trigger, index)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">{actionDef?.description}</p>

        {(action.type === 'create_lead' || action.type === 'move_lead_stage') && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Funil</Label>
              <Select
                value={action.config.board_id || ''}
                onValueChange={v => {
                  handleUpdateActionConfig(trigger, index, 'board_id', v);
                  handleUpdateActionConfig(trigger, index, 'stage_id', '');
                }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Etapa</Label>
              <Select
                value={action.config.stage_id || ''}
                onValueChange={v => handleUpdateActionConfig(trigger, index, 'stage_id', v)}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Primeira etapa" /></SelectTrigger>
                <SelectContent>
                  {(stagesByBoard[action.config.board_id] || []).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {action.type === 'create_activity' && (
          <div className="space-y-2">
            <div>
              <Label className="text-[10px]">Título da atividade</Label>
              <Input
                className="h-8 text-xs"
                value={action.config.title || ''}
                onChange={e => handleUpdateActionConfig(trigger, index, 'title', e.target.value)}
                placeholder="Ex: Dar andamento"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Tipo</Label>
                <Select
                  value={action.config.activity_type || 'tarefa'}
                  onValueChange={v => handleUpdateActionConfig(trigger, index, 'activity_type', v)}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tarefa">Tarefa</SelectItem>
                    <SelectItem value="ligacao">Ligação</SelectItem>
                    <SelectItem value="reuniao">Reunião</SelectItem>
                    <SelectItem value="documento">Documento</SelectItem>
                    <SelectItem value="notificacao">Notificação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Prioridade</Label>
                <Select
                  value={action.config.priority || 'normal'}
                  onValueChange={v => handleUpdateActionConfig(trigger, index, 'priority', v)}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
        )}

        {action.type === 'create_case' && (
          <div>
            <Label className="text-[10px]">Núcleo</Label>
            <Select
              value={action.config.nucleus_id || ''}
              onValueChange={v => handleUpdateActionConfig(trigger, index, 'nucleus_id', v)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar núcleo..." /></SelectTrigger>
              <SelectContent>
                {nuclei.map(n => <SelectItem key={n.id} value={n.id}>{n.prefix} - {n.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {action.type === 'create_group' && (
          <div>
            <Label className="text-[10px]">Funil (usa instâncias configuradas)</Label>
            <Select
              value={action.config.board_id || ''}
              onValueChange={v => handleUpdateActionConfig(trigger, index, 'board_id', v)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar funil..." /></SelectTrigger>
              <SelectContent>
                {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">O nome do grupo será o nome do lead. Configure as instâncias em Configurações → Grupos.</p>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5"><Zap className="h-4 w-4" />Automações</p>
          <p className="text-[10px] text-muted-foreground">Configure ações automáticas para gatilhos do agente</p>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Salvar
        </Button>
      </div>

      {Object.entries(TRIGGER_LABELS).map(([trigger, meta]) => {
        const rule = rules[trigger];
        const isExpanded = expandedTrigger === trigger;
        const actionCount = rule?.actions?.length || 0;

        return (
          <div key={trigger} className="border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
              onClick={() => setExpandedTrigger(isExpanded ? null : trigger)}
            >
              <div className="flex items-center gap-2">
                <span>{meta.icon}</span>
                <div className="text-left">
                  <p className="text-sm font-medium">{meta.label}</p>
                  <p className="text-[10px] text-muted-foreground">{meta.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {actionCount > 0 && (
                  <Badge variant={rule.is_active ? 'default' : 'secondary'} className="text-[10px]">
                    {actionCount} ação{actionCount > 1 ? 'ões' : ''}
                  </Badge>
                )}
                <Switch
                  checked={rule?.is_active ?? false}
                  onCheckedChange={v => { handleToggleTrigger(trigger, v); }}
                  onClick={e => e.stopPropagation()}
                />
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 space-y-2 border-t">
                {rule?.actions?.map((action, idx) => renderActionConfig(trigger, action, idx))}

                {/* Add action button */}
                <div className="pt-1">
                  <Select onValueChange={v => handleAddAction(trigger, v)}>
                    <SelectTrigger className="h-8 text-xs border-dashed">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Plus className="h-3 w-3" />
                        Adicionar ação
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {ACTION_TYPES
                        .filter(at => !rule?.actions?.some(a => a.type === at.value))
                        .map(at => (
                          <SelectItem key={at.value} value={at.value}>
                            <span className="flex items-center gap-2">
                              <at.icon className="h-3.5 w-3.5" />
                              {at.label}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
