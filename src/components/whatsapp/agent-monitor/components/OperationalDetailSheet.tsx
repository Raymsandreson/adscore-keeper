import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Loader2, FileSignature, Users, Briefcase, Scale, ExternalLink, MessageSquare, UsersRound, Radio, UserPlus, Send, CheckSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, endOfDay, format, parseISO } from 'date-fns';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { toast } from 'sonner';
import type { Lead } from '@/hooks/useLeads';

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
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const fetchDetails = async () => {
      setLoading(true);
      const start = startOfDay(dateRange.from).toISOString();
      const end = endOfDay(dateRange.to).toISOString();

      try {
        if (metricType === 'signed_docs') {
          const { data } = await supabase
            .from('zapsign_documents')
            .select('id, document_name, status, signer_name, signer_status, lead_id, whatsapp_phone, instance_name, created_at')
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });
          
          const leadIds = (data || []).map(d => d.lead_id).filter(Boolean);
          let leadMap: Record<string, { lead_name: string; whatsapp_group_id: string | null; acolhedor: string | null }> = {};
          if (leadIds.length > 0) {
            const { data: leads } = await supabase
              .from('leads')
              .select('id, lead_name, whatsapp_group_id, acolhedor')
              .in('id', leadIds);
            if (leads) {
              leadMap = Object.fromEntries(leads.map(l => [l.id, { lead_name: l.lead_name, whatsapp_group_id: l.whatsapp_group_id, acolhedor: l.acolhedor }]));
            }
          }
          
          setItems((data || []).map(d => ({ ...d, _lead: d.lead_id ? leadMap[d.lead_id] : null })));
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
            const { data: linkedContacts } = await supabase
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
          const { data } = await supabase
            .from('legal_cases')
            .select('id, case_number, title, status, acolhedor, lead_id, created_at')
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });
          setItems(data || []);
        } else if (metricType === 'processes') {
          const { data } = await supabase
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
  }, [open, metricType, dateRange]);

  const hasActiveFilter = filters && (
    filters.instanceFilter !== 'all' || filters.acolhedorFilter !== 'all' ||
    filters.agentFilter !== 'all' || filters.boardFilter !== 'all' || filters.campaignFilter !== 'all'
  );

  const filteredItems = useMemo(() => {
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

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Nenhum registro no período</div>
        ) : (
          <ScrollArea className="h-[calc(100vh-120px)] mt-4">
            <div className="space-y-2 pr-2">
              {metricType === 'signed_docs' && filteredItems.map(item => (
                <div key={item.id} className="border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate flex-1">{item.document_name || 'Documento'}</p>
                    {statusBadge(item.status)}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.signer_name || '—'}</span>
                    <span>{format(parseISO(item.created_at), 'HH:mm')}</span>
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
                <div key={item.id} className="border rounded-lg p-3 space-y-1">
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
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => handleOpenChat(item.phone)}>
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
    </>
  );
}
