import { useState, useEffect, useMemo, useCallback } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowRightLeft, AlertTriangle, Check } from 'lucide-react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { ensureRemapCache, remapToExternal } from '@/integrations/supabase/uuid-remap';
import { currentExtUserId } from '@/lib/currentExtUser';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
import { logAudit } from '@/hooks/useAuditLog';
import { LeadActivity } from '@/hooks/useLeadActivities';
import { toast } from 'sonner';

interface Member {
  user_id: string;
  full_name: string | null;
}

/** Chave do índice único lead_activities_dedup_pending_idx, sem o dono. */
const dedupKey = (a: Pick<LeadActivity, 'lead_id' | 'title' | 'activity_type'>) =>
  `${a.lead_id}|${(a.title || '').trim().toLowerCase()}|${a.activity_type}`;

/** Atividade viva conta para o índice; concluída/deletada fica de fora dele. */
const contaNoDedup = (a: { status: string; lead_id: string | null }) =>
  a.status === 'pendente' && !!a.lead_id;

export type Plano = {
  mover: LeadActivity[];
  puladas: { a: LeadActivity; motivo: string }[];
  jaSao: LeadActivity[];
  concluidas: LeadActivity[];
};

/**
 * Divide as selecionadas entre o que muda de dono, o que já é do destino, o que
 * é concluída (não se reescreve) e o que colidiria no índice único.
 *
 * `ocupadas` = chaves dedup das pendentes que o destino JÁ tem (varridas no
 * banco, não só o que está na tela). Função pura para poder ser testada — é
 * aqui que um erro vira 23505 no meio do lote.
 */
export function montarPlano(
  activities: LeadActivity[],
  destExt: string,
  ocupadas: Set<string>,
  destNome = 'destino',
): Plano {
  const concluidas = activities.filter(a => a.status === 'concluida');
  const vivas = activities.filter(a => a.status !== 'concluida');
  const jaSao = vivas.filter(a => a.assigned_to === destExt);
  const candidatas = vivas.filter(a => a.assigned_to !== destExt);

  const mover: LeadActivity[] = [];
  const puladas: { a: LeadActivity; motivo: string }[] = [];
  const noLote = new Set<string>();
  // Empate entre duas selecionadas iguais: fica a mais antiga.
  const ordenadas = [...candidatas].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  for (const a of ordenadas) {
    if (!contaNoDedup(a)) { mover.push(a); continue; }
    const k = dedupKey(a);
    if (ocupadas.has(k)) {
      puladas.push({ a, motivo: `já existe uma pendente igual na fila de ${destNome}` });
      continue;
    }
    if (noLote.has(k)) {
      puladas.push({ a, motivo: 'outra selecionada igual (mesmo lead, título e tipo) já vai neste lote' });
      continue;
    }
    noLote.add(k);
    mover.push(a);
  }
  return { mover, puladas, jaSao, concluidas };
}

/**
 * Passa um lote de atividades selecionadas na lista para outro assessor.
 *
 * Três coisas que este fluxo não pode errar:
 *  - `lead_activities_dedup_pending_idx` é UNIQUE parcial em
 *    (lead_id, lower(btrim(title)), activity_type, coalesce(assigned_to,'000…'))
 *    para status='pendente'. Um `update ... in (ids)` que colida estoura 23505 e
 *    derruba o lote inteiro — então as colisões são detectadas ANTES e puladas,
 *    com relatório na tela (mesma política da RPC aplicar_responsavel_do_caso).
 *  - `assigned_to` guarda o UUID do **Externo**; `teamMembers` vem do profiles do
 *    **Cloud**. Sem o remap o destino grava lixo ou null.
 *  - sem `updated_by` explícito o lote vira "atualizada por —" (a sessão do
 *    Externo é anônima e nenhum trigger de lá descobre o autor).
 *
 * Concluída não é reatribuída: ela registra quem executou o trabalho.
 */
export function BulkReassignSheet({
  open,
  onOpenChange,
  activities,
  teamMembers,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** As atividades marcadas na lista (objetos completos). */
  activities: LeadActivity[];
  /** Equipe do Cloud (user_id = cloud uuid). */
  teamMembers: Member[];
  /** Chamado depois de aplicar: a página recarrega e limpa a seleção. */
  onApplied: () => void;
}) {
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [plano, setPlano] = useState<Plano | null>(null);

  const assignable = useMemo(
    () => filterAssignableMembers([...teamMembers]).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')),
    [teamMembers],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignable;
    return assignable.filter(m => (m.full_name || '').toLowerCase().includes(q));
  }, [assignable, search]);

  const target = useMemo(
    () => assignable.find(m => m.user_id === targetId) || null,
    [assignable, targetId],
  );

  useEffect(() => {
    if (!open) {
      setSearch('');
      setTargetId(null);
      setPlano(null);
    }
  }, [open]);

  // Monta o plano assim que há destino: separa o que move, o que colide e o que
  // já é do destino. A checagem varre as pendentes do destino nos MESMOS leads —
  // a colisão pode vir de uma atividade que nem está na tela.
  useEffect(() => {
    if (!open || !targetId) { setPlano(null); return; }
    let cancelled = false;
    (async () => {
      setChecking(true);
      try {
        await ensureExternalSession();
        await ensureRemapCache();
        const destExt = await remapToExternal(targetId);
        if (!destExt) {
          if (!cancelled) {
            setPlano(null);
            toast.error('Esta pessoa não tem correspondência no banco de atividades — não dá para passar para ela.');
          }
          return;
        }

        // Pendentes que o destino já tem nos leads envolvidos = colisão externa.
        const leadIds = [...new Set(
          activities
            .filter(a => a.status !== 'concluida' && a.assigned_to !== destExt && contaNoDedup(a))
            .map(a => a.lead_id!),
        )];
        const ocupadas = new Set<string>();
        const PAGE = 1000;
        for (let i = 0; i < leadIds.length; i += 200) {
          const slice = leadIds.slice(i, i + 200);
          for (let from = 0; ; from += PAGE) {
            const { data, error } = await (externalSupabase as any)
              .from('lead_activities')
              .select('id, lead_id, title, activity_type')
              .is('deleted_at', null)
              .eq('status', 'pendente')
              .eq('assigned_to', destExt)
              .in('lead_id', slice)
              .range(from, from + PAGE - 1);
            if (error) throw error;
            const rows = (data as any[]) || [];
            rows.forEach(r => ocupadas.add(dedupKey(r)));
            if (rows.length < PAGE) break;
          }
        }

        if (!cancelled) {
          setPlano(montarPlano(activities, destExt, ocupadas, target?.full_name || 'destino'));
        }
      } catch (e: any) {
        console.error('[BulkReassign] checagem falhou:', e);
        if (!cancelled) {
          setPlano(null);
          toast.error(e?.message || 'Erro ao conferir as atividades');
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // target?.full_name só compõe texto; targetId é a dependência real.
  }, [open, targetId, activities]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApply = useCallback(async () => {
    if (!plano || !target || plano.mover.length === 0) return;
    setApplying(true);
    try {
      await ensureExternalSession();
      await ensureRemapCache();
      const destExt = await remapToExternal(target.user_id);
      if (!destExt) throw new Error('Destino sem correspondência no banco de atividades');
      const actorExt = await currentExtUserId();
      const destNome = target.full_name || 'Sem nome';
      const now = new Date().toISOString();

      // Sem co-assessores o patch é idêntico para todas → um update por bloco.
      // Com array, cada uma tem o seu (preserva os demais assessores).
      const simples: string[] = [];
      const individuais: { id: string; patch: Record<string, any> }[] = [];
      for (const a of plano.mover) {
        const ids = a.assigned_to_ids || [];
        const nomes = a.assigned_to_names || [];
        if (ids.length === 0) { simples.push(a.id); continue; }
        const novosIds = ids.slice();
        const novosNomes = nomes.slice();
        const idx = novosIds.indexOf(a.assigned_to || '');
        if (idx >= 0) {
          if (novosIds.includes(destExt)) {
            novosIds.splice(idx, 1);
            novosNomes.splice(idx, 1);
          } else {
            novosIds[idx] = destExt;
            novosNomes[idx] = destNome;
          }
        } else if (!novosIds.includes(destExt)) {
          novosIds.unshift(destExt);
          novosNomes.unshift(destNome);
        }
        individuais.push({
          id: a.id,
          patch: {
            assigned_to: destExt,
            assigned_to_name: destNome,
            assigned_to_ids: novosIds,
            assigned_to_names: novosNomes,
            updated_at: now,
            updated_by: actorExt,
          },
        });
      }

      const patchSimples = {
        assigned_to: destExt,
        assigned_to_name: destNome,
        updated_at: now,
        updated_by: actorExt,
      };
      const CHUNK = 200;
      for (let i = 0; i < simples.length; i += CHUNK) {
        const { error } = await (externalSupabase as any)
          .from('lead_activities')
          .update(patchSimples)
          .in('id', simples.slice(i, i + CHUNK));
        if (error) throw error;
      }
      for (const { id, patch } of individuais) {
        const { error } = await (externalSupabase as any)
          .from('lead_activities')
          .update(patch)
          .eq('id', id);
        if (error) throw error;
      }

      // Um aviso por pessoa, não um por atividade. Lote de 1 usa o 'assigned'
      // de sempre (com botão de abrir); acima disso, 'assigned_bulk' sem
      // activity_id — o listener já trata tipo desconhecido e ausência de id.
      const total = plano.mover.length;
      if (destExt !== actorExt) {
        try {
          const { data: prof } = await (externalSupabase as any)
            .from('profiles').select('full_name').eq('user_id', actorExt || '').maybeSingle();
          const actorName = (prof as any)?.full_name || null;
          await (externalSupabase as any).from('activity_notifications').insert(
            total === 1
              ? {
                  activity_id: plano.mover[0].id,
                  recipient_id: destExt,
                  recipient_name: destNome,
                  type: 'assigned',
                  title: 'Atividade repassada para você',
                  body: plano.mover[0].title || 'Atividade',
                  actor_id: actorExt,
                  actor_name: actorName,
                }
              : {
                  activity_id: null,
                  recipient_id: destExt,
                  recipient_name: destNome,
                  type: 'assigned_bulk',
                  title: `${total} atividades repassadas para você`,
                  body: 'Abra a tela de Atividades para ver a sua fila.',
                  actor_id: actorExt,
                  actor_name: actorName,
                },
          );
        } catch (e) {
          console.warn('[BulkReassign] notificação falhou:', e);
        }
      }

      logAudit({
        action: 'update',
        entityType: 'reatribuicao_atividades',
        entityName: destNome,
        details: {
          para: destNome,
          total,
          ids: plano.mover.map(a => a.id),
          puladas: plano.puladas.length,
          concluidas_ignoradas: plano.concluidas.length,
        },
      });

      toast.success(
        `${total} atividade${total !== 1 ? 's' : ''} passada${total !== 1 ? 's' : ''} para ${destNome}` +
          (plano.puladas.length > 0 ? ` · ${plano.puladas.length} pulada${plano.puladas.length !== 1 ? 's' : ''}` : ''),
      );
      onOpenChange(false);
      onApplied();
    } catch (e: any) {
      console.error('[BulkReassign] aplicar falhou:', e);
      toast.error(e?.message || 'Erro ao passar as atividades');
    } finally {
      setApplying(false);
    }
  }, [plano, target, onApplied, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-4 pt-4 pb-3 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="h-4 w-4" />
            Passar {activities.length} atividade{activities.length !== 1 ? 's' : ''}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Troca o responsável das selecionadas. Concluídas ficam de fora — elas registram quem
            executou o trabalho.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1.5">Passar para</p>
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar assessor..."
              className="h-8 text-xs mb-1.5"
            />
            <div className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground p-2">Ninguém encontrado.</p>
              )}
              {filtered.map(m => (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => setTargetId(m.user_id)}
                  className={`w-full flex items-center gap-2 text-sm rounded p-1.5 text-left transition-colors ${
                    targetId === m.user_id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="flex-1 truncate">{m.full_name || 'Sem nome'}</span>
                  {targetId === m.user_id && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {checking && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Conferindo colisões na fila do destino...
            </div>
          )}

          {plano && !checking && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center gap-2 text-sm">
                <Badge className="text-[11px]">{plano.mover.length}</Badge>
                <span>vão para {target?.full_name || 'destino'}</span>
              </div>

              {plano.concluidas.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {plano.concluidas.length} concluída{plano.concluidas.length !== 1 ? 's' : ''} ficam
                  como está{plano.concluidas.length !== 1 ? 'ão' : ''}.
                </p>
              )}
              {plano.jaSao.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {plano.jaSao.length} já {plano.jaSao.length !== 1 ? 'são' : 'é'} de {target?.full_name || 'destino'}.
                </p>
              )}

              {plano.puladas.length > 0 && (
                <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-2 space-y-1">
                  <p className="text-xs font-medium flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {plano.puladas.length} pulada{plano.puladas.length !== 1 ? 's' : ''} (duplicaria
                    pendente no mesmo lead)
                  </p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {plano.puladas.map(({ a, motivo }) => (
                      <div key={a.id} className="text-[11px] leading-tight">
                        <span className="font-medium">{a.title}</span>
                        {a.lead_name && <span className="text-muted-foreground"> · {a.lead_name}</span>}
                        <div className="text-muted-foreground">{motivo}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t p-3 shrink-0">
          <Button
            className="w-full"
            disabled={applying || checking || !plano || plano.mover.length === 0}
            onClick={handleApply}
          >
            {applying && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {plano && plano.mover.length > 0
              ? `Passar ${plano.mover.length} para ${target?.full_name?.split(' ')[0] || 'destino'}`
              : 'Escolha o destino'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
