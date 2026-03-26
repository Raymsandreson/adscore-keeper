import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Bot, MessageSquare, Plus, Trash2, Pencil, Hash } from 'lucide-react';

interface InternalShortcut {
  id: string;
  shortcut_name: string;
  description: string | null;
  prompt_instructions: string | null;
  is_active: boolean;
  assistant_type: string;
  model: string;
  [key: string]: any;
}

interface Profile {
  user_id: string;
  full_name: string | null;
}

interface MemberAssistantSettingsProps {
  shortcuts?: InternalShortcut[];
  profiles?: Profile[];
  onReload?: () => void;
}

const MODELS = [
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (rápido)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (avançado)' },
  { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
  { value: 'openai/gpt-5', label: 'GPT-5 (avançado)' },
];

export function MemberAssistantSettings({ shortcuts = [], profiles = [], onReload }: MemberAssistantSettingsProps) {
  const [isActive, setIsActive] = useState(true);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [configId, setConfigId] = useState<string | null>(null);
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [commandProcessorPrompt, setCommandProcessorPrompt] = useState('');
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [batchDelaySeconds, setBatchDelaySeconds] = useState(6);
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [showAssistantPromptEditor, setShowAssistantPromptEditor] = useState(false);
  const [savingAssistantPrompt, setSavingAssistantPrompt] = useState(false);

  // Internal command form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    shortcut_name: '',
    description: '',
    prompt_instructions: '',
    model: 'google/gemini-2.5-flash',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [configRes, instRes] = await Promise.all([
      supabase.from('member_assistant_config').select('*').limit(1).maybeSingle(),
      supabase.from('whatsapp_instances').select('id, instance_name').eq('is_active', true).order('instance_name'),
    ]);
    setInstances(instRes.data || []);
    if (configRes.data) {
      setConfigId(configRes.data.id);
      setIsActive(configRes.data.is_active ?? true);
      setInstanceId((configRes.data as any).instance_id || null);
      setCommandProcessorPrompt((configRes.data as any).command_processor_prompt || '');
      setBatchDelaySeconds((configRes.data as any).batch_delay_seconds ?? 6);
      setAssistantPrompt((configRes.data as any).assistant_prompt || '');
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const selectedInst = instances.find((i: any) => i.id === instanceId);
      const payload: any = {
        is_active: isActive,
        instance_id: instanceId || null,
        instance_name: selectedInst?.instance_name || null,
        batch_delay_seconds: batchDelaySeconds,
        updated_at: new Date().toISOString(),
      };

      if (configId) {
        const { error } = await supabase.from('member_assistant_config').update(payload).eq('id', configId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('member_assistant_config').insert(payload).select('id').single();
        if (error) throw error;
        setConfigId(data.id);
      }
      toast.success('Configurações do assistente salvas!');
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setForm({ shortcut_name: '', description: '', prompt_instructions: '', model: 'google/gemini-2.5-flash' });
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (s: InternalShortcut) => {
    setForm({
      shortcut_name: s.shortcut_name,
      description: s.description || '',
      prompt_instructions: s.prompt_instructions || '',
      model: s.model || 'google/gemini-2.5-flash',
    });
    setEditingId(s.id);
    setShowForm(true);
  };

  const handleSaveCommand = async () => {
    if (!form.shortcut_name.trim()) { toast.error('Nome do comando é obrigatório'); return; }
    const payload = {
      shortcut_name: form.shortcut_name.trim().toLowerCase().replace(/\s/g, '_'),
      description: form.description || null,
      prompt_instructions: form.prompt_instructions || null,
      model: form.model,
      assistant_type: 'assistant',
      command_scope: 'internal',
      is_active: true,
    };

    let error;
    if (editingId) {
      ({ error } = await (supabase.from('wjia_command_shortcuts') as any).update(payload).eq('id', editingId));
    } else {
      ({ error } = await (supabase.from('wjia_command_shortcuts') as any).insert({ ...payload, display_order: shortcuts.length }));
    }
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? 'Comando atualizado!' : 'Comando criado!');
    resetForm();
    onReload?.();
  };

  const handleDeleteCommand = async (id: string) => {
    await (supabase.from('wjia_command_shortcuts') as any).delete().eq('id', id);
    onReload?.();
    toast.success('Comando removido');
  };

  const handleToggleCommand = async (id: string, isActive: boolean) => {
    await (supabase.from('wjia_command_shortcuts') as any).update({ is_active: !isActive }).eq('id', id);
    onReload?.();
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-5 w-5" />
                Assistente IA para Membros
              </CardTitle>
              <CardDescription>
                Membros da equipe podem enviar mensagens pelo WhatsApp para interagir com a IA
              </CardDescription>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-3 bg-muted/50">
            <div className="flex items-start gap-2">
              <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Quando ativo, o sistema identifica automaticamente mensagens recebidas de números cadastrados nos perfis dos membros da equipe.</p>
                <p>O membro pode: <strong>resumo do dia</strong>, <strong>tarefas atrasadas</strong>, <strong>criar/editar leads</strong>, <strong>mudar etapa do funil</strong>, <strong>criar contatos</strong>, <strong>vincular contatos a leads</strong>, <strong>criar atividades</strong>, <strong>consultar metas</strong> e conversar livremente.</p>
                <p>⚠️ Certifique-se de que os membros têm o número de WhatsApp cadastrado no perfil.</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Instância que responde aos membros</Label>
            <Select value={instanceId || '__any__'} onValueChange={(v) => setInstanceId(v === '__any__' ? null : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Qualquer instância ativa..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Qualquer instância</SelectItem>
                {instances.map((inst: any) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Se definido, apenas mensagens recebidas nesta instância ativarão o assistente para membros.
            </p>
           </div>

          <div className="space-y-2">
            <Label>Delay de agrupamento (segundos)</Label>
            <p className="text-xs text-muted-foreground">
              Aguarda esse tempo para juntar várias mensagens do membro antes de processar. Se o membro enviar 3 msgs em 5s e o delay for 8s, todas serão processadas juntas.
            </p>
            <Input
              type="number"
              min={0}
              max={30}
              value={batchDelaySeconds}
              onChange={e => setBatchDelaySeconds(parseInt(e.target.value) || 0)}
              className="w-24"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* PROMPT DO ASSISTENTE DE MEMBROS (mensagens diretas) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-5 w-5" />
                Prompt do Assistente (mensagens diretas)
              </CardTitle>
              <CardDescription>
                Prompt de sistema usado pela IA quando membros enviam mensagens diretas (sem ##)
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowAssistantPromptEditor(!showAssistantPromptEditor)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> {showAssistantPromptEditor ? 'Fechar' : 'Editar'}
            </Button>
          </div>
        </CardHeader>
        {showAssistantPromptEditor && (
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-3 bg-muted/50">
              <p className="text-xs text-muted-foreground">
                Deixe em branco para usar o prompt padrão. Variáveis disponíveis: <code>{'{member_name}'}</code>, <code>{'{member_id}'}</code>. 
                O prompt padrão atual está pré-carregado abaixo para referência.
              </p>
            </div>
            {!assistantPrompt && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setAssistantPrompt(DEFAULT_ASSISTANT_PROMPT)}>
                  Carregar prompt padrão para edição
                </Button>
              </div>
            )}
            <Textarea
              placeholder="Deixe vazio para usar o prompt padrão..."
              value={assistantPrompt}
              onChange={e => setAssistantPrompt(e.target.value)}
              className="min-h-[350px] text-xs font-mono"
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setAssistantPrompt('')}>Limpar (usar padrão)</Button>
              <Button size="sm" disabled={savingAssistantPrompt} onClick={async () => {
                setSavingAssistantPrompt(true);
                try {
                  const payload = { assistant_prompt: assistantPrompt || null, updated_at: new Date().toISOString() };
                  if (configId) {
                    const { error } = await supabase.from('member_assistant_config').update(payload).eq('id', configId);
                    if (error) throw error;
                  } else {
                    const { data, error } = await supabase.from('member_assistant_config').insert(payload).select('id').single();
                    if (error) throw error;
                    setConfigId(data.id);
                  }
                  toast.success('Prompt do assistente salvo!');
                } catch (e: any) { toast.error(e.message); } finally { setSavingAssistantPrompt(false); }
              }}>
                {savingAssistantPrompt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span className="ml-1">Salvar Prompt</span>
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-5 w-5" />
                Prompt do Processador de Comandos
              </CardTitle>
              <CardDescription>
                Prompt de sistema usado pela IA ao processar comandos ## dos membros
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowPromptEditor(!showPromptEditor)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> {showPromptEditor ? 'Fechar' : 'Editar'}
            </Button>
          </div>
        </CardHeader>
        {showPromptEditor && (
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-3 bg-muted/50">
              <p className="text-xs text-muted-foreground">
                Deixe em branco para usar o prompt padrão do sistema. Variáveis disponíveis: <code>{'{assessor_name}'}</code>, <code>{'{assessor_id}'}</code>, <code>{'{assessores_list}'}</code>, <code>{'{activity_types}'}</code>, <code>{'{boards_list}'}</code>, <code>{'{nuclei_list}'}</code>, <code>{'{routine_context}'}</code>, <code>{'{current_date}'}</code>
              </p>
            </div>
            <Textarea
              placeholder="Deixe vazio para usar o prompt padrão..."
              value={commandProcessorPrompt}
              onChange={e => setCommandProcessorPrompt(e.target.value)}
              className="min-h-[250px] text-xs font-mono"
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => { setCommandProcessorPrompt(''); }}>Limpar</Button>
              <Button size="sm" disabled={savingPrompt} onClick={async () => {
                setSavingPrompt(true);
                try {
                  const payload = { command_processor_prompt: commandProcessorPrompt || null, updated_at: new Date().toISOString() };
                  if (configId) {
                    const { error } = await supabase.from('member_assistant_config').update(payload).eq('id', configId);
                    if (error) throw error;
                  } else {
                    const { data, error } = await supabase.from('member_assistant_config').insert(payload).select('id').single();
                    if (error) throw error;
                    setConfigId(data.id);
                  }
                  toast.success('Prompt salvo!');
                } catch (e: any) { toast.error(e.message); } finally { setSavingPrompt(false); }
              }}>
                {savingPrompt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span className="ml-1">Salvar Prompt</span>
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ## INTERNAL COMMANDS */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Hash className="h-5 w-5" />
                Comandos Rápidos (##)
              </CardTitle>
              <CardDescription>
                Qualquer membro pode digitar <strong>##comando</strong> em qualquer conversa para executar ações
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => { resetForm(); setShowForm(!showForm); }}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Novo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border p-3 bg-muted/50">
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Exemplos: <strong>##lead</strong> (adicionar como lead), <strong>##caso</strong> (criar caso jurídico), <strong>##contrato</strong> (gerar contrato)</p>
              <p>O comando é deletado automaticamente da conversa e processado em segundo plano.</p>
            </div>
          </div>

          {showForm && (
            <Card className="border-primary/30">
              <CardContent className="p-4 space-y-3">
                <p className="text-xs font-medium text-primary">{editingId ? '✏️ Editando comando' : '➕ Novo comando ##'}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nome do Comando *</Label>
                    <Input placeholder="lead" value={form.shortcut_name} onChange={e => setForm(f => ({ ...f, shortcut_name: e.target.value.replace(/\s/g, '').toLowerCase() }))} className="h-9" />
                    <p className="text-[10px] text-muted-foreground">Acionado por <strong>##nome</strong> no WhatsApp</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Descrição</Label>
                    <Input placeholder="Adiciona contato como lead" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="h-9" />
                  </div>
                </div>
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
                  <Label className="text-xs">Instruções para a IA</Label>
                  <Textarea
                    placeholder="Quando o membro enviar ##lead, analise a conversa e crie um novo lead com os dados disponíveis..."
                    value={form.prompt_instructions}
                    onChange={e => setForm(f => ({ ...f, prompt_instructions: e.target.value }))}
                    className="min-h-[100px] text-xs"
                  />
                </div>
                <div className="flex gap-2 justify-end border-t pt-3">
                  <Button size="sm" variant="ghost" onClick={resetForm}>Cancelar</Button>
                  <Button size="sm" onClick={handleSaveCommand}>{editingId ? 'Atualizar' : 'Salvar'}</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {shortcuts.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              <Hash className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
              Nenhum comando ## configurado
            </div>
          ) : shortcuts.map(s => (
            <div key={s.id} className={`flex items-center gap-3 p-3 rounded-lg border ${!s.is_active ? 'opacity-50' : ''}`}>
              <Hash className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">##{ s.shortcut_name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {MODELS.find(m => m.value === s.model)?.label || s.model}
                  </Badge>
                </div>
                {s.description && <p className="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>}
              </div>
              <Switch checked={s.is_active} onCheckedChange={() => handleToggleCommand(s.id, s.is_active)} />
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(s)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteCommand(s.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
