import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Plus, Trash2, Sparkles, Copy, Save, Loader2 } from 'lucide-react';
import { useActivityMessageTemplates, TEMPLATE_VARIABLES, ActivityMessageTemplate } from '@/hooks/useActivityMessageTemplates';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Board {
  id: string;
  name: string;
  board_type?: string;
}

export function ActivityMessageTemplateSettings() {
  const { templates, loading, saveTemplate, deleteTemplate, DEFAULT_TEMPLATE } = useActivityMessageTemplates();
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<Board[]>([]);
  const [workflows, setWorkflows] = useState<Board[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Partial<ActivityMessageTemplate> | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editName, setEditName] = useState('');
  const [editBoardId, setEditBoardId] = useState<string>('');
  const [editWorkflowId, setEditWorkflowId] = useState<string>('');
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');

  useEffect(() => {
    if (open) {
      fetchBoards();
    }
  }, [open]);

  const fetchBoards = async () => {
    const { data } = await supabase.from('kanban_boards').select('id, name, board_type').order('name');
    if (data) {
      setBoards(data.filter(b => b.board_type !== 'workflow'));
      setWorkflows(data.filter(b => b.board_type === 'workflow'));
    }
  };

  const handleNew = () => {
    setSelectedTemplate({});
    setEditContent(DEFAULT_TEMPLATE);
    setEditName('Novo modelo');
    setEditBoardId('');
    setEditWorkflowId('');
    setEditIsDefault(false);
  };

  const handleSelect = (template: ActivityMessageTemplate) => {
    setSelectedTemplate(template);
    setEditContent(template.template_content);
    setEditName(template.name);
    setEditBoardId(template.board_id || '');
    setEditWorkflowId(template.workflow_id || '');
    setEditIsDefault(template.is_default);
  };

  const handleSave = async () => {
    if (!editContent.trim()) {
      toast.error('O conteúdo do modelo não pode ser vazio');
      return;
    }
    setSaving(true);
    const { error } = await saveTemplate({
      id: selectedTemplate?.id,
      name: editName || 'Modelo padrão',
      template_content: editContent,
      board_id: editBoardId || null,
      workflow_id: editWorkflowId || null,
      is_default: editIsDefault,
    });
    setSaving(false);
    if (error) {
      toast.error('Erro ao salvar modelo');
    } else {
      toast.success('Modelo salvo!');
    }
  };

  const handleDelete = async () => {
    if (!selectedTemplate?.id) return;
    const { error } = await deleteTemplate(selectedTemplate.id);
    if (!error) {
      toast.success('Modelo excluído');
      setSelectedTemplate(null);
    }
  };

  const insertVariable = (varStr: string) => {
    setEditContent(prev => prev + varStr);
  };

  const handleGenerateWithAI = async () => {
    if (!aiPrompt.trim()) {
      toast.error('Descreva o que deseja no modelo');
      return;
    }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-text-editor', {
        body: {
          action: 'custom',
          text: aiPrompt,
          custom_prompt: `Você é um especialista em criação de modelos de mensagens para WhatsApp de escritórios de advocacia.

O usuário quer criar um modelo de mensagem para atividades do CRM.

Variáveis disponíveis que você DEVE usar no modelo (use exatamente como estão):
${TEMPLATE_VARIABLES.map(v => `- ${v.var}: ${v.label}`).join('\n')}

REGRAS:
- Use formatação WhatsApp (*negrito*, _itálico_)
- Inclua as variáveis dinâmicas usando a sintaxe {{variavel}}
- O modelo deve ser profissional mas acolhedor
- Mantenha a estrutura clara com quebras de linha
- NÃO inclua explicações, APENAS o modelo de mensagem
- Retorne SOMENTE o texto do modelo pronto para uso

Pedido do usuário: ${aiPrompt}`,
        },
      });
      if (error) throw error;
      const generatedText = data?.text || data?.result || '';
      if (generatedText) {
        setEditContent(generatedText);
        toast.success('Modelo gerado pela IA!');
      } else {
        toast.error('IA não retornou conteúdo');
      }
    } catch (e: any) {
      toast.error('Erro ao gerar: ' + (e.message || 'desconhecido'));
    }
    setGenerating(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileText className="h-4 w-4" />
          Modelos de Mensagem
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Modelos de Mensagem por Funil / Fluxo
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[250px_1fr] gap-4 h-[65vh]">
          {/* Left: Template List */}
          <div className="border rounded-lg p-3 space-y-2">
            <Button size="sm" className="w-full gap-1" onClick={handleNew}>
              <Plus className="h-4 w-4" /> Novo Modelo
            </Button>
            <ScrollArea className="h-[calc(65vh-60px)]">
              <div className="space-y-1.5">
                {templates.map(t => {
                  const boardName = boards.find(b => b.id === t.board_id)?.name || workflows.find(w => w.id === t.workflow_id)?.name;
                  return (
                    <div
                      key={t.id}
                      className={`p-2 rounded-md cursor-pointer border text-sm transition-colors ${selectedTemplate?.id === t.id ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
                      onClick={() => handleSelect(t)}
                    >
                      <p className="font-medium truncate">{t.name}</p>
                      {boardName && <p className="text-xs text-muted-foreground truncate">{boardName}</p>}
                      {t.is_default && <Badge variant="secondary" className="text-[10px] mt-1">Padrão</Badge>}
                    </div>
                  );
                })}
                {templates.length === 0 && !loading && (
                  <p className="text-xs text-muted-foreground text-center py-4">Nenhum modelo criado</p>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right: Editor */}
          {selectedTemplate ? (
            <div className="border rounded-lg p-4 space-y-4 overflow-y-auto">
              {/* Name & Context */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Nome do modelo</Label>
                  <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8" />
                </div>
                <div className="flex items-center gap-3 pt-4">
                  <Switch checked={editIsDefault} onCheckedChange={setEditIsDefault} />
                  <Label className="text-xs">Modelo padrão (usado quando não há específico)</Label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Funil de Vendas</Label>
                  <Select value={editBoardId} onValueChange={setEditBoardId}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Nenhum (global)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum (global)</SelectItem>
                      {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Fluxo de Trabalho</Label>
                  <Select value={editWorkflowId} onValueChange={setEditWorkflowId}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {workflows.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* AI Generation */}
              <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Gerar modelo com IA
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    placeholder="Ex: Modelo formal para comunicar andamento de processo INSS..."
                    className="h-8 text-xs flex-1"
                  />
                  <Button size="sm" variant="secondary" onClick={handleGenerateWithAI} disabled={generating} className="gap-1 h-8">
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Gerar
                  </Button>
                </div>
              </div>

              {/* Dynamic Variables */}
              <div>
                <Label className="text-xs font-medium mb-1 block">Campos dinâmicos (clique para inserir)</Label>
                <div className="flex flex-wrap gap-1">
                  {TEMPLATE_VARIABLES.map(v => (
                    <Badge
                      key={v.var}
                      variant="outline"
                      className="cursor-pointer hover:bg-primary/10 text-[10px]"
                      onClick={() => insertVariable(v.var)}
                      title={v.label}
                    >
                      {v.var}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Template Editor */}
              <div>
                <Label className="text-xs font-medium">Conteúdo do modelo</Label>
                <Textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="min-h-[250px] font-mono text-xs"
                  placeholder="Digite o modelo da mensagem..."
                />
              </div>

              {/* Actions */}
              <div className="flex justify-between">
                {selectedTemplate?.id && (
                  <Button variant="destructive" size="sm" onClick={handleDelete} className="gap-1">
                    <Trash2 className="h-3.5 w-3.5" /> Excluir
                  </Button>
                )}
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(editContent); toast.success('Copiado!'); }} className="gap-1">
                    <Copy className="h-3.5 w-3.5" /> Copiar
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Salvar
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="border rounded-lg flex items-center justify-center text-muted-foreground text-sm">
              Selecione ou crie um modelo de mensagem
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
