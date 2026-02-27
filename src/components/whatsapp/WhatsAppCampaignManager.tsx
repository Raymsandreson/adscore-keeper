import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Megaphone, Plus, Play, Pause, Eye, Trash2, Clock, CheckCircle, XCircle, Image, Variable } from 'lucide-react';
import { toast } from 'sonner';

interface Campaign {
  id: string;
  name: string;
  message_template: string;
  media_url: string | null;
  media_type: string | null;
  broadcast_list_id: string | null;
  instance_id: string | null;
  interval_seconds: number;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface BroadcastList {
  id: string;
  name: string;
  contact_count?: number;
}

interface Instance {
  id: string;
  instance_name: string;
}

interface CampaignMessage {
  id: string;
  phone: string;
  contact_name: string | null;
  status: string;
  error_message: string | null;
  sent_at: string | null;
}

const VARIABLES = [
  { key: '{nome}', label: 'Nome do contato' },
  { key: '{telefone}', label: 'Telefone' },
];

export function WhatsAppCampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [lists, setLists] = useState<BroadcastList[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);

  // Form
  const [name, setName] = useState('');
  const [messageTemplate, setMessageTemplate] = useState('');
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('');
  const [saving, setSaving] = useState(false);

  // Detail view
  const [viewingCampaign, setViewingCampaign] = useState<Campaign | null>(null);
  const [campaignMessages, setCampaignMessages] = useState<CampaignMessage[]>([]);

  const fetchCampaigns = async () => {
    const { data } = await supabase
      .from('whatsapp_campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    setCampaigns((data || []) as any[]);
    setLoading(false);
  };

  const fetchLists = async () => {
    const { data } = await supabase
      .from('whatsapp_broadcast_lists')
      .select('*')
      .order('name');
    if (data) {
      const withCounts = await Promise.all(
        (data as any[]).map(async list => {
          const { count } = await supabase
            .from('whatsapp_broadcast_list_contacts')
            .select('*', { count: 'exact', head: true })
            .eq('list_id', list.id);
          return { ...list, contact_count: count || 0 };
        })
      );
      setLists(withCounts);
    }
  };

  const fetchInstances = async () => {
    const { data } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name')
      .eq('is_active', true)
      .order('instance_name');
    setInstances((data || []) as Instance[]);
  };

  useEffect(() => {
    fetchCampaigns();
    fetchLists();
    fetchInstances();
  }, []);

  // Realtime subscription for campaign progress
  useEffect(() => {
    const channel = supabase
      .channel('campaign-progress')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_campaigns' }, (payload) => {
        setCampaigns(prev => prev.map(c => c.id === payload.new.id ? { ...c, ...payload.new } as Campaign : c));
        if (viewingCampaign?.id === payload.new.id) {
          setViewingCampaign(prev => prev ? { ...prev, ...payload.new } as Campaign : null);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [viewingCampaign?.id]);

  const handleCreate = async () => {
    if (!name.trim() || !messageTemplate.trim() || !selectedListId || !selectedInstanceId) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Get contacts count
      const { count } = await supabase
        .from('whatsapp_broadcast_list_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('list_id', selectedListId);

      const { error } = await supabase
        .from('whatsapp_campaigns')
        .insert({
          name: name.trim(),
          message_template: messageTemplate.trim(),
          broadcast_list_id: selectedListId,
          instance_id: selectedInstanceId,
          interval_seconds: intervalSeconds,
          media_url: mediaUrl.trim() || null,
          media_type: mediaType || null,
          total_recipients: count || 0,
          created_by: user?.id,
        } as any);

      if (error) throw error;
      toast.success('Campanha criada!');
      resetForm();
      setShowCreate(false);
      fetchCampaigns();
    } catch (e) {
      toast.error('Erro ao criar campanha');
      console.error(e);
    } finally { setSaving(false); }
  };

  const resetForm = () => {
    setName(''); setMessageTemplate(''); setSelectedListId('');
    setSelectedInstanceId(''); setIntervalSeconds(5); setMediaUrl(''); setMediaType('');
  };

  const handleStartCampaign = async (campaign: Campaign) => {
    if (campaign.status === 'sending') {
      toast.error('Campanha já está em envio');
      return;
    }

    try {
      // Call edge function to start sending
      const { data, error } = await supabase.functions.invoke('send-whatsapp-campaign', {
        body: { campaign_id: campaign.id },
      });

      if (error) throw error;
      toast.success('Campanha iniciada! As mensagens serão enviadas com intervalo.');
      fetchCampaigns();
    } catch (e: any) {
      toast.error(`Erro ao iniciar: ${e.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta campanha?')) return;
    await supabase.from('whatsapp_campaigns').delete().eq('id', id);
    toast.success('Campanha excluída');
    fetchCampaigns();
  };

  const viewDetails = async (campaign: Campaign) => {
    setViewingCampaign(campaign);
    const { data } = await supabase
      .from('whatsapp_campaign_messages')
      .select('id, phone, contact_name, status, error_message, sent_at')
      .eq('campaign_id', campaign.id)
      .order('sent_at', { ascending: false });
    setCampaignMessages((data || []) as CampaignMessage[]);
  };

  const insertVariable = (varKey: string) => {
    setMessageTemplate(prev => prev + varKey);
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      draft: { label: 'Rascunho', variant: 'secondary' },
      sending: { label: 'Enviando', variant: 'default' },
      completed: { label: 'Concluída', variant: 'outline' },
      paused: { label: 'Pausada', variant: 'destructive' },
    };
    const s = map[status] || { label: status, variant: 'secondary' as const };
    return <Badge variant={s.variant}>{s.label}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          Campanhas WhatsApp
        </h2>
        <Button size="sm" onClick={() => { fetchLists(); setShowCreate(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Nova Campanha
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Nenhuma campanha criada. Crie listas de transmissão e depois uma campanha.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {campaigns.map(c => {
            const progress = c.total_recipients > 0 ? ((c.sent_count + c.failed_count) / c.total_recipients) * 100 : 0;
            return (
              <Card key={c.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.total_recipients} destinatários · Intervalo: {c.interval_seconds}s
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(c.status)}
                      {c.status === 'draft' && (
                        <Button variant="default" size="icon" className="h-7 w-7" onClick={() => handleStartCampaign(c)}>
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => viewDetails(c)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(c.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {(c.status === 'sending' || c.status === 'completed') && (
                    <div className="space-y-1">
                      <Progress value={progress} className="h-2" />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-500" /> {c.sent_count} enviadas</span>
                        {c.failed_count > 0 && <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-destructive" /> {c.failed_count} falhas</span>}
                        <span>{Math.round(progress)}%</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Campaign Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nova Campanha</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome da Campanha *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Promoção Janeiro" /></div>

            <div>
              <Label>Lista de Transmissão *</Label>
              <Select value={selectedListId} onValueChange={setSelectedListId}>
                <SelectTrigger><SelectValue placeholder="Selecione uma lista" /></SelectTrigger>
                <SelectContent>
                  {lists.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} ({l.contact_count} contatos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Instância de Envio *</Label>
              <Select value={selectedInstanceId} onValueChange={setSelectedInstanceId}>
                <SelectTrigger><SelectValue placeholder="Selecione instância" /></SelectTrigger>
                <SelectContent>
                  {instances.map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.instance_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Mensagem *</Label>
                <div className="flex gap-1">
                  {VARIABLES.map(v => (
                    <Button key={v.key} variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => insertVariable(v.key)} title={v.label}>
                      <Variable className="h-3 w-3 mr-1" />{v.key}
                    </Button>
                  ))}
                </div>
              </div>
              <Textarea value={messageTemplate} onChange={e => setMessageTemplate(e.target.value)} placeholder="Olá {nome}, tudo bem? ..." rows={4} />
              <p className="text-[10px] text-muted-foreground mt-1">Use variáveis para personalizar: {'{nome}'}, {'{telefone}'}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Intervalo entre envios (segundos)</Label>
                <Input type="number" min={3} max={120} value={intervalSeconds} onChange={e => setIntervalSeconds(Number(e.target.value))} />
                <p className="text-[10px] text-muted-foreground mt-1">Mínimo 3s para evitar bloqueio</p>
              </div>
              <div>
                <Label>URL da Mídia (opcional)</Label>
                <Input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} placeholder="https://..." />
                {mediaUrl && (
                  <Select value={mediaType} onValueChange={setMediaType}>
                    <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue placeholder="Tipo de mídia" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="image">Imagem</SelectItem>
                      <SelectItem value="document">Documento</SelectItem>
                      <SelectItem value="audio">Áudio</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'Criando...' : 'Criar Campanha'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Campaign Detail Dialog */}
      <Dialog open={!!viewingCampaign} onOpenChange={() => setViewingCampaign(null)}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader><DialogTitle>{viewingCampaign?.name}</DialogTitle></DialogHeader>
          {viewingCampaign && (
            <div className="space-y-3">
              <div className="bg-muted/50 rounded p-3 text-xs whitespace-pre-wrap">{viewingCampaign.message_template}</div>
              <div className="flex gap-3 text-xs">
                <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-500" /> {viewingCampaign.sent_count} enviadas</span>
                <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-destructive" /> {viewingCampaign.failed_count} falhas</span>
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {viewingCampaign.total_recipients - viewingCampaign.sent_count - viewingCampaign.failed_count} pendentes</span>
              </div>
              {viewingCampaign.status === 'draft' && (
                <Button onClick={() => handleStartCampaign(viewingCampaign)} className="w-full">
                  <Play className="h-4 w-4 mr-1" /> Iniciar Envio
                </Button>
              )}
              <ScrollArea className="h-[250px] border rounded">
                {campaignMessages.map(m => (
                  <div key={m.id} className="flex items-center justify-between px-3 py-2 border-b text-xs">
                    <div>
                      <span className="font-medium">{m.contact_name || m.phone}</span>
                      <span className="text-muted-foreground ml-2">{m.phone}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {m.status === 'sent' && <CheckCircle className="h-3 w-3 text-green-500" />}
                      {m.status === 'failed' && <span title={m.error_message || ''}><XCircle className="h-3 w-3 text-destructive" /></span>}
                      {m.status === 'pending' && <Clock className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  </div>
                ))}
                {campaignMessages.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhuma mensagem registrada</p>
                )}
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
