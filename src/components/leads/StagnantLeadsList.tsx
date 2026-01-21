import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AlertTriangle, Clock, Phone, MessageSquare, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { StagnantLead } from '@/hooks/useStagnationAlerts';
import { LeadStatus } from '@/hooks/useLeads';
import { useState } from 'react';

interface StagnantLeadsListProps {
  stagnantLeads: StagnantLead[];
  stagnantByStatus: Record<LeadStatus, number>;
  onOpenLead?: (lead: StagnantLead) => void;
}

const statusLabels: Record<LeadStatus, string> = {
  comment: 'Comentários',
  new: 'Em análise',
  contacted: 'Contatado',
  qualified: 'Qualificado',
  not_qualified: 'Desqualificado',
  converted: 'Convertido',
  lost: 'Perdido',
};

const statusColors: Record<LeadStatus, string> = {
  comment: 'border-pink-500 text-pink-600',
  new: 'border-blue-500 text-blue-600',
  contacted: 'border-yellow-500 text-yellow-600',
  qualified: 'border-green-500 text-green-600',
  not_qualified: 'border-gray-500 text-gray-600',
  converted: 'border-emerald-500 text-emerald-600',
  lost: 'border-red-500 text-red-600',
};

export const StagnantLeadsList = ({
  stagnantLeads,
  stagnantByStatus,
  onOpenLead,
}: StagnantLeadsListProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const getInitials = (name: string | null) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getSeverityColor = (days: number, threshold: number) => {
    const ratio = days / threshold;
    if (ratio >= 2) return 'text-destructive bg-destructive/10';
    if (ratio >= 1.5) return 'text-orange-600 bg-orange-100';
    return 'text-yellow-600 bg-yellow-100';
  };

  if (stagnantLeads.length === 0) {
    return null;
  }

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardHeader 
        className="cursor-pointer pb-3"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-destructive/10 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                Leads Estagnados
                <Badge variant="destructive">{stagnantLeads.length}</Badge>
              </CardTitle>
              <CardDescription>
                Leads sem atividade além do limite configurado
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon">
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-2 mt-3">
          {Object.entries(stagnantByStatus)
            .filter(([, count]) => count > 0)
            .map(([status, count]) => (
              <Badge 
                key={status} 
                variant="outline" 
                className={statusColors[status as LeadStatus]}
              >
                {statusLabels[status as LeadStatus]}: {count}
              </Badge>
            ))}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent>
          <ScrollArea className="max-h-80">
            <div className="space-y-2">
              {stagnantLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => onOpenLead?.(lead)}
                >
                  <Avatar className="h-9 w-9 border-2 border-destructive/30">
                    <AvatarFallback className="text-xs bg-destructive/10 text-destructive">
                      {getInitials(lead.lead_name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">
                        {lead.lead_name || 'Sem nome'}
                      </p>
                      <Badge variant="outline" className={`text-xs ${statusColors[lead.status]}`}>
                        {statusLabels[lead.status]}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {lead.lead_phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {lead.lead_phone}
                        </span>
                      )}
                      {lead.campaign_name && (
                        <span className="truncate max-w-32">{lead.campaign_name}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge className={`${getSeverityColor(lead.daysSinceLastActivity, lead.threshold)}`}>
                      <Clock className="h-3 w-3 mr-1" />
                      {lead.daysSinceLastActivity}d
                    </Badge>
                    
                    {lead.lead_phone && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`https://wa.me/${lead.lead_phone?.replace(/\D/g, '')}`, '_blank');
                        }}
                      >
                        <MessageSquare className="h-4 w-4 text-green-600" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
};
