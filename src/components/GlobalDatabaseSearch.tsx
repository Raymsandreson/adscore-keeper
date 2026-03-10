// v3 - cache bust
import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Users, MessageCircle, Contact, Send, Search, Loader2, User, Phone, Mail, MapPin, Calendar, FileText, Building, ExternalLink,
  ClipboardList, Workflow, LayoutDashboard,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { useLeads, Lead } from '@/hooks/useLeads';
import { Contact as ContactType } from '@/hooks/useContacts';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';

interface SearchResult {
  id: string;
  type: 'lead' | 'contact' | 'comment' | 'dm' | 'activity' | 'workflow';
  title: string;
  subtitle: string;
  extra?: string;
  date?: string;
  raw: any;
}

// Global search component
export function GlobalDatabaseSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Selected item state
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadSheetOpen, setLeadSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactType | null>(null);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedComment, setSelectedComment] = useState<any | null>(null);
  const [commentSheetOpen, setCommentSheetOpen] = useState(false);
  const [selectedDm, setSelectedDm] = useState<any | null>(null);
  const [dmSheetOpen, setDmSheetOpen] = useState(false);

  const navigate = useNavigate();
  const { updateLead } = useLeads();
  const { boards } = useKanbanBoards();

  // Keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const searchDatabase = useCallback(async (term: string) => {
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const searchTerm = `%${term}%`;

      const [leadsRes, contactsRes, commentsRes, dmsRes, activitiesRes, workflowsRes] = await Promise.all([
        supabase.from('leads').select('*')
          .or(`lead_name.ilike.${searchTerm},victim_name.ilike.${searchTerm},lead_phone.ilike.${searchTerm},lead_email.ilike.${searchTerm},notes.ilike.${searchTerm},instagram_username.ilike.${searchTerm},city.ilike.${searchTerm},cpf.ilike.${searchTerm},state.ilike.${searchTerm},source.ilike.${searchTerm}`)
          .order('updated_at', { ascending: false })
          .limit(15),
        supabase.from('contacts').select('*')
          .or(`full_name.ilike.${searchTerm},phone.ilike.${searchTerm},email.ilike.${searchTerm},instagram_username.ilike.${searchTerm},notes.ilike.${searchTerm},city.ilike.${searchTerm},state.ilike.${searchTerm},profession.ilike.${searchTerm},neighborhood.ilike.${searchTerm}`)
          .order('updated_at', { ascending: false })
          .limit(15),
        supabase.from('instagram_comments').select('*')
          .or(`author_username.ilike.${searchTerm},comment_text.ilike.${searchTerm},prospect_name.ilike.${searchTerm},notes.ilike.${searchTerm}`)
          .order('created_at', { ascending: false })
          .limit(15),
        supabase.from('dm_history').select('*')
          .or(`instagram_username.ilike.${searchTerm},dm_message.ilike.${searchTerm}`)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase.from('lead_activities').select('*')
          .or(`title.ilike.${searchTerm},description.ilike.${searchTerm},lead_name.ilike.${searchTerm},assigned_to_name.ilike.${searchTerm},activity_type.ilike.${searchTerm}`)
          .order('updated_at', { ascending: false })
          .limit(15),
        supabase.from('kanban_boards').select('*')
          .or(`name.ilike.${searchTerm},description.ilike.${searchTerm}`)
          .order('updated_at', { ascending: false })
          .limit(10),
      ]);

      const mapped: SearchResult[] = [];

      // Leads
      (leadsRes.data || []).forEach((l: any) => {
        mapped.push({
          id: l.id,
          type: 'lead',
          title: l.lead_name || l.victim_name || 'Lead sem nome',
          subtitle: [l.city, l.state].filter(Boolean).join('/') || l.source || '',
          extra: l.lead_phone || l.instagram_username || '',
          date: l.updated_at,
          raw: l,
        });
      });

      // Contacts
      (contactsRes.data || []).forEach((c: any) => {
        mapped.push({
          id: c.id,
          type: 'contact',
          title: c.full_name,
          subtitle: c.instagram_username ? `@${c.instagram_username}` : (c.email || ''),
          extra: c.phone || [c.city, c.state].filter(Boolean).join('/') || '',
          date: c.updated_at,
          raw: c,
        });
      });

      // Comments
      (commentsRes.data || []).forEach((c: any) => {
        mapped.push({
          id: c.id,
          type: 'comment',
          title: c.author_username || c.prospect_name || 'Comentário',
          subtitle: (c.comment_text || '').slice(0, 80),
          extra: c.platform || '',
          date: c.created_at,
          raw: c,
        });
      });

      // DMs
      (dmsRes.data || []).forEach((d: any) => {
        mapped.push({
          id: d.id,
          type: 'dm',
          title: `@${d.instagram_username}`,
          subtitle: (d.dm_message || '').slice(0, 80),
          extra: d.action_type === 'sent' ? 'Enviada' : 'Recebida',
          date: d.created_at,
          raw: d,
        });
      });

      // Activities
      (activitiesRes.data || []).forEach((a: any) => {
        mapped.push({
          id: a.id,
          type: 'activity',
          title: a.title || 'Atividade sem título',
          subtitle: a.lead_name ? `Lead: ${a.lead_name}` : (a.description || '').slice(0, 80),
          extra: a.assigned_to_name || a.status || '',
          date: a.updated_at || a.created_at,
          raw: a,
        });
      });

      // Workflows/Boards
      (workflowsRes.data || []).forEach((w: any) => {
        mapped.push({
          id: w.id,
          type: 'workflow',
          title: w.name || 'Fluxo sem nome',
          subtitle: w.description || '',
          extra: w.board_type === 'workflow' ? 'Fluxo de Trabalho' : 'Funil de Vendas',
          date: w.updated_at,
          raw: w,
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
    if (debounceTimer) clearTimeout(debounceTimer);
    const timer = setTimeout(() => searchDatabase(value), 300);
    setDebounceTimer(timer);
  };

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setQuery('');
    setResults([]);

    switch (result.type) {
      case 'lead':
        setSelectedLead(result.raw as Lead);
        setLeadSheetOpen(true);
        break;
      case 'contact':
        setSelectedContact(result.raw as ContactType);
        setContactSheetOpen(true);
        break;
      case 'comment':
        setSelectedComment(result.raw);
        setCommentSheetOpen(true);
        break;
      case 'dm':
        setSelectedDm(result.raw);
        setDmSheetOpen(true);
        break;
      case 'activity':
        navigate(`/?openActivity=${result.id}`);
        break;
      case 'workflow':
        navigate(`/workflow`);
        break;
    }
  };

  const typeConfig = {
    lead: { icon: Users, label: 'Lead', color: 'bg-blue-500/10 text-blue-700 border-blue-200' },
    contact: { icon: Contact, label: 'Contato', color: 'bg-green-500/10 text-green-700 border-green-200' },
    activity: { icon: ClipboardList, label: 'Atividade', color: 'bg-amber-500/10 text-amber-700 border-amber-200' },
    workflow: { icon: Workflow, label: 'Fluxo', color: 'bg-violet-500/10 text-violet-700 border-violet-200' },
    comment: { icon: MessageCircle, label: 'Comentário', color: 'bg-orange-500/10 text-orange-700 border-orange-200' },
    dm: { icon: Send, label: 'DM', color: 'bg-purple-500/10 text-purple-700 border-purple-200' },
  };

  const grouped = results.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {} as Record<string, SearchResult[]>);

  const groupOrder: Array<SearchResult['type']> = ['lead', 'contact', 'activity', 'workflow', 'comment', 'dm'];

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Buscar leads, contatos, atividades, fluxos, comentários, DMs... (⌘K)"
          value={query}
          onValueChange={handleQueryChange}
        />
        <CommandList>
          {searching ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando...
            </div>
          ) : query.length < 2 ? (
            <CommandEmpty>
              <div className="text-center py-6 space-y-2">
                <Search className="h-8 w-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Digite ao menos 2 caracteres para buscar</p>
                <p className="text-xs text-muted-foreground/70">Busca em leads, contatos, comentários e DMs</p>
              </div>
            </CommandEmpty>
          ) : results.length === 0 ? (
            <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
          ) : (
            groupOrder.map((type, idx) => {
              const items = grouped[type];
              if (!items || items.length === 0) return null;
              const config = typeConfig[type];
              return (
                <div key={type}>
                  {idx > 0 && grouped[groupOrder[idx - 1]] && <CommandSeparator />}
                  <CommandGroup heading={`${config.label}s (${items.length})`}>
                    {items.map(item => (
                      <CommandItem
                        key={`${item.type}-${item.id}`}
                        value={`${item.title} ${item.subtitle} ${item.extra}`}
                        onSelect={() => handleSelect(item)}
                        className="gap-3 cursor-pointer"
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
                          <config.icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{item.title}</span>
                            <Badge variant="outline" className={`text-[10px] shrink-0 ${config.color}`}>
                              {config.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {item.extra && (
                            <p className="text-[10px] text-muted-foreground">{item.extra}</p>
                          )}
                          {item.date && (
                            <p className="text-[10px] text-muted-foreground">
                              {format(new Date(item.date), 'dd/MM/yy', { locale: ptBR })}
                            </p>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </div>
              );
            })
          )}
        </CommandList>
      </CommandDialog>

      {/* Lead Sheet */}
      {selectedLead && (
        <LeadEditDialog
          open={leadSheetOpen}
          onOpenChange={(v) => { setLeadSheetOpen(v); if (!v) setSelectedLead(null); }}
          lead={selectedLead}
          onSave={async (id, updates) => { await updateLead(id, updates); }}
          boards={boards}
          mode="sheet"
        />
      )}

      {/* Contact Sheet */}
      {selectedContact && (
        <ContactDetailSheet
          open={contactSheetOpen}
          onOpenChange={(v) => { setContactSheetOpen(v); if (!v) setSelectedContact(null); }}
          contact={selectedContact}
        />
      )}

      {/* Comment Sheet */}
      <Sheet open={commentSheetOpen} onOpenChange={(v) => { setCommentSheetOpen(v); if (!v) setSelectedComment(null); }}>
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
                    {selectedComment.prospect_name && (
                      <Badge variant="secondary" className="text-xs">{selectedComment.prospect_name}</Badge>
                    )}
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
                  {selectedComment.platform && (
                    <div>
                      <p className="text-xs text-muted-foreground">Plataforma</p>
                      <p className="font-medium capitalize">{selectedComment.platform}</p>
                    </div>
                  )}
                  {selectedComment.comment_type && (
                    <div>
                      <p className="text-xs text-muted-foreground">Tipo</p>
                      <p className="font-medium capitalize">{selectedComment.comment_type}</p>
                    </div>
                  )}
                  {selectedComment.funnel_stage && (
                    <div>
                      <p className="text-xs text-muted-foreground">Fase Funil</p>
                      <p className="font-medium capitalize">{selectedComment.funnel_stage}</p>
                    </div>
                  )}
                  {selectedComment.replied_at && (
                    <div>
                      <p className="text-xs text-muted-foreground">Respondido em</p>
                      <p className="font-medium">{format(new Date(selectedComment.replied_at), 'dd/MM/yy HH:mm')}</p>
                    </div>
                  )}
                </div>

                {selectedComment.post_url && (
                  <a
                    href={selectedComment.post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Ver post original
                  </a>
                )}

                {selectedComment.notes && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Notas</p>
                    <p className="text-sm bg-muted/30 rounded p-2">{selectedComment.notes}</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>

      {/* DM Sheet */}
      <Sheet open={dmSheetOpen} onOpenChange={(v) => { setDmSheetOpen(v); if (!v) setSelectedDm(null); }}>
        <SheetContent className="w-[450px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Direct Message
            </SheetTitle>
          </SheetHeader>
          {selectedDm && (
            <ScrollArea className="h-[calc(100vh-120px)] mt-4">
              <div className="space-y-4 pr-4">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">@{selectedDm.instagram_username}</span>
                  <Badge variant="outline" className="text-xs">
                    {selectedDm.action_type === 'sent' ? 'Enviada' : 'Recebida'}
                  </Badge>
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

                {selectedDm.original_suggestion && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Sugestão original da IA</p>
                    <p className="text-sm bg-muted/30 rounded p-2">{selectedDm.original_suggestion}</p>
                  </div>
                )}

                {selectedDm.was_edited && (
                  <Badge variant="secondary" className="text-xs">Mensagem editada antes do envio</Badge>
                )}
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
