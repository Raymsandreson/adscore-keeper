import { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ScanSearch, Merge, AlertTriangle, CheckCircle2, Phone, User } from 'lucide-react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinished?: () => void;
}

interface DupContact {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  created_at: string | null;
  notes?: string | null;
}

interface DupGroup {
  key: string;
  reason: 'phone' | 'name';
  classification: 'safe' | 'ambiguous';
  contacts: DupContact[];
}

interface ScanResult {
  total_contacts: number;
  total_groups: number;
  safe_count: number;
  ambiguous_count: number;
  groups: DupGroup[];
}

type Phase = 'idle' | 'scanning' | 'list' | 'merging' | 'done';

// últimos 10 dígitos (ignora DDI 55 e nono dígito)
function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.slice(-10).padStart(10, '0');
}

function normalizeName(n?: string | null): string | null {
  if (!n) return null;
  const v = n
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return v.length >= 4 ? v : null;
}

function namesCompatible(a?: string | null, b?: string | null): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return true; // falta de nome não invalida
  if (na === nb) return true;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  // se compartilham primeiro nome E pelo menos um sobrenome → compatível
  const firstA = na.split(' ')[0];
  const firstB = nb.split(' ')[0];
  if (firstA !== firstB) return false;
  const inter = [...ta].filter((x) => tb.has(x));
  return inter.length >= 2;
}

export function DuplicateContactsScanDialog({ open, onOpenChange, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeResult, setMergeResult] = useState<{ merged: number; errors: string[] } | null>(null);
  const [progress, setProgress] = useState<string>('');

  const runScan = async () => {
    setPhase('scanning');
    setProgress('Carregando contatos…');
    try {
      await ensureExternalSession();

      // pagina pra evitar limite de 1000
      const PAGE = 1000;
      let from = 0;
      const all: DupContact[] = [];
      while (true) {
        const { data, error } = await db
          .from('contacts')
          .select('id, full_name, phone, email, city, state, created_at')
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as DupContact[]));
        setProgress(`Carregados ${all.length} contatos…`);
        if (data.length < PAGE) break;
        from += PAGE;
      }

      setProgress('Analisando…');

      // agrupa por telefone normalizado
      const byPhone = new Map<string, DupContact[]>();
      const byName = new Map<string, DupContact[]>();
      for (const c of all) {
        const p = normalizePhone(c.phone);
        if (p) {
          if (!byPhone.has(p)) byPhone.set(p, []);
          byPhone.get(p)!.push(c);
        }
        const n = normalizeName(c.full_name);
        if (n) {
          if (!byName.has(n)) byName.set(n, []);
          byName.get(n)!.push(c);
        }
      }

      const groups: DupGroup[] = [];
      const usedIds = new Set<string>();

      // telefone primeiro
      for (const [key, list] of byPhone.entries()) {
        if (list.length < 2) continue;
        const sorted = [...list].sort((a, b) =>
          (a.created_at || '').localeCompare(b.created_at || '')
        );
        const winner = sorted[0];
        const allCompatible = sorted.slice(1).every((c) => namesCompatible(winner.full_name, c.full_name));
        groups.push({
          key: `phone:${key}`,
          reason: 'phone',
          classification: allCompatible ? 'safe' : 'ambiguous',
          contacts: sorted,
        });
        sorted.forEach((c) => usedIds.add(c.id));
      }

      // nome (só se nenhum dos contatos já caiu em grupo de telefone)
      for (const [key, list] of byName.entries()) {
        if (list.length < 2) continue;
        const filtered = list.filter((c) => !usedIds.has(c.id));
        if (filtered.length < 2) continue;
        const sorted = [...filtered].sort((a, b) =>
          (a.created_at || '').localeCompare(b.created_at || '')
        );
        groups.push({
          key: `name:${key}`,
          reason: 'name',
          classification: 'ambiguous',
          contacts: sorted,
        });
      }

      const result: ScanResult = {
        total_contacts: all.length,
        total_groups: groups.length,
        safe_count: groups.filter((g) => g.classification === 'safe').length,
        ambiguous_count: groups.filter((g) => g.classification === 'ambiguous').length,
        groups,
      };

      setScan(result);
      setSelected(new Set(groups.filter((g) => g.classification === 'safe').map((g) => g.key)));
      setPhase('list');
    } catch (err: any) {
      console.error('[scan-duplicates]', err);
      toast.error(`Erro ao varrer: ${err.message || err}`);
      setPhase('idle');
    }
  };

  const mergeOneGroup = async (g: DupGroup): Promise<void> => {
    const sorted = [...g.contacts].sort((a, b) =>
      (a.created_at || '').localeCompare(b.created_at || '')
    );
    const winner = sorted[0];
    const losers = sorted.slice(1);

    // monta payload preenchendo campos vazios do winner com dados dos losers
    const fields: (keyof DupContact)[] = ['full_name', 'phone', 'email', 'city', 'state'];
    const patch: Record<string, any> = {};
    for (const f of fields) {
      if (!winner[f] || !String(winner[f]).trim()) {
        const fill = losers.find((l) => l[f] && String(l[f]).trim());
        if (fill) patch[f] = fill[f];
      }
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await db.from('contacts').update(patch).eq('id', winner.id);
      if (error) throw new Error(`update winner: ${error.message}`);
    }

    // re-vincula TODAS as FKs (14 tabelas, não só contact_leads) + soft-delete, numa transação.
    // Antes daqui só re-vinculava contact_leads e deixava órfãos call_records, zapsign_documents,
    // process_parties, contact_relationships, etc.
    const { error } = await (db as any).rpc('merge_relink_and_softdelete', {
      p_table: 'contacts',
      p_winner: winner.id,
      p_losers: losers.map((l) => l.id),
    });
    if (error) throw new Error(error.message);
  };

  const mergeSelected = async () => {
    if (!scan || selected.size === 0) return;
    setPhase('merging');
    const errors: string[] = [];
    let merged = 0;
    const groups = scan.groups.filter((g) => selected.has(g.key));
    for (let i = 0; i < groups.length; i++) {
      setProgress(`Mesclando ${i + 1}/${groups.length}…`);
      try {
        await mergeOneGroup(groups[i]);
        merged++;
      } catch (err: any) {
        errors.push(`${groups[i].key}: ${err.message || err}`);
      }
    }
    setMergeResult({ merged, errors });
    setPhase('done');
    toast.success(`${merged} grupo(s) mesclado(s)`);
    onFinished?.();
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (!scan) return;
    setSelected(checked ? new Set(scan.groups.map((g) => g.key)) : new Set());
  };

  const groupedView = useMemo(() => {
    if (!scan) return [];
    return [...scan.groups].sort((a, b) => {
      if (a.classification !== b.classification) return a.classification === 'safe' ? -1 : 1;
      return 0;
    });
  }, [scan]);

  const reset = () => {
    setPhase('idle');
    setScan(null);
    setSelected(new Set());
    setMergeResult(null);
    setProgress('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="h-5 w-5 text-primary" />
            Contatos duplicados
          </DialogTitle>
          <DialogDescription>
            Varre seus contatos, agrupa os parecidos (mesmo telefone ou nome), você marca quais juntar.
            O contato mais antigo é mantido e campos vazios são preenchidos com dados dos outros.
          </DialogDescription>
        </DialogHeader>

        {phase === 'idle' && (
          <div className="py-4">
            <Button onClick={runScan}>
              <ScanSearch className="h-4 w-4 mr-1" />
              Procurar duplicados
            </Button>
          </div>
        )}

        {(phase === 'scanning' || phase === 'merging') && (
          <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {progress || (phase === 'scanning' ? 'Procurando…' : 'Mesclando…')}
          </div>
        )}

        {phase === 'list' && scan && (
          <>
            <div className="flex items-center justify-between text-sm border-b pb-2">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={selected.size === scan.groups.length && scan.groups.length > 0}
                  onCheckedChange={(c) => toggleAll(!!c)}
                />
                <span className="text-muted-foreground">
                  {selected.size} de {scan.total_groups} selecionados
                </span>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-950/30">
                  <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-600" />
                  {scan.safe_count} seguros
                </Badge>
                <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/30">
                  <AlertTriangle className="h-3 w-3 mr-1 text-amber-600" />
                  {scan.ambiguous_count} ambíguos
                </Badge>
              </div>
            </div>

            <ScrollArea className="flex-1 min-h-[300px]">
              <div className="space-y-2 pr-3">
                {groupedView.length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Nenhum duplicado encontrado 🎉
                  </p>
                )}
                {groupedView.map((g) => (
                  <div
                    key={g.key}
                    className={`border rounded p-3 ${
                      g.classification === 'safe'
                        ? 'border-emerald-200 dark:border-emerald-900'
                        : 'border-amber-200 dark:border-amber-900'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selected.has(g.key)}
                        onCheckedChange={() => toggle(g.key)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground flex-wrap">
                          {g.reason === 'phone' ? <Phone className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          <span>Mesmo {g.reason === 'phone' ? 'telefone' : 'nome'}: {g.key.split(':')[1]}</span>
                          <Badge
                            variant="outline"
                            className={`ml-auto text-[10px] ${
                              g.classification === 'safe'
                                ? 'border-emerald-400 text-emerald-700 dark:text-emerald-400'
                                : 'border-amber-400 text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {g.classification === 'safe' ? 'Seguro' : 'Ambíguo'}
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          {g.contacts.map((c, idx) => (
                            <div key={c.id} className="text-sm flex items-center gap-2 flex-wrap">
                              {idx === 0 && (
                                <Badge variant="secondary" className="text-[10px]">vencedor</Badge>
                              )}
                              <span className="font-medium">{c.full_name || '(sem nome)'}</span>
                              {c.phone && <span className="text-muted-foreground text-xs">{c.phone}</span>}
                              {c.email && <span className="text-muted-foreground text-xs">{c.email}</span>}
                              {(c.city || c.state) && (
                                <span className="text-muted-foreground text-xs">
                                  {[c.city, c.state].filter(Boolean).join('/')}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
              <Button onClick={mergeSelected} disabled={selected.size === 0}>
                <Merge className="h-4 w-4 mr-1" />
                Mesclar {selected.size} grupo(s)
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === 'done' && mergeResult && (
          <div className="space-y-3 py-2">
            <p className="text-sm">
              <CheckCircle2 className="h-4 w-4 inline mr-1 text-emerald-600" />
              <strong>{mergeResult.merged}</strong> grupo(s) mesclado(s).
            </p>
            {mergeResult.errors.length > 0 && (
              <ScrollArea className="h-32 border rounded p-2">
                <p className="text-xs font-medium text-destructive mb-1">Erros ({mergeResult.errors.length}):</p>
                {mergeResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground break-all">{e}</p>
                ))}
              </ScrollArea>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { reset(); runScan(); }}>
                Procurar de novo
              </Button>
              <Button onClick={() => { reset(); onOpenChange(false); }}>Fechar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
