import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import {
  ExternalLink, MapPin, Building2, Phone, Mail, User, Calendar,
  ArrowRight, Clock, FileText, Instagram, Heart, UserPlus, Search, Link2, Loader2,
} from 'lucide-react';
import { TeamChatButton } from '@/components/chat/TeamChatButton';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import type { Lead } from '@/hooks/useLeads';

interface LeadData {
  id: string;
  lead_name: string | null;
  status: string | null;
  source: string | null;
  city: string | null;
  state: string | null;
  case_type: string | null;
  acolhedor: string | null;
  victim_name: string | null;
  victim_age: number | null;
  accident_date: string | null;
  damage_description: string | null;
  main_company: string | null;
  contractor_company: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  board_id: string | null;
  group_link: string | null;
  news_link: string | null;
  visit_city: string | null;
  visit_state: string | null;
  accident_address: string | null;
}

interface ContactData {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  instagram_username: string | null;
  classification: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  relationship_to_victim?: string | null;
}

interface StageHistoryEntry {
  id: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
  changed_by: string | null;
  notes: string | null;
}

interface LeadActivityEntry {
  id: string;
  title: string;
  activity_type: string;
  status: string;
  deadline: string | null;
  created_at: string;
  assigned_to_name: string | null;
  completed_at: string | null;
}

interface ActivityDetailPanelProps {
  leadId: string | null;
  leadName: string | null;
  currentActivityId: string | null;
  onNavigateToLead?: (leadId: string) => void;
}

const statusLabels: Record<string, string> = {
  new: 'Novo', qualified: 'Qualificado', contacted: 'Contatado',
  converted: 'Convertido', lost: 'Perdido',
};

const activityTypeLabels: Record<string, string> = {
  tarefa: 'Tarefa', audiencia: 'Audiência', prazo: 'Prazo',
  acompanhamento: 'Acompanhamento', reuniao: 'Reunião', diligencia: 'Diligência',
};

const statusActivityColors: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  em_andamento: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  concluida: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
};

function LinkContactButton({ leadId, onLinked }: { leadId: string; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Array<{ id: string; full_name: string; phone: string | null; email: string | null }>>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  const doSearch = useCallback(async (q: string) => {
    setSearching(true);
    let query = supabase.from('contacts').select('id, full_name, phone, email').order('full_name').limit(15);
    if (q.trim()) {
      query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
    }
    const { data } = await query;
    setResults(data || []);
    setSearching(false);
  }, []);

  useEffect(() => {
    if (open) doSearch(search);
  }, [open]);

  const handleLink = async (contactId: string) => {
    setLinking(contactId);
    try {
      const { error } = await supabase.from('contact_leads').insert({ contact_id: contactId, lead_id: leadId });
      if (error) {
        if (error.code === '23505') { toast.error('Contato já vinculado'); return; }
        throw error;
      }
      toast.success('Contato vinculado!');
      setOpen(false);
      onLinked();
    } catch (e: any) {
      toast.error('Erro ao vincular: ' + e.message);
    } finally {
      setLinking(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full gap-2 text-xs">
          <Link2 className="h-3.5 w-3.5" /> Vincular Contato
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="relative mb-2">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar contato..."
            value={search}
            onChange={e => { setSearch(e.target.value); doSearch(e.target.value); }}
            className="pl-7 h-8 text-xs"
          />
        </div>
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {searching ? (
            <p className="text-xs text-center py-3 text-muted-foreground">Buscando...</p>
          ) : results.length === 0 ? (
            <p className="text-xs text-center py-3 text-muted-foreground">Nenhum contato encontrado</p>
          ) : (
            results.map(c => (
              <button
                key={c.id}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-xs flex items-center justify-between gap-2"
                onClick={() => handleLink(c.id)}
                disabled={linking === c.id}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.full_name}</p>
                  {c.phone && <p className="text-muted-foreground text-[10px]">{c.phone}</p>}
                </div>
                {linking === c.id ? <Loader2 className="h-3 w-3 animate-spin shrink-0" /> : <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ActivityDetailPanel({ leadId, leadName, currentActivityId, onNavigateToLead }: ActivityDetailPanelProps) {
  const [lead, setLead] = useState<LeadData | null>(null);
  const [contacts, setContacts] = useState<ContactData[]>([]);
  const [stageHistory, setStageHistory] = useState<StageHistoryEntry[]>([]);
  const [leadActivities, setLeadActivities] = useState<LeadActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('detalhes');
  const [showLeadSheet, setShowLeadSheet] = useState(false);

  const fetchLeadData = useCallback(async () => {
    if (!leadId) {
      setLead(null);
      setContacts([]);
      setStageHistory([]);
      setLeadActivities([]);
      return;
    }
    setLoading(true);
    try {
      const [leadRes, contactLinksRes, historyRes, activitiesRes] = await Promise.all([
        supabase.from('leads').select('*').eq('id', leadId).single(),
        supabase.from('contact_leads').select('contact_id, relationship_to_victim').eq('lead_id', leadId),
        supabase.from('lead_stage_history').select('*').eq('lead_id', leadId).order('changed_at', { ascending: false }),
        supabase.from('lead_activities').select('id, title, activity_type, status, deadline, created_at, assigned_to_name, completed_at').eq('lead_id', leadId).order('created_at', { ascending: false }),
      ]);

      if (leadRes.data) setLead(leadRes.data as LeadData);

      // Fetch contacts
      const contactIds = (contactLinksRes.data || []).map(cl => cl.contact_id);
      const relationshipMap = new Map((contactLinksRes.data || []).map(cl => [cl.contact_id, cl.relationship_to_victim]));

      if (contactIds.length > 0) {
        const { data: contactsData } = await supabase
          .from('contacts')
          .select('id, full_name, phone, email, instagram_username, classification, city, state, notes')
          .in('id', contactIds);
        setContacts((contactsData || []).map(c => ({
          ...c,
          relationship_to_victim: relationshipMap.get(c.id) || null,
        })));
      } else {
        // Check legacy lead_id
        const { data: legacyContacts } = await supabase
          .from('contacts')
          .select('id, full_name, phone, email, instagram_username, classification, city, state, notes')
          .eq('lead_id', leadId);
        setContacts((legacyContacts || []).map(c => ({ ...c, relationship_to_victim: null })));
      }

      setStageHistory((historyRes.data || []) as StageHistoryEntry[]);
      setLeadActivities((activitiesRes.data || []) as LeadActivityEntry[]);
    } catch (err) {
      console.error('Error fetching lead data:', err);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchLeadData();
  }, [fetchLeadData]);

  if (!leadId || !leadName) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-6">
        <p>Vincule um lead à atividade para ver detalhes completos aqui.</p>
      </div>
    );
  }

  // Build summary line: Vítima x Empresa
  const summaryParts: string[] = [];
  if (lead?.victim_name) summaryParts.push(lead.victim_name);
  if (lead?.main_company) summaryParts.push(lead.main_company);
  const summaryLine = summaryParts.length > 1 ? summaryParts.join(' x ') : summaryParts[0] || '';

  return (
    <div className="flex flex-col h-full">
      {/* Fixed Lead Card Header */}
      <div className="shrink-0 bg-card border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Lead name + status */}
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm truncate">{leadName}</h3>
              {lead?.status && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                  {statusLabels[lead.status] || lead.status}
                </Badge>
              )}
            </div>

            {/* Compact metadata summary line (like activities header) */}
            {lead && (() => {
              const parts: string[] = [];
              if (lead.city && lead.state) parts.push(`${lead.city}/${lead.state}`);
              if (lead.victim_name) parts.push(lead.victim_name);
              if (lead.accident_date) parts.push(`(${format(parseISO(lead.accident_date), 'dd/MM/yyyy')})`);
              if (lead.damage_description) parts.push(`- ${lead.damage_description}`);
              const metaLine = parts.join(' | ');
              return metaLine ? (
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate" title={metaLine}>
                  📁 {metaLine}
                </p>
              ) : null;
            })()}

            {/* Secondary info row */}
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
              {lead?.damage_description && (
                <span className="flex items-center gap-0.5">🩹 {lead.damage_description}</span>
              )}
              {lead?.accident_date && (
                <span className="flex items-center gap-0.5">
                  <Calendar className="h-2.5 w-2.5" /> {format(parseISO(lead.accident_date), 'dd/MM/yyyy')}
                </span>
              )}
              {lead?.updated_at && (
                <span className="flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" /> Últ: {format(parseISO(lead.updated_at), 'dd/MM HH:mm')}
                </span>
              )}
              {lead?.case_type && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                  {lead.case_type}
                </Badge>
              )}
              {lead?.acolhedor && (
                <span className="flex items-center gap-0.5">
                  <User className="h-2.5 w-2.5" /> {lead.acolhedor}
                </span>
              )}
            </div>
          </div>
          {leadId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 shrink-0"
              onClick={() => setShowLeadSheet(true)}
            >
              <ExternalLink className="h-3 w-3" /> Abrir Lead
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="shrink-0 w-full justify-start rounded-none border-b bg-transparent h-9 px-2 gap-0">
          <TabsTrigger value="detalhes" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            Lead
          </TabsTrigger>
          <TabsTrigger value="contatos" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            Contatos {contacts.length > 0 && <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 h-4">{contacts.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="atividades" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            Atividades {leadActivities.length > 0 && <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 h-4">{leadActivities.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="historico" className="text-xs h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            Funil {stageHistory.length > 0 && <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 h-4">{stageHistory.length}</Badge>}
          </TabsTrigger>
          {leadId && (
            <div className="ml-auto flex items-center">
              <TeamChatButton entityType="lead" entityId={leadId} entityName={leadName || undefined} variant="icon" />
            </div>
          )}
        </TabsList>

        {/* Lead Details Tab */}
        <TabsContent value="detalhes" className="flex-1 overflow-y-auto m-0">
          <div className="p-4 space-y-4">
            {loading ? (
              <div className="text-center text-muted-foreground text-sm py-8">Carregando...</div>
            ) : lead ? (
              <>
                {/* Vítima + Idade */}
                {(lead.victim_name || lead.victim_age) && (
                  <div className="grid grid-cols-2 gap-3">
                    {lead.victim_name && (
                      <div>
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Vítima</span>
                        <p className="text-sm font-medium">{lead.victim_name}</p>
                      </div>
                    )}
                    {lead.victim_age && (
                      <div>
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Idade</span>
                        <p className="text-sm">{lead.victim_age} anos</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Acidente info */}
                <div className="grid grid-cols-2 gap-3">
                  {lead.accident_date && (
                    <div>
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Data do Acidente</span>
                      <p className="text-sm">{format(parseISO(lead.accident_date), 'dd/MM/yyyy')}</p>
                    </div>
                  )}
                  {lead.case_type && (
                    <div>
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Tipo de Caso</span>
                      <p className="text-sm">{lead.case_type}</p>
                    </div>
                  )}
                </div>

                {lead.damage_description && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Dano / Lesão</span>
                    <p className="text-sm">{lead.damage_description}</p>
                  </div>
                )}

                {lead.accident_address && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Local do Acidente</span>
                    <p className="text-sm">{lead.accident_address}</p>
                  </div>
                )}

                {(lead.main_company || lead.contractor_company) && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Empresas</span>
                    {lead.main_company && <p className="text-sm flex items-center gap-1"><Building2 className="h-3 w-3" /> {lead.main_company}</p>}
                    {lead.contractor_company && <p className="text-sm text-muted-foreground ml-4">Terceirizada: {lead.contractor_company}</p>}
                  </div>
                )}

                {/* Local da Visita */}
                {(lead.visit_city || lead.visit_state) && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Local da Visita</span>
                    <p className="text-sm flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {[lead.visit_city, lead.visit_state].filter(Boolean).join('/')}
                    </p>
                  </div>
                )}

                {lead.notes && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Observações</span>
                    <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
                  </div>
                )}

                {(lead.group_link || lead.news_link) && (
                  <div className="flex gap-2 flex-wrap">
                    {lead.group_link && (
                      <a href={lead.group_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">Grupo</a>
                    )}
                    {lead.news_link && (
                      <a href={lead.news_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">Notícia</a>
                    )}
                  </div>
                )}

                <Separator />

                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider">Criado em</span>
                    <p>{format(parseISO(lead.created_at), "dd/MM/yyyy 'às' HH:mm")}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider">Atualizado em</span>
                    <p>{format(parseISO(lead.updated_at), "dd/MM/yyyy 'às' HH:mm")}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Lead não encontrado</p>
            )}
          </div>
        </TabsContent>

        {/* Contacts Tab */}
        <TabsContent value="contatos" className="flex-1 overflow-y-auto m-0">
          <div className="p-4 space-y-3">
            <LinkContactButton leadId={leadId} onLinked={fetchLeadData} />
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum contato vinculado a este lead</p>
            ) : (
              contacts.map(contact => (
                <div key={contact.id} className="bg-muted/30 rounded-lg p-3 border border-border/50">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{contact.full_name}</p>
                      {contact.relationship_to_victim && (
                        <Badge variant="outline" className="text-[10px] mt-0.5">{contact.relationship_to_victim}</Badge>
                      )}
                    </div>
                    {contact.classification && (
                      <Badge variant="secondary" className="text-[10px]">{contact.classification}</Badge>
                    )}
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {contact.phone && (
                      <a href={`tel:${contact.phone}`} className="flex items-center gap-1.5 hover:text-foreground">
                        <Phone className="h-3 w-3" /> {contact.phone}
                      </a>
                    )}
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 hover:text-foreground">
                        <Mail className="h-3 w-3" /> {contact.email}
                      </a>
                    )}
                    {contact.instagram_username && (
                      <a href={`https://instagram.com/${contact.instagram_username}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-foreground">
                        <Instagram className="h-3 w-3" /> @{contact.instagram_username}
                      </a>
                    )}
                    {contact.city && contact.state && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3" /> {contact.city}/{contact.state}
                      </span>
                    )}
                  </div>
                  {contact.notes && (
                    <p className="mt-2 text-xs text-muted-foreground italic">{contact.notes}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* Activities Tab */}
        <TabsContent value="atividades" className="flex-1 overflow-y-auto m-0">
          <div className="p-4 space-y-2">
            {leadActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhuma atividade para este lead</p>
            ) : (
              leadActivities.map(act => (
                <div
                  key={act.id}
                  className={cn(
                    "rounded-lg p-3 border border-border/50 transition-colors",
                    act.id === currentActivityId ? "bg-primary/5 border-primary/30 ring-1 ring-primary/20" : "bg-muted/20 hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Badge className={cn("text-[10px] px-1.5 py-0", statusActivityColors[act.status] || 'bg-muted')}>
                      {act.status === 'pendente' ? 'Pendente' : act.status === 'em_andamento' ? 'Em Andamento' : 'Concluída'}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {activityTypeLabels[act.activity_type] || act.activity_type}
                    </Badge>
                    {act.id === currentActivityId && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-primary text-primary-foreground">Atual</Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">{act.title}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                    {act.deadline && (
                      <span className="flex items-center gap-0.5">
                        <Calendar className="h-3 w-3" /> {format(parseISO(act.deadline), 'dd/MM/yyyy')}
                      </span>
                    )}
                    {act.assigned_to_name && <span>• {act.assigned_to_name}</span>}
                    {act.completed_at && (
                      <span className="text-green-600">✓ {format(parseISO(act.completed_at), 'dd/MM HH:mm')}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* Stage History Tab */}
        <TabsContent value="historico" className="flex-1 overflow-y-auto m-0">
          <div className="p-4">
            {stageHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhuma movimentação no funil</p>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />

                <div className="space-y-4">
                  {stageHistory.map((entry, idx) => (
                    <div key={entry.id} className="relative pl-8">
                      {/* Timeline dot */}
                      <div className={cn(
                        "absolute left-1.5 top-1 h-3 w-3 rounded-full border-2 border-background",
                        idx === 0 ? "bg-primary" : "bg-muted-foreground/30"
                      )} />

                      <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
                        <div className="flex items-center gap-1.5 text-xs">
                          {entry.from_stage ? (
                            <>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{entry.from_stage}</Badge>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <Badge className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">{entry.to_stage}</Badge>
                            </>
                          ) : (
                            <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                              Entrada: {entry.to_stage}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {format(parseISO(entry.changed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </div>
                        {entry.notes && (
                          <p className="mt-1 text-xs text-muted-foreground italic">{entry.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Lead Edit Sheet */}
      {leadId && (
        <LeadEditDialog
          open={showLeadSheet}
          onOpenChange={setShowLeadSheet}
          lead={lead as any}
          onSave={() => {
            setShowLeadSheet(false);
            fetchLeadData();
          }}
          mode="sheet"
        />
      )}
    </div>
  );
}
