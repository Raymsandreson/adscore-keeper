import { useState, useMemo, useEffect, useCallback } from 'react';
import { useCallRecords, CallRecord } from '@/hooks/useCallRecords';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff, Voicemail,
  Clock, Star, Tag, Calendar as CalendarIcon, Search, Loader2, Play, Trash2, Save, Plus, X,
  TrendingUp, Users, Timer, CheckCircle, XCircle, BarChart3, Filter,
} from 'lucide-react';
import { format, formatDistanceToNow, startOfDay, endOfDay, isToday, isThisWeek, isThisMonth, parseISO, subDays, subWeeks, subMonths } from 'date-fns';
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
  const [filterInstance, setFilterInstance] = useState('all');
  const [filterMember, setFilterMember] = useState('all');
  const [filterRating, setFilterRating] = useState('all');
  const [filterPeriod, setFilterPeriod] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState<Date | undefined>();
  const [filterDateTo, setFilterDateTo] = useState<Date | undefined>();
  const [instances, setInstances] = useState<{ id: string; instance_name: string; owner_phone: string | null }[]>([]);
  const [members, setMembers] = useState<{ user_id: string; full_name: string | null }[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [editData, setEditData] = useState<Partial<CallRecord>>({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('list');
  const [showNewCallDialog, setShowNewCallDialog] = useState(false);
  const [newCall, setNewCall] = useState({
    call_type: 'outbound',
    call_result: 'answered',
    lead_id: '' as string,
    lead_name: '',
    contact_id: '' as string,
    contact_name: '',
    contact_phone: '',
    duration_minutes: 0,
    duration_seconds: 0,
    notes: '',
    next_step: '',
    phone_used: '',
  });

  // Lead search
  const [leadSearch, setLeadSearch] = useState('');
  const [leadResults, setLeadResults] = useState<any[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const [showLeadDropdown, setShowLeadDropdown] = useState(false);

  // Contact search (filtered by selected lead)
  const [contactResults, setContactResults] = useState<any[]>([]);
  const [contactSearching, setContactSearching] = useState(false);

  const searchLeads = useCallback(async (q: string) => {
    if (!q.trim()) { setLeadResults([]); return; }
    setLeadSearching(true);
    try {
      const { data } = await supabase
        .from('leads')
        .select('id, lead_name, lead_phone, status')
        .ilike('lead_name', `%${q}%`)
        .limit(8);
      setLeadResults(data || []);
    } catch { setLeadResults([]); }
    finally { setLeadSearching(false); }
  }, []);

  // Debounced lead search
  useEffect(() => {
    if (!leadSearch.trim()) { setLeadResults([]); return; }
    const t = setTimeout(() => searchLeads(leadSearch), 300);
    return () => clearTimeout(t);
  }, [leadSearch, searchLeads]);

  // Fetch instances and members for filters
  useEffect(() => {
    const fetchFilterData = async () => {
      const [instRes, membersRes] = await Promise.all([
        supabase.from('whatsapp_instances').select('id, instance_name, owner_phone'),
        supabase.from('profiles').select('user_id, full_name').order('full_name'),
      ]);
      setInstances((instRes.data || []) as any[]);
      setMembers((membersRes.data || []) as any[]);
    };
    fetchFilterData();
  }, []);

  // Fetch contacts for selected lead
  useEffect(() => {
    if (!newCall.lead_id) { setContactResults([]); return; }
    setContactSearching(true);
    const fetchContacts = async () => {
      try {
        const { data: links } = await supabase
          .from('contact_leads')
          .select('contact_id')
          .eq('lead_id', newCall.lead_id);
        const junctionIds = (links || []).map((l: any) => l.contact_id);
        const { data: legacy } = await supabase
          .from('contacts')
          .select('id')
          .eq('lead_id', newCall.lead_id);
        const legacyIds = (legacy || []).map((c: any) => c.id);
        const allIds = [...new Set([...junctionIds, ...legacyIds])];
        if (allIds.length === 0) { setContactResults([]); setContactSearching(false); return; }
        const { data: contacts } = await supabase
          .from('contacts')
          .select('id, full_name, phone')
          .in('id', allIds);
        setContactResults(contacts || []);
      } catch { setContactResults([]); }
      finally { setContactSearching(false); }
    };
    fetchContacts();
  }, [newCall.lead_id]);

  // Filter records
  const filtered = useMemo(() => {
    return records.filter(r => {
      // Result filter
      if (filterResult !== 'all') {
        const resultMap: Record<string, string[]> = { answered: ['answered', 'atendeu'], not_answered: ['not_answered', 'não_atendeu'], busy: ['busy', 'ocupado'] };
        const validResults = resultMap[filterResult] || [filterResult];
        if (!validResults.includes(r.call_result)) return false;
      }
      // Type filter
      if (filterType !== 'all') {
        const typeMap: Record<string, string[]> = { outbound: ['outbound', 'realizada'], inbound: ['inbound', 'recebida'] };
        const validTypes = typeMap[filterType] || [filterType];
        if (!validTypes.includes(r.call_type)) return false;
      }
      // Instance filter — match by instance_name, owner_phone, or phone_used
      if (filterInstance !== 'all') {
        const inst = instances.find(i => i.instance_name === filterInstance);
        const phoneUsed = (r.phone_used || '').replace(/\D/g, '');
        const ownerPhone = (inst?.owner_phone || '').replace(/\D/g, '');
        const matchesName = (r.phone_used || '').toLowerCase() === filterInstance.toLowerCase();
        const matchesPhone = ownerPhone && phoneUsed && ownerPhone.includes(phoneUsed);
        const matchesPhoneReverse = ownerPhone && phoneUsed && phoneUsed.includes(ownerPhone);
        if (!matchesName && !matchesPhone && !matchesPhoneReverse) return false;
      }
      // Member filter
      if (filterMember !== 'all') {
        if (r.user_id !== filterMember) return false;
      }
      // Rating filter
      if (filterRating !== 'all') {
        const ratingVal = parseInt(filterRating);
        if (filterRating === 'none') {
          if (r.rating !== null && r.rating !== undefined) return false;
        } else {
          if ((r.rating || 0) !== ratingVal) return false;
        }
      }
      // Period filter
      const recordDate = parseISO(r.created_at);
      if (filterPeriod === 'today' && !isToday(recordDate)) return false;
      if (filterPeriod === 'week' && !isThisWeek(recordDate, { locale: ptBR })) return false;
      if (filterPeriod === 'month' && !isThisMonth(recordDate)) return false;
      if (filterPeriod === 'custom') {
        if (filterDateFrom && recordDate < startOfDay(filterDateFrom)) return false;
        if (filterDateTo && recordDate > endOfDay(filterDateTo)) return false;
      }
      // Search
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
  }, [records, search, filterResult, filterType, filterInstance, filterMember, filterRating, filterPeriod, filterDateFrom, filterDateTo, instances]);

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
    if (!newCall.lead_id) { toast.error('Selecione um lead'); return; }
    if (!newCall.contact_id) { toast.error('Selecione um contato'); return; }
    setSaving(true);
    try {
      const totalSeconds = (newCall.duration_minutes * 60) + newCall.duration_seconds;
      await createRecord({
        user_id: user.id,
        call_type: newCall.call_type === 'outbound' ? 'realizada' : 'recebida',
        call_result: newCall.call_result,
        lead_id: newCall.lead_id || null,
        lead_name: newCall.lead_name || null,
        contact_id: newCall.contact_id || null,
        contact_name: newCall.contact_name || null,
        contact_phone: newCall.contact_phone || null,
        duration_seconds: totalSeconds,
        notes: newCall.notes || null,
        next_step: newCall.next_step || null,
        phone_used: newCall.phone_used || null,
        tags: ['manual'],
      });
      toast.success('Ligação registrada!');
      setShowNewCallDialog(false);
      setNewCall({ call_type: 'outbound', call_result: 'answered', lead_id: '', lead_name: '', contact_id: '', contact_name: '', contact_phone: '', duration_minutes: 0, duration_seconds: 0, notes: '', next_step: '', phone_used: '' });
      setLeadSearch('');
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
            {/* Lead selector */}
            <div className="space-y-1 relative">
              <label className="text-xs font-medium text-muted-foreground">Lead *</label>
              {newCall.lead_id ? (
                <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/30">
                  <span className="text-sm flex-1 truncate">{newCall.lead_name}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => {
                    setNewCall(p => ({ ...p, lead_id: '', lead_name: '', contact_id: '', contact_name: '', contact_phone: '' }));
                    setLeadSearch('');
                  }}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    value={leadSearch}
                    onChange={e => { setLeadSearch(e.target.value); setShowLeadDropdown(true); }}
                    onFocus={() => setShowLeadDropdown(true)}
                    placeholder="Buscar lead..."
                  />
                  {showLeadDropdown && leadResults.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {leadResults.map(lead => (
                        <button
                          key={lead.id}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
                          onClick={() => {
                            setNewCall(p => ({ ...p, lead_id: lead.id, lead_name: lead.lead_name || '', contact_id: '', contact_name: '', contact_phone: '' }));
                            setLeadSearch('');
                            setShowLeadDropdown(false);
                          }}
                        >
                          <div className="font-medium truncate">{lead.lead_name || 'Sem nome'}</div>
                          {lead.status && <div className="text-xs text-muted-foreground">{lead.status}</div>}
                        </button>
                      ))}
                    </div>
                  )}
                  {leadSearching && <Loader2 className="absolute right-3 top-7 h-4 w-4 animate-spin text-muted-foreground" />}
                </>
              )}
            </div>

            {/* Contact selector (depends on lead) */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Contato *</label>
              {!newCall.lead_id ? (
                <p className="text-xs text-muted-foreground italic py-2">Selecione um lead primeiro</p>
              ) : contactSearching ? (
                <div className="flex items-center gap-2 py-2"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-xs text-muted-foreground">Carregando contatos...</span></div>
              ) : contactResults.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">Nenhum contato vinculado a este lead</p>
              ) : (
                <Select
                  value={newCall.contact_id}
                  onValueChange={v => {
                    const ct = contactResults.find(c => c.id === v);
                    setNewCall(p => ({ ...p, contact_id: v, contact_name: ct?.full_name || '', contact_phone: ct?.phone || '' }));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione um contato" /></SelectTrigger>
                  <SelectContent>
                    {contactResults.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name}{c.phone ? ` — ${c.phone}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
        <Select value={filterPeriod} onValueChange={setFilterPeriod}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo período</SelectItem>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="week">Esta semana</SelectItem>
            <SelectItem value="month">Este mês</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterResult} onValueChange={setFilterResult}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Resultado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos resultados</SelectItem>
            {RESULT_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos tipos</SelectItem>
            {TYPE_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {instances.length > 0 && (
          <Select value={filterInstance} onValueChange={setFilterInstance}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Instância" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas instâncias</SelectItem>
              {instances.map(inst => (
                <SelectItem key={inst.instance_name} value={inst.instance_name}>
                  {inst.instance_name}{inst.owner_phone ? ` (${inst.owner_phone})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {members.length > 1 && (
          <Select value={filterMember} onValueChange={setFilterMember}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Membro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos membros</SelectItem>
              {members.map(m => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name || 'Sem nome'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={filterRating} onValueChange={setFilterRating}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Avaliação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas notas</SelectItem>
            <SelectItem value="none">Sem avaliação</SelectItem>
            {[5, 4, 3, 2, 1].map(r => (
              <SelectItem key={r} value={String(r)}>{'⭐'.repeat(r)} ({r})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Custom date range */}
      {filterPeriod === 'custom' && (
        <div className="flex flex-wrap gap-2 items-center">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("gap-1.5", !filterDateFrom && "text-muted-foreground")}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {filterDateFrom ? format(filterDateFrom, "dd/MM/yyyy") : 'Data início'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={filterDateFrom} onSelect={setFilterDateFrom} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <span className="text-xs text-muted-foreground">até</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("gap-1.5", !filterDateTo && "text-muted-foreground")}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {filterDateTo ? format(filterDateTo, "dd/MM/yyyy") : 'Data fim'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={filterDateTo} onSelect={setFilterDateTo} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          {(filterDateFrom || filterDateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setFilterDateFrom(undefined); setFilterDateTo(undefined); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Active filters summary */}
      {(filterResult !== 'all' || filterType !== 'all' || filterInstance !== 'all' || filterMember !== 'all' || filterRating !== 'all' || filterPeriod !== 'all') && (
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{filtered.length} de {records.length} ligações</span>
          <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => {
            setFilterResult('all'); setFilterType('all'); setFilterInstance('all');
            setFilterMember('all'); setFilterRating('all'); setFilterPeriod('all');
            setFilterDateFrom(undefined); setFilterDateTo(undefined);
          }}>
            Limpar filtros
          </Button>
        </div>
      )}

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
