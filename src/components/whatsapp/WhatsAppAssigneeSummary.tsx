import { useMemo, useEffect, useState } from 'react';
import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { useProfileNames } from '@/hooks/useProfileNames';
import { cn } from '@/lib/utils';
import { Users, UserX, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  conversations: WhatsAppConversation[];
  cloudAssignees: Map<string, string>;
}

export function WhatsAppAssigneeSummary({ conversations, cloudAssignees }: Props) {
  const { fetchProfileNames, getDisplayName } = useProfileNames();

  const availableInstances = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      if (c.instance_name) set.add(c.instance_name);
    }
    return Array.from(set).sort();
  }, [conversations]);

  const [selectedInstance, setSelectedInstance] = useState<string>('all');

  useEffect(() => {
    if (availableInstances.length === 0) {
      setSelectedInstance('all');
      return;
    }
    if (selectedInstance !== 'all' && !availableInstances.includes(selectedInstance)) {
      setSelectedInstance('all');
    }
  }, [availableInstances, selectedInstance]);

  const filteredConversations = useMemo(() => {
    if (selectedInstance === 'all') return conversations;
    return conversations.filter(c => c.instance_name === selectedInstance);
  }, [conversations, selectedInstance]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let unassigned = 0;
    for (const conv of filteredConversations) {
      const owner = cloudAssignees.get(conv.phone);
      if (owner) {
        map.set(owner, (map.get(owner) || 0) + 1);
      } else {
        unassigned++;
      }
    }
    return { byOwner: map, unassigned };
  }, [filteredConversations, cloudAssignees]);

  const ownerIds = useMemo(() => Array.from(counts.byOwner.keys()), [counts]);

  useEffect(() => {
    if (ownerIds.length > 0) fetchProfileNames(ownerIds);
  }, [ownerIds, fetchProfileNames]);

  if (conversations.length === 0) return null;

  const [expanded, setExpanded] = useState(false);

  const total = filteredConversations.length;
  const ownerCount = ownerIds.length;

  return (
    <div className="shrink-0 border-b bg-muted/30">
      {/* Header colapsado: 1 linha clicável */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-muted/50 transition-colors"
      >
        <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-[11px] font-semibold text-muted-foreground">Distribuição</span>
        <div className="flex items-center gap-1.5 ml-1 flex-1 min-w-0 overflow-hidden">
          {counts.unassigned > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 font-medium flex-shrink-0">
              {counts.unassigned} sem dono
            </span>
          )}
          {ownerCount > 0 && (
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              · {ownerCount} atendente{ownerCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground flex-shrink-0">
          Total <span className="font-semibold text-foreground">{total}</span>
        </span>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
      </button>

      {/* Detalhe expandido */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {availableInstances.length > 0 && (
            <Select value={selectedInstance} onValueChange={setSelectedInstance}>
              <SelectTrigger className="h-6 text-[10px] px-2 py-0 w-auto min-w-[140px] gap-1">
                <Filter className="h-3 w-3 text-muted-foreground" />
                <SelectValue placeholder="Fila" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as filas</SelectItem>
                {availableInstances.map(inst => (
                  <SelectItem key={inst} value={inst}>{inst}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex items-center gap-1.5 flex-wrap">
            {counts.unassigned > 0 && (
              <div className={cn(
                "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border",
                "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300"
              )}>
                <UserX className="h-3 w-3" />
                <span className="font-medium">Sem dono</span>
                <span className="font-bold">{counts.unassigned}</span>
              </div>
            )}

            {ownerIds.map(id => {
              const name = getDisplayName(id) || id.slice(0, 8) + '…';
              return (
                <div
                  key={id}
                  className={cn(
                    "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border",
                    "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300"
                  )}
                >
                  <span className="font-medium truncate max-w-[120px]">{name}</span>
                  <span className="font-bold">{counts.byOwner.get(id)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

