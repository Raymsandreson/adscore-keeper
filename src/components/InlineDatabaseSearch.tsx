import { useState, useCallback, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toggle } from '@/components/ui/toggle';
import {
  Users, MessageCircle, Contact, Send, Search, Loader2, User, Calendar, ExternalLink, X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { useLeads, Lead } from '@/hooks/useLeads';
import { Contact as ContactType } from '@/hooks/useContacts';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';

type ResultType = 'lead' | 'contact' | 'comment' | 'dm';

interface SearchResult {
  id: string;
  type: ResultType;
  title: string;
  subtitle: string;
  extra?: string;
  date?: string;
  raw: any;
}

const TYPE_CONFIG: Record<ResultType, { icon: typeof Users; label: string; color: string }> = {
  lead: { icon: Users, label: 'Lead', color: 'bg-blue-500/10 text-blue-700 border-blue-200 dark:text-blue-400' },
  contact: { icon: Contact, label: 'Contato', color: 'bg-green-500/10 text-green-700 border-green-200 dark:text-green-400' },
  comment: { icon: MessageCircle, label: 'Comentário', color: 'bg-orange-500/10 text-orange-700 border-orange-200 dark:text-orange-400' },
  dm: { icon: Send, label: 'DM', color: 'bg-purple-500/10 text-purple-700 border-purple-200 dark:text-purple-400' },
};

const ALL_TYPES: ResultType[] = ['lead', 'contact', 'comment', 'dm'];

export function InlineDatabaseSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeTypes, setActiveTypes] = useState<Set<ResultType>>(new Set(ALL_TYPES));
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Detail sheets
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadSheetOpen, setLeadSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactType | null>(null);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedComment, setSelectedComment] = useState<any | null>(null);
  const [commentSheetOpen, setCommentSheetOpen] = useState(false);
  const [selectedDm, setSelectedDm] = useState<any | null>(null);
  const [dmSheetOpen, setDmSheetOpen] = useState(false);

  const { updateLead } = useLeads();
  const { boards } = useKanbanBoards();

  // Close results on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleType = (type: ResultType) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const searchDatabase = useCallback(async (term: string, types: Set<ResultType>) => {
    if (term.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const s = `%${term}%`;
      const promises: Array<PromiseLike<any>> = [];
      const typeOrder: ResultType[] = [];

      if (types.has('lead')) {
        typeOrder.push('lead');
        promises.push(
          supabase.from('leads').select('*')
            .or(`lead_name.ilike.${s},victim_name.ilike.${s},lead_phone.ilike.${s},lead_email.ilike.${s},notes.ilike.${s},instagram_username.ilike.${s},city.ilike.${s}`)
            .order('updated_at', { ascending: false }).limit(15).then(r => r)
        );
      }
      if (types.has('contact')) {
        typeOrder.push('contact');
        promises.push(
          supabase.from('contacts').select('*')
            .or(`full_name.ilike.${s},phone.ilike.${s},email.ilike.${s},instagram_username.ilike.${s},notes.ilike.${s},city.ilike.${s}`)
            .order('updated_at', { ascending: false }).limit(15).then(r => r)
        );
      }
      if (types.has('comment')) {
        typeOrder.push('comment');
        promises.push(
          supabase.from('instagram_comments').select('*')
            .or(`author_username.ilike.${s},comment_text.ilike.${s},prospect_name.ilike.${s},notes.ilike.${s}`)
            .order('created_at', { ascending: false }).limit(15).then(r => r)
        );
      }
      if (types.has('dm')) {
        typeOrder.push('dm');
        promises.push(
          supabase.from('dm_history').select('*')
            .or(`instagram_username.ilike.${s},dm_message.ilike.${s}`)
            .order('created_at', { ascending: false }).limit(10).then(r => r)
        );
      }

      const responses = await Promise.all(promises);
      const mapped: SearchResult[] = [];

      responses.forEach((res, i) => {
        const type = typeOrder[i];
        (res.data || []).forEach((row: any) => {
          switch (type) {
            case 'lead':
              mapped.push({ id: row.id, type: 'lead', title: row.lead_name || row.victim_name || 'Lead sem nome', subtitle: [row.city, row.state].filter(Boolean).join('/') || row.source || '', extra: row.lead_phone || row.instagram_username || '', date: row.updated_at, raw: row });
              break;
            case 'contact':
              mapped.push({ id: row.id, type: 'contact', title: row.full_name, subtitle: row.instagram_username ? `@${row.instagram_username}` : (row.email || ''), extra: row.phone || [row.city, row.state].filter(Boolean).join('/') || '', date: row.updated_at, raw: row });
              break;
            case 'comment':
              mapped.push({ id: row.id, type: 'comment', title: row.author_username || row.prospect_name || 'Comentário', subtitle: (row.comment_text || '').slice(0, 80), extra: row.platform || '', date: row.created_at, raw: row });
              break;
            case 'dm':
              mapped.push({ id: row.id, type: 'dm', title: `@${row.instagram_username}`, subtitle: (row.dm_message || '').slice(0, 80), extra: row.action_type === 'sent' ? 'Enviada' : 'Recebida', date: row.created_at, raw: row });
              break;
          }
        });
      });

      setResults(mapped);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setShowResults(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDatabase(value, activeTypes), 300);
  };

  // Re-search when filters change
  useEffect(() => {
    if (query.length >= 2) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => searchDatabase(query, activeTypes), 200);
    }
  }, [activeTypes]);

  const handleSelect = (result: SearchResult) => {
    setShowResults(false);
    switch (result.type) {
      case 'lead': setSelectedLead(result.raw); setLeadSheetOpen(true); break;
      case 'contact': setSelectedContact(result.raw); setContactSheetOpen(true); break;
      case 'comment': setSelectedComment(result.raw); setCommentSheetOpen(true); break;
      case 'dm': setSelectedDm(result.raw); setDmSheetOpen(true); break;
    }
  };

  const filteredResults = results.filter(r => activeTypes.has(r.type));
  const grouped = filteredResults.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {} as Record<string, SearchResult[]>);

  return (
    <>
      <div ref={containerRef} className="mx-auto mt-4 max-w-2xl w-full relative">
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onFocus={() => query.length >= 2 && setShowResults(true)}
            placeholder="Buscar entre todo o conteúdo..."
            className="pl-10 pr-10 h-12 rounded-xl border-border/50 bg-background shadow-sm text-sm"
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); setShowResults(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
          {searching && <Loader2 className="absolute right-10 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Type Filter Chips */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {ALL_TYPES.map(type => {
            const cfg = TYPE_CONFIG[type];
            const active = activeTypes.has(type);
            const count = grouped[type]?.length || 0;
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? cfg.color + ' border-current/20'
                    : 'bg-muted/30 text-muted-foreground border-border/50 opacity-60'
                }`}
              >
                <cfg.icon className="h-3 w-3" />
                {cfg.label}s
                {query.length >= 2 && count > 0 && (
                  <span className="ml-0.5 bg-background/50 rounded-full px-1.5 text-[10px]">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Results Dropdown */}
        {showResults && query.length >= 2 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-background border border-border rounded-xl shadow-lg max-h-[400px] overflow-y-auto">
            {filteredResults.length === 0 && !searching ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Nenhum resultado encontrado
              </div>
            ) : (
              ALL_TYPES.filter(t => grouped[t]?.length).map(type => {
                const cfg = TYPE_CONFIG[type];
                const items = grouped[type];
                return (
                  <div key={type}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border/50">
                      {cfg.label}s ({items.length})
                    </div>
                    {items.map(item => (
                      <button
                        key={`${item.type}-${item.id}`}
                        onClick={() => handleSelect(item)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left border-b border-border/30 last:border-b-0"
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted shrink-0">
                          <cfg.icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{item.title}</span>
                            <Badge variant="outline" className={`text-[10px] shrink-0 ${cfg.color}`}>{cfg.label}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {item.extra && <p className="text-[10px] text-muted-foreground">{item.extra}</p>}
                          {item.date && <p className="text-[10px] text-muted-foreground">{format(new Date(item.date), 'dd/MM/yy', { locale: ptBR })}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Detail Sheets */}
      {selectedLead && (
        <LeadEditDialog
          open={leadSheetOpen}
          onOpenChange={v => { setLeadSheetOpen(v); if (!v) setSelectedLead(null); }}
          lead={selectedLead}
          onSave={async (id, updates) => { await updateLead(id, updates); }}
          boards={boards}
          mode="sheet"
        />
      )}

      {selectedContact && (
        <ContactDetailSheet
          open={contactSheetOpen}
          onOpenChange={v => { setContactSheetOpen(v); if (!v) setSelectedContact(null); }}
          contact={selectedContact}
        />
      )}

      <Sheet open={commentSheetOpen} onOpenChange={v => { setCommentSheetOpen(v); if (!v) setSelectedComment(null); }}>
        <SheetContent className="w-[450px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Comentário
            </SheetTitle>
          </SheetHeader>
          {selectedComment && (
            <ScrollArea className="h-[calc(100vh-120px)] mt-4">
              <div className="space-y-4 pr-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">@{selectedComment.author_username || 'Desconhecido'}</span>
                    {selectedComment.prospect_name && <Badge variant="secondary" className="text-xs">{selectedComment.prospect_name}</Badge>}
                  </div>
                  {selectedComment.created_at && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(selectedComment.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                  )}
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm whitespace-pre-wrap">{selectedComment.comment_text || 'Sem texto'}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {selectedComment.platform && <div><p className="text-xs text-muted-foreground">Plataforma</p><p className="font-medium capitalize">{selectedComment.platform}</p></div>}
                  {selectedComment.comment_type && <div><p className="text-xs text-muted-foreground">Tipo</p><p className="font-medium capitalize">{selectedComment.comment_type}</p></div>}
                  {selectedComment.funnel_stage && <div><p className="text-xs text-muted-foreground">Fase Funil</p><p className="font-medium capitalize">{selectedComment.funnel_stage}</p></div>}
                  {selectedComment.replied_at && <div><p className="text-xs text-muted-foreground">Respondido em</p><p className="font-medium">{format(new Date(selectedComment.replied_at), 'dd/MM/yy HH:mm')}</p></div>}
                </div>
                {selectedComment.post_url && (
                  <a href={selectedComment.post_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> Ver post original
                  </a>
                )}
                {selectedComment.notes && <div><p className="text-xs text-muted-foreground mb-1">Notas</p><p className="text-sm bg-muted/30 rounded p-2">{selectedComment.notes}</p></div>}
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={dmSheetOpen} onOpenChange={v => { setDmSheetOpen(v); if (!v) setSelectedDm(null); }}>
        <SheetContent className="w-[450px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" /> Direct Message
            </SheetTitle>
          </SheetHeader>
          {selectedDm && (
            <ScrollArea className="h-[calc(100vh-120px)] mt-4">
              <div className="space-y-4 pr-4">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">@{selectedDm.instagram_username}</span>
                  <Badge variant="outline" className="text-xs">{selectedDm.action_type === 'sent' ? 'Enviada' : 'Recebida'}</Badge>
                </div>
                {selectedDm.created_at && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(selectedDm.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                )}
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm whitespace-pre-wrap">{selectedDm.dm_message}</p>
                </div>
                {selectedDm.original_suggestion && <div><p className="text-xs text-muted-foreground mb-1">Sugestão original da IA</p><p className="text-sm bg-muted/30 rounded p-2">{selectedDm.original_suggestion}</p></div>}
                {selectedDm.was_edited && <Badge variant="secondary" className="text-xs">Mensagem editada antes do envio</Badge>}
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
