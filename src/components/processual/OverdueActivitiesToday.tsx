import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { useProfilesList } from '@/hooks/useProfilesList';
import { filterAssignableMembers, ASSIGNEE_BLOCKLIST } from '@/lib/assigneeBlocklist';
import { remapToCloudSync, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Loader2, RefreshCw, UserRound, CheckCircle2, Clock, MessageSquare, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface OverdueActivity {
  id: string;
  title: string;
  activity_type: string | null;
  status: string;
  priority: string | null;
  deadline: string | null;
  updated_at: string | null;
  created_at: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  lead_name: string | null;
  lead_id: string | null;
  current_status_notes: string | null;
}

interface TodayChatMessage {
  activity_id: string;
  content: string | null;
  message_type: string;
  created_at: string;
  sender_name: string | null;
}

// Classificação do dia: atualizada com motivo registrado, atualizada sem motivo, ou sem atualização.
type UpdateState = 'com_motivo' | 'sem_motivo' | 'sem_atualizacao';

interface ActivityRow extends OverdueActivity {
  updateState: UpdateState;
  updateAt: string | null;
  motivo: string | null;
}

const SEM_RESPONSAVEL = 'Sem responsável';

export function OverdueActivitiesToday() {
  const navigate = useNavigate();
  const profiles = useProfilesList();
  const [items, setItems] = useState<OverdueActivity[]>([]);
  const [chatToday, setChatToday] = useState<TodayChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [author, setAuthor] = useState<string>('all');
  // Linhas visíveis por grupo — dados vêm completos, mas grupos gigantes ("Sem responsável"
  // passa de 5 mil) não podem ir todos pro DOM de uma vez.
  const GROUP_BATCH = 30;
  const [groupLimits, setGroupLimits] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    try {
      await ensureRemapCache();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Todas as vencidas não concluídas, sem teto (blocos de 1000, limite do PostgREST)
      const PAGE = 1000;
      const all: OverdueActivity[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data } = await externalSupabase
          .from('lead_activities')
          .select('id, title, activity_type, status, priority, deadline, updated_at, created_at, assigned_to, assigned_to_name, lead_name, lead_id, current_status_notes')
          .is('deleted_at', null)
          .neq('status', 'concluida')
          .not('deadline', 'is', null)
          .lt('deadline', todayStart.toISOString())
          .order('deadline', { ascending: false })
          .range(from, from + PAGE - 1);
        const chunk = (data || []) as OverdueActivity[];
        all.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      // Esconde atividades de usuários que também estão fora do seletor de Assessor (blocklist).
      const filteredAll = all.filter((a) => {
        if (!a.assigned_to) return true;
        const cloudId = remapToCloudSync(a.assigned_to) || a.assigned_to;
        return !ASSIGNEE_BLOCKLIST.has(cloudId);
      });
      setItems(filteredAll);

      // Mensagens de chat de atividade postadas hoje — servem de "motivo" do atraso
      const { data: msgs } = await externalSupabase
        .from('activity_chat_messages')
        .select('activity_id, content, message_type, created_at, sender_name')
        .is('deleted_at', null)
        .not('activity_id', 'is', null)
        .gte('created_at', todayStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(1000);
      setChatToday((msgs || []) as TodayChatMessage[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const authors = useMemo(() => {
    const set = new Set<string>();
    // Mesma lista da tela de Atividades: perfis do Cloud filtrados pelo blocklist de assessores.
    filterAssignableMembers(profiles).forEach((p) => {
      const name = p.full_name?.trim() || p.email?.split('@')[0]?.trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [profiles]);

  // Última mensagem de hoje por atividade (a query já vem ordenada desc)
  const chatByActivity = useMemo(() => {
    const map = new Map<string, TodayChatMessage>();
    chatToday.forEach((m) => { if (!map.has(m.activity_id)) map.set(m.activity_id, m); });
    return map;
  }, [chatToday]);

  const rows: ActivityRow[] = useMemo(() => {
    return items.map((a) => {
      const updatedToday = !!a.updated_at && new Date(a.updated_at) >= todayStart;
      const chatMsg = chatByActivity.get(a.id) || null;
      const motivo = chatMsg
        ? (chatMsg.content?.trim() || `(${chatMsg.message_type === 'audio' ? 'áudio' : 'anexo'} no chat)`)
        : (updatedToday && a.current_status_notes?.trim() ? a.current_status_notes.trim() : null);
      const hasUpdate = updatedToday || !!chatMsg;
      const updateState: UpdateState = !hasUpdate ? 'sem_atualizacao' : (motivo ? 'com_motivo' : 'sem_motivo');
      const updateAt = chatMsg?.created_at || (updatedToday ? a.updated_at : null);
      return { ...a, updateState, updateAt, motivo };
    });
  }, [items, chatByActivity, todayStart]);

  const filtered = useMemo(() => {
    if (author === 'all') return rows;
    if (author === '__none__') return rows.filter((i) => !i.assigned_to_name);
    return rows.filter((i) => i.assigned_to_name === author);
  }, [rows, author]);

  // Agrupamento por responsável, maiores ofensores primeiro
  const groups = useMemo(() => {
    const map = new Map<string, ActivityRow[]>();
    filtered.forEach((r) => {
      const key = r.assigned_to_name?.trim() || SEM_RESPONSAVEL;
      const list = map.get(key) || [];
      list.push(r);
      map.set(key, list);
    });
    return Array.from(map.entries())
      .map(([name, list]) => ({
        name,
        list,
        comMotivo: list.filter((r) => r.updateState === 'com_motivo').length,
        semMotivo: list.filter((r) => r.updateState === 'sem_motivo').length,
        semAtualizacao: list.filter((r) => r.updateState === 'sem_atualizacao').length,
      }))
      .sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name, 'pt-BR'));
  }, [filtered]);

  const totals = useMemo(() => ({
    comMotivo: filtered.filter((r) => r.updateState === 'com_motivo').length,
    semMotivo: filtered.filter((r) => r.updateState === 'sem_motivo').length,
    semAtualizacao: filtered.filter((r) => r.updateState === 'sem_atualizacao').length,
  }), [filtered]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 rounded-md border bg-card p-1.5 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">
                Atividades atrasadas — hoje
              </CardTitle>
              <CardDescription className="text-xs">
                Não concluídas com prazo vencido, por responsável. Atualização do dia e motivo do atraso.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <UserRound className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Filtrar responsável…"
                className="h-8 w-[220px] pl-7 pr-7 text-xs"
              />
              {author && (
                <button
                  type="button"
                  onClick={() => setAuthor('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Limpar filtro"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <Badge variant="outline" className="gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {filtered.length} atrasada{filtered.length === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            {totals.comMotivo} atualizada{totals.comMotivo === 1 ? '' : 's'} com motivo
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <MessageSquare className="h-3 w-3 text-amber-600" />
            {totals.semMotivo} atualizada{totals.semMotivo === 1 ? '' : 's'} sem motivo
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <Clock className="h-3 w-3 text-muted-foreground" />
            {totals.semAtualizacao} sem atualização hoje
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma atividade atrasada no filtro atual.
          </div>
        ) : (
          <ScrollArea type="always" className="h-[560px] [&_[data-radix-scroll-area-thumb]]:bg-muted-foreground/50 [&_[data-radix-scroll-area-scrollbar]]:w-3">
            {groups.map((g) => (
              <div key={g.name}>
                <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-y bg-muted/80 px-3 py-1.5 backdrop-blur">
                  <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className={cn('text-xs font-semibold', g.name === SEM_RESPONSAVEL && 'italic text-muted-foreground')}>
                    {g.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {g.list.length} atrasada{g.list.length === 1 ? '' : 's'}
                    {' · '}{g.comMotivo} com motivo
                    {' · '}{g.semMotivo} sem motivo
                    {' · '}{g.semAtualizacao} sem atualização
                  </span>
                </div>
                <table className="w-full text-xs">
                  <tbody className="divide-y">
                    {g.list.slice(0, groupLimits[g.name] ?? GROUP_BATCH).map((a) => {
                      // deadline é DATE ("2026-07-10"): parseISO dá meia-noite local;
                      // new Date() daria meia-noite UTC e exibiria o dia anterior no fuso -03.
                      const dl = a.deadline ? parseISO(a.deadline) : null;
                      const daysLate = dl
                        ? Math.max(0, Math.floor((todayStart.getTime() - dl.getTime()) / 86400000))
                        : 0;
                      return (
                        <tr
                          key={a.id}
                          onClick={() => navigate(`/?openActivity=${a.id}`)}
                          className="cursor-pointer transition-colors hover:bg-muted/40"
                        >
                          <td className="w-[38%] px-3 py-2 align-top">
                            <div className="font-medium text-foreground line-clamp-1">{a.title}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                              {a.activity_type && <Badge variant="outline" className="text-[10px]">{a.activity_type}</Badge>}
                              <Badge variant="secondary" className="text-[10px] capitalize">{a.status}</Badge>
                              {a.lead_name && <span className="truncate">Lead: {a.lead_name}</span>}
                            </div>
                          </td>
                          <td className="w-[17%] px-3 py-2 align-top">
                            {a.updateState === 'com_motivo' ? (
                              <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" />
                                Com motivo
                                {a.updateAt && (
                                  <span className="ml-1 text-[10px] opacity-70">
                                    {format(new Date(a.updateAt), 'HH:mm', { locale: ptBR })}
                                  </span>
                                )}
                              </Badge>
                            ) : a.updateState === 'sem_motivo' ? (
                              <Badge className="gap-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400">
                                <MessageSquare className="h-3 w-3" />
                                Sem motivo
                                {a.updateAt && (
                                  <span className="ml-1 text-[10px] opacity-70">
                                    {format(new Date(a.updateAt), 'HH:mm', { locale: ptBR })}
                                  </span>
                                )}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-muted-foreground">
                                <AlertTriangle className="h-3 w-3 text-red-500" />
                                Sem atualização
                              </Badge>
                            )}
                          </td>
                          <td className="w-[30%] px-3 py-2 align-top">
                            {a.motivo ? (
                              <span className="line-clamp-2 text-muted-foreground" title={a.motivo}>
                                {a.motivo}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                          <td className="w-[15%] px-3 py-2 align-top">
                            {dl ? (
                              <div className="flex flex-col">
                                <span className="tabular-nums">{format(dl, 'dd/MM/yyyy', { locale: ptBR })}</span>
                                <span className="text-[10px] text-red-600">
                                  {daysLate === 0 ? 'vence hoje' : `${daysLate}d atrasada`}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {g.list.length > (groupLimits[g.name] ?? GROUP_BATCH) && (
                  <div className="border-t px-3 py-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-full text-xs text-muted-foreground"
                      onClick={() =>
                        setGroupLimits((prev) => ({
                          ...prev,
                          [g.name]: (prev[g.name] ?? GROUP_BATCH) + 100,
                        }))
                      }
                    >
                      Mostrar mais ({(g.list.length - (groupLimits[g.name] ?? GROUP_BATCH)).toLocaleString('pt-BR')} restantes)
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
