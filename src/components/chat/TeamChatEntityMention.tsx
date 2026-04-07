import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Briefcase, ClipboardList, Users, Search, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EntityMentionType = 'lead' | 'contact' | 'activity';

export interface EntityMention {
  type: EntityMentionType;
  id: string;
  name: string;
}

interface TeamChatEntityMentionProps {
  open: boolean;
  onClose: () => void;
  onSelect: (entity: EntityMention) => void;
}

const typeConfig: Record<EntityMentionType, { icon: React.ReactNode; label: string; color: string }> = {
  lead: { icon: <Briefcase className="h-3.5 w-3.5" />, label: 'Leads', color: 'text-blue-600 bg-blue-500/10' },
  contact: { icon: <Users className="h-3.5 w-3.5" />, label: 'Contatos', color: 'text-purple-600 bg-purple-500/10' },
  activity: { icon: <ClipboardList className="h-3.5 w-3.5" />, label: 'Atividades', color: 'text-emerald-600 bg-emerald-500/10' },
};

export function TeamChatEntityMention({ open, onClose, onSelect }: TeamChatEntityMentionProps) {
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState<EntityMentionType>('lead');
  const [results, setResults] = useState<EntityMention[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEntities = useCallback(async () => {
    if (!search.trim() && search.length === 0) {
      // Load recent items
      setLoading(true);
      let data: EntityMention[] = [];

      if (activeType === 'lead') {
        const { data: leads } = await supabase
          .from('leads')
          .select('id, lead_name')
          .order('updated_at', { ascending: false })
          .limit(20);
        data = (leads || []).map(l => ({ type: 'lead' as const, id: l.id, name: l.lead_name || 'Sem nome' }));
      } else if (activeType === 'contact') {
        const { data: contacts } = await supabase
          .from('contacts')
          .select('id, full_name')
          .order('updated_at', { ascending: false })
          .limit(20);
        data = (contacts || []).map(c => ({ type: 'contact' as const, id: c.id, name: c.full_name || 'Sem nome' }));
      } else {
        const { data: activities } = await supabase
          .from('lead_activities')
          .select('id, title')
          .order('updated_at', { ascending: false })
          .limit(20);
        data = (activities || []).map(a => ({ type: 'activity' as const, id: a.id, name: a.title || 'Sem título' }));
      }

      setResults(data);
      setLoading(false);
      return;
    }

    setLoading(true);
    const term = `%${search}%`;
    let data: EntityMention[] = [];

    if (activeType === 'lead') {
      const { data: leads } = await supabase
        .from('leads')
        .select('id, lead_name')
        .ilike('lead_name', term)
        .limit(20);
      data = (leads || []).map(l => ({ type: 'lead' as const, id: l.id, name: l.lead_name || 'Sem nome' }));
    } else if (activeType === 'contact') {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, full_name')
        .ilike('full_name', term)
        .limit(20);
      data = (contacts || []).map(c => ({ type: 'contact' as const, id: c.id, name: c.full_name || 'Sem nome' }));
    } else {
      const { data: activities } = await supabase
        .from('lead_activities')
        .select('id, title')
        .ilike('title', term)
        .limit(20);
      data = (activities || []).map(a => ({ type: 'activity' as const, id: a.id, name: a.title || 'Sem título' }));
    }

    setResults(data);
    setLoading(false);
  }, [search, activeType]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(fetchEntities, 300);
      return () => clearTimeout(timer);
    }
  }, [open, fetchEntities]);

  useEffect(() => {
    if (open) {
      setSearch('');
      setResults([]);
      fetchEntities();
    }
  }, [open, activeType]);

  if (!open) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-lg z-50 max-h-[320px] flex flex-col">
      <div className="shrink-0 p-2 border-b space-y-2">
        <div className="flex gap-1">
          {(Object.keys(typeConfig) as EntityMentionType[]).map(type => (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors',
                activeType === type
                  ? `${typeConfig[type].color} ring-1 ring-current/20`
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {typeConfig[type].icon}
              {typeConfig[type].label}
            </button>
          ))}
          <button
            onClick={onClose}
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground px-1"
          >
            ✕
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Buscar ${typeConfig[activeType].label.toLowerCase()}...`}
            className="h-7 text-xs pl-7"
            autoFocus
          />
        </div>
      </div>

      <ScrollArea className="flex-1 max-h-[200px]">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            Nenhum resultado encontrado
          </div>
        ) : (
          <div className="divide-y">
            {results.map(entity => (
              <button
                key={entity.id}
                onClick={() => {
                  onSelect(entity);
                  onClose();
                }}
                className="w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors flex items-center gap-2"
              >
                <span className={cn('shrink-0 w-6 h-6 rounded-full flex items-center justify-center', typeConfig[entity.type].color)}>
                  {typeConfig[entity.type].icon}
                </span>
                <span className="text-xs truncate">{entity.name}</span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// Render entity mentions in message content
export function renderMessageWithMentions(content: string, onNavigate: (type: EntityMentionType, id: string) => void) {
  // Pattern: [type:id:name]
  const mentionRegex = /\[(lead|contact|activity):([a-f0-9-]+):([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const type = match[1] as EntityMentionType;
    const id = match[2];
    const name = match[3];
    const cfg = typeConfig[type];

    parts.push(
      <button
        key={`${id}-${match.index}`}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(type, id);
        }}
        className={cn(
          'inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[11px] font-medium',
          'hover:ring-1 hover:ring-current/30 transition-all cursor-pointer',
          cfg.color
        )}
      >
        {cfg.icon}
        {name}
      </button>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : content;
}
