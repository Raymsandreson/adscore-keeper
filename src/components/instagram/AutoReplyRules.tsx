import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { 
  Bot, 
  Plus, 
  Edit2, 
  Trash2, 
  Zap,
  MessageCircle,
  AtSign,
  UserPlus,
  Mail,
  AlertCircle,
  Play,
  Pause,
  Settings
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AutoReplyRule {
  id: string;
  platform: string;
  name: string;
  trigger_type: string;
  trigger_keywords: string[];
  reply_templates: string[];
  is_active: boolean;
  delay_seconds: number;
  max_replies_per_hour: number;
  replies_count: number;
}

const TRIGGER_TYPES = [
  { value: 'all_comments', label: 'Todos os Comentários', icon: MessageCircle, description: 'Responde a todos os comentários' },
  { value: 'keyword', label: 'Palavra-chave', icon: Zap, description: 'Responde quando detecta palavras específicas' },
  { value: 'mention', label: 'Menção', icon: AtSign, description: 'Responde quando é mencionado' },
  { value: 'new_follower', label: 'Novo Seguidor', icon: UserPlus, description: 'Envia mensagem para novos seguidores' },
  { value: 'dm', label: 'Mensagem Direta', icon: Mail, description: 'Responde a DMs recebidas' },
];

export const AutoReplyRules = () => {
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutoReplyRule | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('instagram');
  const [triggerType, setTriggerType] = useState('keyword');
  const [keywords, setKeywords] = useState('');
  const [templates, setTemplates] = useState('');
  const [delaySeconds, setDelaySeconds] = useState('0');
  const [maxRepliesPerHour, setMaxRepliesPerHour] = useState('20');

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const { data, error } = await supabase
        .from('instagram_auto_replies')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRules(data || []);
    } catch (error) {
      console.error('Error fetching rules:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveRule = async () => {
    if (!name.trim()) {
      toast.error('Digite um nome para a regra');
      return;
    }
    if (!templates.trim()) {
      toast.error('Adicione pelo menos uma resposta automática');
      return;
    }

    const keywordsArray = keywords.split(',').map(k => k.trim()).filter(k => k);
    const templatesArray = templates.split('\n---\n').map(t => t.trim()).filter(t => t);

    try {
      if (editingRule) {
        const { error } = await supabase
          .from('instagram_auto_replies')
          .update({
            name,
            platform,
            trigger_type: triggerType,
            trigger_keywords: keywordsArray,
            reply_templates: templatesArray,
            delay_seconds: parseInt(delaySeconds) || 0,
            max_replies_per_hour: parseInt(maxRepliesPerHour) || 20,
          })
          .eq('id', editingRule.id);

        if (error) throw error;
        toast.success('Regra atualizada!');
      } else {
        const { error } = await supabase
          .from('instagram_auto_replies')
          .insert({
            name,
            platform,
            trigger_type: triggerType,
            trigger_keywords: keywordsArray,
            reply_templates: templatesArray,
            delay_seconds: parseInt(delaySeconds) || 0,
            max_replies_per_hour: parseInt(maxRepliesPerHour) || 20,
            is_active: true,
            replies_count: 0,
          });

        if (error) throw error;
        toast.success('Regra criada!');
      }

      setIsDialogOpen(false);
      resetForm();
      fetchRules();
    } catch (error) {
      console.error('Error saving rule:', error);
      toast.error('Erro ao salvar regra');
    }
  };

  const handleToggleRule = async (rule: AutoReplyRule) => {
    try {
      const { error } = await supabase
        .from('instagram_auto_replies')
        .update({ is_active: !rule.is_active })
        .eq('id', rule.id);

      if (error) throw error;
      toast.success(rule.is_active ? 'Regra desativada' : 'Regra ativada');
      fetchRules();
    } catch (error) {
      console.error('Error toggling rule:', error);
      toast.error('Erro ao alterar status');
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const { error } = await supabase
        .from('instagram_auto_replies')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Regra removida');
      fetchRules();
    } catch (error) {
      console.error('Error deleting rule:', error);
      toast.error('Erro ao remover regra');
    }
  };

  const handleEditRule = (rule: AutoReplyRule) => {
    setEditingRule(rule);
    setName(rule.name);
    setPlatform(rule.platform);
    setTriggerType(rule.trigger_type);
    setKeywords(rule.trigger_keywords.join(', '));
    setTemplates(rule.reply_templates.join('\n---\n'));
    setDelaySeconds(rule.delay_seconds.toString());
    setMaxRepliesPerHour(rule.max_replies_per_hour.toString());
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setEditingRule(null);
    setName('');
    setPlatform('instagram');
    setTriggerType('keyword');
    setKeywords('');
    setTemplates('');
    setDelaySeconds('0');
    setMaxRepliesPerHour('20');
  };

  const getTriggerIcon = (type: string) => {
    const trigger = TRIGGER_TYPES.find(t => t.value === type);
    return trigger ? trigger.icon : Zap;
  };

  const getTriggerLabel = (type: string) => {
    const trigger = TRIGGER_TYPES.find(t => t.value === type);
    return trigger ? trigger.label : type;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-muted-foreground mt-4">Carregando regras...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <Card className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">Sobre Automação de Respostas</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                As regras de automação precisam das permissões <code className="bg-amber-200 dark:bg-amber-800 px-1 rounded">instagram_manage_comments</code> e 
                <code className="bg-amber-200 dark:bg-amber-800 px-1 rounded ml-1">pages_messaging</code> para funcionar automaticamente. 
                Por enquanto, use este módulo para organizar suas respostas padrão e agilizar o trabalho manual.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Regras de Resposta Automática
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure templates de resposta para agilizar seu engajamento
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nova Regra
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingRule ? 'Editar Regra' : 'Nova Regra de Resposta'}</DialogTitle>
              <DialogDescription>
                Configure quando e como responder automaticamente
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <div className="space-y-2">
                <Label>Nome da Regra</Label>
                <Input
                  placeholder="Ex: Resposta de agradecimento"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plataforma</Label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="instagram">Instagram</SelectItem>
                      <SelectItem value="facebook">Facebook</SelectItem>
                      <SelectItem value="all">Ambas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Gatilho</Label>
                  <Select value={triggerType} onValueChange={setTriggerType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRIGGER_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex items-center gap-2">
                            <type.icon className="h-4 w-4" />
                            {type.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {triggerType === 'keyword' && (
                <div className="space-y-2">
                  <Label>Palavras-chave (separadas por vírgula)</Label>
                  <Input
                    placeholder="preço, quanto custa, valor, orçamento"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    A resposta será enviada quando qualquer palavra-chave for detectada
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Respostas (separe múltiplas com ---)</Label>
                <Textarea
                  placeholder="Obrigado pelo comentário! 😊 Ficamos felizes em ter você aqui!
---
Que bom que gostou! Siga nosso perfil para mais novidades! 🚀"
                  value={templates}
                  onChange={(e) => setTemplates(e.target.value)}
                  rows={5}
                />
                <p className="text-xs text-muted-foreground">
                  Uma resposta aleatória será escolhida para parecer mais natural
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Delay (segundos)</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Máx. respostas/hora</Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="20"
                    value={maxRepliesPerHour}
                    onChange={(e) => setMaxRepliesPerHour(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveRule}>
                {editingRule ? 'Salvar' : 'Criar Regra'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Rules List */}
      {rules.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Nenhuma regra configurada</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Crie regras de resposta automática para agilizar seu engajamento
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Primeira Regra
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rules.map((rule) => {
            const Icon = getTriggerIcon(rule.trigger_type);

            return (
              <Card key={rule.id} className={`border-border/50 transition-all ${rule.is_active ? '' : 'opacity-60'}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${rule.is_active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">{rule.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {getTriggerLabel(rule.trigger_type)} • {rule.platform === 'all' ? 'Todas' : rule.platform}
                        </CardDescription>
                      </div>
                    </div>
                    <Switch
                      checked={rule.is_active}
                      onCheckedChange={() => handleToggleRule(rule)}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {rule.trigger_keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {rule.trigger_keywords.slice(0, 4).map((kw, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {kw}
                          </Badge>
                        ))}
                        {rule.trigger_keywords.length > 4 && (
                          <Badge variant="secondary" className="text-xs">
                            +{rule.trigger_keywords.length - 4}
                          </Badge>
                        )}
                      </div>
                    )}

                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground mb-1">Exemplo de resposta:</p>
                      <p className="text-sm line-clamp-2">{rule.reply_templates[0]}</p>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{rule.replies_count} enviadas</span>
                        <span>{rule.reply_templates.length} variações</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditRule(rule)}>
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteRule(rule.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
