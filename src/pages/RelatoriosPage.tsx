/**
 * Relatórios — conversa com o analista de dados por IA.
 *
 * Não é mais "pergunta → tabela". É uma conversa: a IA consulta o banco, olha o
 * resultado e responde em português (o que achou, o que está estranho no dado,
 * o que dá pra fazer). As tabelas das consultas aparecem dentro da resposta.
 *
 * As mensagens ficam GRAVADAS (report_conversations/report_messages, via as
 * funções report-query e report-conversations) — F5 não apaga nada e cada
 * pessoa pode ter várias conversas em paralelo. Conversa é privada de quem criou.
 *
 * Nada aqui redireciona: a lista de conversas é uma coluna da própria tela (e
 * um Sheet lateral no celular), nunca uma rota nova.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { cloudFunctions } from '@/lib/functionRouter';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  FileBarChart, Send, Loader2, Code2, AlertTriangle, Lock, Sparkles, Database,
  Plus, MessagesSquare, MoreVertical, Pencil, Trash2, Check, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface QueryRun {
  sql: string;
  purpose: string;
  columns: string[];
  rows: Record<string, unknown>[];
  count: number;
  truncated: boolean;
  /** Quantas linhas ficaram gravadas (só vem ao reabrir uma conversa antiga). */
  stored_rows?: number;
  error?: string | null;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  queries?: QueryRun[];
  engine?: string;
  status?: string;
  loading?: boolean;
  forbidden?: boolean;
}

interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

function engineLabel(engine?: string): string {
  if (!engine) return '';
  if (engine.includes('gemini')) return 'Gemini';
  if (engine.includes('sonnet')) return 'Sonnet';
  if (engine.includes('opus')) return 'Opus';
  if (engine.includes('haiku')) return 'Haiku';
  return engine;
}

const EXAMPLES = [
  'Relação dos processos em que a Gisele é responsável',
  'Atividades atrasadas do João Manoel',
  'Casos abertos por núcleo',
  'Leads que viraram cliente esse mês',
  'Quais dados do funil BPC estão furados?',
];

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  // ISO date/datetime → dd/mm/aaaa
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(T[\d:.]+.*)?$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function humanCol(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function ResultTable({ query }: { query: QueryRun }) {
  if (!query.rows.length) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
        Nenhum registro voltou dessa consulta.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border max-h-[420px] overflow-y-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            {query.columns.map((c) => (
              <TableHead key={c} className="whitespace-nowrap font-semibold">{humanCol(c)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.rows.map((row, i) => (
            <TableRow key={i}>
              {query.columns.map((c) => (
                <TableCell key={c} className="whitespace-nowrap max-w-[320px] truncate" title={formatCell(row[c])}>
                  {formatCell(row[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function QueryBlock({ query }: { query: QueryRun }) {
  const partial = query.rows.length < query.count;
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <Database className="h-3 w-3" /> {query.count} registro{query.count === 1 ? '' : 's'}
        </Badge>
        {query.truncated && (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            Teto de 1000 — pode haver mais
          </Badge>
        )}
        {partial && !query.truncated && (
          <Badge variant="outline" className="text-muted-foreground">
            Mostrando {query.rows.length} linhas gravadas
          </Badge>
        )}
        {query.purpose && <span className="text-xs text-muted-foreground">{query.purpose}</span>}
      </div>

      {query.error ? (
        <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> A consulta falhou: {query.error}
        </div>
      ) : (
        <ResultTable query={query} />
      )}

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground h-7">
            <Code2 className="h-3.5 w-3.5" /> Ver a consulta usada
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
            {query.sql}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 max-w-[85%] whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0 space-y-3">
          {msg.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Consultando o banco...
            </div>
          ) : msg.forbidden ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <Lock className="h-4 w-4" /> {msg.content}
            </div>
          ) : msg.status === 'error' ? (
            <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {msg.content}
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-ul:my-1.5">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          )}

          {msg.queries?.map((q, i) => <QueryBlock key={i} query={q} />)}

          {msg.engine && !msg.loading && (
            <div className="text-[10px] text-muted-foreground">via {engineLabel(msg.engine)}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function RelatoriosPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadConversations = useCallback(async () => {
    const { data } = await cloudFunctions.invoke('report-conversations', { body: { action: 'list' } });
    if (data?.success) setConversations(data.conversations || []);
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const openConversation = useCallback(async (id: string) => {
    setSheetOpen(false);
    setLoadingConv(true);
    setActiveId(id);
    setMessages([]);
    const { data } = await cloudFunctions.invoke('report-conversations', {
      body: { action: 'messages', conversation_id: id },
    });
    if (data?.success) {
      setMessages((data.messages || []).map((m: any) => ({
        id: m.id, role: m.role, content: m.content,
        queries: Array.isArray(m.queries) ? m.queries : [],
        engine: m.engine, status: m.status,
      })));
    }
    setLoadingConv(false);
  }, []);

  const newConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setSheetOpen(false);
  }, []);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput('');
    const tempId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID() : `t-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: `u-${tempId}`, role: 'user', content: q },
      { id: tempId, role: 'assistant', content: '', loading: true },
    ]);

    try {
      const { data, error } = await cloudFunctions.invoke('report-query', {
        body: { question: q, conversation_id: activeIdRef.current || undefined },
      });

      if (data?.conversation_id && !activeIdRef.current) {
        setActiveId(data.conversation_id);
        activeIdRef.current = data.conversation_id;
      }

      setMessages((prev) => prev.map((m) => {
        if (m.id !== tempId) return m;
        if (error) {
          return { ...m, loading: false, status: 'error', content: 'Erro de conexão com o servidor de relatórios. Tente de novo.' };
        }
        if (!data?.success) {
          return {
            ...m, loading: false, status: 'error',
            forbidden: data?.error === 'forbidden',
            content: data?.message || 'Não consegui responder essa.',
          };
        }
        return {
          ...m,
          id: data.message?.id || m.id,
          loading: false,
          content: data.message?.content || '',
          queries: data.message?.queries || [],
          engine: data.message?.engine,
          status: 'ok',
        };
      }));

      loadConversations();
    } catch (e) {
      setMessages((prev) => prev.map((m) => m.id === tempId
        ? { ...m, loading: false, status: 'error', content: e instanceof Error ? e.message : 'Erro inesperado.' }
        : m));
    } finally {
      setBusy(false);
    }
  }, [busy, loadConversations]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const t = title.trim();
    setEditingId(null);
    if (!t) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: t } : c)));
    await cloudFunctions.invoke('report-conversations', {
      body: { action: 'rename', conversation_id: id, title: t },
    });
  }, []);

  const confirmDelete = useCallback(async () => {
    const id = deleteId;
    setDeleteId(null);
    if (!id) return;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeIdRef.current === id) newConversation();
    await cloudFunctions.invoke('report-conversations', {
      body: { action: 'delete', conversation_id: id },
    });
  }, [deleteId, newConversation]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  };

  const ConversationList = (
    <div className="flex flex-col h-full">
      <Button variant="outline" size="sm" className="gap-2 m-2" onClick={newConversation}>
        <Plus className="h-4 w-4" /> Nova conversa
      </Button>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {conversations.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            Suas conversas ficam gravadas aqui.
          </p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cn(
              'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent',
              c.id === activeId && 'bg-accent',
            )}
          >
            {editingId === c.id ? (
              <>
                <Input
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameConversation(c.id, editingTitle);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="h-7 text-xs"
                  autoFocus
                />
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  onClick={() => renameConversation(c.id, editingTitle)}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditingId(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <button className="flex-1 text-left truncate" onClick={() => openConversation(c.id)} title={c.title}>
                  {c.title}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100">
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditingId(c.id); setEditingTitle(c.title); }}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(c.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Apagar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full">
      {/* Lista de conversas — coluna fixa no desktop */}
      <aside className="hidden md:flex w-60 shrink-0 border-r flex-col">
        {ConversationList}
      </aside>

      <div className="flex flex-col flex-1 min-w-0 max-w-4xl mx-auto w-full">
        <div className="px-4 py-4 border-b flex items-center gap-2">
          {/* No celular a lista vira Sheet lateral — nada de rota nova */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden shrink-0">
                <MessagesSquare className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="p-4 pb-0">
                <SheetTitle>Conversas</SheetTitle>
              </SheetHeader>
              {ConversationList}
            </SheetContent>
          </Sheet>

          <FileBarChart className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">Relatórios</h1>
            <p className="text-xs text-muted-foreground">
              Converse com o analista: ele consulta o banco, mostra a tabela e aponta o que está estranho no dado.
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loadingConv && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-10">
              <Loader2 className="h-4 w-4 animate-spin" /> Abrindo a conversa...
            </div>
          )}

          {!loadingConv && messages.length === 0 && (
            <div className="text-center py-10 space-y-4">
              <div className="inline-flex p-3 rounded-full bg-primary/10">
                <FileBarChart className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="font-medium">O que você quer saber?</p>
                <p className="text-sm text-muted-foreground">
                  Atividades, processos, casos, contatos, leads — pergunte de qualquer jeito.
                  Pode perguntar também o que está furado no cadastro.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-2xl mx-auto">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => ask(ex)}
                    className="text-xs px-3 py-1.5 rounded-full border hover:bg-accent transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
          <div ref={bottomRef} />
        </div>

        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ex: me dê a relação dos processos que a Gisele é responsável"
              className="resize-none min-h-[44px] max-h-32"
              rows={1}
              disabled={busy}
            />
            <Button onClick={() => ask(input)} disabled={busy || !input.trim()} size="icon" className="shrink-0 h-11 w-11">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            Somente leitura · CPF e dados bancários são mascarados · acesso restrito à diretoria e gestores
          </p>
        </div>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar esta conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela some da sua lista. O histórico continua guardado para auditoria, mas você não abre mais por aqui.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
