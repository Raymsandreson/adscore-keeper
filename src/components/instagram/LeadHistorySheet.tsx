import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  User,
  Calendar,
  MapPin,
  Phone,
  Mail,
  Briefcase,
  ArrowRight,
  Clock,
  FileText,
  Activity,
  UserCheck,
  Building2,
  AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

interface LeadInfo {
  id: string;
  lead_name: string | null;
  status: string | null;
  board_id: string | null;
}

interface StageHistoryEntry {
  id: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
  notes: string | null;
}

interface FollowupEntry {
  id: string;
  followup_date: string;
  followup_type: string;
  notes: string | null;
  outcome: string | null;
}

interface LeadDetails {
  id: string;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  status: string | null;
  source: string | null;
  victim_name: string | null;
  accident_date: string | null;
  accident_address: string | null;
  city: string | null;
  state: string | null;
  main_company: string | null;
  contractor_company: string | null;
  case_type: string | null;
  legal_viability: string | null;
  acolhedor: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
}

interface LeadHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadInfo | null;
}

export function LeadHistorySheet({
  open,
  onOpenChange,
  lead,
}: LeadHistorySheetProps) {
  const [leadDetails, setLeadDetails] = useState<LeadDetails | null>(null);
  const [stageHistory, setStageHistory] = useState<StageHistoryEntry[]>([]);
  const [followups, setFollowups] = useState<FollowupEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !lead?.id) return;

    const fetchLeadData = async () => {
      setLoading(true);
      try {
        // Fetch lead details
        const { data: leadData } = await supabase
          .from('leads')
          .select('*')
          .eq('id', lead.id)
          .single();

        if (leadData) {
          setLeadDetails(leadData as LeadDetails);
        }

        // Fetch stage history
        const { data: historyData } = await supabase
          .from('lead_stage_history')
          .select('*')
          .eq('lead_id', lead.id)
          .order('changed_at', { ascending: false });

        setStageHistory((historyData || []) as StageHistoryEntry[]);

        // Fetch followups
        const { data: followupsData } = await supabase
          .from('lead_followups')
          .select('*')
          .eq('lead_id', lead.id)
          .order('followup_date', { ascending: false });

        setFollowups((followupsData || []) as FollowupEntry[]);
      } catch (error) {
        console.error('Error fetching lead data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeadData();
  }, [open, lead?.id]);

  if (!lead) return null;

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'novo':
        return 'bg-blue-500/10 text-blue-700 border-blue-500/30';
      case 'qualificado':
        return 'bg-green-500/10 text-green-700 border-green-500/30';
      case 'cliente':
        return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30';
      case 'perdido':
        return 'bg-red-500/10 text-red-700 border-red-500/30';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getFollowupTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      call: 'Ligação',
      email: 'E-mail',
      whatsapp: 'WhatsApp',
      meeting: 'Reunião',
      visit: 'Visita',
      other: 'Outro',
    };
    return labels[type] || type;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Histórico do Lead
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 mt-4">
          {loading ? (
            <div className="space-y-4 pr-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <div className="space-y-6 pr-4">
              {/* Lead Info Card */}
              <div className="p-4 rounded-lg border bg-muted/30">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-lg">
                      {leadDetails?.lead_name || 'Lead sem nome'}
                    </h3>
                    {leadDetails?.victim_name && (
                      <p className="text-sm text-muted-foreground">
                        Vítima: {leadDetails.victim_name}
                      </p>
                    )}
                  </div>
                  <Badge className={getStatusColor(leadDetails?.status)}>
                    {leadDetails?.status || 'Sem status'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  {leadDetails?.lead_phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {leadDetails.lead_phone}
                    </div>
                  )}
                  {leadDetails?.lead_email && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      {leadDetails.lead_email}
                    </div>
                  )}
                  {(leadDetails?.city || leadDetails?.state) && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {[leadDetails?.city, leadDetails?.state].filter(Boolean).join(' - ')}
                    </div>
                  )}
                  {leadDetails?.accident_date && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(leadDetails.accident_date), 'dd/MM/yyyy')}
                    </div>
                  )}
                  {leadDetails?.main_company && (
                    <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                      <Building2 className="h-3 w-3" />
                      {leadDetails.main_company}
                    </div>
                  )}
                  {leadDetails?.case_type && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Briefcase className="h-3 w-3" />
                      {leadDetails.case_type}
                    </div>
                  )}
                  {leadDetails?.acolhedor && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <UserCheck className="h-3 w-3" />
                      {leadDetails.acolhedor}
                    </div>
                  )}
                </div>

                {leadDetails?.notes && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <FileText className="h-3 w-3 mt-0.5 flex-shrink-0" />
                      {leadDetails.notes}
                    </p>
                  </div>
                )}
              </div>

              {/* Legal Viability */}
              {leadDetails?.legal_viability && (
                <div className="p-3 rounded-lg border bg-amber-500/5 border-amber-500/20">
                  <div className="flex items-center gap-2 text-sm">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <span className="font-medium">Viabilidade Jurídica:</span>
                    <Badge variant="outline" className="border-amber-500/30 text-amber-700">
                      {leadDetails.legal_viability}
                    </Badge>
                  </div>
                </div>
              )}

              <Separator />

              {/* Stage History */}
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Histórico de Etapas
                </h4>

                {stageHistory.length > 0 ? (
                  <div className="space-y-3">
                    {stageHistory.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-3 rounded-lg border bg-muted/20"
                      >
                        <div className="flex items-center gap-2 text-sm">
                          {entry.from_stage ? (
                            <>
                              <Badge variant="outline" className="text-xs">
                                {entry.from_stage}
                              </Badge>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">Criado em</span>
                          )}
                          <Badge className="text-xs bg-primary/10 text-primary border-primary/30">
                            {entry.to_stage}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {format(new Date(entry.changed_at), "dd/MM/yyyy 'às' HH:mm", {
                            locale: ptBR,
                          })}
                        </div>
                        {entry.notes && (
                          <p className="mt-2 text-xs text-muted-foreground border-l-2 border-muted pl-2">
                            {entry.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhuma movimentação registrada
                  </p>
                )}
              </div>

              <Separator />

              {/* Followups */}
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Follow-ups Realizados
                </h4>

                {followups.length > 0 ? (
                  <div className="space-y-3">
                    {followups.map((followup) => (
                      <div
                        key={followup.id}
                        className="p-3 rounded-lg border bg-muted/20"
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-xs">
                            {getFollowupTypeLabel(followup.followup_type)}
                          </Badge>
                          {followup.outcome && (
                            <Badge
                              className={`text-xs ${
                                followup.outcome === 'success'
                                  ? 'bg-green-500/10 text-green-700'
                                  : followup.outcome === 'no_answer'
                                  ? 'bg-amber-500/10 text-amber-700'
                                  : 'bg-red-500/10 text-red-700'
                              }`}
                            >
                              {followup.outcome === 'success'
                                ? 'Sucesso'
                                : followup.outcome === 'no_answer'
                                ? 'Não atendeu'
                                : 'Sem interesse'}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(followup.followup_date), "dd/MM/yyyy 'às' HH:mm", {
                            locale: ptBR,
                          })}
                        </div>
                        {followup.notes && (
                          <p className="mt-2 text-xs text-muted-foreground border-l-2 border-muted pl-2">
                            {followup.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum follow-up registrado
                  </p>
                )}
              </div>

              {/* Created/Updated dates */}
              <div className="text-xs text-muted-foreground space-y-1 pt-4">
                {leadDetails?.created_at && (
                  <p>
                    Criado em:{' '}
                    {format(new Date(leadDetails.created_at), "dd/MM/yyyy 'às' HH:mm", {
                      locale: ptBR,
                    })}
                  </p>
                )}
                {leadDetails?.updated_at && (
                  <p>
                    Atualizado em:{' '}
                    {format(new Date(leadDetails.updated_at), "dd/MM/yyyy 'às' HH:mm", {
                      locale: ptBR,
                    })}
                  </p>
                )}
              </div>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
