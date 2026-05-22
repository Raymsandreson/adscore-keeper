import { useEffect, useState } from 'react';
import { Tag, Loader2, Plus, Trash2, RefreshCw, FileSignature, AlertCircle, Wifi, WifiOff, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { db } from '@/integrations/supabase';
import { cloudFunctions } from '@/lib/functionRouter';
import { useWhatsAppInstanceStatus } from '@/hooks/useWhatsAppInstanceStatus';

interface Instance {
  instance_name: string;
  is_active: boolean | null;
  review_notification_phone?: string | null;
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

// Paleta da UazAPI/WhatsApp — `color` é INT (0..19). Mostramos só as 10 cores
// principais com swatches; cada uma já existe nativamente nas etiquetas do app.
const COLOR_OPTIONS: { value: number; hex: string; name: string }[] = [
  { value: 0, hex: '#ff6e6e', name: 'Vermelho' },
  { value: 1, hex: '#ff9764', name: 'Laranja' },
  { value: 2, hex: '#fbb33b', name: 'Amarelo' },
  { value: 5, hex: '#75d572', name: 'Verde' },
  { value: 6, hex: '#6ed3cf', name: 'Ciano' },
  { value: 4, hex: '#95c4ff', name: 'Azul' },
  { value: 7, hex: '#b9b7ff', name: 'Lilás' },
  { value: 3, hex: '#dfaef0', name: 'Roxo' },
  { value: 8, hex: '#ffb9ee', name: 'Rosa' },
  { value: 10, hex: '#d4d4d4', name: 'Cinza' },
];


export function LabelTriggersConfig() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [labels, setLabels] = useState<UazLabel[]>([]);
  const [templates, setTemplates] = useState<ZapTemplate[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingTriggers, setLoadingTriggers] = useState(false);

  // status de conexão das instâncias (mesma fonte usada nas conversas)
  const { statuses } = useWhatsAppInstanceStatus(true);
  const currentStatus = statuses.find(s => s.instance_name === selectedInstance);
  const isConnected = currentStatus?.connected ?? null; // null = ainda carregando

  // Form pra adicionar novo gatilho
  const [newLabelId, setNewLabelId] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [newLookback, setNewLookback] = useState(200);
  const [newAutoMedia, setNewAutoMedia] = useState(true);
  const [saving, setSaving] = useState(false);

  // Telefone do operador que recebe a notificação de revisão (por instância)
  const [reviewPhone, setReviewPhone] = useState('');
  const [reviewPhoneSaving, setReviewPhoneSaving] = useState(false);
  const [reviewPhoneSavedAt, setReviewPhoneSavedAt] = useState<number | null>(null);

  // Dialog de criar/editar etiqueta
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<UazLabel | null>(null);
  const [labelFormName, setLabelFormName] = useState('');
  const [labelFormColor, setLabelFormColor] = useState<number>(4);
  const [labelSaving, setLabelSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: insts } = await db
        .from('whatsapp_instances')
        .select('instance_name, is_active, review_notification_phone' as any)
        .eq('is_active', true)
        .order('instance_name');
      setInstances(((insts as unknown) as Instance[]) || []);
      if (insts && insts.length > 0) setSelectedInstance((insts[0] as any).instance_name);

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

  useEffect(() => {
    if (!selectedInstance) return;
    loadLabels();
    loadTriggers();
    const inst = instances.find(i => i.instance_name === selectedInstance);
    setReviewPhone(inst?.review_notification_phone || '');
    setReviewPhoneSavedAt(null);
  }, [selectedInstance, instances]);

  async function saveReviewPhone() {
    if (!selectedInstance) return;
    const phone = reviewPhone.replace(/\D/g, '');
    if (phone && phone.length < 10) {
      toast.error('Telefone inválido. Use DDD + número.');
      return;
    }
    setReviewPhoneSaving(true);
    try {
      const { error } = await db
        .from('whatsapp_instances')
        .update({ review_notification_phone: phone || null } as any)
        .eq('instance_name', selectedInstance);
      if (error) throw error;
      setInstances(prev => prev.map(i =>
        i.instance_name === selectedInstance ? { ...i, review_notification_phone: phone || null } : i
      ));
      setReviewPhoneSavedAt(Date.now());
      toast.success('Telefone salvo');
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e?.message || ''));
    } finally {
      setReviewPhoneSaving(false);
    }
  }

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

  function openCreateLabel() {
    setEditingLabel(null);
    setLabelFormName('');
    setLabelFormColor(4);
    setLabelDialogOpen(true);
  }
  function openEditLabel(l: UazLabel) {
    setEditingLabel(l);
    setLabelFormName(l.name);
    setLabelFormColor(typeof l.color === 'number' ? l.color : 4);

    setLabelDialogOpen(true);
  }

  async function saveLabel() {
    if (!labelFormName.trim()) {
      toast.error('Nome obrigatório');
      return;
    }
    setLabelSaving(true);
    try {
      const { data, error } = await cloudFunctions.invoke<any>('manage-uazapi-label', {
        body: {
          instance_name: selectedInstance,
          action: editingLabel ? 'update' : 'create',
          id: editingLabel?.id,
          name: labelFormName.trim(),
          color: labelFormColor,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha');
      toast.success(editingLabel ? 'Etiqueta atualizada' : 'Etiqueta criada');
      setLabelDialogOpen(false);
      await loadLabels(true);
    } catch (e: any) {
      toast.error(e?.message || 'Erro');
    } finally {
      setLabelSaving(false);
    }
  }

  async function deleteLabel(l: UazLabel) {
    if (!confirm(`Excluir a etiqueta "${l.name}" do WhatsApp?\n\nIsso remove em todas as conversas.`)) return;
    try {
      const { data, error } = await cloudFunctions.invoke<any>('manage-uazapi-label', {
        body: { instance_name: selectedInstance, action: 'delete', id: l.id },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha');
      toast.success('Etiqueta removida');
      await loadLabels(true);
    } catch (e: any) {
      toast.error(e?.message || 'Erro');
    }
  }

  async function handleAdd() {
    if (!selectedInstance) { toast.error('Escolha uma instância'); return; }
    if (!newLabelId) { toast.error('Escolha uma etiqueta do WhatsApp'); return; }
    if (!newTemplateId) { toast.error('Escolha um template do ZapSign'); return; }
    const label = labels.find(l => l.id === newLabelId);
    const tmpl = templates.find(t => t.id === newTemplateId);
    if (!label) { toast.error(`Etiqueta não encontrada (id=${newLabelId}). Tente recarregar.`); return; }
    if (!tmpl) { toast.error(`Template não encontrado (id=${newTemplateId}). Tente recarregar a página.`); return; }

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
    if (error) toast.error('Erro: ' + error.message);
    else loadTriggers();
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

  const availableLabels = labels.filter(l => !triggers.some(t => t.label_id === l.id));

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
            <Label className="text-xs">Etiqueta-Gatilho (instância que dispara)</Label>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1">
                <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha uma instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {instances.map(i => {
                      const st = statuses.find(s => s.instance_name === i.instance_name);
                      return (
                        <SelectItem key={i.instance_name} value={i.instance_name}>
                          <span className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                st?.connected ? 'bg-green-500' : st ? 'bg-red-500' : 'bg-gray-400'
                              }`}
                            />
                            {i.instance_name}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              {isConnected !== null && (
                <Badge variant={isConnected ? 'default' : 'destructive'} className="gap-1 whitespace-nowrap">
                  {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                  {isConnected ? 'Conectada' : 'Desconectada'}
                </Badge>
              )}
            </div>
            {isConnected === false && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 p-3 rounded-md mt-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Esta instância está desconectada do WhatsApp. Vá em <strong>Configurações → WhatsApp → Instâncias</strong> e
                  escaneie o QR code pra reconectar antes de gerenciar etiquetas.
                </span>
              </div>
            )}
          </div>

          {selectedInstance && (
            <div className="rounded-md border p-3 bg-muted/20 space-y-2">
              <Label className="text-xs font-medium flex items-center gap-1.5">
                📱 Telefone do operador (revisão da procuração)
              </Label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Quando essa instância dispara uma etiqueta-gatilho, o link de revisão é enviado
                via WhatsApp pra este número. Cai como notificação normal do WhatsApp (aparece
                sobre o app aberto), o operador toca, revisa e confirma o envio ao cliente.
                Use DDD + número (ex: 11999998888).
              </p>
              <div className="flex gap-2">
                <Input
                  value={reviewPhone}
                  onChange={(e) => { setReviewPhone(e.target.value); setReviewPhoneSavedAt(null); }}
                  placeholder="11999998888"
                  inputMode="numeric"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={saveReviewPhone}
                  disabled={reviewPhoneSaving}
                  variant={reviewPhoneSavedAt ? 'secondary' : 'default'}
                >
                  {reviewPhoneSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : reviewPhoneSavedAt ? '✓ Salvo' : 'Salvar'}
                </Button>
              </div>
            </div>
          )}


          {selectedInstance && (
            <>
              <Separator />
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-medium">Etiquetas dessa instância</p>
                  <p className="text-xs text-muted-foreground">
                    {labels.length} encontrada{labels.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => loadLabels(true)} disabled={loadingLabels}>
                    {loadingLabels ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    <span className="ml-1">Recarregar</span>
                  </Button>
                  <Button size="sm" onClick={openCreateLabel} disabled={!isConnected}>
                    <Plus className="h-4 w-4 mr-1" /> Nova etiqueta
                  </Button>
                </div>
              </div>

              {labels.length === 0 && !loadingLabels && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-3 rounded-md">
                  <AlertCircle className="h-4 w-4" />
                  Nenhuma etiqueta encontrada. Crie uma acima ou pelo próprio WhatsApp Web.
                </div>
              )}

              {labels.length > 0 && (
                <div className="space-y-1.5">
                  {labels.map(l => (
                    <div key={l.id} className="flex items-center gap-2 p-2 border rounded-md hover:bg-muted/30">
                      <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm flex-1 truncate">{l.name}</span>
                      {l.color && (
                        <span className="text-[10px] text-muted-foreground uppercase">{l.color}</span>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEditLabel(l)} disabled={!isConnected}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => deleteLabel(l)} disabled={!isConnected}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

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
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha" /></SelectTrigger>
                  <SelectContent>
                    {availableLabels.map(l => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
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
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
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
            <Button onClick={handleAdd} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Criar gatilho
            </Button>
          </CardContent>
        </Card>
      )}

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
                <div key={t.id} className="flex items-center gap-3 p-3 border rounded-md hover:bg-muted/30">
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

      <Dialog open={labelDialogOpen} onOpenChange={setLabelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLabel ? 'Editar etiqueta' : 'Nova etiqueta'}</DialogTitle>
            <DialogDescription>
              Aplica direto no WhatsApp da instância <strong>{selectedInstance}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                value={labelFormName}
                onChange={(e) => setLabelFormName(e.target.value)}
                placeholder="Ex: PROCURAÇÃO_GERAL"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Cor</Label>
              <Select value={String(labelFormColor)} onValueChange={(v) => setLabelFormColor(Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COLOR_OPTIONS.map(c => (
                    <SelectItem key={c.value} value={String(c.value)}>
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: c.hex }} />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLabelDialogOpen(false)}>Cancelar</Button>
            <Button onClick={saveLabel} disabled={labelSaving}>
              {labelSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingLabel ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
