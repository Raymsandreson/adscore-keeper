import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  FileBarChart, Send, Loader2, Code2, AlertTriangle, Lock, Sparkles, Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReportResult {
  title: string;
  explanation: string;
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  count: number;
  truncated: boolean;
  engine?: string;
}

function engineLabel(engine?: string): string {
  if (!engine) return '';
  if (engine.includes('gemini')) return 'Gemini';
  if (engine.includes('sonnet')) return 'Sonnet';
  if (engine.includes('opus')) return 'Opus';
  if (engine.includes('haiku')) return 'Haiku';
  return engine;
}

interface Turn {
  id: string;
  question: string;
  loading: boolean;
  result?: ReportResult;
  error?: string;
  forbidden?: boolean;
}

const EXAMPLES = [
  'Relação dos processos em que a Gisele é responsável',
  'Atividades atrasadas do João Manoel',
  'Casos abertos por núcleo',
  'Leads que viraram cliente esse mês',
  'Processos INSS com status indeferido',
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

function ResultTable({ result }: { result: ReportResult }) {
  if (!result.rows.length) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        Nenhum registro encontrado para esse pedido.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {result.columns.map((c) => (
              <TableHead key={c} className="whitespace-nowrap font-semibold">{humanCol(c)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row, i) => (
            <TableRow key={i}>
              {result.columns.map((c) => (
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

function TurnCard({ turn }: { turn: Turn }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 mt-1 text-primary shrink-0" />
        <p className="font-medium">{turn.question}</p>
      </div>

      {turn.loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Montando o relatório...
        </div>
      )}

      {turn.forbidden && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <Lock className="h-4 w-4" /> {turn.error}
        </div>
      )}

      {turn.error && !turn.forbidden && (
        <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {turn.error}
        </div>
      )}

      {turn.result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Database className="h-3 w-3" /> {turn.result.count} registro{turn.result.count === 1 ? '' : 's'}
            </Badge>
            {turn.result.truncated && (
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                Mostrando os primeiros 1000 — refine o pedido para ver menos
              </Badge>
            )}
            {turn.result.engine && (
              <Badge variant="outline" className="text-muted-foreground text-[10px]">
                via {engineLabel(turn.result.engine)}
              </Badge>
            )}
          </div>

          {turn.result.explanation && (
            <p className="text-sm text-muted-foreground">{turn.result.explanation}</p>
          )}

          <ResultTable result={turn.result} />

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground h-7">
                <Code2 className="h-3.5 w-3.5" /> Ver a consulta usada
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                {turn.result.sql}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </Card>
  );
}

export default function RelatoriosPage() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const turnsRef = useRef<Turn[]>([]);

  useEffect(() => {
    turnsRef.current = turns;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput('');
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID() : `t-${Date.now()}`;
    // Histórico curto para follow-ups (pergunta anterior + SQL anterior),
    // lido do ref ANTES de adicionar o turno novo.
    const history: Array<{ role: string; content: string }> = [];
    for (const t of turnsRef.current.slice(-3)) {
      if (t.result) {
        history.push({ role: 'user', content: t.question });
        history.push({ role: 'assistant', content: `SQL usada:\n${t.result.sql}` });
      }
    }

    setTurns((prev) => [...prev, { id, question: q, loading: true }]);

    try {
      const { data, error } = await cloudFunctions.invoke('report-query', {
        body: { question: q, history },
      });

      setTurns((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        if (error) {
          return { ...t, loading: false, error: 'Erro de conexão com o servidor de relatórios. Tente de novo.' };
        }
        if (!data?.success) {
          return {
            ...t, loading: false,
            error: data?.message || 'Não consegui gerar esse relatório.',
            forbidden: data?.error === 'forbidden',
          };
        }
        return {
          ...t, loading: false,
          result: {
            title: data.title, explanation: data.explanation, sql: data.sql,
            columns: data.columns || [], rows: data.rows || [],
            count: data.count || 0, truncated: !!data.truncated,
            engine: data.engine,
          },
        };
      }));
    } catch (e) {
      setTurns((prev) => prev.map((t) => t.id === id
        ? { ...t, loading: false, error: e instanceof Error ? e.message : 'Erro inesperado.' }
        : t));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] max-w-4xl mx-auto w-full">
      <div className="px-4 py-4 border-b flex items-center gap-2">
        <FileBarChart className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-semibold leading-tight">Relatórios</h1>
          <p className="text-xs text-muted-foreground">
            Peça em português — a IA monta a consulta no banco e mostra a tabela na hora.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {turns.length === 0 && (
          <div className="text-center py-10 space-y-4">
            <div className="inline-flex p-3 rounded-full bg-primary/10">
              <FileBarChart className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-medium">O que você quer saber?</p>
              <p className="text-sm text-muted-foreground">
                Atividades, processos, casos, contatos, leads — pergunte de qualquer jeito.
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

        {turns.map((t) => <TurnCard key={t.id} turn={t} />)}
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
  );
}
