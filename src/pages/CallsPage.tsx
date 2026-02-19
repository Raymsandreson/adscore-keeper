import { useState, useMemo } from 'react';
import { useCallRecords, CallRecord } from '@/hooks/useCallRecords';
import { useAuthContext } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff, Voicemail,
  Clock, Star, Tag, Calendar, Search, Loader2, Play, Trash2, Save, Plus,
  TrendingUp, Users, Timer, CheckCircle, XCircle, BarChart3,
} from 'lucide-react';
import { format, formatDistanceToNow, startOfDay, endOfDay, isToday, isThisWeek, isThisMonth, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const RESULT_OPTIONS = [
  { value: 'answered', label: 'Atendeu', icon: CheckCircle, color: 'text-green-500' },
  { value: 'not_answered', label: 'Não Atendeu', icon: PhoneMissed, color: 'text-red-500' },
  { value: 'voicemail', label: 'Caixa Postal', icon: Voicemail, color: 'text-yellow-500' },
  { value: 'busy', label: 'Ocupado', icon: PhoneOff, color: 'text-orange-500' },
  { value: 'wrong_number', label: 'Número Errado', icon: XCircle, color: 'text-muted-foreground' },
];

const TYPE_OPTIONS = [
  { value: 'outbound', label: 'Chamada Realizada', icon: PhoneOutgoing },
  { value: 'inbound', label: 'Chamada Recebida', icon: PhoneIncoming },
];

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}min ${s}s`;
}

export default function CallsPage() {
  const { user } = useAuthContext();
  const { records, loading, updateRecord, deleteRecord, createRecord } = useCallRecords();
  const [search, setSearch] = useState('');
  const [filterResult, setFilterResult] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [editData, setEditData] = useState<Partial<CallRecord>>({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('list');
  const [showNewCallDialog, setShowNewCallDialog] = useState(false);
  const [newCall, setNewCall] = useState({
    call_type: 'outbound',
    call_result: 'answered',
    contact_name: '',
    contact_phone: '',
    lead_name: '',
    duration_minutes: 0,
    duration_seconds: 0,
    notes: '',
    next_step: '',
    phone_used: '',
  });

  // Filter records
  const filtered = useMemo(() => {
    return records.filter(r => {
      if (filterResult !== 'all') {
        const resultMap: Record<string, string[]> = { answered: ['answered', 'atendeu'], not_answered: ['not_answered', 'não_atendeu'], busy: ['busy', 'ocupado'] };
        const validResults = resultMap[filterResult] || [filterResult];
        if (!validResults.includes(r.call_result)) return false;
      }
      if (filterType !== 'all') {
        const typeMap: Record<string, string[]> = { outbound: ['outbound', 'realizada'], inbound: ['inbound', 'recebida'] };
        const validTypes = typeMap[filterType] || [filterType];
        if (!validTypes.includes(r.call_type)) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          (r.lead_name || '').toLowerCase().includes(q) ||
          (r.contact_name || '').toLowerCase().includes(q) ||
          (r.contact_phone || '').toLowerCase().includes(q) ||
          (r.notes || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [records, search, filterResult, filterType]);

  // Stats
  const stats = useMemo(() => {
    const today = records.filter(r => isToday(parseISO(r.created_at)));
    const week = records.filter(r => isThisWeek(parseISO(r.created_at), { locale: ptBR }));
    const answered = records.filter(r => r.call_result === 'answered');
    const totalDuration = records.reduce((sum, r) => sum + (r.duration_seconds || 0), 0);
    const avgDuration = records.length > 0 ? Math.round(totalDuration / records.length) : 0;
    const contactRate = records.length > 0 ? Math.round((answered.length / records.length) * 100) : 0;
    const pendingCallbacks = records.filter(r => r.callback_date && new Date(r.callback_date) > new Date()).length;

    return { total: records.length, today: today.length, week: week.length, answered: answered.length, avgDuration, contactRate, totalDuration, pendingCallbacks };
  }, [records]);

  // Timeline grouped by lead
  const timeline = useMemo(() => {
    const grouped: Record<string, CallRecord[]> = {};
    for (const r of filtered) {
      const key = r.lead_name || r.contact_name || 'Sem Lead';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    }
    return Object.entries(grouped).sort((a, b) => {
      const latestA = new Date(a[1][0].created_at).getTime();
      const latestB = new Date(b[1][0].created_at).getTime();
      return latestB - latestA;
    });
  }, [filtered]);

  const openDetail = (call: CallRecord) => {
    setSelectedCall(call);
    setEditData({
      call_type: call.call_type,
      call_result: call.call_result,
      phone_used: call.phone_used || '',
      next_step: call.next_step || '',
      callback_date: call.callback_date || '',
      callback_notes: call.callback_notes || '',
      notes: call.notes || '',
      rating: call.rating,
      tags: call.tags || [],
    });
  };

  const handleSave = async () => {
    if (!selectedCall) return;
    setSaving(true);
    try {
      await updateRecord(selectedCall.id, editData);
      toast.success('Ligação atualizada!');
      setSelectedCall(null);
    } catch (e) {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta ligação?')) return;
    try {
      await deleteRecord(id);
      toast.success('Ligação excluída');
      setSelectedCall(null);
    } catch (e) {
      toast.error('Erro ao excluir');
    }
  };

  const handleCreateCall = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const totalSeconds = (newCall.duration_minutes * 60) + newCall.duration_seconds;
      await createRecord({
        user_id: user.id,
        call_type: newCall.call_type === 'outbound' ? 'realizada' : 'recebida',
        call_result: newCall.call_result,
        contact_name: newCall.contact_name || null,
        contact_phone: newCall.contact_phone || null,
        lead_name: newCall.lead_name || null,
        duration_seconds: totalSeconds,
        notes: newCall.notes || null,
        next_step: newCall.next_step || null,
        phone_used: newCall.phone_used || null,
        tags: ['manual'],
      });
      toast.success('Ligação registrada!');
      setShowNewCallDialog(false);
      setNewCall({ call_type: 'outbound', call_result: 'answered', contact_name: '', contact_phone: '', lead_name: '', duration_minutes: 0, duration_seconds: 0, notes: '', next_step: '', phone_used: '' });
    } catch (e) {
      toast.error('Erro ao registrar ligação');
    } finally {
      setSaving(false);
    }
  };

  const normalizeResult = (result: string) => {
    const map: Record<string, string> = { atendeu: 'answered', 'não_atendeu': 'not_answered', ocupado: 'busy' };
    return map[result] || result;
  };

  const isOutbound = (type: string) => type === 'outbound' || type === 'realizada';

  const getResultBadge = (result: string) => {
    const normalized = normalizeResult(result);
    const opt = RESULT_OPTIONS.find(o => o.value === normalized);
    if (!opt) return <Badge variant="outline">{result}</Badge>;
    const Icon = opt.icon;
    return (
      <Badge variant="outline" className={cn("gap-1", opt.color)}>
        <Icon className="h-3 w-3" /> {opt.label}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-24 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Phone className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Ligações</h1>
        <Button size="sm" className="ml-auto gap-1.5" onClick={() => setShowNewCallDialog(true)}>
          <Plus className="h-4 w-4" /> Registrar
        </Button>
        <Badge variant="secondary">{records.length} total</Badge>
      </div>

      {/* New Call Dialog */}
      <Dialog open={showNewCallDialog} onOpenChange={setShowNewCallDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-primary" /> Registrar Ligação
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Tipo</label>
                <Select value={newCall.call_type} onValueChange={v => setNewCall(p => ({ ...p, call_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Resultado</label>
                <Select value={newCall.call_result} onValueChange={v => setNewCall(p => ({ ...p, call_result: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RESULT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Nome do Contato</label>
              <Input value={newCall.contact_name} onChange={e => setNewCall(p => ({ ...p, contact_name: e.target.value }))} placeholder="Nome..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Telefone</label>
                <Input value={newCall.contact_phone} onChange={e => setNewCall(p => ({ ...p, contact_phone: e.target.value }))} placeholder="(11) 99999-9999" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Lead</label>
                <Input value={newCall.lead_name} onChange={e => setNewCall(p => ({ ...p, lead_name: e.target.value }))} placeholder="Nome do lead..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Duração (min)</label>
                <Input type="number" min={0} value={newCall.duration_minutes} onChange={e => setNewCall(p => ({ ...p, duration_minutes: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Duração (seg)</label>
                <Input type="number" min={0} max={59} value={newCall.duration_seconds} onChange={e => setNewCall(p => ({ ...p, duration_seconds: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Telefone Usado</label>
              <Input value={newCall.phone_used} onChange={e => setNewCall(p => ({ ...p, phone_used: e.target.value }))} placeholder="Ex: WhatsApp, celular..." />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Próximo Passo</label>
              <Input value={newCall.next_step} onChange={e => setNewCall(p => ({ ...p, next_step: e.target.value }))} placeholder="O que fazer em seguida?" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Observações</label>
              <Textarea value={newCall.notes} onChange={e => setNewCall(p => ({ ...p, notes: e.target.value }))} placeholder="Anotações..." rows={3} />
            </div>
            <Button onClick={handleCreateCall} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar Ligação
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dashboard Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <Phone className="h-5 w-5 mx-auto text-primary mb-1" />
            <div className="text-2xl font-bold">{stats.today}</div>
            <div className="text-xs text-muted-foreground">Hoje</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <BarChart3 className="h-5 w-5 mx-auto text-blue-500 mb-1" />
            <div className="text-2xl font-bold">{stats.week}</div>
            <div className="text-xs text-muted-foreground">Esta Semana</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <TrendingUp className="h-5 w-5 mx-auto text-green-500 mb-1" />
            <div className="text-2xl font-bold">{stats.contactRate}%</div>
            <div className="text-xs text-muted-foreground">Taxa de Contato</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Timer className="h-5 w-5 mx-auto text-orange-500 mb-1" />
            <div className="text-2xl font-bold">{formatDuration(stats.avgDuration)}</div>
            <div className="text-xs text-muted-foreground">Duração Média</div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Callbacks Alert */}
      {stats.pendingCallbacks > 0 && (
        <Card className="border-yellow-500/50 bg-yellow-500/5">
          <CardContent className="p-3 flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-yellow-500" />
            <span className="font-medium">{stats.pendingCallbacks} retorno(s) agendado(s)</span>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar lead, contato, telefone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterResult} onValueChange={setFilterResult}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Resultado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {RESULT_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {TYPE_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs: List / Timeline */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Lista</TabsTrigger>
          <TabsTrigger value="timeline">Timeline por Lead</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-3">
          {filtered.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">Nenhuma ligação encontrada</CardContent></Card>
          ) : (
            <Card>
              <ScrollArea className="max-h-[60vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Lead / Contato</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Resultado</TableHead>
                      <TableHead>Duração</TableHead>
                      <TableHead>Avaliação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(call => (
                      <TableRow key={call.id} className="cursor-pointer hover:bg-accent/50" onClick={() => openDetail(call)}>
                        <TableCell className="text-xs">
                          {format(parseISO(call.created_at), "dd/MM HH:mm", { locale: ptBR })}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{call.lead_name || call.contact_name || '—'}</div>
                          {call.contact_phone && <div className="text-xs text-muted-foreground">{call.contact_phone}</div>}
                        </TableCell>
                        <TableCell>
                          {isOutbound(call.call_type) ? (
                            <Badge variant="outline" className="gap-1"><PhoneOutgoing className="h-3 w-3" /> Chamada Realizada</Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1"><PhoneIncoming className="h-3 w-3" /> Chamada Recebida</Badge>
                          )}
                        </TableCell>
                        <TableCell>{getResultBadge(call.call_result)}</TableCell>
                        <TableCell className="text-xs">{formatDuration(call.duration_seconds)}</TableCell>
                        <TableCell>
                          {call.rating ? (
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map(s => (
                                <Star key={s} className={cn("h-3 w-3", s <= call.rating! ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground/30")} />
                              ))}
                            </div>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="mt-3 space-y-4">
          {timeline.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">Nenhuma ligação encontrada</CardContent></Card>
          ) : (
            timeline.map(([leadName, calls]) => (
              <Card key={leadName}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    {leadName}
                    <Badge variant="secondary" className="ml-auto">{calls.length} ligação(ões)</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="relative pl-4 border-l-2 border-primary/20 space-y-3">
                    {calls.map(call => (
                      <div
                        key={call.id}
                        className="relative cursor-pointer hover:bg-accent/30 rounded-lg p-2 -ml-4 pl-6 transition-colors"
                        onClick={() => openDetail(call)}
                      >
                        <div className="absolute left-[-9px] top-3 w-4 h-4 rounded-full bg-background border-2 border-primary" />
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">
                            {format(parseISO(call.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </span>
                          {getResultBadge(call.call_result)}
                          <span className="text-xs">{formatDuration(call.duration_seconds)}</span>
                        </div>
                        {call.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{call.notes}</p>}
                        {call.next_step && <p className="text-xs text-primary mt-1">→ {call.next_step}</p>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Detail Sheet */}
      <Sheet open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-primary" />
              Detalhes da Ligação
            </SheetTitle>
          </SheetHeader>

          {selectedCall && (
            <div className="space-y-4 mt-4">
              {/* Audio Player */}
              {selectedCall.audio_url && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Áudio</label>
                  <audio controls src={selectedCall.audio_url} className="w-full" preload="metadata" />
                </div>
              )}

              {/* AI Summary */}
              {selectedCall.ai_summary && (
                <div className="bg-primary/10 rounded-lg p-3 space-y-1">
                  <div className="text-xs font-medium text-primary">Resumo da IA</div>
                  <p className="text-sm">{selectedCall.ai_summary}</p>
                </div>
              )}

              <Separator />

              {/* Type & Result */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Tipo</label>
                  <Select value={editData.call_type} onValueChange={v => setEditData(p => ({ ...p, call_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Resultado</label>
                  <Select value={editData.call_result} onValueChange={v => setEditData(p => ({ ...p, call_result: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RESULT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Phone */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Telefone Usado</label>
                <Input
                  value={editData.phone_used || ''}
                  onChange={e => setEditData(p => ({ ...p, phone_used: e.target.value }))}
                  placeholder="Ex: (11) 99999-9999"
                />
              </div>

              {/* Rating */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Avaliação</label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(s => (
                    <button key={s} onClick={() => setEditData(p => ({ ...p, rating: s }))} className="p-1">
                      <Star className={cn("h-5 w-5 transition-colors", s <= (editData.rating || 0) ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground/30 hover:text-yellow-500/50")} />
                    </button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Next Step */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Próximo Passo</label>
                <Input
                  value={editData.next_step || ''}
                  onChange={e => setEditData(p => ({ ...p, next_step: e.target.value }))}
                  placeholder="O que fazer em seguida?"
                />
              </div>

              {/* Callback */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Data de Retorno</label>
                  <Input
                    type="datetime-local"
                    value={editData.callback_date ? format(new Date(editData.callback_date), "yyyy-MM-dd'T'HH:mm") : ''}
                    onChange={e => setEditData(p => ({ ...p, callback_date: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Notas do Retorno</label>
                  <Input
                    value={editData.callback_notes || ''}
                    onChange={e => setEditData(p => ({ ...p, callback_notes: e.target.value }))}
                    placeholder="Sobre o retorno..."
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Observações</label>
                <Textarea
                  value={editData.notes || ''}
                  onChange={e => setEditData(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Anotações sobre a ligação..."
                  rows={3}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={saving} className="flex-1">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Salvar
                </Button>
                <Button variant="destructive" size="icon" onClick={() => handleDelete(selectedCall.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Meta info */}
              <div className="text-xs text-muted-foreground space-y-1 pt-2">
                <div>Lead: {selectedCall.lead_name || '—'}</div>
                <div>Contato: {selectedCall.contact_name || '—'}</div>
                <div>Telefone: {selectedCall.contact_phone || '—'}</div>
                <div>Duração: {formatDuration(selectedCall.duration_seconds)}</div>
                <div>Criada: {format(parseISO(selectedCall.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
