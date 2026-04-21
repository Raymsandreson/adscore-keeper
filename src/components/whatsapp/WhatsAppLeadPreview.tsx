import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ActivityDetailPanel } from '@/components/activities/ActivityDetailPanel';
import { WhatsAppLeadStageDrawer } from './WhatsAppLeadStageDrawer';
import { 
  MapPin, Building2, User, Calendar, FileText, ExternalLink, 
  ChevronDown, ChevronUp, ClipboardPlus
} from 'lucide-react';
import { CopyableText } from '@/components/ui/copyable-text';
import { ShareMenu } from '@/components/ShareMenu';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

interface LeadData {
  id: string;
  lead_name: string | null;
  status: string | null;
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
  visit_city: string | null;
  visit_state: string | null;
  board_id: string | null;
}

interface WhatsAppLeadPreviewProps {
  leadId: string;
  contactId?: string | null;
  contactName?: string | null;
  onCreateActivity: (leadId: string, leadName: string, contactId?: string, contactName?: string) => void;
  onNavigateToLead?: (leadId: string) => void;
}

const statusLabels: Record<string, string> = {
  new: 'Novo', qualified: 'Qualificado', contacted: 'Contatado',
  converted: 'Convertido', lost: 'Perdido',
};

export function WhatsAppLeadPreview({ leadId, contactId, contactName, onCreateActivity, onNavigateToLead }: WhatsAppLeadPreviewProps) {
  const [lead, setLead] = useState<LeadData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchLead = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('leads')
      .select('id, lead_name, status, city, state, case_type, acolhedor, victim_name, victim_age, accident_date, damage_description, main_company, contractor_company, visit_city, visit_state, board_id')
      .eq('id', leadId)
      .single();
    setLead(data as LeadData | null);
    setLoading(false);
  }, [leadId]);

  useEffect(() => { fetchLead(); }, [fetchLead]);

  if (loading || !lead) return null;

  const summaryParts: string[] = [];
  if (lead.victim_name) summaryParts.push(lead.victim_name);
  if (lead.main_company) summaryParts.push(lead.main_company);
  const summaryLine = summaryParts.length > 1 ? summaryParts.join(' x ') : summaryParts[0] || '';

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="shrink-0 bg-card border-b">
        {/* Compact header - always visible */}
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CopyableText copyValue={lead.lead_name || 'Lead'} label="Lead" className="text-xs font-semibold truncate">{lead.lead_name || 'Lead'}</CopyableText>
              {lead.status && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0">
                  {statusLabels[lead.status] || lead.status}
                </Badge>
              )}
              {summaryLine && (
                <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                  — {summaryLine}
                </span>
              )}
            </div>
            {/* Key badges row */}
            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
              {lead.case_type && (
                <span className="flex items-center gap-0.5">
                  <FileText className="h-2.5 w-2.5" /> {lead.case_type}
                </span>
              )}
              {lead.damage_description && (
                <span className="flex items-center gap-0.5 truncate max-w-[120px]" title={lead.damage_description}>
                  🩹 {lead.damage_description}
                </span>
              )}
              {lead.accident_date && (
                <span className="flex items-center gap-0.5">
                  <Calendar className="h-2.5 w-2.5" /> {format(parseISO(lead.accident_date), 'dd/MM/yyyy')}
                </span>
              )}
              {(lead.city || lead.visit_city) && (
                <span className="flex items-center gap-0.5">
                  <MapPin className="h-2.5 w-2.5" /> {lead.visit_city || lead.city}/{lead.visit_state || lead.state}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ShareMenu entityType="lead" entityId={lead.id} entityName={lead.lead_name || 'Lead'} className="h-6 w-6" />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] gap-1 px-2 text-green-600 hover:text-green-700"
              onClick={() => onCreateActivity(lead.id, lead.lead_name || 'Lead', contactId || undefined, contactName || undefined)}
            >
              <ClipboardPlus className="h-3 w-3" /> Criar Atividade
            </Button>
            {onNavigateToLead && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onNavigateToLead(lead.id)}
                title="Abrir Lead"
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        {/* Stage Drawer - faixa fina + Sheet lateral (libera espaço do chat) */}
        {lead.board_id && (
          <WhatsAppLeadStageDrawer
            leadId={lead.id}
            boardId={lead.board_id}
            currentStageId={lead.status}
            onStageChanged={fetchLead}
          />
        )}

        {/* Expanded: Full ActivityDetailPanel with tabs */}
        <CollapsibleContent>
          <div className="border-t" style={{ height: '300px' }}>
            <ActivityDetailPanel
              leadId={lead.id}
              leadName={lead.lead_name}
              currentActivityId={null}
              onNavigateToLead={onNavigateToLead}
            />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
