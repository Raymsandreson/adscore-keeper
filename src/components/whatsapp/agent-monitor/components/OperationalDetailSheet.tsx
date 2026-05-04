import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, FileSignature, Users, Briefcase, Scale, ExternalLink, MessageSquare, UsersRound, Radio, UserPlus, Send, CalendarRange } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { startOfDay, endOfDay, format, parseISO, subDays } from 'date-fns';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { toast } from 'sonner';
import type { Lead } from '@/hooks/useLeads';
import type { Contact } from '@/hooks/useContacts';

export type OperationalMetricType = 'signed_docs' | 'groups' | 'cases' | 'processes' | 'contacts';

export interface OperationalFilters {
  instanceFilter: string;
  acolhedorFilter: string;
  agentFilter: string;
  boardFilter: string;
  campaignFilter: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  metricType: OperationalMetricType;
  dateRange: { from: Date; to: Date };
  filters?: OperationalFilters;
  filteredLeadIds?: Set<string>;
  onOpenChat?: (phone: string, instanceName?: string, contactName?: string) => void;
}

const config: Record<OperationalMetricType, { title: string; icon: typeof FileSignature; color: string }> = {
  signed_docs: { title: 'Documentos Assinados', icon: FileSignature, color: 'text-violet-500' },
  groups: { title: 'Grupos Criados', icon: Users, color: 'text-cyan-500' },
  cases: { title: 'Casos Criados', icon: Briefcase, color: 'text-amber-600' },
  processes: { title: 'Processos Criados', icon: Scale, color: 'text-indigo-500' },
  contacts: { title: 'Contatos Criados', icon: UserPlus, color: 'text-emerald-500' },
};

export function OperationalDetailSheet({ open, onClose, metricType, dateRange, filters, filteredLeadIds, onOpenChat }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [showLeadEdit, setShowLeadEdit] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [docStatusFilter, setDocStatusFilter] = useState<'all' | 'signed' | 'pending'>('all');
  const [docInstanceFilter, setDocInstanceFilter] = useState<string>('all');
  const [sendingFollowup, setSendingFollowup] = useState<Set<string>>(new Set());
  // Local date filter inside the sheet — defaults to the range passed by the dashboard
  const [fromDate, setFromDate] = useState<string>(format(dateRange.from, 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState<string>(format(dateRange.to, 'yyyy-MM-dd'));
  const navigate = useNavigate();

  // Re-sync local range whenever the sheet opens with a new external dateRange
  useEffect(() => {
    if (!open) return;
    setFromDate(format(dateRange.from, 'yyyy-MM-dd'));
    setToDate(format(dateRange.to, 'yyyy-MM-dd'));
  }, [open, dateRange.from, dateRange.to]);

  useEffect(() => {
    if (!open) return;
    const fetchDetails = async () => {
      setLoading(true);
      const fromD = fromDate ? new Date(fromDate + 'T00:00:00') : dateRange.from;
      const toD = toDate ? new Date(toDate + 'T00:00:00') : dateRange.to;
      const start = startOfDay(fromD).toISOString();
      const end = endOfDay(toD).toISOString();

      try {
        if (metricType === 'signed_docs') {
          // Fonte de verdade: Externo (Cloud está dessincronizado)
          const { data } = await externalSupabase
            .from('zapsign_documents' as any)
            .select('id, document_name, status, signer_name, signer_status, lead_id, whatsapp_phone, instance_name, created_at, signed_at')
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });

          const docs = (data || []) as any[];
          const leadIds = docs.map((d: any) => d.lead_id).filter(Boolean);
          let leadMap: Record<string, { lead_name: string; whatsapp_group_id: string | null; acolhedor: string | null }> = {};
          if (leadIds.length > 0) {
            const { data: leads } = await externalSupabase
              .from('leads' as any)
              .select('id, lead_name, whatsapp_group_id, acolhedor')
              .in('id', leadIds);
            if (leads) {
              leadMap = Object.fromEntries((leads as any[]).map((l: any) => [l.id, { lead_name: l.lead_name, whatsapp_group_id: l.whatsapp_group_id, acolhedor: l.acolhedor }]));
            }
          }

          // Fallback: docs sem instance_name → resolver via whatsapp_messages.phone
          const phoneVariants = (raw: string): string[] => {
            const phone = (raw || '').replace(/\D/g, '');
            if (!phone) return [];
            const set = new Set<string>([phone]);
            const m = phone.match(/^(55)?(\d{2})(\d+)$/);
            if (m) {
              const [, cc, ddd, rest] = m;
              const ccPart = cc || '55';
              if (rest.length === 9 && rest.startsWith('9')) {
                set.add(`${ccPart}${ddd}${rest.slice(1)}`); set.add(`${ddd}${rest.slice(1)}`);
              } else if (rest.length === 8) {
                set.add(`${ccPart}${ddd}9${rest}`); set.add(`${ddd}9${rest}`);
              }
              set.add(`${ddd}${rest}`);
            }
            return Array.from(set);
          };
          const resolveMap = new Map<string, string>(); // raw phone -> resolved instance
          const docsSemInst = docs.filter((d: any) => !d.instance_name && d.whatsapp_phone);
          if (docsSemInst.length > 0) {
            const allPhones = Array.from(new Set(docsSemInst.flatMap((d: any) => phoneVariants(d.whatsapp_phone))));
            if (allPhones.length > 0) {
              const { data: msgs } = await externalSupabase
                .from('whatsapp_messages' as any)
                .select('phone, instance_name')
                .in('phone', allPhones)
                .not('instance_name', 'is', null)
                .limit(5000);
              const counts = new Map<string, Map<string, number>>(); // phone -> instance -> count
              for (const r of (msgs || []) as any[]) {
                if (!counts.has(r.phone)) counts.set(r.phone, new Map());
                const inner = counts.get(r.phone)!;
                inner.set(r.instance_name, (inner.get(r.instance_name) || 0) + 1);
              }
              for (const d of docsSemInst) {
                const variants = phoneVariants(d.whatsapp_phone);
                const merged = new Map<string, number>();
                for (const v of variants) {
                  const inner = counts.get(v);
                  if (!inner) continue;
                  for (const [inst, c] of inner) merged.set(inst, (merged.get(inst) || 0) + c);
                }
                if (merged.size > 0) {
                  const picked = [...merged.entries()].sort((a, b) => b[1] - a[1])[0][0];
                  resolveMap.set(d.whatsapp_phone, picked);
                }
              }
            }
          }

          setItems(docs.map((d: any) => ({
            ...d,
            _lead: d.lead_id ? leadMap[d.lead_id] : null,
            _resolved_instance: !d.instance_name && d.whatsapp_phone ? (resolveMap.get(d.whatsapp_phone) || null) : null,
          })));
        } else if (metricType === 'groups') {
          const { data } = await supabase
            .from('leads')
            .select('id, lead_name, whatsapp_group_id, acolhedor, lead_phone, created_at')
            .not('whatsapp_group_id', 'is', null)
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });
          
          // For each group, fetch contacts linked to it
          const enrichedItems = await Promise.all((data || []).map(async (item: any) => {
            const { data: contacts } = await supabase
              .from('contacts')
              .select('id, full_name, phone, city, state, created_by')
              .eq('whatsapp_group_id', item.whatsapp_group_id)
              .limit(20);
            
            // Also find contacts linked via contact_leads
            const { data: linkedContacts } = await externalSupabase
              .from('contact_leads')
              .select('contact_id, contacts:contact_id(id, full_name, phone, city, state, created_by)')
              .eq('lead_id', item.id)
              .limit(20);
            
            const allContacts = [
              ...(contacts || []),
              ...(linkedContacts || []).map((lc: any) => lc.contacts).filter(Boolean),
            ];
            // Deduplicate by id
            const uniqueContacts = Array.from(new Map(allContacts.map((c: any) => [c.id, c])).values());
            
            return { ...item, _contacts: uniqueContacts };
          }));
          
          setItems(enrichedItems);
        } else if (metricType === 'cases') {
          const { data } = await externalSupabase
            .from('legal_cases')
            .select('id, case_number, title, status, acolhedor, lead_id, created_at')
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });
          setItems(data || []);
        } else if (metricType === 'processes') {
          const { data } = await externalSupabase
            .from('case_process_tracking')
            .select('id, cliente, caso, tipo, acolhedor, status_processo, numero_processo, created_at')
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });
          setItems(data || []);
        } else if (metricType === 'contacts') {
          const { data } = await supabase
            .from('contacts')
            .select('id, full_name, phone, city, state, classification, created_by, action_source_detail, created_at')
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });
          
          // Resolve created_by names
          const creatorIds = (data || []).map((c: any) => c.created_by).filter(Boolean);
          let creatorMap: Record<string, string> = {};
          if (creatorIds.length > 0) {
            const { data: profiles } = await supabase.from('profiles').select('user_id, full_name').in('user_id', [...new Set(creatorIds)]);
            creatorMap = Object.fromEntries((profiles || []).map((p: any) => [p.user_id, p.full_name]));
          }
          setItems((data || []).map((c: any) => ({ ...c, _creator_name: c.created_by ? creatorMap[c.created_by] || null : null })));
        }
      } catch (err) {
        console.error('Error fetching operational details:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [open, metricType, dateRange, fromDate, toDate]);

  const hasActiveFilter = filters && (
    filters.instanceFilter !== 'all' || filters.acolhedorFilter !== 'all' ||
    filters.agentFilter !== 'all' || filters.boardFilter !== 'all' || filters.campaignFilter !== 'all'
  );

  // First apply dashboard filters (acolhedor, instance, etc.)
  const dashboardFilteredItems = useMemo(() => {
    if (!hasActiveFilter) return items;
    
    return items.filter(item => {
      if (metricType === 'signed_docs') {
        if (filters!.instanceFilter !== 'all' && item.instance_name && item.instance_name !== filters!.instanceFilter) return false;
        if (filters!.acolhedorFilter !== 'all' && item._lead?.acolhedor) {
          if (filters!.acolhedorFilter === '__none__' && item._lead.acolhedor) return false;
          if (filters!.acolhedorFilter !== '__none__' && item._lead.acolhedor !== filters!.acolhedorFilter) return false;
        }
        if (filteredLeadIds && filteredLeadIds.size > 0 && item.lead_id && !filteredLeadIds.has(item.lead_id)) return false;
        return true;
      }
      
      if (metricType === 'groups') {
        if (filters!.acolhedorFilter !== 'all' && item.acolhedor) {
          if (filters!.acolhedorFilter === '__none__' && item.acolhedor) return false;
          if (filters!.acolhedorFilter !== '__none__' && item.acolhedor !== filters!.acolhedorFilter) return false;
        }
        if (filteredLeadIds && filteredLeadIds.size > 0 && !filteredLeadIds.has(item.id)) return false;
        return true;
      }
      
      if (filters!.acolhedorFilter !== 'all' && item.acolhedor) {
        if (filters!.acolhedorFilter === '__none__' && item.acolhedor) return false;
        if (filters!.acolhedorFilter !== '__none__' && item.acolhedor !== filters!.acolhedorFilter) return false;
      }
      
      return true;
    });
  }, [items, filters, filteredLeadIds, hasActiveFilter, metricType]);

  // List of available instances inside the sheet (combining real + resolved-via-chat)
  const availableInstances = useMemo(() => {
    if (metricType !== 'signed_docs') return [] as string[];
    const set = new Set<string>();
    let hasNone = false;
    for (const it of dashboardFilteredItems) {
      const inst = it.instance_name || it._resolved_instance;
      if (inst) set.add(inst); else hasNone = true;
    }
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b));
    return hasNone ? [...arr, '__none__'] : arr;
  }, [dashboardFilteredItems, metricType]);

  // Apply doc status + instance filter on top of dashboard-filtered items
  const filteredItems = useMemo(() => {
    let list = dashboardFilteredItems;
    if (metricType === 'signed_docs') {
      const isSigned = (i: any) => i.status === 'signed' || i.signer_status === 'signed';
      if (docStatusFilter === 'signed') list = list.filter(isSigned);
      else if (docStatusFilter === 'pending') list = list.filter((i) => !isSigned(i));

      if (docInstanceFilter !== 'all') {
        list = list.filter((i) => {
          const inst = i.instance_name || i._resolved_instance;
          if (docInstanceFilter === '__none__') return !inst;
          return inst === docInstanceFilter;
        });
      }
    }
    return list;
  }, [dashboardFilteredItems, metricType, docStatusFilter, docInstanceFilter]);

  const { title, icon: Icon, color } = config[metricType];

  const statusBadge = (status: string | null) => {
    if (!status) return null;
    const map: Record<string, string> = {
      signed: 'bg-green-100 text-green-700',
      pending: 'bg-yellow-100 text-yellow-700',
      em_andamento: 'bg-blue-100 text-blue-700',
      new: 'bg-gray-100 text-gray-600',
    };
    return <Badge className={`text-[9px] ${map[status] || 'bg-muted text-muted-foreground'}`}>{status}</Badge>;
  };

  const handleOpenLead = async (leadId: string) => {
    if (!leadId) return;
    const { data } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
    if (data) {
      setEditingLead(data as Lead);
      setShowLeadEdit(true);
    }
  };

  const handleOpenContact = async (contactId: string) => {
    if (!contactId) return;
    const { data } = await supabase.from('contacts').select('*').eq('id', contactId).maybeSingle();
    if (data) setEditingContact(data as Contact);
  };

  const handleOpenChat = (phone: string, instanceName?: string, contactName?: string) => {
    if (!phone) return;
    onClose();
    if (onOpenChat) {
      onOpenChat(phone, instanceName, contactName);
    } else {
      const params = new URLSearchParams({ phone });
      if (instanceName) params.set('instance', instanceName);
      navigate(`/whatsapp?${params.toString()}`);
    }
  };

  const handleBulkFollowup = async (pendingItems: any[]) => {
    const phonesToSend = pendingItems.filter(item => item.whatsapp_phone && item.instance_name);
    if (phonesToSend.length === 0) {
      toast.warning('Nenhum documento pendente com telefone e instância disponível');
      return;
    }

    // Resolve instance IDs from instance names
    const instanceNames = [...new Set(phonesToSend.map(i => i.instance_name))];
    const { data: instances } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name')
      .in('instance_name', instanceNames);
    
    const instanceMap = new Map((instances || []).map(i => [i.instance_name, i.id]));

    setSendingFollowup(new Set(phonesToSend.map(i => i.id)));
    let successCount = 0;
    let errorCount = 0;

    for (const item of phonesToSend) {
      const instanceId = instanceMap.get(item.instance_name);
      if (!instanceId) { errorCount++; continue; }

      try {
        const signerName = item.signer_name || item._lead?.lead_name || '';
        const docName = item.document_name || 'documento';
        const message = `Olá${signerName ? ` ${signerName.split(' ')[0]}` : ''}, tudo bem? 😊\n\nNotamos que o *${docName}* ainda está pendente de assinatura. Poderia assinar para darmos andamento? 🙏\n\nSe tiver alguma dúvida, estamos à disposição!`;

        const { error } = await supabase.functions.invoke('send-whatsapp', {
          body: {
            instance_id: instanceId,
            phone: item.whatsapp_phone,
            message,
          },
        });

        if (error) throw error;
        successCount++;
      } catch (err) {
        console.error('Error sending followup to', item.whatsapp_phone, err);
        errorCount++;
      }
    }

    setSendingFollowup(new Set());

    if (successCount > 0) {
      toast.success(`Follow-up enviado para ${successCount} contato${successCount > 1 ? 's' : ''}`);
    }
    if (errorCount > 0) {
      toast.error(`Falha ao enviar para ${errorCount} contato${errorCount > 1 ? 's' : ''}`);
    }
  };

  const handleSingleFollowup = async (item: any) => {
    setSendingFollowup(prev => new Set(prev).add(item.id));
    await handleBulkFollowup([item]);
  };

  return (
    <>
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${color}`} />
            {title}
            <Badge variant="secondary" className="ml-auto">{filteredItems.length}</Badge>
          </SheetTitle>
        </SheetHeader>

        {/* Date range filter */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-7 text-xs w-[140px]"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <Input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
            className="h-7 text-xs w-[140px]"
          />
          {[
            { label: 'Hoje', days: 0 },
            { label: '7d', days: 6 },
            { label: '30d', days: 29 },
            { label: '90d', days: 89 },
          ].map(p => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              className="h-7 text-[10px] px-2"
              onClick={() => {
                const to = new Date();
                const from = subDays(to, p.days);
                setFromDate(format(from, 'yyyy-MM-dd'));
                setToDate(format(to, 'yyyy-MM-dd'));
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {/* Doc status filter tabs */}
        {metricType === 'signed_docs' && !loading && items.length > 0 && (
          <>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {([
              { key: 'all' as const, label: 'Todos', count: dashboardFilteredItems.length },
              { key: 'signed' as const, label: 'Assinados', count: dashboardFilteredItems.filter(i => i.status === 'signed' || i.signer_status === 'signed').length },
              { key: 'pending' as const, label: 'Pendentes', count: dashboardFilteredItems.filter(i => !(i.status === 'signed' || i.signer_status === 'signed')).length },
            ]).map(tab => (
              <Button
                key={tab.key}
                variant={docStatusFilter === tab.key ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setDocStatusFilter(tab.key)}
              >
                {tab.label} <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">{tab.count}</Badge>
              </Button>
            ))}
            {docStatusFilter === 'pending' && filteredItems.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 ml-auto border-amber-300 text-amber-700 hover:bg-amber-50"
                disabled={sendingFollowup.size > 0}
                onClick={() => handleBulkFollowup(filteredItems)}
              >
                <Send className="h-3 w-3" />
                Cobrar {filteredItems.length} pendente{filteredItems.length > 1 ? 's' : ''}
              </Button>
            )}
          </div>

          {/* Instance filter */}
          {availableInstances.length > 0 && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Radio className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Instância:</span>
              <Button
                variant={docInstanceFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => setDocInstanceFilter('all')}
              >
                Todas
              </Button>
              {availableInstances.map((inst) => {
                const count = dashboardFilteredItems.filter((i) => {
                  const ii = i.instance_name || i._resolved_instance;
                  return inst === '__none__' ? !ii : ii === inst;
                }).length;
                return (
                  <Button
                    key={inst}
                    variant={docInstanceFilter === inst ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 text-[10px] px-2 gap-1"
                    onClick={() => setDocInstanceFilter(inst)}
                  >
                    {inst === '__none__' ? 'Sem instância' : inst}
                    <Badge variant="secondary" className="h-3.5 px-1 text-[9px]">{count}</Badge>
                  </Button>
                );
              })}
            </div>
          )}
          </>
        )}


        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Nenhum registro no período</div>
        ) : (
          <ScrollArea className="h-[calc(100vh-170px)] mt-4">
            <div className="space-y-2 pr-2">
              {metricType === 'signed_docs' && filteredItems.map(item => (
                <div key={item.id} className="border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate flex-1">{item.document_name || 'Documento'}</p>
                    {statusBadge(item.signer_status)}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.signer_name || '—'}</span>
                    <span>{format(parseISO(item.created_at), 'dd/MM HH:mm')}</span>
                  </div>
                  {item.instance_name && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Radio className="h-2.5 w-2.5" />
                      <span>{item.instance_name}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                    {item.lead_id && (
                      <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => handleOpenLead(item.lead_id)}>
                        <ExternalLink className="h-3 w-3" /> Abrir Lead
                      </Button>
                    )}
                    {item.whatsapp_phone && (
                      <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => handleOpenChat(item.whatsapp_phone, item.instance_name)}>
                        <MessageSquare className="h-3 w-3" /> Chat Conversa
                      </Button>
                    )}
                    {item._lead?.whatsapp_group_id && (
                      <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1 border-cyan-200 text-cyan-700" onClick={() => handleOpenChat(item._lead.whatsapp_group_id, item.instance_name, item._lead?.lead_name || item.signer_name)}>
                        <UsersRound className="h-3 w-3" /> Chat Grupo
                      </Button>
                    )}
                    {item.signer_status !== 'signed' && item.whatsapp_phone && item.instance_name && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] px-2 gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                        disabled={sendingFollowup.has(item.id)}
                        onClick={() => handleSingleFollowup(item)}
                      >
                        {sendingFollowup.has(item.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Cobrar
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {metricType === 'groups' && filteredItems.map(item => (
                <div key={item.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate flex-1">{item.lead_name || 'Lead'}</p>
                    <span className="text-[10px] text-muted-foreground">{format(parseISO(item.created_at), 'HH:mm')}</span>
                  </div>
                  {item.acolhedor && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <UsersRound className="h-2.5 w-2.5" />
                      <span>Responsável: <strong className="text-foreground">{item.acolhedor}</strong></span>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground truncate">{item.whatsapp_group_id}</p>
                  
                  {/* Participants/Contacts */}
                  {item._contacts && item._contacts.length > 0 && (
                    <div className="border-t pt-2 mt-1">
                      <p className="text-[10px] font-medium text-muted-foreground mb-1">
                        Contatos vinculados ({item._contacts.length})
                      </p>
                      <div className="space-y-1">
                        {item._contacts.map((contact: any) => (
                          <div key={contact.id} className="flex items-center justify-between text-[10px] bg-muted/50 rounded px-2 py-1">
                            <span className="font-medium truncate flex-1">{contact.full_name}</span>
                            <span className="text-muted-foreground ml-2">
                              {contact.city && contact.state ? `${contact.city}/${contact.state}` : contact.state || '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-1.5 pt-1">
                    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => handleOpenLead(item.id)}>
                      <ExternalLink className="h-3 w-3" /> Abrir Lead
                    </Button>
                    {item.whatsapp_group_id && (
                      <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1 border-cyan-200 text-cyan-700" onClick={() => handleOpenChat(item.whatsapp_group_id, undefined, item.lead_name)}>
                        <MessageSquare className="h-3 w-3" /> Chat Grupo
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {metricType === 'cases' && filteredItems.map(item => (
                <div key={item.id} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate flex-1">{item.case_number} — {item.title || ''}</p>
                    {statusBadge(item.status)}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.acolhedor || '—'}</span>
                    <span>{format(parseISO(item.created_at), 'HH:mm')}</span>
                  </div>
                  {item.lead_id && (
                    <div className="pt-1">
                      <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => handleOpenLead(item.lead_id)}>
                        <ExternalLink className="h-3 w-3" /> Abrir Lead
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              {metricType === 'processes' && filteredItems.map(item => (
                <div key={item.id} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate flex-1">{item.caso || item.cliente || 'Processo'}</p>
                    {statusBadge(item.status_processo)}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.tipo || '—'} {item.acolhedor ? `• ${item.acolhedor}` : ''}</span>
                    <span>{format(parseISO(item.created_at), 'HH:mm')}</span>
                  </div>
                  {item.numero_processo && (
                    <p className="text-[10px] text-muted-foreground truncate">Nº {item.numero_processo}</p>
                  )}
                </div>
              ))}

              {metricType === 'contacts' && filteredItems.map(item => (
                <div
                  key={item.id}
                  className="border rounded-lg p-3 space-y-1 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => handleOpenContact(item.id)}
                  role="button"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate flex-1">{item.full_name || 'Contato'}</p>
                    {item.classification && <Badge variant="outline" className="text-[9px]">{item.classification}</Badge>}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.phone || '—'}</span>
                    <span>{format(parseISO(item.created_at), 'HH:mm')}</span>
                  </div>
                  {(item.city || item.state) && (
                    <p className="text-[10px] text-muted-foreground">{[item.city, item.state].filter(Boolean).join(', ')}</p>
                  )}
                  {item._creator_name && (
                    <p className="text-[10px] text-muted-foreground">Responsável: {item._creator_name}</p>
                  )}
                  {item.action_source_detail && (
                    <p className="text-[9px] text-muted-foreground truncate">{item.action_source_detail}</p>
                  )}
                  {item.phone && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={(e) => { e.stopPropagation(); handleOpenChat(item.phone); }}
                    >
                      <MessageSquare className="h-3 w-3 mr-1" /> Chat
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>

    {editingLead && (
      <LeadEditDialog
        open={showLeadEdit}
        onOpenChange={(open) => {
          setShowLeadEdit(open);
          if (!open) setEditingLead(null);
        }}
        lead={editingLead}
        onSave={async (leadId, updates) => {
          await supabase.from('leads').update(updates).eq('id', leadId);
          setShowLeadEdit(false);
          setEditingLead(null);
        }}
        mode="sheet"
      />
    )}
    <ContactDetailSheet
      contact={editingContact}
      open={!!editingContact}
      onOpenChange={(open) => { if (!open) setEditingContact(null); }}
    />
    </>
  );
}
