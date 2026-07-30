import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowDown, ArrowUp, Loader2, Search, Users, UserPlus, Building2 } from 'lucide-react';
import { db, authClient } from '@/integrations/supabase';
import { ensureRemapCache, remapToExternal, remapToCloudSync } from '@/integrations/supabase/uuid-remap';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  boardName: string;
  /** Só troca rótulo — funil (comercial) e POP (processual) usam o mesmo rodízio. */
  boardType?: 'funnel' | 'workflow';
}

interface PoolRow {
  id: string;
  user_id: string;          // ext uuid
  is_active: boolean;
  position: number;
  last_assigned_at: string | null;
}

interface MemberOption {
  cloud_uuid: string;
  full_name: string | null;
  email: string | null;
  role: string;
  team_name: string | null;   // time (Cloud) a que pertence
  joined_at: string | null;   // team_members.created_at — desde quando
}

interface TeamOption {
  id: string;
  name: string;
  /** cloud uuids dos membros */
  memberIds: string[];
  /** este time aponta pra este quadro (teams.board_id) */
  linkedHere: boolean;
}

/** De onde sai a lista de quem pode entrar no rodízio. */
type MemberSource = 'times' | 'todos';

export function FunnelTeamDialog({ open, onOpenChange, boardId, boardName, boardType = 'funnel' }: Props) {
  const typeLabel = boardType === 'workflow' ? 'POP' : 'funil';
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolRow[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<MemberSource>('times');
  const [addTeamId, setAddTeamId] = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      await ensureRemapCache();

      // Carrega TODOS os times e TODOS os perfis. O rodízio deste quadro não
      // depende mais de `teams.board_id` — dá pra montar por time ou avulso.
      const [{ data: teamRows }, { data: tmRows }, { data: allProfiles }] = await Promise.all([
        authClient.from('teams').select('id, name, board_id'),
        authClient.from('team_members').select('user_id, team_id, created_at'),
        authClient.from('profiles').select('id, user_id, full_name, email').order('full_name'),
      ]);

      const teamNameById = new Map<string, string>(
        (teamRows || []).map((t: { id: string; name: string }) => [t.id, t.name]),
      );

      // profiles indexados pelas duas chaves — team_members.user_id guarda ora o
      // auth user_id, ora o id do profile (legado).
      const profByAnyId = new Map<string, { user_id: string; full_name: string | null; email: string | null }>();
      for (const p of (allProfiles || []) as Array<{ id: string; user_id: string; full_name: string | null; email: string | null }>) {
        profByAnyId.set(p.user_id, p);
        profByAnyId.set(p.id, p);
      }
      const resolveCloudUuid = (storedId: string) => profByAnyId.get(storedId)?.user_id || storedId;

      // Vínculo mais antigo de cada membro (time + desde quando).
      const membershipByCloud = new Map<string, { team_name: string | null; joined_at: string | null }>();
      const membersByTeam = new Map<string, string[]>();
      for (const r of (tmRows || []) as Array<{ user_id: string; team_id: string; created_at: string | null }>) {
        const cloudUuid = resolveCloudUuid(r.user_id);
        const list = membersByTeam.get(r.team_id) || [];
        if (!list.includes(cloudUuid)) list.push(cloudUuid);
        membersByTeam.set(r.team_id, list);

        const prev = membershipByCloud.get(cloudUuid);
        if (!prev || (r.created_at && prev.joined_at && r.created_at < prev.joined_at)) {
          membershipByCloud.set(cloudUuid, {
            team_name: teamNameById.get(r.team_id) ?? null,
            joined_at: r.created_at ?? null,
          });
        }
      }

      setTeams(
        (teamRows || []).map((t: { id: string; name: string; board_id: string | null }) => ({
          id: t.id,
          name: t.name,
          memberIds: membersByTeam.get(t.id) || [],
          linkedHere: t.board_id === boardId,
        })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      );

      // Papéis só pra badge "admin".
      const authIds = Array.from(new Set((allProfiles || []).map((p: { user_id: string }) => p.user_id)));
      const { data: roles } = authIds.length
        ? await authClient.from('user_roles').select('user_id, role').in('user_id', authIds)
        : { data: [] as Array<{ user_id: string; role: string }> };
      const roleMap = new Map<string, string>();
      for (const r of (roles || []) as Array<{ user_id: string; role: string }>) {
        if (roleMap.get(r.user_id) !== 'admin') roleMap.set(r.user_id, r.role);
      }

      setMembers(
        (allProfiles || []).map((p: { user_id: string; full_name: string | null; email: string | null }) => {
          const membership = membershipByCloud.get(p.user_id);
          return {
            cloud_uuid: p.user_id,
            full_name: p.full_name,
            email: p.email,
            role: roleMap.get(p.user_id) ?? 'user',
            team_name: membership?.team_name ?? null,
            joined_at: membership?.joined_at ?? null,
          };
        }),
      );

      const { data: rows } = await db
        .from('funnel_round_robin_members' as never)
        .select('id, user_id, is_active, position, last_assigned_at')
        .eq('board_id', boardId)
        .order('position', { ascending: true });
      setPool((rows as unknown as PoolRow[]) || []);
    } catch (e) {
      toast({ title: 'Erro ao carregar equipe', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boardId]);

  const poolByExtId = useMemo(() => new Map(pool.map(p => [p.user_id, p])), [pool]);

  /** Casa membro (cloud uuid) com a linha do rodízio (ext uuid). */
  const rowForMember = useMemo(() => {
    const fn = (cloudUuid: string) =>
      poolByExtId.get(cloudUuid) || pool.find(p => remapToCloudSync(p.user_id) === cloudUuid);
    return fn;
  }, [pool, poolByExtId]);

  const rowsForDisplay = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = members
      .map(m => ({ member: m, row: rowForMember(m.cloud_uuid) }))
      // "Dos times" = quem tem vínculo de time. "Todos" = escritório inteiro.
      // Quem já está no rodízio aparece sempre, independente da origem.
      .filter(x => source === 'todos' || !!x.member.team_name || !!x.row);
    const filtered = q
      ? list.filter(x =>
          (x.member.full_name || '').toLowerCase().includes(q) ||
          (x.member.email || '').toLowerCase().includes(q),
        )
      : list;
    // No rodízio primeiro, na ordem do rodízio; depois o resto por nome.
    return filtered.sort((a, b) => {
      if (a.row && b.row) return a.row.position - b.row.position;
      if (a.row) return -1;
      if (b.row) return 1;
      return (a.member.full_name || '').localeCompare(b.member.full_name || '', 'pt-BR');
    });
  }, [members, source, search, rowForMember]);

  const noPool = pool.length === 0;

  const nextPosition = () => (pool.reduce((m, p) => Math.max(m, p.position), -1) ?? -1) + 1;

  const addMember = async (cloudUuid: string) => {
    setSaving(cloudUuid);
    try {
      const extId = await remapToExternal(cloudUuid);
      if (!extId) throw new Error('UUID não mapeado');
      const { error } = await db
        .from('funnel_round_robin_members' as never)
        .insert({ board_id: boardId, user_id: extId, is_active: true, position: nextPosition() } as never);
      if (error) throw error;
      await load();
    } catch (e) {
      toast({ title: 'Não foi possível adicionar', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  /** Adiciona de uma vez todo mundo do time que ainda não está no rodízio. */
  const addTeam = async (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    setSaving(`team:${teamId}`);
    try {
      const faltantes = team.memberIds.filter(cu => !rowForMember(cu));
      if (!faltantes.length) {
        toast({ title: 'Nada a adicionar', description: `Todos do time ${team.name} já estão no rodízio.` });
        return;
      }
      let pos = nextPosition();
      const linhas: Array<{ board_id: string; user_id: string; is_active: boolean; position: number }> = [];
      const semMapa: string[] = [];
      for (const cu of faltantes) {
        const extId = await remapToExternal(cu);
        if (!extId) {
          semMapa.push(members.find(m => m.cloud_uuid === cu)?.full_name || cu);
          continue;
        }
        linhas.push({ board_id: boardId, user_id: extId, is_active: true, position: pos++ });
      }
      if (linhas.length) {
        const { error } = await db.from('funnel_round_robin_members' as never).insert(linhas as never);
        if (error) throw error;
      }
      await load();
      toast({
        title: `${linhas.length} membro(s) adicionado(s)`,
        description: semMapa.length
          ? `Sem mapeamento de usuário, ficaram de fora: ${semMapa.join(', ')}`
          : `Time ${team.name} entrou no rodízio deste ${typeLabel}.`,
        variant: semMapa.length ? 'destructive' : undefined,
      });
      setAddTeamId('');
    } catch (e) {
      toast({ title: 'Não foi possível adicionar o time', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const toggleActive = async (row: PoolRow) => {
    setSaving(row.id);
    try {
      const { error } = await db
        .from('funnel_round_robin_members' as never)
        .update({ is_active: !row.is_active, updated_at: new Date().toISOString() } as never)
        .eq('id', row.id);
      if (error) throw error;
      setPool(p => p.map(x => x.id === row.id ? { ...x, is_active: !row.is_active } : x));
    } catch (e) {
      toast({ title: 'Erro ao atualizar', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const removeMember = async (row: PoolRow) => {
    setSaving(row.id);
    try {
      const { error } = await db.from('funnel_round_robin_members' as never).delete().eq('id', row.id);
      if (error) throw error;
      await load();
    } catch (e) {
      toast({ title: 'Erro ao remover', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const move = async (row: PoolRow, dir: -1 | 1) => {
    const ordered = [...pool].sort((a, b) => a.position - b.position);
    const idx = ordered.findIndex(r => r.id === row.id);
    const swap = ordered[idx + dir];
    if (!swap) return;
    setSaving(row.id);
    try {
      await db.from('funnel_round_robin_members' as never).update({ position: swap.position } as never).eq('id', row.id);
      await db.from('funnel_round_robin_members' as never).update({ position: row.position } as never).eq('id', swap.id);
      await load();
    } catch (e) {
      toast({ title: 'Erro ao reordenar', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const teamsComMembros = teams.filter(t => t.memberIds.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Equipe do {typeLabel} — {boardName}
          </DialogTitle>
          <DialogDescription>
            Quem está no rodízio recebe automaticamente os novos leads deste {typeLabel} (round-robin atômico).
            Inativos ficam fora do rodízio, mas continuam donos dos leads atuais.
          </DialogDescription>
        </DialogHeader>

        {/* Adicionar por TIME */}
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Building2 className="h-4 w-4 text-primary" />
            Adicionar um time inteiro
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={addTeamId} onValueChange={setAddTeamId}>
              <SelectTrigger className="h-8 flex-1 min-w-[200px] text-xs">
                <SelectValue placeholder={teamsComMembros.length ? 'Escolher time...' : 'Nenhum time com membros'} />
              </SelectTrigger>
              <SelectContent>
                {teamsComMembros.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} · {t.memberIds.length} membro{t.memberIds.length > 1 ? 's' : ''}
                    {t.linkedHere ? ' · vinculado a este quadro' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!addTeamId || saving === `team:${addTeamId}`}
              onClick={() => addTeam(addTeamId)}
            >
              {saving === `team:${addTeamId}`
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <><UserPlus className="h-3.5 w-3.5 mr-1.5" />Adicionar todos</>}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Entra todo mundo do time que ainda não está no rodízio. Não altera a que
            quadro o time pertence — isso continua sendo definido em Times.
          </p>
        </div>

        {/* Adicionar por MEMBRO */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar membro..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
            {([
              { v: 'times', l: 'Dos times' },
              { v: 'todos', l: 'Todos' },
            ] as { v: MemberSource; l: string }[]).map(opt => (
              <Button
                key={opt.v}
                size="sm"
                variant={source === opt.v ? 'default' : 'ghost'}
                className="h-7 px-2.5 text-[11px]"
                onClick={() => setSource(opt.v)}
                aria-pressed={source === opt.v}
              >
                {opt.l}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando...
          </div>
        ) : (
          <ScrollArea className="max-h-[45vh] pr-2">
            <div className="space-y-1.5">
              {rowsForDisplay.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-6 px-4">
                  {source === 'times'
                    ? 'Ninguém com vínculo de time por aqui. Troque para "Todos" para adicionar qualquer pessoa do escritório, ou use o seletor de time acima.'
                    : 'Nenhum membro encontrado.'}
                </div>
              )}
              {rowsForDisplay.map(({ member, row }) => {
                const inPool = !!row;
                const busy = saving === (row?.id || member.cloud_uuid);
                return (
                  <div
                    key={member.cloud_uuid}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5 rounded-md border bg-card"
                  >
                    <div className="flex-1 min-w-[160px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium truncate">
                          {member.full_name || member.email?.split('@')[0] || 'Membro'}
                        </span>
                        {member.role === 'admin' && (
                          <Badge variant="secondary" className="text-[10px]">admin</Badge>
                        )}
                        {inPool && row!.is_active && (
                          <Badge className="text-[10px]">no rodízio</Badge>
                        )}
                        {inPool && !row!.is_active && (
                          <Badge variant="outline" className="text-[10px]">pausado</Badge>
                        )}
                      </div>
                      {member.email && (
                        <div className="text-[11px] text-muted-foreground truncate">{member.email}</div>
                      )}
                      <div className="text-[11px] text-muted-foreground/80 truncate">
                        {member.team_name ? `Time: ${member.team_name}` : 'Sem time'}
                        {member.joined_at && (
                          <span> · desde {new Date(member.joined_at).toLocaleDateString('pt-BR')}</span>
                        )}
                      </div>
                    </div>

                    {inPool ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          disabled={busy}
                          onClick={() => move(row!, -1)}
                          title="Subir"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          disabled={busy}
                          onClick={() => move(row!, 1)}
                          title="Descer"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Switch
                          checked={row!.is_active}
                          disabled={busy}
                          onCheckedChange={() => toggleActive(row!)}
                        />
                        <Button
                          variant="ghost" size="sm"
                          className="text-xs text-destructive h-7"
                          disabled={busy}
                          onClick={() => removeMember(row!)}
                        >
                          Remover
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm" variant="outline" className="shrink-0"
                        disabled={busy}
                        onClick={() => addMember(member.cloud_uuid)}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Adicionar'}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <div className="text-[11px] text-muted-foreground border-t pt-2">
          {noPool
            ? 'Ninguém no rodízio ainda — os novos leads deste quadro não serão distribuídos automaticamente.'
            : 'Ordem do rodízio: quem está há mais tempo sem receber lead recebe o próximo. A posição desempata quando o tempo é igual.'}
        </div>
      </DialogContent>
    </Dialog>
  );
}
