import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { db, authClient } from '@/integrations/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { formatHMS, BREAK_LABELS, type BreakType } from '@/contexts/ActivityTimerContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Clock, Coffee, Download, Loader2, RefreshCw, Users, X } from 'lucide-react';

interface RawEntry {
  user_id: string;
  user_name: string | null;
  activity_id: string | null;
  activity_type: string | null;
  active_seconds: number;
  idle_seconds: number;
  break_type: BreakType | null;
}

interface Agg {
  key: string;
  userId: string;
  userName: string;
  activityType: string;
  active: number;
  idle: number;
  activities: Set<string>;
}

const PAGE = 1000;
// activity_time_entries ainda não está nos types gerados — acesso destipado.
const dbAny = db as unknown as SupabaseClient;

function firstDayOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function BancoHorasPage() {
  const { types } = useActivityTypes();
  const typeLabel = useMemo(() => {
    const m = new Map<string, string>();
    types.forEach((t) => m.set(t.key, t.label));
    return (k: string) => {
      if (k.startsWith('pausa:')) return `Pausa · ${BREAK_LABELS[k.slice(6) as BreakType] || k.slice(6)}`;
      // Linha de gap (activity_type vazio): mistura trabalho sem atividade
      // vinculada (ativo) com ociosidade real (ocioso) — as colunas separam.
      return k ? (m.get(k) || k) : 'Trabalho avulso (sem atividade)';
    };
  }, [types]);

  const [from, setFrom] = useState<string>(firstDayOfMonthISO());
  const [to, setTo] = useState<string>(todayISO());
  const [rows, setRows] = useState<RawEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [memberFilter, setMemberFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [teamFilter, setTeamFilter] = useState<Set<string>>(new Set());
  const [teamOptions, setTeamOptions] = useState<{ id: string; name: string; extIds: Set<string> }[]>([]);

  // Times (Cloud) + membros mapeados pro Externo — habilita o filtro "por time"
  useEffect(() => {
    (async () => {
      try {
        const [{ data: teams }, { data: tms }] = await Promise.all([
          authClient.from('teams').select('id, name').order('name'),
          authClient.from('team_members').select('team_id, user_id'),
        ]);
        await ensureRemapCache().catch(() => {});
        const byTeam = new Map<string, string[]>();
        (tms || []).forEach((tm) => {
          const a = byTeam.get(tm.team_id) || [];
          a.push(tm.user_id);
          byTeam.set(tm.team_id, a);
        });
        const result: { id: string; name: string; extIds: Set<string> }[] = [];
        for (const t of (teams || [])) {
          const exts = await Promise.all((byTeam.get(t.id) || []).map((id) => remapToExternal(id)));
          result.push({ id: t.id, name: t.name, extIds: new Set(exts.filter(Boolean) as string[]) });
        }
        setTeamOptions(result);
      } catch { /* sem times */ }
    })();
  }, []);

  // União dos membros (ext) dos times selecionados
  const teamAllowedExtIds = useMemo(() => {
    if (!teamFilter.size) return null;
    const s = new Set<string>();
    teamOptions.filter((t) => teamFilter.has(t.id)).forEach((t) => t.extIds.forEach((id) => s.add(id)));
    return s;
  }, [teamFilter, teamOptions]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fromTs = new Date(`${from}T00:00:00`).toISOString();
      const toTs = new Date(`${to}T23:59:59`).toISOString();
      const all: RawEntry[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await dbAny
          .from('activity_time_entries')
          .select('user_id, user_name, activity_id, activity_type, active_seconds, idle_seconds, break_type')
          .gte('started_at', fromTs)
          .lte('started_at', toTs)
          .order('started_at', { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        const chunk = (data as RawEntry[]) || [];
        all.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      setRows(all);
    } catch (e) {
      console.error('[banco-horas] erro ao carregar:', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  // Membros e tipos presentes nos dados (para os chips de filtro)
  const memberOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => m.set(r.user_id, r.user_name || 'Membro'));
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.break_type ? `pausa:${r.break_type}` : (r.activity_type || '')));
    return Array.from(s).sort();
  }, [rows]);

  // Agregação por membro × tipo
  const aggregated = useMemo(() => {
    const map = new Map<string, Agg>();
    for (const r of rows) {
      if (teamAllowedExtIds && !teamAllowedExtIds.has(r.user_id)) continue;
      if (memberFilter.size && !memberFilter.has(r.user_id)) continue;
      // Pausas justificadas viram categoria própria (não misturam com ocioso)
      const t = r.break_type ? `pausa:${r.break_type}` : (r.activity_type || '');
      if (typeFilter.size && !typeFilter.has(t)) continue;
      const key = `${r.user_id}|${t}`;
      let a = map.get(key);
      if (!a) {
        a = { key, userId: r.user_id, userName: r.user_name || 'Membro', activityType: t, active: 0, idle: 0, activities: new Set() };
        map.set(key, a);
      }
      a.active += r.active_seconds || 0;
      a.idle += r.idle_seconds || 0;
      if (r.activity_id) a.activities.add(r.activity_id);
    }
    return Array.from(map.values()).sort(
      (x, y) => x.userName.localeCompare(y.userName) || y.active - x.active,
    );
  }, [rows, memberFilter, typeFilter, teamAllowedExtIds]);

  // Subtotais por membro (para agrupar visualmente)
  const byMember = useMemo(() => {
    const m = new Map<string, { userName: string; items: Agg[]; active: number; idle: number; acts: Set<string> }>();
    for (const a of aggregated) {
      let g = m.get(a.userId);
      if (!g) { g = { userName: a.userName, items: [], active: 0, idle: 0, acts: new Set() }; m.set(a.userId, g); }
      g.items.push(a);
      g.active += a.active;
      g.idle += a.idle;
      a.activities.forEach((id) => g!.acts.add(id));
    }
    return Array.from(m.values()).sort((x, y) => x.userName.localeCompare(y.userName));
  }, [aggregated]);

  const totals = useMemo(() => {
    const active = aggregated.reduce((s, a) => s + a.active, 0);
    // Pausas justificadas (almoço/intervalo/compensação) não contam como ocioso
    const idle = aggregated.reduce((s, a) => s + (a.activityType.startsWith('pausa:') ? 0 : a.idle), 0);
    // Parcela do ativo que veio da linha de gap: produtivo, mas sem atividade
    // vinculada (atendimento no WhatsApp, cadastro, consulta de processo...).
    const loose = aggregated.reduce((s, a) => s + (a.activityType === '' ? a.active : 0), 0);
    const acts = new Set<string>();
    aggregated.forEach((a) => a.activities.forEach((id) => acts.add(id)));
    return { active, idle, loose, acts: acts.size, members: byMember.length };
  }, [aggregated, byMember.length]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setter(next);
  };

  const exportCSV = () => {
    const header = ['Membro', 'Tipo', 'Tempo ativo (s)', 'Tempo ativo', 'Ocioso (s)', 'Ocioso', 'Nº atividades'];
    const lines = aggregated.map((a) => [
      a.userName,
      typeLabel(a.activityType),
      String(a.active),
      formatHMS(a.active),
      String(a.idle),
      formatHMS(a.idle),
      String(a.activities.size),
    ]);
    const csv = [header, ...lines]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const BOM = String.fromCharCode(0xfeff); // Excel reconhece UTF-8
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `banco-horas_${from}_a_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="h-6 w-6 text-indigo-500" /> Banco de Horas
          </h1>
          <p className="text-sm text-muted-foreground">Tempo cronometrado por membro e tipo de atividade.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Atualizar
          </Button>
          <Button size="sm" onClick={exportCSV} disabled={!aggregated.length} className="gap-1">
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">De</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Até</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>Aplicar período</Button>

            {/* Filtros compactos em menu suspenso */}
            <MultiFilter
              label="Time"
              options={teamOptions.map((t) => ({ value: t.id, label: t.name }))}
              selected={teamFilter}
              onToggle={(v) => toggle(teamFilter, setTeamFilter, v)}
              onClear={() => setTeamFilter(new Set())}
            />
            <MultiFilter
              label="Assessor"
              options={memberOptions.map((m) => ({ value: m.id, label: m.name }))}
              selected={memberFilter}
              onToggle={(v) => toggle(memberFilter, setMemberFilter, v)}
              onClear={() => setMemberFilter(new Set())}
            />
            <MultiFilter
              label="Tipo de atv"
              options={typeOptions.map((t) => ({ value: t, label: typeLabel(t) }))}
              selected={typeFilter}
              onToggle={(v) => toggle(typeFilter, setTypeFilter, v)}
              onClear={() => setTypeFilter(new Set())}
            />

            {(teamFilter.size > 0 || memberFilter.size > 0 || typeFilter.size > 0) && (
              <Button
                variant="ghost" size="sm"
                className="h-9 text-xs text-destructive"
                onClick={() => { setTeamFilter(new Set()); setMemberFilter(new Set()); setTypeFilter(new Set()); }}
              >
                <X className="h-3 w-3 mr-1" /> Limpar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Totais */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={<Clock className="h-4 w-4 text-emerald-500" />} label="Tempo ativo" value={formatHMS(totals.active)} />
        <StatCard icon={<Clock className="h-4 w-4 text-sky-500" />} label="Trabalho avulso" value={formatHMS(totals.loose)} />
        <StatCard icon={<Coffee className="h-4 w-4 text-amber-500" />} label="Tempo ocioso" value={formatHMS(totals.idle)} />
        <StatCard icon={<RefreshCw className="h-4 w-4 text-blue-500" />} label="Atividades" value={String(totals.acts)} />
        <StatCard icon={<Users className="h-4 w-4 text-indigo-500" />} label="Membros" value={String(totals.members)} />
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalhamento por membro e tipo</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Carregando…</div>
          ) : byMember.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Nenhum tempo registrado no período/filtros.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 px-4 font-medium">Membro / Tipo</th>
                    <th className="py-2 px-4 font-medium text-right">Ativo</th>
                    <th className="py-2 px-4 font-medium text-right">Ocioso</th>
                    <th className="py-2 px-4 font-medium text-right">Total</th>
                    <th className="py-2 px-4 font-medium text-right">Atvs</th>
                  </tr>
                </thead>
                <tbody>
                  {byMember.map((g) => (
                    <Fragment key={g.userName}>
                      <tr className="border-b bg-muted/40 font-semibold">
                        <td className="py-2 px-4">{g.userName}</td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums">{formatHMS(g.active)}</td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums text-amber-600">{formatHMS(g.idle)}</td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums">{formatHMS(g.active + g.idle)}</td>
                        <td className="py-2 px-4 text-right">{g.acts.size}</td>
                      </tr>
                      {g.items.map((a) => (
                        <tr key={a.key} className="border-b text-muted-foreground">
                          <td className="py-1.5 px-4 pl-8">{typeLabel(a.activityType)}</td>
                          <td className="py-1.5 px-4 text-right font-mono tabular-nums">{formatHMS(a.active)}</td>
                          <td className="py-1.5 px-4 text-right font-mono tabular-nums">{formatHMS(a.idle)}</td>
                          <td className="py-1.5 px-4 text-right font-mono tabular-nums">{formatHMS(a.active + a.idle)}</td>
                          <td className="py-1.5 px-4 text-right">{a.activities.size}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t-2">
                    <td className="py-2 px-4">Total geral</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums">{formatHMS(totals.active)}</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-amber-600">{formatHMS(totals.idle)}</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums">{formatHMS(totals.active + totals.idle)}</td>
                    <td className="py-2 px-4 text-right">{totals.acts}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Multi-seleção compacta em menu suspenso (com busca). */
function MultiFilter({
  label, options, selected, onToggle, onClear,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={selected.size ? 'default' : 'outline'} size="sm" className="h-9 gap-1">
          {label}
          {selected.size > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">{selected.size}</Badge>
          )}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={`Buscar ${label.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => onToggle(o.value)}>
                  <Check className={cn('mr-2 h-4 w-4', selected.has(o.value) ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="w-full border-t py-1.5 text-xs text-muted-foreground hover:text-destructive"
          >
            Limpar seleção
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon} {label}</div>
        <div className="text-2xl font-bold font-mono tabular-nums mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
