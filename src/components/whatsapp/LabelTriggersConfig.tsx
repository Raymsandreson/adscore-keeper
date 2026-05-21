import { useEffect, useState } from 'react';
import { Tag, Loader2, Plus, Trash2, RefreshCw, FileSignature, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { db } from '@/integrations/supabase';
import { cloudFunctions } from '@/lib/functionRouter';

interface Instance {
  instance_name: string;
  is_active: boolean | null;
}
interface UazLabel {
  id: string;
  name: string;
  color?: string | null;
}
interface ZapTemplate {
  id: string;
  name: string;
}
interface Trigger {
  id: string;
  label_id: string;
  label_name: string;
  instance_name: string;
  zapsign_template_id: string;
  zapsign_template_name: string | null;
  auto_extract_media: boolean;
  message_lookback_count: number;
  enabled: boolean;
}

export function LabelTriggersConfig() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [labels, setLabels] = useState<UazLabel[]>([]);
  const [templates, setTemplates] = useState<ZapTemplate[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingTriggers, setLoadingTriggers] = useState(false);

  // Form pra adicionar novo gatilho
  const [newLabelId, setNewLabelId] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [newLookback, setNewLookback] = useState(200);
  const [newAutoMedia, setNewAutoMedia] = useState(true);
  const [saving, setSaving] = useState(false);

  // 1. Carregar instâncias e templates uma vez
  useEffect(() => {
    (async () => {
      const { data: insts } = await db
        .from('whatsapp_instances')
        .select('instance_name, is_active')
        .eq('is_active', true)
        .order('instance_name');
      setInstances((insts as Instance[]) || []);
      if (insts && insts.length > 0) setSelectedInstance(insts[0].instance_name);

      setLoadingTemplates(true);
      try {
        const { data, error } = await cloudFunctions.invoke<any>('zapsign-api', {
          body: { action: 'list_templates' },
        });
        if (error) throw error;
        const arr = data?.templates?.results || data?.templates || [];
        setTemplates(
          (Array.isArray(arr) ? arr : []).map((t: any) => ({
            id: String(t.id || t.token || ''),
            name: String(t.name || t.title || 'Sem nome'),
          })).filter((t: any) => t.id),
        );
      } catch (e: any) {
        toast.error('Erro carregando templates ZapSign: ' + (e?.message || ''));
      } finally {
        setLoadingTemplates(false);
      }
    })();
  }, []);

  // 2. Quando trocar instância, recarregar labels + triggers
  useEffect(() => {
    if (!selectedInstance) return;
    loadLabels();
    loadTriggers();
  }, [selectedInstance]);

  async function loadLabels(forceRefresh = false) {
    setLoadingLabels(true);
    try {
      const { data, error } = await cloudFunctions.invoke<any>('list-uazapi-labels', {
        body: { instance_name: selectedInstance, refresh: forceRefresh },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha ao listar etiquetas');
      setLabels(data.labels || []);
    } catch (e: any) {
      toast.error('Erro ao buscar etiquetas: ' + (e?.message || ''));
      setLabels([]);
    } finally {
      setLoadingLabels(false);
    }
  }

  async function loadTriggers() {
    setLoadingTriggers(true);
    try {
      const { data, error } = await db
        .from('label_document_triggers' as any)
        .select('*')
        .eq('instance_name', selectedInstance)
        .is('deleted_at', null)
        .order('label_name');
      if (error) throw error;
      setTriggers((data as any) || []);
    } catch (e: any) {
      toast.error('Erro carregando gatilhos: ' + (e?.message || ''));
    } finally {
      setLoadingTriggers(false);
    }
  }

  async function handleAdd() {
    if (!newLabelId || !newTemplateId) {
      toast.error('Escolha etiqueta e template');
      return;
    }
    const label = labels.find(l => l.id === newLabelId);
    const tmpl = templates.find(t => t.id === newTemplateId);
    if (!label || !tmpl) return;

    setSaving(true);
    try {
      const { error } = await db.from('label_document_triggers' as any).insert({
        label_id: label.id,
        label_name: label.name,
        instance_name: selectedInstance,
        zapsign_template_id: tmpl.id,
        zapsign_template_name: tmpl.name,
        auto_extract_media: newAutoMedia,
        message_lookback_count: newLookback,
        enabled: true,
      });
      if (error) throw error;
      toast.success('Gatilho criado!');
      setNewLabelId('');
      setNewTemplateId('');
      loadTriggers();
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e?.message || ''));
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(t: Trigger) {
    const { error } = await db
      .from('label_document_triggers' as any)
      .update({ enabled: !t.enabled, updated_at: new Date().toISOString() })
      .eq('id', t.id);
    if (error) {
      toast.error('Erro: ' + error.message);
    } else {
      loadTriggers();
    }
  }

  async function remove(t: Trigger) {
    if (!confirm(`Remover gatilho da etiqueta "${t.label_name}"?`)) return;
    const { error } = await db
      .from('label_document_triggers' as any)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', t.id);
    if (error) toast.error('Erro: ' + error.message);
    else {
      toast.success('Removido');
      loadTriggers();
    }
  }

  // Etiquetas que ainda NÃO têm gatilho (pra não permitir duplicar)
  const availableLabels = labels.filter(
    l => !triggers.some(t => t.label_id === l.id),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            Etiqueta = Procuração automática
          </CardTitle>
          <CardDescription>
            Quando o operador colocar uma etiqueta marcada aqui em qualquer conversa, o sistema
            extrai os dados do chat (incluindo OCR de documentos enviados) via UazAPI e prepara
            a procuração no ZapSign pra revisão antes do envio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Instância</Label>
            <Select value={selectedInstance} onValueChange={setSelectedInstance}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Escolha uma instância" />
              </SelectTrigger>
              <SelectContent>
                {instances.map(i => (
                  <SelectItem key={i.instance_name} value={i.instance_name}>
                    {i.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedInstance && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Etiquetas dessa instância</p>
                  <p className="text-xs text-muted-foreground">
                    {labels.length} encontrada{labels.length === 1 ? '' : 's'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadLabels(true)}
                  disabled={loadingLabels}
                >
                  {loadingLabels ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="ml-1">Recarregar</span>
                </Button>
              </div>

              {labels.length === 0 && !loadingLabels && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-3 rounded-md">
                  <AlertCircle className="h-4 w-4" />
                  Nenhuma etiqueta encontrada. Crie etiquetas direto no WhatsApp Web e clique em "Recarregar".
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Adicionar novo gatilho */}
      {selectedInstance && availableLabels.length > 0 && templates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Novo gatilho
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Etiqueta do WhatsApp</Label>
                <Select value={newLabelId} onValueChange={setNewLabelId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLabels.map(l => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Template ZapSign</Label>
                <Select value={newTemplateId} onValueChange={setNewTemplateId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={loadingTemplates ? 'Carregando…' : 'Escolha'} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Quantas mensagens analisar</Label>
                <Input
                  type="number"
                  min={50}
                  max={1000}
                  value={newLookback}
                  onChange={(e) => setNewLookback(Number(e.target.value) || 200)}
                  className="mt-1"
                />
              </div>
              <div className="flex items-end gap-2">
                <Switch checked={newAutoMedia} onCheckedChange={setNewAutoMedia} id="auto-media" />
                <Label htmlFor="auto-media" className="text-xs cursor-pointer">
                  Extrair OCR dos documentos enviados na conversa
                </Label>
              </div>
            </div>
            <Button onClick={handleAdd} disabled={saving || !newLabelId || !newTemplateId} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Criar gatilho
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Lista de gatilhos existentes */}
      {selectedInstance && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gatilhos ativos ({triggers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTriggers && <Loader2 className="h-5 w-5 animate-spin mx-auto" />}
            {!loadingTriggers && triggers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum gatilho configurado nessa instância ainda.
              </p>
            )}
            <div className="space-y-2">
              {triggers.map(t => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 p-3 border rounded-md hover:bg-muted/30"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="gap-1">
                        <Tag className="h-3 w-3" /> {t.label_name}
                      </Badge>
                      <span className="text-xs text-muted-foreground">→</span>
                      <Badge variant="secondary" className="gap-1">
                        <FileSignature className="h-3 w-3" />
                        {t.zapsign_template_name || t.zapsign_template_id}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Analisa últimas {t.message_lookback_count} mensagens
                      {t.auto_extract_media ? ' • OCR ativado' : ' • Sem OCR'}
                    </p>
                  </div>
                  <Switch checked={t.enabled} onCheckedChange={() => toggleEnabled(t)} />
                  <Button variant="ghost" size="sm" onClick={() => remove(t)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
