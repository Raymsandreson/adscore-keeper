import { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ScanSearch, Merge, AlertTriangle, CheckCircle2, Phone, User } from 'lucide-react';
import { cloudFunctions } from '@/lib/functionRouter';
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

export function DuplicateContactsScanDialog({ open, onOpenChange, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeResult, setMergeResult] = useState<{ merged: number; errors: string[] } | null>(null);

  const runScan = async () => {
    setPhase('scanning');
    try {
      const { data, error } = await cloudFunctions.invoke('scan-duplicate-contacts', {
        body: { mode: 'dry-run' },
      });
      if (error || !data?.success) {
        toast.error(`Falha: ${error?.message || data?.error || 'erro'}`);
        setPhase('idle');
        return;
      }
      setScan(data as ScanResult);
      // pré-seleciona os seguros
      const safeKeys = new Set<string>(
        (data.groups as DupGroup[]).filter((g) => g.classification === 'safe').map((g) => g.key)
      );
      setSelected(safeKeys);
      setPhase('list');
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
      setPhase('idle');
    }
  };

  const mergeSelected = async () => {
    if (!scan || selected.size === 0) return;
    setPhase('merging');
    try {
      const { data, error } = await cloudFunctions.invoke('scan-duplicate-contacts', {
        body: { mode: 'merge-selected', keys: Array.from(selected) },
      });
      if (error || !data?.success) {
        toast.error(`Falha: ${error?.message || data?.error || 'erro'}`);
        setPhase('list');
        return;
      }
      setMergeResult({ merged: data.merged_count || 0, errors: data.merge_errors || [] });
      setPhase('done');
      toast.success(`${data.merged_count} contato(s) mesclado(s)`);
      onFinished?.();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
      setPhase('list');
    }
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
      // seguros primeiro
      if (a.classification !== b.classification) return a.classification === 'safe' ? -1 : 1;
      return 0;
    });
  }, [scan]);

  const reset = () => {
    setPhase('idle');
    setScan(null);
    setSelected(new Set());
    setMergeResult(null);
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
            Veja os grupos de duplicados, marque os que quer juntar e mescle em lote.
            Cada grupo mantém o contato mais antigo e preenche campos vazios com dados dos outros.
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
            {phase === 'scanning' ? 'Procurando…' : 'Mesclando…'}
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
                        <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground">
                          {g.reason === 'phone' ? <Phone className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          <span>Mesmo {g.reason === 'phone' ? 'telefone' : 'nome'}: {g.key}</span>
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
              <strong>{mergeResult.merged}</strong> contato(s) mesclado(s).
            </p>
            {mergeResult.errors.length > 0 && (
              <ScrollArea className="h-24 border rounded p-2">
                <p className="text-xs font-medium text-destructive mb-1">Erros:</p>
                {mergeResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{e}</p>
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
