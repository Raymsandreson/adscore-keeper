import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Search, X, Calendar as CalendarIcon, Loader2, ArrowDown, ArrowUp } from 'lucide-react';
import { format, isToday, isYesterday, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { searchConversationMessages, type WhatsAppMessage } from '@/integrations/supabase/external-rpc';
import { ensureExternalSession } from '@/integrations/supabase/external-client';

export interface ChatSearchHit {
  id: string;
  created_at: string;
  message_text: string | null;
  message_type: string;
  direction: string;
}

interface Props {
  phone: string;
  instanceName?: string | null;
  /** Pula até a mensagem (o chat carrega o trecho se ele não estiver em memória). */
  onJump: (hit: ChatSearchHit) => void | Promise<void>;
  onClose: () => void;
  /** Termo aplicado no destaque das bolhas — o chat usa pra pintar o trecho. */
  onTermChange?: (term: string) => void;
}

const RESULT_LIMIT = 60;

function labelDia(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return 'Hoje';
  if (isYesterday(d)) return 'Ontem';
  return format(d, "dd/MM/yyyy", { locale: ptBR });
}

function trecho(text: string | null, term: string) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (!term) return t.slice(0, 140);
  const i = t.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return t.slice(0, 140);
  const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + t.slice(start, start + 140);
}

/** Marca as ocorrências do termo no texto — usado na lista e nas bolhas do chat. */
export function HighlightedText({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  let from = 0;
  let idx = lower.indexOf(needle, from);
  let key = 0;
  while (idx >= 0) {
    if (idx > from) parts.push(<span key={key++}>{text.slice(from, idx)}</span>);
    parts.push(
      <mark key={key++} className="bg-yellow-300/70 dark:bg-yellow-500/40 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    from = idx + needle.length;
    idx = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(<span key={key++}>{text.slice(from)}</span>);
  return <>{parts}</>;
}

/**
 * Busca dentro da conversa aberta — texto e/ou dia, igual ao WhatsApp.
 * Fica logo abaixo do header e empurra a lista de mensagens (nada sobreposto).
 */
export function WhatsAppChatSearchPanel({ phone, instanceName, onJump, onClose, onTermChange }: Props) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [date, setDate] = useState<Date | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [results, setResults] = useState<ChatSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 350);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => { onTermChange?.(debounced.length >= 2 ? debounced : ''); }, [debounced, onTermChange]);

  // Troca de conversa zera a busca
  useEffect(() => {
    setTerm(''); setDebounced(''); setDate(undefined); setResults([]); setCursor(-1); setErro(null);
  }, [phone, instanceName]);

  const temFiltro = debounced.length >= 2 || !!date;

  useEffect(() => {
    if (!instanceName) return;
    if (!temFiltro) { setResults([]); setCursor(-1); setErro(null); return; }
    const reqId = ++reqIdRef.current;
    let cancelado = false;
    setLoading(true);
    setErro(null);
    (async () => {
      try {
        await ensureExternalSession().catch(() => {});
        const rows = await searchConversationMessages(phone, instanceName, {
          term: debounced.length >= 2 ? debounced : undefined,
          fromIso: date ? startOfDay(date).toISOString() : undefined,
          toIso: date ? endOfDay(date).toISOString() : undefined,
          // Só data = quer começar no início do dia; com texto, mais recentes primeiro.
          order: date && debounced.length < 2 ? 'asc' : 'desc',
          limit: RESULT_LIMIT,
        });
        if (cancelado || reqId !== reqIdRef.current) return;
        setResults((rows as unknown as WhatsAppMessage[]).map(m => ({
          id: m.id,
          created_at: m.created_at,
          message_text: m.message_text,
          message_type: m.message_type,
          direction: m.direction,
        })));
        setCursor(-1);
      } catch (e: unknown) {
        if (cancelado || reqId !== reqIdRef.current) return;
        console.error('[busca na conversa] falhou:', e);
        setErro(e instanceof Error ? e.message : 'Falha ao buscar');
        setResults([]);
      } finally {
        if (!cancelado && reqId === reqIdRef.current) setLoading(false);
      }
    })();
    return () => { cancelado = true; };
  }, [phone, instanceName, debounced, date, temFiltro]);

  const irPara = useCallback((i: number) => {
    const hit = results[i];
    if (!hit) return;
    setCursor(i);
    onJump(hit);
  }, [results, onJump]);

  const proximo = useCallback(() => {
    if (results.length === 0) return;
    irPara(cursor < 0 ? 0 : Math.min(results.length - 1, cursor + 1));
  }, [results.length, cursor, irPara]);

  const anterior = useCallback(() => {
    if (results.length === 0) return;
    irPara(cursor <= 0 ? 0 : cursor - 1);
  }, [results.length, cursor, irPara]);

  const resumo = useMemo(() => {
    if (loading) return 'Buscando…';
    if (erro) return erro;
    if (!temFiltro) return 'Digite ao menos 2 letras ou escolha uma data';
    if (results.length === 0) return 'Nenhuma mensagem encontrada';
    const pos = cursor >= 0 ? `${cursor + 1} de ` : '';
    const teto = results.length >= RESULT_LIMIT ? '+' : '';
    return `${pos}${results.length}${teto} ${results.length === 1 ? 'mensagem' : 'mensagens'}`;
  }, [loading, erro, temFiltro, results.length, cursor]);

  return (
    <div className="border-b bg-card shrink-0">
      <div className="flex items-center gap-2 p-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) anterior(); else proximo();
              }
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
            placeholder="Buscar nesta conversa…"
            className="pl-8 h-8 text-sm"
          />
        </div>

        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={date ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 gap-1.5 px-2 shrink-0"
              title="Ir para uma data"
            >
              <CalendarIcon className="h-4 w-4" />
              <span className="text-xs hidden sm:inline">
                {date ? format(date, "dd/MM/yy", { locale: ptBR }) : 'Data'}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(d) => { setDate(d); setCalendarOpen(false); }}
              disabled={(d) => d > new Date()}
              initialFocus
              locale={ptBR}
              className={cn('p-3 pointer-events-auto')}
            />
            {date && (
              <div className="border-t p-2">
                <Button variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={() => { setDate(undefined); setCalendarOpen(false); }}>
                  Limpar data
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-0.5 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={anterior} disabled={results.length === 0} title="Resultado anterior (Shift+Enter)">
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={proximo} disabled={results.length === 0} title="Próximo resultado (Enter)">
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="Fechar busca (Esc)">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pb-1.5 text-[11px] text-muted-foreground">
        {loading && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
        <span className={cn('truncate', erro && 'text-destructive')}>{resumo}</span>
        {date && (
          <button type="button" className="ml-auto underline shrink-0" onClick={() => setDate(undefined)}>
            limpar data
          </button>
        )}
      </div>

      {results.length > 0 && (
        <div className="max-h-56 overflow-y-auto border-t divide-y">
          {results.map((hit, i) => (
            <button
              key={hit.id}
              type="button"
              onClick={() => irPara(i)}
              className={cn(
                'w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors',
                cursor === i && 'bg-muted'
              )}
            >
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{labelDia(hit.created_at)}</span>
                <span>{format(new Date(hit.created_at), 'HH:mm', { locale: ptBR })}</span>
                <span>•</span>
                <span>{hit.direction === 'outbound' ? 'Enviada' : 'Recebida'}</span>
              </div>
              <div className="text-xs mt-0.5 line-clamp-2 break-words">
                {hit.message_text
                  ? <HighlightedText text={trecho(hit.message_text, debounced.length >= 2 ? debounced : '')} term={debounced.length >= 2 ? debounced : ''} />
                  : <span className="italic text-muted-foreground">({hit.message_type || 'mídia'})</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
