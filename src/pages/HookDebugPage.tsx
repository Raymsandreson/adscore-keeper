import { useEffect, useMemo, useState } from 'react';
import {
  subscribeHookTrace,
  clearHookTrace,
  type HookTraceEntry,
} from '@/utils/hookTracer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Página de diagnóstico ao vivo: mostra quantas vezes cada hook/efeito
 * disparou e o intervalo desde o último disparo. Útil para identificar
 * o que está causando o "piscar" do Inbox.
 *
 * Acessar em: /debug/hooks
 */
export default function HookDebugPage() {
  const [entries, setEntries] = useState<HookTraceEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (paused) return;
    const unsub = subscribeHookTrace((next) => setEntries(next));
    return unsub;
  }, [paused]);

  const counters = useMemo(() => {
    const map = new Map<string, { count: number; lastTs: number; lastDelta: number | null }>();
    for (const e of entries) {
      const cur = map.get(e.name) ?? { count: 0, lastTs: 0, lastDelta: null };
      cur.count += 1;
      cur.lastTs = e.wallTime;
      cur.lastDelta = e.deltaMs;
      map.set(e.name, cur);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [entries]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f
      ? entries.filter((e) => e.name.toLowerCase().includes(f))
      : entries;
    return list.slice(-200).reverse();
  }, [entries, filter]);

  const totalEvents = entries.length;

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Hook Debug</h1>
          <p className="text-sm text-muted-foreground">
            Rastreio ao vivo de disparos de hooks/efeitos. Abra o Inbox em outra aba e veja o que dispara quando ele "pisca".
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={paused ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? 'Retomar' : 'Pausar'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              clearHookTrace();
              setEntries([]);
            }}
          >
            Limpar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total de eventos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEvents}</div>
            <div className="text-xs text-muted-foreground">buffer máx: 500</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Hooks distintos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counters.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={paused ? 'outline' : 'default'}>
              {paused ? 'Pausado' : 'Ao vivo'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contadores por hook</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hook / Efeito</TableHead>
                <TableHead className="text-right">Disparos</TableHead>
                <TableHead className="text-right">Δ último (ms)</TableHead>
                <TableHead className="text-right">Último disparo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counters.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    Nenhum evento ainda. Navegue até o Inbox para gerar tráfego.
                  </TableCell>
                </TableRow>
              )}
              {counters.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-mono text-xs">{row.name}</TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={row.count > 10 ? 'destructive' : row.count > 3 ? 'secondary' : 'outline'}
                    >
                      {row.count}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.lastDelta == null ? '—' : row.lastDelta}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {new Date(row.lastTs).toLocaleTimeString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Eventos recentes (mais novos primeiro)</CardTitle>
            <input
              type="text"
              placeholder="filtrar por nome…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 px-2 text-sm border rounded-md bg-background"
            />
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[420px] pr-2">
            <div className="space-y-1">
              {filtered.map((e) => (
                <div
                  key={e.id}
                  className="text-xs font-mono border rounded-md px-2 py-1 flex items-start justify-between gap-2 bg-muted/30"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{e.name}</span>
                      {e.deltaMs != null && e.deltaMs < 100 && (
                        <Badge variant="destructive" className="h-4 text-[10px]">
                          burst {e.deltaMs}ms
                        </Badge>
                      )}
                    </div>
                    {e.detail && (
                      <div className="text-muted-foreground break-all mt-0.5">
                        {JSON.stringify(e.detail)}
                      </div>
                    )}
                  </div>
                  <div className="text-muted-foreground whitespace-nowrap">
                    {new Date(e.wallTime).toLocaleTimeString()}
                    {e.deltaMs != null && (
                      <span className="ml-1 text-[10px]">+{e.deltaMs}ms</span>
                    )}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-6">
                  Nenhum evento corresponde ao filtro.
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
