import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowDown, ArrowUp, Loader2, Search, Users } from 'lucide-react';
import { db, authClient } from '@/integrations/supabase';
import { ensureRemapCache, remapToExternal, remapToCloudSync } from '@/integrations/supabase/uuid-remap';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  boardName: string;
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
}

export function FunnelTeamDialog({ open, onOpenChange, boardId, boardName }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolRow[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [search, setSearch] = useState('');
  // Times (Cloud) que têm este funil como board_id — fonte da composição.
  const [linkedTeams, setLinkedTeams] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      await ensureRemapCache();

      // 1. Times donos deste funil (teams.board_id no Cloud).
      const { data: teamRows } = await authClient
        .from('teams')
        .select('id, name')
        .eq('board_id', boardId);
      const teamIds = (teamRows || []).map((t: any) => t.id);
      setLinkedTeams((teamRows || []).map((t: any) => t.name));

      // 2. Membros desses times. team_members.user_id guarda ora o auth
      //    user_id, ora o id do profile (legado) — resolvemos os dois.
      const { data: tmRows } = teamIds.length
        ? await authClient.from('team_members').select('user_id, team_id').in('team_id', teamIds)
        : { data: [] as any[] };
      const storedIds = Array.from(new Set((tmRows || []).map((r: any) => r.user_id)));

      // 3. Perfis casando por user_id OU id (legado).
      const [{ data: profByUser }, { data: profById }] = storedIds.length
        ? await Promise.all([
            authClient.from('profiles').select('id, user_id, full_name, email').in('user_id', storedIds),
            authClient.from('profiles').select('id, user_id, full_name, email').in('id', storedIds),
          ])
        : [{ data: [] as any[] }, { data: [] as any[] }];
      const profiles = [...(profByUser || []), ...(profById || [])];

      // 4. Papéis só pra badge "admin".
      const authIds = Array.from(new Set(profiles.map((p: any) => p.user_id)));
      const { data: roles } = authIds.length
        ? await authClient.from('user_roles').select('user_id, role').in('user_id', authIds)
        : { data: [] as any[] };
      const roleMap = new Map<string, string>();
      for (const r of (roles || []) as any[]) {
        if (roleMap.get(r.user_id) !== 'admin') roleMap.set(r.user_id, r.role);
      }

      // Monta as opções chaveadas pelo cloud auth uuid (dedupe).
      const dedup = new Map<string, MemberOption>();
      for (const storedId of storedIds) {
        const p = profiles.find((pp: any) => pp.user_id === storedId || pp.id === storedId);
        const cloudUuid = p?.user_id || storedId;
        if (dedup.has(cloudUuid)) continue;
        dedup.set(cloudUuid, {
          cloud_uuid: cloudUuid,
          full_name: p?.full_name ?? null,
          email: p?.email ?? null,
          role: roleMap.get(cloudUuid) ?? 'user',
        });
      }
      setMembers(Array.from(dedup.values()));

      const { data: rows } = await db
        .from('funnel_round_robin_members' as any)
        .select('id, user_id, is_active, position, last_assigned_at')
        .eq('board_id', boardId)
        .order('position', { ascending: true });
      setPool((rows as any) || []);
    } catch (e: any) {
      toast({ title: 'Erro ao carregar equipe', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boardId]);

  const poolByExtId = useMemo(() => new Map(pool.map(p => [p.user_id, p])), [pool]);

  const rowsForDisplay = useMemo(() => {
    const list = members.map(m => {
      // Try direct (cloud_uuid stored as ext) and remapped (when external session has different id)
      const direct = poolByExtId.get(m.cloud_uuid);
      const remapped = !direct
        ? pool.find(p => remapToCloudSync(p.user_id) === m.cloud_uuid)
        : undefined;
      const row = direct || remapped;
      return { member: m, row };
    });
    const q = search.trim().toLowerCase();
    return q
      ? list.filter(x =>
          (x.member.full_name || '').toLowerCase().includes(q) ||
          (x.member.email || '').toLowerCase().includes(q),
        )
      : list;
  }, [members, pool, poolByExtId, search]);

  const addMember = async (cloudUuid: string) => {
    setSaving(cloudUuid);
    try {
      const extId = await remapToExternal(cloudUuid);
      if (!extId) throw new Error('UUID não mapeado');
      const nextPos = (pool.reduce((m, p) => Math.max(m, p.position), -1) ?? -1) + 1;
      const { error } = await db
        .from('funnel_round_robin_members' as any)
        .insert({ board_id: boardId, user_id: extId, is_active: true, position: nextPos });
      if (error) throw error;
      await load();
    } catch (e: any) {
      toast({ title: 'Não foi possível adicionar', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const toggleActive = async (row: PoolRow) => {
    setSaving(row.id);
    try {
      const { error } = await db
        .from('funnel_round_robin_members' as any)
        .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) throw error;
      setPool(p => p.map(x => x.id === row.id ? { ...x, is_active: !row.is_active } : x));
    } catch (e: any) {
      toast({ title: 'Erro ao atualizar', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const removeMember = async (row: PoolRow) => {
    setSaving(row.id);
    try {
      const { error } = await db
        .from('funnel_round_robin_members' as any)
        .delete()
        .eq('id', row.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      toast({ title: 'Erro ao remover', description: e.message, variant: 'destructive' });
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
      // swap positions
      await db.from('funnel_round_robin_members' as any).update({ position: swap.position }).eq('id', row.id);
      await db.from('funnel_round_robin_members' as any).update({ position: row.position }).eq('id', swap.id);
      await load();
    } catch (e: any) {
      toast({ title: 'Erro ao reordenar', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Equipe do funil — {boardName}
          </DialogTitle>
          <DialogDescription>
            Quem está no rodízio recebe automaticamente os novos leads deste funil (round-robin atômico).
            Inativos ficam fora do rodízio, mas continuam donos dos leads atuais.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar membro..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {loading ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando...
          </div>
        ) : (
          <ScrollArea className="max-h-[55vh] pr-2">
            <div className="space-y-1.5">
              {rowsForDisplay.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-6">
                  {linkedTeams.length === 0
                    ? 'Nenhum time está vinculado a este funil. Vincule um time ao funil em Times para escolher quem entra no rodízio.'
                    : 'Nenhum membro encontrado.'}
                </div>
              )}
              {rowsForDisplay.map(({ member, row }) => {
                const inPool = !!row;
                const busy = saving === (row?.id || member.cloud_uuid);
                return (
                  <div
                    key={member.cloud_uuid}
                    className="flex items-center gap-3 p-2.5 rounded-md border bg-card"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
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
                    </div>

                    {inPool ? (
                      <div className="flex items-center gap-1">
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
                        size="sm" variant="outline"
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
          Ordem do rodízio: quem está há mais tempo sem receber lead recebe o próximo. A posição
          desempata quando o tempo é igual.
        </div>
      </DialogContent>
    </Dialog>
  );
}
