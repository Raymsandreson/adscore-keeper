import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Merge, CheckCircle2, AlertTriangle, Crown, ShieldAlert } from 'lucide-react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { toast } from 'sonner';
import { DuplicateGroup, MERGE_FIELDS, buildMergePatch } from '@/lib/duplicateDetection';

export type MergeType = 'lead' | 'contact' | 'case' | 'process' | 'campaign';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: MergeType;
  groups: DuplicateGroup<any>[];
  onMerged?: () => void; // recarregar a busca
}

const TYPE_LABEL: Record<MergeType, string> = { lead: 'leads', contact: 'contatos', case: 'casos', process: 'processos', campaign: 'campanhas' };
const TYPE_TABLE: Record<MergeType, string> = { lead: 'leads', contact: 'contacts', case: 'legal_cases', process: 'lead_processes', campaign: 'campaigns' };
// Caso mexe em lead_financials (honorário/fundo): não auto-seleciona, exige revisão manual.
const REQUIRE_MANUAL: Record<MergeType, boolean> = { lead: false, contact: false, case: true, process: false, campaign: false };

function displayName(type: MergeType, raw: any): string {
  if (type === 'lead') return raw.lead_name || raw.victim_name || '(sem nome)';
  if (type === 'contact') return raw.full_name || '(sem nome)';
  if (type === 'case') return raw.case_number || raw.title || '(caso)';
  if (type === 'campaign') return raw.name || '(campanha)';
  return raw.process_number || raw.title || '(processo)';
}
function displaySub(type: MergeType, raw: any): string {
  if (type === 'lead') return [raw.lead_phone, [raw.city, raw.state].filter(Boolean).join('/')].filter(Boolean).join(' · ');
  if (type === 'contact') return [raw.phone, raw.email, raw.instagram_username && `@${raw.instagram_username}`].filter(Boolean).join(' · ');
  if (type === 'case') return [raw.title, raw.status].filter(Boolean).join(' · ');
  if (type === 'campaign') return [raw.status, raw.meta_campaign_id].filter(Boolean).join(' · ');
  return [raw.title, raw.status, raw.tribunal].filter(Boolean).join(' · ');
}

export function DuplicateMergeDialog({ open, onOpenChange, type, groups, onMerged }: Props) {
  const manual = REQUIRE_MANUAL[type];
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(manual ? [] : groups.map((g) => g.key)),
  );
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<{ merged: number; errors: string[] } | null>(null);

  // reinicia seleção quando a lista de grupos muda (nova busca)
  const groupsKey = groups.map((g) => g.key).join('|');
  useEffect(() => {
    setSelected(new Set(manual ? [] : groups.map((g) => g.key)));
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsKey]);

  const fields = MERGE_FIELDS[type] || [];

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const mergeOne = async (g: DuplicateGroup<any>) => {
    const members = g.members.map((m) => m.raw);
    const winner = members[0];
    const losers = members.slice(1);
    const patch = buildMergePatch(members, fields);

    const table = TYPE_TABLE[type];
    if (Object.keys(patch).length > 0) {
      const { error } = await (db as any).from(table).update(patch).eq('id', winner.id);
      if (error) throw new Error(`patch vencedor: ${error.message}`);
    }
    const { error } = await (db as any).rpc('merge_relink_and_softdelete', {
      p_table: table,
      p_winner: winner.id,
      p_losers: losers.map((l) => l.id),
    });
    if (error) throw new Error(error.message);
  };

  const runMerge = async () => {
    const chosen = groups.filter((g) => selected.has(g.key));
    if (chosen.length === 0) return;
    setMerging(true);
    await ensureExternalSession();
    const errors: string[] = [];
    let merged = 0;
    for (const g of chosen) {
      try {
        await mergeOne(g);
        merged++;
      } catch (err: any) {
        errors.push(`${displayName(type, g.members[0].raw)}: ${err.message || err}`);
      }
    }
    setMerging(false);
    setResult({ merged, errors });
    if (merged > 0) {
      toast.success(`${merged} fusão(ões) concluída(s)`);
      onMerged?.();
    }
    if (errors.length > 0) toast.error(`${errors.length} falha(s) na fusão`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-5 w-5 text-primary" />
            Fundir {TYPE_LABEL[type]} duplicados
          </DialogTitle>
          <DialogDescription>
            O registro com <strong>vínculos</strong> e dados é preservado (o mais recente vence);
            os demais são absorvidos e marcados como mesclados. Campos vazios do vencedor são
            preenchidos com os dados dos outros. Reversível (soft-delete com snapshot).
          </DialogDescription>
        </DialogHeader>

        {type === 'case' && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-2.5 text-xs text-rose-800 dark:text-rose-300">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Fundir casos move <strong>honorários e financeiro</strong> (dado do fundo) do perdedor pro vencedor.
              Confira que são o <strong>mesmo processo do mesmo cliente</strong> antes de marcar. Nada vem marcado por padrão.
            </span>
          </div>
        )}

        {!result && (
          <ScrollArea className="flex-1 min-h-[200px]">
            <div className="space-y-2 pr-3">
              {groups.map((g) => {
                const patch = buildMergePatch(g.members.map((m) => m.raw), fields);
                const patchKeys = Object.keys(patch);
                return (
                  <div key={g.key} className="border rounded p-3 border-amber-200 dark:border-amber-900">
                    <div className="flex items-start gap-3">
                      <Checkbox checked={selected.has(g.key)} onCheckedChange={() => toggle(g.key)} className="mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground flex-wrap">
                          <AlertTriangle className="h-3 w-3 text-amber-600" />
                          <span>{g.reasons.join(' · ')}</span>
                          <Badge variant="outline" className="ml-auto text-[10px]">
                            {g.members.length} registros
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          {g.members.map((m, idx) => (
                            <div key={m.id} className="text-sm flex items-center gap-2 flex-wrap">
                              {idx === 0 && (
                                <Badge variant="secondary" className="text-[10px] gap-1">
                                  <Crown className="h-3 w-3" /> vencedor
                                </Badge>
                              )}
                              <span className={idx === 0 ? 'font-medium' : 'text-muted-foreground'}>
                                {displayName(type, m.raw)}
                              </span>
                              <span className="text-muted-foreground text-xs">{displaySub(type, m.raw)}</span>
                            </div>
                          ))}
                        </div>
                        {patchKeys.length > 0 && (
                          <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1.5">
                            Vai preencher no vencedor: {patchKeys.join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {result && (
          <div className="space-y-3 py-2">
            <p className="text-sm">
              <CheckCircle2 className="h-4 w-4 inline mr-1 text-emerald-600" />
              <strong>{result.merged}</strong> fusão(ões) concluída(s).
            </p>
            {result.errors.length > 0 && (
              <ScrollArea className="h-28 border rounded p-2">
                <p className="text-xs font-medium text-destructive mb-1">Falhas ({result.errors.length}):</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground break-all">{e}</p>
                ))}
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={merging}>Cancelar</Button>
              <Button onClick={runMerge} disabled={merging || selected.size === 0}>
                {merging ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Merge className="h-4 w-4 mr-1" />}
                Fundir {selected.size} grupo(s)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
