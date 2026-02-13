import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  ExternalLink, MapPin, Building2, Phone, Mail, User, Calendar,
  ArrowRight, Clock, FileText, Instagram, Heart,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

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

export function ActivityDetailPanel({ leadId, leadName, currentActivityId, onNavigateToLead }: ActivityDetailPanelProps) {
  const [lead, setLead] = useState<LeadData | null>(null);
  const [contacts, setContacts] = useState<ContactData[]>([]);
  const [stageHistory, setStageHistory] = useState<StageHistoryEntry[]>([]);
  const [leadActivities, setLeadActivities] = useState<LeadActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('detalhes');

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

            {/* Vítima x Empresa */}
            {summaryLine && (
              <p className="text-xs font-medium text-foreground/80 mt-0.5 truncate">
                {summaryLine}
              </p>
            )}

            {/* Key info grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-[11px] text-muted-foreground">
              {lead?.case_type && (
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3 shrink-0" /> {lead.case_type}
                </span>
              )}
              {lead?.damage_description && (
                <span className="flex items-center gap-1 truncate" title={lead.damage_description}>
                  🩹 {lead.damage_description}
                </span>
              )}
              {lead?.accident_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3 shrink-0" /> {format(parseISO(lead.accident_date), 'dd/MM/yyyy')}
                </span>
              )}
              {lead?.city && lead?.state && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" /> {lead.city}/{lead.state}
                </span>
              )}
              {lead?.acolhedor && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3 shrink-0" /> {lead.acolhedor}
                </span>
              )}
              {contacts.length > 0 && (
                <span className="flex items-center gap-1">
                  👥 {contacts.length} contato{contacts.length > 1 ? 's' : ''}
                </span>
              )}
              {lead?.contractor_company && (
                <span className="flex items-center gap-1 truncate" title={lead.contractor_company}>
                  <Building2 className="h-3 w-3 shrink-0" /> {lead.contractor_company}
                </span>
              )}
              {lead?.victim_age && (
                <span className="flex items-center gap-1">
                  🎂 {lead.victim_age} anos
                </span>
              )}
              {lead?.visit_city && lead?.visit_state && (
                <span className="flex items-center gap-1">
                  📍 Visita: {lead.visit_city}/{lead.visit_state}
                </span>
              )}
            </div>
          </div>
          {onNavigateToLead && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 shrink-0"
              onClick={() => onNavigateToLead(leadId)}
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
    </div>
  );
}
