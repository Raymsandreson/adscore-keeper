import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { ensureRemapCache, remapToExternalSync } from '@/integrations/supabase/uuid-remap';
import { logAudit } from '@/hooks/useAuditLog';
import { toast } from 'sonner';

interface Person {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface PendingActivity {
  id: string;
  activity_type: string | null;
  deadline: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_to_ids: string[] | null;
  assigned_to_names: string[] | null;
}

const dateKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/**
 * Redistribui as atividades pendentes de membros desativados (org_user_status
 * no Externo) para outros usuários ativos. Com teto de atividades/dia, os
 * prazos são reagendados preenchendo os dias úteis de cada destino (contando
 * a agenda pendente que a pessoa já tem); sem teto, os prazos são mantidos e
 * a divisão é round-robin. Não dispara notificação por atividade.
 */
export function RedistributeActivitiesDialog({ people, inactiveIds, open: openProp, onOpenChange, initialSourceId }: {
  people: Person[];
  inactiveIds: Set<string>;
  /** Quando controlado (aberto a partir da linha do membro), o trigger não é renderizado. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialSourceId?: string | null;
}) {
  const controlled = openProp !== undefined;
  const [openState, setOpenState] = useState(false);
  const open = controlled ? openProp : openState;
  const setOpen = (v: boolean) => { if (controlled) onOpenChange?.(v); else setOpenState(v); };

  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  // Cloud user_id do inativo -> atividades pendentes dele no Externo
  const [pendingBySource, setPendingBySource] = useState<Map<string, PendingActivity[]>>(new Map());
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [targetSearch, setTargetSearch] = useState('');
  const [maxPerDay, setMaxPerDay] = useState('');

  const inactivePeople = useMemo(
    () => people.filter(p => inactiveIds.has(p.user_id)),
    [people, inactiveIds]
  );
  const activePeople = useMemo(
    () => people.filter(p => !inactiveIds.has(p.user_id)),
    [people, inactiveIds]
  );

  const personName = (p: Person) => p.full_name || p.email || 'Sem nome';

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      await ensureRemapCache();

      const extBySource = new Map<string, string>();
      inactivePeople.forEach(p => {
        const ext = remapToExternalSync(p.user_id);
        if (ext) extBySource.set(p.user_id, ext);
      });
      const extIds = [...extBySource.values()];
      if (extIds.length === 0) {
        setPendingBySource(new Map());
        return;
      }

      // Busca paginada: pendentes (não concluídas, não deletadas) onde o
      // inativo é o principal ou está no array de co-assessores.
      const all: PendingActivity[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (externalSupabase as any)
          .from('lead_activities')
          .select('id, activity_type, deadline, assigned_to, assigned_to_name, assigned_to_ids, assigned_to_names')
          .is('deleted_at', null)
          .neq('status', 'concluida')
          .or(`assigned_to.in.(${extIds.join(',')}),assigned_to_ids.ov.{${extIds.join(',')}}`)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all.push(...((data as PendingActivity[]) || []));
        if (!data || data.length < PAGE) break;
      }

      // Agrupa por membro inativo; atividade com dois inativos fica só no primeiro
      const bySource = new Map<string, PendingActivity[]>();
      const claimed = new Set<string>();
      for (const [cloudId, extId] of extBySource) {
        const mine = all.filter(a =>
          !claimed.has(a.id) &&
          (a.assigned_to === extId || (a.assigned_to_ids || []).includes(extId))
        );
        mine.forEach(a => claimed.add(a.id));
        if (mine.length > 0) bySource.set(cloudId, mine);
      }
      setPendingBySource(bySource);
      setSelectedSources(
        initialSourceId && bySource.has(initialSourceId)
          ? new Set([initialSourceId])
          : new Set(bySource.keys())
      );
      const types = new Set<string>();
      bySource.forEach(acts => acts.forEach(a => types.add(a.activity_type || 'sem tipo')));
      setSelectedTypes(types);
    } catch (e) {
      console.error('[RedistributeActivities] Failed to load pending:', e);
      toast.error('Erro ao carregar atividades pendentes dos inativos');
    } finally {
      setLoading(false);
    }
  }, [inactivePeople, initialSourceId]);

  useEffect(() => {
    if (open) fetchPending();
  }, [open, fetchPending]);

  // Tipos presentes nas pendências dos membros selecionados, com contagem
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of selectedSources) {
      (pendingBySource.get(id) || []).forEach(a => {
        const t = a.activity_type || 'sem tipo';
        counts.set(t, (counts.get(t) || 0) + 1);
      });
    }
    return counts;
  }, [selectedSources, pendingBySource]);

  const matchesType = useCallback(
    (a: PendingActivity) => selectedTypes.has(a.activity_type || 'sem tipo'),
    [selectedTypes]
  );

  const countForSource = useCallback(
    (cloudId: string) => (pendingBySource.get(cloudId) || []).filter(matchesType).length,
    [pendingBySource, matchesType]
  );

  const totalSelected = useMemo(
    () => [...selectedSources].reduce((sum, id) => sum + countForSource(id), 0),
    [selectedSources, countForSource]
  );

  const filteredTargets = activePeople.filter(p => {
    const q = targetSearch.trim().toLowerCase();
    if (!q) return true;
    return (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
  });

  const handleApply = async () => {
    const targets = activePeople.filter(p => selectedTargets.has(p.user_id));
    if (targets.length === 0 || totalSelected === 0) return;
    const cap = parseInt(maxPerDay, 10) || 0;
    setApplying(true);
    try {
      await ensureExternalSession();
      await ensureRemapCache();

      const targetInfo = targets.map(t => ({
        cloudId: t.user_id,
        extId: remapToExternalSync(t.user_id)!,
        name: personName(t),
        assigned: 0,
        // Com teto/dia: quantas pendentes a pessoa já tem em cada dia (hoje em diante)
        dayCounts: new Map<string, number>(),
      }));

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (cap > 0) {
        // Carrega a agenda pendente atual dos destinos pra não estourar o teto
        const tExtIds = targetInfo.map(t => t.extId);
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await (externalSupabase as any)
            .from('lead_activities')
            .select('assigned_to, assigned_to_ids, deadline')
            .is('deleted_at', null)
            .neq('status', 'concluida')
            .gte('deadline', today.toISOString())
            .or(`assigned_to.in.(${tExtIds.join(',')}),assigned_to_ids.ov.{${tExtIds.join(',')}}`)
            .range(from, from + PAGE - 1);
          if (error) throw error;
          for (const row of ((data as any[]) || [])) {
            if (!row.deadline) continue;
            const key = dateKey(new Date(row.deadline));
            for (const t of targetInfo) {
              if (row.assigned_to === t.extId || (row.assigned_to_ids || []).includes(t.extId)) {
                t.dayCounts.set(key, (t.dayCounts.get(key) || 0) + 1);
              }
            }
          }
          if (!data || data.length < PAGE) break;
        }
      }

      // Primeiro dia útil, de hoje em diante, em que o destino ainda tem vaga
      const nextSlot = (t: typeof targetInfo[number]): Date => {
        const d = new Date(today);
        for (let i = 0; i < 730; i++) {
          if (!isWeekend(d) && (t.dayCounts.get(dateKey(d)) || 0) < cap) return new Date(d);
          d.setDate(d.getDate() + 1);
        }
        return new Date(d);
      };

      // Escolhe o destino: com teto, quem tem a vaga mais cedo (agenda mais
      // livre); sem teto, round-robin simples.
      let rr = 0;
      const pickTarget = (): { t: typeof targetInfo[number]; slot: Date | null } => {
        if (cap <= 0) {
          const t = targetInfo[rr % targetInfo.length];
          rr += 1;
          return { t, slot: null };
        }
        let best = targetInfo[0];
        let bestSlot = nextSlot(best);
        for (const t of targetInfo.slice(1)) {
          const s = nextSlot(t);
          if (s < bestSlot || (s.getTime() === bestSlot.getTime() && t.assigned < best.assigned)) {
            best = t; bestSlot = s;
          }
        }
        best.dayCounts.set(dateKey(bestSlot), (best.dayCounts.get(dateKey(bestSlot)) || 0) + 1);
        return { t: best, slot: bestSlot };
      };

      const now = new Date().toISOString();
      const bulk = new Map<string, { patch: Record<string, any>; ids: string[] }>();
      const individual: { id: string; patch: Record<string, any> }[] = [];
      const perTargetCount = new Map<string, number>();

      for (const sourceId of selectedSources) {
        const srcExt = remapToExternalSync(sourceId);
        const acts = (pendingBySource.get(sourceId) || []).filter(matchesType);
        for (const a of acts) {
          const { t, slot } = pickTarget();
          t.assigned += 1;
          perTargetCount.set(t.name, (perTargetCount.get(t.name) || 0) + 1);
          // Prazo reagendado pro dia com vaga, meio-dia local (evita pular de
          // dia na conversão de fuso ao salvar em ISO/UTC)
          const deadlinePatch = slot
            ? { deadline: new Date(slot.getFullYear(), slot.getMonth(), slot.getDate(), 12, 0, 0).toISOString() }
            : {};

          const ids = a.assigned_to_ids || [];
          const isSimple = ids.length <= 1 && (ids.length === 0 || ids[0] === srcExt);
          if (isSimple && a.assigned_to === srcExt) {
            const hasArray = ids.length > 0;
            const key = `${t.cloudId}|${hasArray}|${(deadlinePatch as any).deadline || ''}`;
            if (!bulk.has(key)) {
              bulk.set(key, {
                patch: {
                  assigned_to: t.extId,
                  assigned_to_name: t.name,
                  ...(hasArray ? { assigned_to_ids: [t.extId], assigned_to_names: [t.name] } : {}),
                  ...deadlinePatch,
                  updated_at: now,
                },
                ids: [],
              });
            }
            bulk.get(key)!.ids.push(a.id);
          } else {
            // Substitui o inativo mantendo os demais assessores; se o destino
            // já está no array, o inativo só é removido.
            const names = a.assigned_to_names || [];
            const newIds = ids.slice();
            const newNames = names.slice();
            const idx = newIds.indexOf(srcExt || '');
            if (idx >= 0) {
              if (newIds.includes(t.extId)) {
                newIds.splice(idx, 1);
                newNames.splice(idx, 1);
              } else {
                newIds[idx] = t.extId;
                newNames[idx] = t.name;
              }
            }
            const patch: Record<string, any> = { ...deadlinePatch, updated_at: now };
            if (ids.length > 0) {
              patch.assigned_to_ids = newIds;
              patch.assigned_to_names = newNames;
            }
            if (a.assigned_to === srcExt) {
              patch.assigned_to = newIds[0] || t.extId;
              patch.assigned_to_name = newNames[0] || t.name;
            }
            individual.push({ id: a.id, patch });
          }
        }
      }

      const CHUNK = 200;
      for (const { patch, ids } of bulk.values()) {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { error } = await (externalSupabase as any)
            .from('lead_activities')
            .update(patch)
            .in('id', ids.slice(i, i + CHUNK));
          if (error) throw error;
        }
      }
      for (const { id, patch } of individual) {
        const { error } = await (externalSupabase as any)
          .from('lead_activities')
          .update(patch)
          .eq('id', id);
        if (error) throw error;
      }

      const sourceNames = [...selectedSources]
        .map(id => { const p = inactivePeople.find(pp => pp.user_id === id); return p ? personName(p) : id; });
      logAudit({
        action: 'update',
        entityType: 'redistribuicao_atividades',
        details: {
          de: sourceNames,
          para: Object.fromEntries(perTargetCount),
          tipos: [...selectedTypes],
          max_por_dia: cap > 0 ? cap : null,
          total: totalSelected,
        },
      });

      const dist = [...perTargetCount.entries()].map(([n, c]) => `${n}: ${c}`).join(', ');
      toast.success(`${totalSelected} atividade${totalSelected !== 1 ? 's' : ''} redistribuída${totalSelected !== 1 ? 's' : ''} (${dist})${cap > 0 ? ` — prazos reagendados com máx. ${cap}/dia` : ''}`);
      setSelectedTargets(new Set());
      fetchPending();
    } catch (e: any) {
      console.error('[RedistributeActivities] Failed to redistribute:', e);
      toast.error(e?.message || 'Erro ao redistribuir atividades');
    } finally {
      setApplying(false);
    }
  };

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
            Redistribuir atividades de inativos
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Redistribuir atividades</DialogTitle>
          <DialogDescription>
            Atividades pendentes de membros desativados são transferidas para os usuários
            escolhidos. Com máximo por dia definido, os prazos são reagendados preenchendo
            os dias úteis de cada pessoa sem passar do teto.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : pendingBySource.size === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nenhum membro desativado com atividades pendentes.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1.5">
                Membros desativados com pendências
              </p>
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {[...pendingBySource.keys()].map(cloudId => {
                  const p = inactivePeople.find(pp => pp.user_id === cloudId);
                  return (
                    <label key={cloudId} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded p-1.5">
                      <Checkbox
                        checked={selectedSources.has(cloudId)}
                        onCheckedChange={() => toggle(selectedSources, cloudId, setSelectedSources)}
                      />
                      <span className="flex-1 truncate">{p ? personName(p) : cloudId}</span>
                      <Badge variant="secondary" className="text-[10px]">{countForSource(cloudId)}</Badge>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1.5">
                Tipos de atividade
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                  const on = selectedTypes.has(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggle(selectedTypes, type, setSelectedTypes)}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/50 text-muted-foreground border-transparent hover:border-muted-foreground/30'}`}
                    >
                      {type} · {count}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1.5">
                Redistribuir para
              </p>
              <Input
                value={targetSearch}
                onChange={e => setTargetSearch(e.target.value)}
                placeholder="Buscar por nome ou email..."
                className="h-8 text-xs mb-1.5"
              />
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {filteredTargets.map(p => (
                  <label key={p.user_id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded p-1.5">
                    <Checkbox
                      checked={selectedTargets.has(p.user_id)}
                      onCheckedChange={() => toggle(selectedTargets, p.user_id, setSelectedTargets)}
                    />
                    <span className="flex-1 truncate">{personName(p)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs shrink-0">Máx. de atividades por dia por pessoa</Label>
              <Input
                type="number"
                min={1}
                value={maxPerDay}
                onChange={e => setMaxPerDay(e.target.value)}
                placeholder="Sem limite"
                className="h-8 text-xs w-28"
              />
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">
              Vazio = mantém os prazos originais e divide igual. Com valor, conta o que a
              pessoa já tem agendado e reagenda os prazos em dias úteis a partir de hoje.
            </p>

            <Button
              className="w-full"
              disabled={applying || totalSelected === 0 || selectedTargets.size === 0}
              onClick={handleApply}
            >
              {applying && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {totalSelected > 0 && selectedTargets.size > 0
                ? `Redistribuir ${totalSelected} atividade${totalSelected !== 1 ? 's' : ''} para ${selectedTargets.size} pessoa${selectedTargets.size !== 1 ? 's' : ''}`
                : 'Redistribuir'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
