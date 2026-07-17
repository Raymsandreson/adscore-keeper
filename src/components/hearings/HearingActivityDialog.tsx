import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { db, authClient } from '@/integrations/supabase';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useProfilesList } from '@/hooks/useProfilesList';
import type { Hearing } from '@/hooks/useHearings';
import { Loader2, Search, CheckCircle2, AlertTriangle, Briefcase, FileText, CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';

interface CaseHit {
  id: string;
  case_number: string | null;
  title: string | null;
  lead_id: string | null;
}

interface ProcessHit {
  id: string;
  process_number: string | null;
  title: string | null;
  case_id: string | null;
  lead_id: string | null;
  workflow_id: string | null;
}

interface Snapshot {
  case_ref: string;
  process_number: string;
  hearing_type: string;
  hearing_date: string;
  hearing_time: string;
  timezone_label: string;
  location: string;
  notes: string;
  assigned_user_id: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hearing: Hearing;
  snapshot: Snapshot;
}

/**
 * Confirma o vínculo caso/processo de uma audiência e cria a atividade
 * (lead_activities, activity_type 'audiencia') pré-preenchida com os dados dela.
 */
export function HearingActivityDialog({ open, onOpenChange, hearing, snapshot }: Props) {
  const qc = useQueryClient();
  const profiles = useProfilesList();
  const [resolving, setResolving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [caso, setCaso] = useState<CaseHit | null>(null);
  const [processo, setProcesso] = useState<ProcessHit | null>(null);
  const [leadName, setLeadName] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<CaseHit[]>([]);
  const [searching, setSearching] = useState(false);

  const cnj = snapshot.process_number.trim();

  const fetchLeadName = async (leadId: string | null | undefined) => {
    if (!leadId) return null;
    const { data } = await (db as any).from('leads').select('lead_name').eq('id', leadId).maybeSingle();
    return data?.lead_name || null;
  };

  const fetchCaseById = async (id: string): Promise<CaseHit | null> => {
    const { data } = await (db as any).from('legal_cases')
      .select('id, case_number, title, lead_id').eq('id', id).maybeSingle();
    return (data as CaseHit) || null;
  };

  const fetchProcessesOfCase = async (caseId: string): Promise<ProcessHit[]> => {
    const { data } = await (db as any).from('lead_processes')
      .select('id, process_number, title, case_id, lead_id, workflow_id')
      .eq('case_id', caseId).limit(10);
    return (data as ProcessHit[]) || [];
  };

  // Resolução automática: legal_case_id salvo > CNJ em lead_processes > case_ref em legal_cases
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setResolving(true);
      setSearchMode(false);
      setSearch('');
      setSearchResults([]);
      try {
        let proc: ProcessHit | null = null;
        let hit: CaseHit | null = null;

        if (cnj) {
          const { data } = await (db as any).from('lead_processes')
            .select('id, process_number, title, case_id, lead_id, workflow_id')
            .eq('process_number', cnj).limit(1);
          proc = (data?.[0] as ProcessHit) || null;
        }

        if (hearing.legal_case_id) hit = await fetchCaseById(hearing.legal_case_id);
        if (!hit && proc?.case_id) hit = await fetchCaseById(proc.case_id);

        if (!hit) {
          const num = (snapshot.case_ref.match(/\d{1,8}/) || [])[0];
          if (num) {
            const { data } = await (db as any).from('legal_cases')
              .select('id, case_number, title, lead_id')
              .ilike('case_number', `%${num}%`).limit(10);
            const cands = (data as CaseHit[]) || [];
            // Match exato pelos dígitos ("207" não pode casar com "1207")
            hit = cands.find((c) => (c.case_number || '').replace(/\D/g, '') === num)
              || (cands.length === 1 ? cands[0] : null);
          }
        }

        // Caso achado mas processo não: tenta os processos do caso (preferindo o CNJ da audiência)
        if (hit && !proc) {
          const procs = await fetchProcessesOfCase(hit.id);
          proc = procs.find((p) => (p.process_number || '').trim() === cnj) || procs[0] || null;
        }

        const ln = await fetchLeadName(hit?.lead_id || proc?.lead_id);
        if (!cancelled) {
          setCaso(hit);
          setProcesso(proc);
          setLeadName(ln);
        }
      } catch (e) {
        console.error('[HearingActivityDialog] resolve error', e);
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const runSearch = async () => {
    const q = search.trim().replace(/[,()]/g, ' ');
    if (q.length < 2) return;
    setSearching(true);
    try {
      const { data } = await (db as any).from('legal_cases')
        .select('id, case_number, title, lead_id')
        .or(`case_number.ilike.%${q}%,title.ilike.%${q}%`)
        .limit(10);
      setSearchResults((data as CaseHit[]) || []);
    } catch (e: any) {
      toast.error('Falha na busca', { description: e?.message });
    } finally {
      setSearching(false);
    }
  };

  const pickCase = async (c: CaseHit) => {
    setCaso(c);
    setSearchMode(false);
    const procs = await fetchProcessesOfCase(c.id);
    const proc = procs.find((p) => (p.process_number || '').trim() === cnj) || procs[0] || null;
    setProcesso(proc);
    setLeadName(await fetchLeadName(c.lead_id || proc?.lead_id));
  };

  const assignedProfile = useMemo(
    () => profiles.find((p) => p.user_id === snapshot.assigned_user_id) || null,
    [profiles, snapshot.assigned_user_id]
  );

  const canCreate = !!(caso || processo);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { data: userData } = await authClient.auth.getUser();
      const cloudUserId = userData?.user?.id || null;
      const extUserId = await remapToExternal(cloudUserId);
      const extAssignedTo = await remapToExternal(snapshot.assigned_user_id || cloudUserId);

      const time = (snapshot.hearing_time || '09:00').slice(0, 5);
      const deadlineIso = new Date(`${snapshot.hearing_date}T${time}:00`).toISOString();
      const dataBR = snapshot.hearing_date.split('-').reverse().join('/');

      const descLines = [
        `Audiência: ${snapshot.hearing_type || '—'}`,
        `Data/hora: ${dataBR} às ${time} (${snapshot.timezone_label || 'fuso não informado'})`,
        snapshot.location ? `Local: ${snapshot.location}` : null,
        cnj ? `Processo: ${cnj}` : null,
        caso?.case_number ? `Caso: ${caso.case_number}` : null,
        snapshot.notes ? `Observações: ${snapshot.notes}` : null,
      ].filter(Boolean).join('\n');

      const { error } = await externalSupabase
        .from('lead_activities')
        .insert({
          title: `Audiência ${snapshot.hearing_type || ''} ${dataBR} ${time}`.replace(/\s+/g, ' ').trim(),
          activity_type: 'audiencia',
          status: 'pendente',
          priority: 'normal',
          lead_id: caso?.lead_id || processo?.lead_id || null,
          lead_name: leadName,
          case_id: caso?.id || null,
          case_title: caso ? (caso.title || caso.case_number) : null,
          process_id: processo?.id || null,
          process_title: processo?.title || cnj || null,
          workflow_id: processo?.workflow_id || null,
          description: descLines,
          deadline: deadlineIso,
          notification_date: deadlineIso,
          assigned_to: extAssignedTo,
          assigned_to_name: assignedProfile?.full_name || assignedProfile?.email || null,
          created_by: extUserId,
        } as any);
      if (error) throw error;

      // Persiste o vínculo na audiência pra próxima vez já vir resolvido
      await (db as any).from('hearings')
        .update({ legal_case_id: caso?.id || null, lead_id: caso?.lead_id || processo?.lead_id || null })
        .eq('id', hearing.id);
      qc.invalidateQueries({ queryKey: ['hearings'] });

      toast.success('Atividade criada', {
        description: `Audiência ${dataBR} ${time} vinculada a ${caso?.case_number || cnj || 'processo'}.`,
      });
      onOpenChange(false);
    } catch (e: any) {
      console.error('[HearingActivityDialog] create error', e);
      toast.error('Falha ao criar atividade', { description: e?.message });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5" /> Criar atividade da audiência
          </DialogTitle>
        </DialogHeader>

        {resolving ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Localizando caso e processo...
          </div>
        ) : (
          <div className="space-y-3">
            {/* Caso */}
            <div className={`rounded-lg border p-3 ${caso ? 'border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-900/10'}`}>
              <div className="flex items-center gap-2 text-sm font-medium mb-1">
                <Briefcase className="h-4 w-4" />
                Caso
                {caso ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
              </div>
              {caso ? (
                <div className="text-sm">
                  <Badge variant="outline" className="mr-2">{caso.case_number}</Badge>
                  {caso.title || <span className="text-muted-foreground">sem título</span>}
                  {leadName && <div className="text-xs text-muted-foreground mt-1">Cliente: {leadName}</div>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum caso encontrado para "{snapshot.case_ref || cnj || 'esta audiência'}". Associe manualmente abaixo.
                </p>
              )}
              <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={() => setSearchMode((v) => !v)}>
                <Search className="h-3 w-3 mr-1" /> {caso ? 'Trocar caso' : 'Buscar caso'}
              </Button>
              {searchMode && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      placeholder="CASO 207, nome do cliente, título..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                      className="h-8"
                    />
                    <Button size="sm" className="h-8" onClick={runSearch} disabled={searching}>
                      {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Buscar'}
                    </Button>
                  </div>
                  {searchResults.length > 0 && (
                    <div className="max-h-40 overflow-auto rounded border divide-y">
                      {searchResults.map((c) => (
                        <button
                          key={c.id}
                          className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted/60"
                          onClick={() => pickCase(c)}
                        >
                          <span className="font-medium mr-2">{c.case_number}</span>
                          <span className="text-muted-foreground">{c.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Processo */}
            <div className={`rounded-lg border p-3 ${processo ? 'border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-muted'}`}>
              <div className="flex items-center gap-2 text-sm font-medium mb-1">
                <FileText className="h-4 w-4" />
                Processo
                {processo && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              </div>
              {processo ? (
                <div className="text-sm">
                  <span className="font-mono text-xs">{processo.process_number || 'sem CNJ'}</span>
                  {processo.title && <div className="text-xs text-muted-foreground mt-0.5">{processo.title}</div>}
                  {cnj && processo.process_number && processo.process_number.trim() !== cnj && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Número difere do informado na audiência ({cnj}) — confira antes de criar.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {cnj
                    ? `Nenhum processo cadastrado com o número ${cnj}. A atividade será criada só com o vínculo do caso.`
                    : 'Audiência sem número de processo.'}
                </p>
              )}
            </div>

            {/* Resumo da atividade */}
            <div className="rounded-lg border p-3 text-xs text-muted-foreground space-y-0.5">
              <div><Label className="text-xs">A atividade será criada com:</Label></div>
              <div>Tipo: <span className="text-foreground">Audiência</span> · Prazo/notificação: <span className="text-foreground">{snapshot.hearing_date.split('-').reverse().join('/')} {(snapshot.hearing_time || '').slice(0, 5)}</span></div>
              <div>Responsável: <span className="text-foreground">{assignedProfile?.full_name || assignedProfile?.email || 'você (sem membro associado)'}</span></div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={!canCreate || creating || resolving}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
            Confirmar e criar atividade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
