import { useState, useEffect } from 'react';
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
import { toast } from 'sonner';
import { 
  Bot, Plus, Trash2, Smartphone, Shield, MessageSquare, Sparkles, 
  Zap, Clock, Phone, FileText, GripVertical, Settings2, Bell, Pencil
} from 'lucide-react';

// ==================== TYPES ====================
interface CommandConfig {
  id: string;
  instance_name: string;
  authorized_phone: string;
  user_id: string;
  user_name: string | null;
  is_active: boolean;
  created_at: string;
}

interface Shortcut {
  id: string;
  shortcut_name: string;
  description: string | null;
  template_token: string | null;
  template_name: string | null;
  prompt_instructions: string | null;
  is_active: boolean;
  display_order: number;
}

interface FollowupStep {
  action_type: 'whatsapp_message' | 'call' | 'create_activity';
  delay_minutes: number;
  message_template?: string;
  assigned_to?: string;
  activity_type?: string;
  priority?: string;
}

interface FollowupRule {
  id: string;
  name: string;
  description: string | null;
  trigger_status: string;
  steps: FollowupStep[];
  is_active: boolean;
}

interface Instance { id: string; instance_name: string; }
interface Profile { user_id: string; full_name: string | null; }

// ==================== COMPONENT ====================
export function WhatsAppCommandConfig() {
  const [activeTab, setActiveTab] = useState('auth');
  const [configs, setConfigs] = useState<CommandConfig[]>([]);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [followupRules, setFollowupRules] = useState<FollowupRule[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [configsRes, instancesRes, profilesRes, shortcutsRes, rulesRes] = await Promise.all([
      supabase.from('whatsapp_command_config').select('*').order('created_at', { ascending: false }),
      supabase.from('whatsapp_instances').select('id, instance_name').eq('is_active', true),
      supabase.from('profiles').select('user_id, full_name').order('full_name'),
      supabase.from('wjia_command_shortcuts').select('*').order('display_order') as any,
      supabase.from('wjia_followup_rules').select('*').order('display_order') as any,
    ]);
    setConfigs((configsRes.data as any[]) || []);
    setInstances(instancesRes.data || []);
    setProfiles((profilesRes.data || []).filter((p: any) => p.full_name));
    setShortcuts((shortcutsRes.data || []) as Shortcut[]);
    setFollowupRules((rulesRes.data || []) as FollowupRule[]);
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
              <p className="text-sm font-medium">Sistema de Comandos @wjia</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Configure números autorizados, atalhos de comandos e regras de follow-up automático para documentos pendentes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="auth" className="text-xs gap-1">
            <Shield className="h-3.5 w-3.5" /> Autorizados
          </TabsTrigger>
          <TabsTrigger value="shortcuts" className="text-xs gap-1">
            <Zap className="h-3.5 w-3.5" /> Atalhos
          </TabsTrigger>
          <TabsTrigger value="followup" className="text-xs gap-1">
            <Bell className="h-3.5 w-3.5" /> Follow-up
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auth">
          <AuthorizedPhonesTab
            configs={configs}
            instances={instances}
            profiles={profiles}
            onReload={loadData}
          />
        </TabsContent>

        <TabsContent value="shortcuts">
          <ShortcutsTab
            shortcuts={shortcuts}
            onReload={loadData}
          />
        </TabsContent>

        <TabsContent value="followup">
          <FollowupTab
            rules={followupRules}
            profiles={profiles}
            onReload={loadData}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ==================== AUTH TAB ====================
function AuthorizedPhonesTab({ configs, instances, profiles, onReload }: {
  configs: CommandConfig[]; instances: Instance[]; profiles: Profile[]; onReload: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [phone, setPhone] = useState('');

  const handleAdd = async () => {
    if (!selectedInstance || !selectedUser || !phone.trim()) {
      toast.error('Preencha todos os campos');
      return;
    }
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^0+/, '');
    if (normalizedPhone.length < 10) { toast.error('Telefone inválido'); return; }

    const profile = profiles.find(p => p.user_id === selectedUser);
    setAdding(true);
    const { error } = await supabase.from('whatsapp_command_config').insert({
      instance_name: selectedInstance, authorized_phone: normalizedPhone,
      user_id: selectedUser, user_name: profile?.full_name || null,
    } as any);
    setAdding(false);

    if (error) {
      toast.error(error.code === '23505' ? 'Já configurado' : error.message);
      return;
    }
    toast.success('Adicionado!');
    setPhone(''); setSelectedInstance(''); setSelectedUser('');
    onReload();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await supabase.from('whatsapp_command_config').update({ is_active: !isActive } as any).eq('id', id);
    onReload();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('whatsapp_command_config').delete().eq('id', id);
    onReload();
    toast.success('Removido');
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Plus className="h-4 w-4" /> Adicionar Número</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Instância</Label>
              <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {instances.map(i => <SelectItem key={i.id} value={i.instance_name}>{i.instance_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Usuário</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {profiles.map(p => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Telefone</Label>
              <div className="flex gap-2">
                <Input placeholder="5511999999999" value={phone} onChange={e => setPhone(e.target.value)} className="h-9" />
                <Button onClick={handleAdd} disabled={adding} size="sm"><Plus className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {configs.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">Nenhum número configurado</CardContent></Card>
        ) : configs.map(c => (
          <Card key={c.id} className={!c.is_active ? 'opacity-50' : ''}>
            <CardContent className="p-3 flex items-center gap-3">
              <Bot className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{c.user_name || 'Usuário'}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="outline" className="text-[10px] h-5"><Smartphone className="h-3 w-3 mr-1" />{c.authorized_phone}</Badge>
                  <span className="text-[10px] text-muted-foreground">{c.instance_name}</span>
                </div>
              </div>
              <Switch checked={c.is_active} onCheckedChange={() => handleToggle(c.id, c.is_active)} />
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(c.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ==================== SHORTCUTS TAB ====================
function ShortcutsTab({ shortcuts, onReload }: { shortcuts: Shortcut[]; onReload: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ shortcut_name: '', description: '', template_token: '', template_name: '', prompt_instructions: '' });

  const resetForm = () => {
    setForm({ shortcut_name: '', description: '', template_token: '', template_name: '', prompt_instructions: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (s: Shortcut) => {
    setForm({
      shortcut_name: s.shortcut_name,
      description: s.description || '',
      template_token: s.template_token || '',
      template_name: s.template_name || '',
      prompt_instructions: s.prompt_instructions || '',
    });
    setEditingId(s.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.shortcut_name.trim()) { toast.error('Nome do atalho é obrigatório'); return; }
    const payload = {
      shortcut_name: form.shortcut_name.trim(),
      description: form.description || null,
      template_token: form.template_token || null,
      template_name: form.template_name || null,
      prompt_instructions: form.prompt_instructions || null,
    };

    let error;
    if (editingId) {
      ({ error } = await (supabase.from('wjia_command_shortcuts') as any).update(payload).eq('id', editingId));
    } else {
      ({ error } = await (supabase.from('wjia_command_shortcuts') as any).insert({ ...payload, display_order: shortcuts.length }));
    }
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? 'Atalho atualizado!' : 'Atalho criado!');
    resetForm();
    onReload();
  };

  const handleDelete = async (id: string) => {
    await (supabase.from('wjia_command_shortcuts') as any).delete().eq('id', id);
    onReload();
    toast.success('Atalho removido');
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await (supabase.from('wjia_command_shortcuts') as any).update({ is_active: !isActive }).eq('id', id);
    onReload();
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Atalhos que aparecem ao digitar @wjia no chat. Ex: "@wjia procuração" dispara automaticamente o template configurado.
        </p>
        <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Novo
        </Button>
      </div>

      {showForm && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome do Atalho *</Label>
                <Input placeholder="procuração" value={form.shortcut_name} onChange={e => setForm(f => ({ ...f, shortcut_name: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Descrição</Label>
                <Input placeholder="Gera procuração ad judicia" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Token do Template ZapSign</Label>
                <Input placeholder="abc123..." value={form.template_token} onChange={e => setForm(f => ({ ...f, template_token: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nome do Template</Label>
                <Input placeholder="Procuração Ad Judicia" value={form.template_name} onChange={e => setForm(f => ({ ...f, template_name: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Instruções do Prompt (como o robô deve agir)</Label>
              <Textarea
                placeholder="Ao coletar dados para esta procuração, pergunte nome completo, CPF, RG, endereço completo, estado civil, nacionalidade..."
                value={form.prompt_instructions}
                onChange={e => setForm(f => ({ ...f, prompt_instructions: e.target.value }))}
                className="min-h-[80px] text-xs"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleSave}>Salvar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {shortcuts.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
          <Zap className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
          Nenhum atalho configurado
        </CardContent></Card>
      ) : shortcuts.map(s => (
        <Card key={s.id} className={!s.is_active ? 'opacity-50' : ''}>
          <CardContent className="p-3 flex items-center gap-3">
            <Zap className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">@wjia {s.shortcut_name}</span>
                {s.template_name && <Badge variant="secondary" className="text-[10px]">{s.template_name}</Badge>}
              </div>
              {s.description && <p className="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>}
              {s.prompt_instructions && (
                <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate max-w-[300px]">
                  💡 {s.prompt_instructions}
                </p>
              )}
            </div>
            <Switch checked={s.is_active} onCheckedChange={() => handleToggle(s.id, s.is_active)} />
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(s.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ==================== FOLLOWUP TAB ====================
function FollowupTab({ rules, profiles, onReload }: { rules: FollowupRule[]; profiles: Profile[]; onReload: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<FollowupStep[]>([
    { action_type: 'whatsapp_message', delay_minutes: 60, message_template: '' }
  ]);

  const addStep = () => {
    setSteps(prev => [...prev, { action_type: 'whatsapp_message', delay_minutes: 120, message_template: '' }]);
  };

  const removeStep = (idx: number) => {
    setSteps(prev => prev.filter((_, i) => i !== idx));
  };

  const updateStep = (idx: number, field: string, value: any) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Nome é obrigatório'); return; }
    if (steps.length === 0) { toast.error('Adicione pelo menos uma etapa'); return; }

    const { error } = await (supabase.from('wjia_followup_rules') as any).insert({
      name: name.trim(),
      description: description || null,
      trigger_status: 'generated',
      steps,
      display_order: rules.length,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Regra de follow-up criada!');
    setName(''); setDescription('');
    setSteps([{ action_type: 'whatsapp_message', delay_minutes: 60, message_template: '' }]);
    setShowForm(false);
    onReload();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await (supabase.from('wjia_followup_rules') as any).update({ is_active: !isActive }).eq('id', id);
    onReload();
  };

  const handleDelete = async (id: string) => {
    await (supabase.from('wjia_followup_rules') as any).delete().eq('id', id);
    onReload();
    toast.success('Regra removida');
  };

  const actionLabels: Record<string, { label: string; icon: any; color: string }> = {
    whatsapp_message: { label: 'Mensagem WhatsApp', icon: MessageSquare, color: 'text-green-500' },
    call: { label: 'Ligação', icon: Phone, color: 'text-blue-500' },
    create_activity: { label: 'Criar Atividade', icon: FileText, color: 'text-orange-500' },
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Regras de cobrança automática quando o cliente não assina o documento. Defina sequência, canal e intervalo.
        </p>
        <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Nova Regra
        </Button>
      </div>

      {showForm && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome da Regra *</Label>
                <Input placeholder="Cobrança padrão" value={name} onChange={e => setName(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Descrição</Label>
                <Input placeholder="Cobra 3x antes de criar tarefa" value={description} onChange={e => setDescription(e.target.value)} className="h-9" />
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-xs font-semibold">Etapas da Sequência</Label>
              {steps.map((step, idx) => {
                const ActionIcon = actionLabels[step.action_type]?.icon || Clock;
                return (
                  <div key={idx} className="flex items-start gap-2 p-3 rounded-lg border bg-muted/30">
                    <div className="flex items-center gap-1 mt-1">
                      <Badge variant="secondary" className="text-[10px] h-5 w-5 p-0 flex items-center justify-center">{idx + 1}</Badge>
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
                          <Input
                            type="number"
                            min={5}
                            value={step.delay_minutes}
                            onChange={e => updateStep(idx, 'delay_minutes', parseInt(e.target.value) || 60)}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                      {step.action_type === 'whatsapp_message' && (
                        <div className="space-y-1">
                          <Label className="text-[10px]">Mensagem (use {'{{nome}}'}, {'{{documento}}'}, {'{{link}}'})</Label>
                          <Textarea
                            placeholder="Olá {{nome}}! Notamos que o {{documento}} ainda não foi assinado..."
                            value={step.message_template || ''}
                            onChange={e => updateStep(idx, 'message_template', e.target.value)}
                            className="min-h-[60px] text-xs"
                          />
                        </div>
                      )}
                      {step.action_type === 'create_activity' && (
                        <div className="space-y-1">
                          <Label className="text-[10px]">Atribuir a</Label>
                          <Select value={step.assigned_to || ''} onValueChange={v => updateStep(idx, 'assigned_to', v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                            <SelectContent>
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
                );
              })}
              <Button size="sm" variant="outline" onClick={addStep} className="w-full">
                <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Etapa
              </Button>
            </div>

            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleSave}>Salvar Regra</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {rules.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
          <Bell className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
          <p>Nenhuma regra de follow-up configurada</p>
          <p className="text-[11px] mt-1">Crie uma regra para cobrar automaticamente documentos pendentes</p>
        </CardContent></Card>
      ) : rules.map(rule => (
        <Card key={rule.id} className={!rule.is_active ? 'opacity-50' : ''}>
          <CardContent className="p-3">
            <div className="flex items-center gap-3 mb-2">
              <Bell className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{rule.name}</span>
                {rule.description && <p className="text-[11px] text-muted-foreground">{rule.description}</p>}
              </div>
              <Switch checked={rule.is_active} onCheckedChange={() => handleToggle(rule.id, rule.is_active)} />
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(rule.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {(rule.steps || []).map((step: any, idx: number) => {
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
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
