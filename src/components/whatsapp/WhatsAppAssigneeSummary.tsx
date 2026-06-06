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

  const total = filteredConversations.length;

  return (
    <div className="shrink-0 px-3 py-2 border-b bg-muted/30">
      <div className="flex items-center gap-2 mb-1.5">
        <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-[11px] font-semibold text-muted-foreground flex-shrink-0">
          Distribuição
        </span>
        {availableInstances.length > 0 && (
          <Select value={selectedInstance} onValueChange={setSelectedInstance}>
            <SelectTrigger className="h-6 text-[10px] px-2 py-0 w-auto min-w-[100px] border-0 bg-transparent hover:bg-muted/50 focus:ring-0 focus:ring-offset-0">
              <Filter className="h-3 w-3 mr-1 text-muted-foreground" />
              <SelectValue placeholder="Fila" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as filas</SelectItem>
              {availableInstances.map(inst => (
                <SelectItem key={inst} value={inst}>
                  {inst}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        {counts.unassigned > 0 && (
          <div className={cn(
            "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0",
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
                "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0",
                "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300"
              )}
            >
              <span className="font-medium truncate max-w-[120px]">{name}</span>
              <span className="font-bold">{counts.byOwner.get(id)}</span>
            </div>
          );
        })}

        <div className="ml-auto text-[10px] text-muted-foreground flex-shrink-0">
          Total <span className="font-semibold">{total}</span>
        </div>
      </div>
    </div>
  );
}
