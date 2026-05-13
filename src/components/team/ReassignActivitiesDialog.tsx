import { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { Loader2, AlertTriangle, ArrowRight, Filter, Check, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';

interface MemberLite {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface ReassignActivitiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberLite | null;
  candidates: MemberLite[]; // outros membros para reatribuir
  onConfirm: () => Promise<void> | void; // remoção do membro
}

type StatusFilter = 'pendente' | 'concluida' | 'all';

export function ReassignActivitiesDialog({ open, onOpenChange, member, candidates, onConfirm }: ReassignActivitiesDialogProps) {
  const { types } = useActivityTypes();
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [extUserId, setExtUserId] = useState<string | null>(null);
  const [allCount, setAllCount] = useState(0);
  const [matchCount, setMatchCount] = useState(0);

  const [mode, setMode] = useState<'all' | 'filtered'>('filtered');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pendente');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [dateField, setDateField] = useState<'deadline' | 'created_at'>('deadline');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [targetUserId, setTargetUserId] = useState<string>('');
  const [skipReassign, setSkipReassign] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setMode('filtered');
      setStatusFilter('pendente');
      setTypeFilter([]);
      setDateField('deadline');
      setDateFrom('');
      setDateTo('');
      setTargetUserId('');
      setSkipReassign(false);
    }
  }, [open]);

  // Resolve ext user_id e contagem total
  useEffect(() => {
    if (!open || !member) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      await ensureRemapCache();
      const ext = await remapToExternal(member.user_id);
      if (cancelled) return;
      setExtUserId(ext);
      if (ext) {
        const { count } = await externalSupabase
          .from('lead_activities')
          .select('id', { count: 'exact', head: true })
          .is('deleted_at', null)
          .eq('assigned_to', ext);
        if (!cancelled) setAllCount(count ?? 0);
      } else {
        setAllCount(0);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, member]);

  const buildQuery = useCallback(() => {
    if (!extUserId) return null;
    let q = externalSupabase
      .from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('assigned_to', extUserId);

    if (mode === 'filtered') {
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (typeFilter.length === 1) q = q.eq('activity_type', typeFilter[0]);
      else if (typeFilter.length > 1) q = q.in('activity_type', typeFilter);
      if (dateFrom) q = q.gte(dateField, dateFrom);
      if (dateTo) q = q.lte(dateField, dateTo);
    }
    return q;
  }, [extUserId, mode, statusFilter, typeFilter, dateField, dateFrom, dateTo]);

  // Recalcular contagem do filtro
  useEffect(() => {
    if (!open || !extUserId) return;
    let cancelled = false;
    (async () => {
      const q = buildQuery();
      if (!q) return;
      const { count } = await q;
      if (!cancelled) setMatchCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [open, extUserId, buildQuery]);

  const targetCandidates = useMemo(
    () => candidates.filter((c) => c.user_id !== member?.user_id),
    [candidates, member]
  );

  const toggleType = (key: string) => {
    setTypeFilter((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  const handleSubmit = async () => {
    if (!member || !extUserId) return;
    const needsReassign = matchCount > 0 && !skipReassign;

    if (needsReassign && !targetUserId) {
      toast.error('Selecione um membro para receber as atividades.');
      return;
    }

    setWorking(true);
    try {
      if (needsReassign && targetUserId) {
        const targetExt = await remapToExternal(targetUserId);
        if (!targetExt) throw new Error('Não foi possível mapear o membro destino.');
        const target = targetCandidates.find((c) => c.user_id === targetUserId);

        // Buscar IDs (Supabase update com .in evita problemas de or/range)
        let idsQuery = externalSupabase
          .from('lead_activities')
          .select('id')
          .is('deleted_at', null)
          .eq('assigned_to', extUserId);
        if (mode === 'filtered') {
          if (statusFilter !== 'all') idsQuery = idsQuery.eq('status', statusFilter);
          if (typeFilter.length === 1) idsQuery = idsQuery.eq('activity_type', typeFilter[0]);
          else if (typeFilter.length > 1) idsQuery = idsQuery.in('activity_type', typeFilter);
          if (dateFrom) idsQuery = idsQuery.gte(dateField, dateFrom);
          if (dateTo) idsQuery = idsQuery.lte(dateField, dateTo);
        }
        const { data: rows, error: idsErr } = await idsQuery;
        if (idsErr) throw idsErr;
        const ids = (rows ?? []).map((r: any) => r.id);

        if (ids.length > 0) {
          // Updates em lotes de 500
          const chunkSize = 500;
          for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const { error: upErr } = await externalSupabase
              .from('lead_activities')
              .update({
                assigned_to: targetExt,
                assigned_to_name: target?.full_name || target?.email || null,
              })
              .in('id', chunk);
            if (upErr) throw upErr;
          }
          toast.success(`${ids.length} atividade(s) reatribuída(s).`);
        }
      }

      await onConfirm();
      onOpenChange(false);
    } catch (e: any) {
      console.error('[ReassignActivities] erro:', e);
      toast.error('Erro ao reatribuir/remover: ' + (e.message || 'desconhecido'));
    } finally {
      setWorking(false);
    }
  };

  if (!member) return null;

  const memberLabel = member.full_name || member.email || 'Membro';
  const targetMember = targetCandidates.find((c) => c.user_id === targetUserId);

  return (
    <Dialog open={open} onOpenChange={(v) => !working && onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Remover {memberLabel}
          </DialogTitle>
          <DialogDescription>
            Antes de remover, escolha o que fazer com as atividades atribuídas a este membro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando atividades…
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <p>
                  Total de atividades vinculadas a <strong>{memberLabel}</strong>:{' '}
                  <Badge variant="secondary">{allCount}</Badge>
                </p>
              </div>

              {/* Modo: todas ou filtradas */}
              <div className="space-y-2">
                <Label>Quais atividades reatribuir?</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === 'filtered' ? 'default' : 'outline'}
                    onClick={() => setMode('filtered')}
                  >
                    <Filter className="h-3.5 w-3.5 mr-1" /> Por filtros
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === 'all' ? 'default' : 'outline'}
                    onClick={() => setMode('all')}
                  >
                    Todas ({allCount})
                  </Button>
                </div>
              </div>

              {mode === 'filtered' && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Status</Label>
                      <Select value={statusFilter} onValueChange={(v: StatusFilter) => setStatusFilter(v)}>
                        <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent className="z-[200]">
                          <SelectItem value="pendente">Pendentes</SelectItem>
                          <SelectItem value="concluida">Concluídas</SelectItem>
                          <SelectItem value="all">Todos os status</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Tipos</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 w-full justify-start font-normal mt-1">
                            {typeFilter.length === 0 ? 'Todos os tipos' : `${typeFilter.length} selecionado(s)`}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2 z-[200]" align="start">
                          <div className="space-y-1 max-h-60 overflow-y-auto">
                            {types.map((t) => (
                              <label key={t.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer text-sm">
                                <Checkbox
                                  checked={typeFilter.includes(t.key)}
                                  onCheckedChange={() => toggleType(t.key)}
                                />
                                <span>{t.label}</span>
                              </label>
                            ))}
                          </div>
                          {typeFilter.length > 0 && (
                            <Button variant="ghost" size="sm" className="w-full mt-1 h-7" onClick={() => setTypeFilter([])}>
                              Limpar
                            </Button>
                          )}
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Campo de data</Label>
                      <Select value={dateField} onValueChange={(v: any) => setDateField(v)}>
                        <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent className="z-[200]">
                          <SelectItem value="deadline">Prazo</SelectItem>
                          <SelectItem value="created_at">Criação</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">De</Label>
                      <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Até</Label>
                      <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 mt-1" />
                    </div>
                  </div>

                  <p className="text-sm">
                    Resultado:{' '}
                    <Badge variant={matchCount > 0 ? 'default' : 'secondary'}>{matchCount}</Badge> atividade(s) selecionada(s)
                  </p>
                </div>
              )}

              {/* Destino */}
              {(mode === 'all' ? allCount : matchCount) > 0 && !skipReassign && (
                <div className="space-y-2">
                  <Label>Reatribuir para</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                        {targetMember ? (
                          <span className="flex flex-col items-start min-w-0">
                            <span className="truncate">{targetMember.full_name || targetMember.email}</span>
                            {targetMember.full_name && targetMember.email && (
                              <span className="text-xs text-muted-foreground truncate">{targetMember.email}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Selecione um membro…</span>
                        )}
                        <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0 z-[200]" align="start">
                      <Command
                        filter={(value, search) => {
                          // value já é "nome email" lowercased
                          return value.includes(search.toLowerCase()) ? 1 : 0;
                        }}
                      >
                        <CommandInput placeholder="Buscar por nome ou email…" />
                        <CommandList>
                          <CommandEmpty>Nenhum membro encontrado.</CommandEmpty>
                          <CommandGroup>
                            {targetCandidates.map((c) => {
                              const name = c.full_name || '';
                              const email = c.email || '';
                              return (
                                <CommandItem
                                  key={c.user_id}
                                  value={`${name} ${email}`.toLowerCase()}
                                  onSelect={() => setTargetUserId(c.user_id)}
                                  className="flex items-center justify-between gap-2"
                                >
                                  <div className="flex flex-col min-w-0">
                                    <span className="truncate">{name || email}</span>
                                    {name && email && (
                                      <span className="text-xs text-muted-foreground truncate">{email}</span>
                                    )}
                                  </div>
                                  {targetUserId === c.user_id && <Check className="h-4 w-4 shrink-0" />}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  {targetMember && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{memberLabel}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">
                        {targetMember.full_name || targetMember.email}
                        {targetMember.full_name && targetMember.email && (
                          <span className="text-muted-foreground font-normal"> · {targetMember.email}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {(mode === 'all' ? allCount : matchCount) > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={skipReassign} onCheckedChange={(v) => setSkipReassign(!!v)} />
                  Não reatribuir (manter atividades como estão e apenas remover o membro)
                </label>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={working || loading}>
            {working ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Processando…</> : 'Reatribuir e remover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
