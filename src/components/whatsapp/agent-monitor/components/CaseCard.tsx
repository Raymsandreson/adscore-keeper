import { Bot, Phone, MapPin, Megaphone, Zap, Clock, RefreshCw, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import type { ConversationDetail } from '../types';
import { convKey, getCaseStatus, statusColor, statusLabel, formatTimeAgo, activatedByLabel } from '../utils';

interface CaseCardProps {
  c: ConversationDetail;
  selectable?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (c: ConversationDetail) => void;
  onOpenChat?: (c: ConversationDetail) => void;
  generatingLeadId?: string | null;
  onGenerateActivity?: (c: ConversationDetail) => void;
}

export function CaseCard({ c, selectable = false, isSelected = false, onToggleSelect, onOpenChat, generatingLeadId, onGenerateActivity }: CaseCardProps) {
  const status = getCaseStatus(c);

  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-shadow ${isSelected ? 'ring-2 ring-primary' : ''}`}
      onClick={() => selectable && onToggleSelect ? onToggleSelect(c) : onOpenChat?.(c)}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {selectable && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect?.(c)}
              onClick={(e) => e.stopPropagation()}
              className="mt-1 shrink-0"
            />
          )}
          <div className="flex-1 min-w-0" onClick={(e) => { if (selectable) { e.stopPropagation(); onOpenChat?.(c); } }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold truncate">{c.contact_name || c.lead_name || c.phone}</span>
              <Badge className={`text-[9px] h-4 border ${statusColor(status)}`}>{statusLabel(status)}</Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
              <span className="flex items-center gap-0.5"><Bot className="h-3 w-3" /> {c.agent_name}</span>
              <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" /> {c.phone}</span>
              {c.lead_city && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {c.lead_city}{c.lead_state ? `/${c.lead_state}` : ''}</span>}
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {c.campaign_name && <Badge variant="secondary" className="text-[9px] h-4"><Megaphone className="h-2.5 w-2.5 mr-0.5" /> {c.campaign_name}</Badge>}
              {c.board_name && c.stage_name && <Badge variant="outline" className="text-[9px] h-4">{c.board_name} → {c.stage_name}</Badge>}
              {c.activated_by && <Badge variant="outline" className="text-[9px] h-4 border-blue-200 text-blue-600 dark:border-blue-800 dark:text-blue-400">⚡ {activatedByLabel(c.activated_by)}</Badge>}
              {c.has_followup_config && <Badge variant="outline" className="text-[9px] h-4 border-purple-200 text-purple-600 dark:border-purple-800 dark:text-purple-400"><Zap className="h-2.5 w-2.5 mr-0.5" /> Follow-up</Badge>}
            </div>
          </div>
          <div className="text-right shrink-0 space-y-1">
            {c.created_at && <p className="text-[10px] text-muted-foreground">{format(new Date(c.created_at), 'dd/MM HH:mm')}</p>}
            {c.time_without_response != null && c.time_without_response > 0 && (
              <p className={`text-[10px] font-medium ${c.time_without_response > 120 ? 'text-red-500' : c.time_without_response > 60 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                <Clock className="h-3 w-3 inline mr-0.5" />{formatTimeAgo(c.time_without_response)}
              </p>
            )}
            <p className="text-[9px] text-muted-foreground">📩 {c.inbound_count} 📤 {c.outbound_count}</p>
            {status === 'fechado' && c.lead_id && onGenerateActivity && (
              <Button
                variant="outline"
                size="sm"
                className="h-5 text-[9px] px-1.5 gap-0.5 mt-1"
                disabled={generatingLeadId === c.lead_id}
                onClick={(e) => { e.stopPropagation(); onGenerateActivity(c); }}
              >
                {generatingLeadId === c.lead_id ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
                Gerar Atv
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
