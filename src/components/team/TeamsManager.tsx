import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Plus, Users, Trash2, UserPlus, UserMinus, Loader2, Pencil, LayoutGrid, Settings2, ChevronDown, ChevronUp, ArrowRightLeft, Home, Building2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { toast } from 'sonner';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { TeamActivityTypesPicker } from './TeamActivityTypesPicker';
import { RedistributeActivitiesDialog } from './RedistributeActivitiesDialog';
import { TeamManagerPicker } from './TeamManagerPicker';
import { DirectorPicker } from './DirectorPicker';
import { useAuthContext } from '@/contexts/AuthContext';

const ALL_METRICS = [
  { key: 'replies', label: 'Respostas' },
  { key: 'dms', label: 'DMs' },
  { key: 'leads', label: 'Leads cadastrados' },
  { key: 'session_minutes', label: 'Tempo de sessão' },
  { key: 'contacts', label: 'Contatos' },
  { key: 'calls', label: 'Ligações' },
  { key: 'activities', label: 'Atividades' },
  { key: 'stage_changes', label: 'Fases' },
  { key: 'leads_closed', label: 'Fechados' },
  { key: 'checklist_items', label: 'Passos' },
];

interface Team {
  id: string;
  name: string;
  description: string | null;
  color: string;
  board_id: string | null;
  created_at: string;
}

interface TeamMemberEntry {
  id: string;
  team_id: string;
  user_id: string;
  evaluated_metrics: string[];
  created_at: string;
}

function CollapsibleMembers({ members: currentMembers, teamId, teamName, cargos, onCargoSave, getMemberMetrics, handleToggleMetric, handleRemoveMember, teamMembers, setTeamMembers, teamColor, isHomeOffice, onToggleHomeOffice }: {
  members: { user_id: string; full_name: string | null; email: string | null }[];
  teamId: string;
  teamName: string;
  cargos: Record<string, string>;
  onCargoSave: (teamName: string, userId: string, cargo: string) => void;
  getMemberMetrics: (teamId: string, userId: string) => string[];
  handleToggleMetric: (teamId: string, userId: string, metricKey: string) => void;
  handleRemoveMember: (teamId: string, userId: string) => void;
  teamMembers: TeamMemberEntry[];
  setTeamMembers: React.Dispatch<React.SetStateAction<TeamMemberEntry[]>>;
  teamColor: string;
  isHomeOffice: (userId: string) => boolean;
  onToggleHomeOffice: (member: { user_id: string; full_name: string | null; email: string | null }) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1 mb-1"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Users className="h-3.5 w-3.5" />
          Membros
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{currentMembers.length}</Badge>
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      <div className={cn(
        'overflow-hidden transition-all duration-200',
        expanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
      )}>
        <div className="space-y-2">
          {currentMembers.map(m => {
            const memberMetrics = getMemberMetrics(teamId, m.user_id);
            return (
              <div key={m.user_id} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Users className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium block truncate">{m.full_name || m.email || 'Sem nome'}</span>
                    <Input
                      defaultValue={cargos[`${teamName}|${m.user_id}`] || ''}
                      placeholder="Cargo (quem faz o quê)..."
                      className="h-6 text-[11px] mt-0.5 max-w-[220px]"
                      onBlur={(e) => {
                        const v = e.target.value;
                        if (v !== (cargos[`${teamName}|${m.user_id}`] || '')) onCargoSave(teamName, m.user_id, v);
                      }}
                    />
                    {memberMetrics.length > 0 && memberMetrics.length < ALL_METRICS.length && (
                      <span className="text-[10px] text-muted-foreground">
                        {memberMetrics.length} métrica{memberMetrics.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={isHomeOffice(m.user_id)
                      ? 'Home office — clique pra marcar como escritório'
                      : 'Escritório — clique pra marcar como home office'}
                    onClick={() => onToggleHomeOffice(m)}
                  >
                    {isHomeOffice(m.user_id)
                      ? <Home className="h-3.5 w-3.5 text-teal-500" />
                      : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />}
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium">Métricas avaliadas</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={async () => {
                            const allSelected = memberMetrics.length === ALL_METRICS.length;
                            const newMetrics = allSelected ? [] : ALL_METRICS.map(met => met.key);
                            try {
                              await supabase
                                .from('team_members')
                                .update({ evaluated_metrics: newMetrics })
                                .eq('team_id', teamId)
                                .eq('user_id', m.user_id);
                              setTeamMembers(prev => prev.map(tm =>
                                tm.team_id === teamId && tm.user_id === m.user_id
                                  ? { ...tm, evaluated_metrics: newMetrics }
                                  : tm
                              ));
                            } catch { toast.error('Erro ao atualizar métricas'); }
                          }}
                        >
                          {memberMetrics.length === ALL_METRICS.length ? 'Desmarcar tudo' : 'Selecionar tudo'}
                        </Button>
                      </div>
                      <div className="space-y-1.5">
                        {ALL_METRICS.map(metric => (
                          <label key={metric.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded p-1 -mx-1">
                            <Checkbox
                              checked={memberMetrics.includes(metric.key)}
                              onCheckedChange={() => handleToggleMetric(teamId, m.user_id, metric.key)}
                            />
                            {metric.label}
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveMember(teamId, m.user_id)}>
                    <UserMinus className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CollapsibleAddMembers({ available, teamId, onAdd }: {
  available: { user_id: string; full_name: string | null; email: string | null }[];
  teamId: string;
  onAdd: (teamId: string, userId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = available.filter(m => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (m.full_name || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="pt-2 border-t">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <UserPlus className="h-3.5 w-3.5" />
          Adicionar membro
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{available.length}</Badge>
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou email..."
            className="h-8 text-xs"
          />
          <div className="max-h-72 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center">
                {available.length === 0 ? 'Todos os membros já estão no time' : 'Nenhum resultado'}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {filtered.map(m => (
                  <Button
                    key={m.user_id}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onAdd(teamId, m.user_id)}
                    title={m.email || ''}
                  >
                    <UserPlus className="h-3 w-3 mr-1" />
                    {m.full_name || m.email || 'Sem nome'}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TeamsManager() {
  // Fonte de pessoas: profiles (todos com login), não user_roles — usuários sem
  // papel atribuído (ex.: João Pedro) também precisam aparecer nos times.
  const profilesList = useProfilesList();
  const { boards } = useKanbanBoards();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [boardId, setBoardId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [cargos, setCargos] = useState<Record<string, string>>({}); // `${team_name}|${user_id}` -> cargo
  const [inactiveIds, setInactiveIds] = useState<Set<string>>(new Set());
  // Cloud user_id de quem trabalha em home office (org_user_status.home_office no Externo)
  const [homeOfficeIds, setHomeOfficeIds] = useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = useState(false);
  const [managerIds, setManagerIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  // Cloud user_id do inativo cujo dialog de redistribuição foi aberto pela linha
  const [redistributeFor, setRedistributeFor] = useState<string | null>(null);

  const { user } = useAuthContext();

  // Cargos e status de acesso moram no Supabase Externo.
  // Modelo plano: Diretoria → Time (sem núcleos/setores).
  const fetchOrg = useCallback(async () => {
    try {
      await ensureExternalSession();
      const [{ data: cargoRows }, { data: statusRows }, { data: managerRows }] = await Promise.all([
        ((externalSupabase as any).from('team_member_cargos') as any).select('team_name, user_id, cargo'),
        ((externalSupabase as any).from('org_user_status') as any).select('user_id, active, home_office'),
        ((externalSupabase as any).from('team_managers') as any).select('manager_user_id'),
      ]);
      setInactiveIds(new Set(((statusRows as any[]) || []).filter(r => r.active === false).map(r => r.user_id)));
      setHomeOfficeIds(new Set(((statusRows as any[]) || []).filter(r => r.home_office === true).map(r => r.user_id)));
      setManagerIds(new Set(((managerRows as any[]) || []).map(r => r.manager_user_id).filter(Boolean)));
      const cargoMap: Record<string, string> = {};
      ((cargoRows as any[]) || []).forEach(r => { if (r.cargo) cargoMap[`${r.team_name}|${r.user_id}`] = r.cargo; });
      setCargos(cargoMap);
    } catch (e) {
      console.error('[TeamsManager] Failed to load org data:', e);
    }
  }, []);

  const toggleActive = useCallback(async (person: { user_id: string; full_name: string | null; email: string | null }, active: boolean) => {
    try {
      await ensureExternalSession();
      const { error } = await ((externalSupabase as any).from('org_user_status') as any).upsert({
        user_id: person.user_id,
        name: person.full_name || person.email || null,
        active,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      setInactiveIds(prev => {
        const next = new Set(prev);
        if (active) next.delete(person.user_id); else next.add(person.user_id);
        return next;
      });
      toast.success(active
        ? `${person.full_name || person.email} reativado`
        : `${person.full_name || person.email} desativado — será deslogado ao abrir o sistema`);
    } catch (e) {
      console.error('[TeamsManager] Failed to toggle status:', e);
      toast.error('Erro ao alterar status de acesso');
    }
  }, []);

  // team_members.user_id pode ser o auth user_id ou o id do profile (legado);
  // org_user_status é chaveado pelo auth user_id do Cloud — resolve antes.
  const resolveAuthId = useCallback((storedId: string) => {
    const p = profilesList.find(pp => pp.user_id === storedId || pp.id === storedId);
    return p?.user_id || storedId;
  }, [profilesList]);

  const isHomeOffice = useCallback(
    (storedId: string) => homeOfficeIds.has(resolveAuthId(storedId)),
    [homeOfficeIds, resolveAuthId],
  );

  const toggleHomeOffice = useCallback(async (member: { user_id: string; full_name: string | null; email: string | null }) => {
    const authId = resolveAuthId(member.user_id);
    const next = !homeOfficeIds.has(authId);
    try {
      await ensureExternalSession();
      const { error } = await ((externalSupabase as any).from('org_user_status') as any).upsert({
        user_id: authId,
        name: member.full_name || member.email || null,
        home_office: next,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      setHomeOfficeIds(prev => {
        const set = new Set(prev);
        if (next) set.add(authId); else set.delete(authId);
        return set;
      });
      toast.success(`${member.full_name || member.email}: ${next ? '🏠 home office' : '🏢 escritório'}`);
    } catch (e) {
      console.error('[TeamsManager] Failed to toggle home office:', e);
      toast.error('Erro ao alterar regime de trabalho');
    }
  }, [homeOfficeIds, resolveAuthId]);

  const saveCargo = useCallback(async (teamName: string, userId: string, cargo: string) => {
    try {
      await ensureExternalSession();
      const { error } = await ((externalSupabase as any).from('team_member_cargos') as any).upsert({
        team_name: teamName,
        user_id: userId,
        cargo: cargo.trim() || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'team_name,user_id' });
      if (error) throw error;
      setCargos(prev => ({ ...prev, [`${teamName}|${userId}`]: cargo.trim() }));
    } catch (e) {
      console.error('[TeamsManager] Failed to save cargo:', e);
      toast.error('Erro ao salvar cargo');
    }
  }, []);

  // Cria/atualiza o grupo de chat "👥 {time}" com os membros atuais e posta
  // o "quem faz o quê" (cargos). O relatório diário e o filtro por time do
  // chat usam esses grupos como fonte da composição do time.
  const syncChatGroups = async () => {
    if (!user?.id) return;
    setSyncing(true);
    try {
      await ensureExternalSession();
      for (const team of teams) {
        const teamPeople = getTeamMembers(team.id)
          .map(m => {
            const p = profilesList.find(pp => pp.user_id === m.user_id || pp.id === m.user_id);
            return p ? { authId: p.user_id, name: p.full_name || p.email || 'Sem nome', storedId: m.user_id } : null;
          })
          .filter(Boolean) as { authId: string; name: string; storedId: string }[];
        if (teamPeople.length === 0) continue;

        const groupName = `👥 ${team.name}`;
        const { data: existing } = await ((externalSupabase as any).from('team_conversations') as any)
          .select('id').eq('type', 'group').eq('name', groupName).maybeSingle();
        let convId = existing?.id as string | undefined;
        if (!convId) {
          const { data: created, error } = await ((externalSupabase as any).from('team_conversations') as any)
            .insert({ type: 'group', name: groupName }).select('id').single();
          if (error) throw error;
          convId = created.id;
        }

        const wanted = [...new Set([...teamPeople.map(p => p.authId), user.id])];
        const { data: current } = await ((externalSupabase as any).from('team_conversation_members') as any)
          .select('user_id').eq('conversation_id', convId);
        const have = new Set(((current as any[]) || []).map(m => m.user_id));
        const toAdd = wanted.filter(id => !have.has(id));
        if (toAdd.length) {
          await ((externalSupabase as any).from('team_conversation_members') as any)
            .insert(toAdd.map(uid => ({ conversation_id: convId, user_id: uid })));
        }

        const roster = teamPeople
          .map(p => `• ${p.name} — ${cargos[`${team.name}|${p.storedId}`] || 'cargo não definido'}`)
          .join('\n');
        await ((externalSupabase as any).from('team_messages') as any).insert({
          conversation_id: convId,
          sender_id: user.id,
          sender_name: '👥 Organização',
          content: `👥 ${team.name} — quem faz o quê:\n${roster}`,
          message_type: 'text',
        });
      }
      toast.success('Grupos de chat dos times sincronizados');
    } catch (e) {
      console.error('[TeamsManager] Failed to sync chat groups:', e);
      toast.error('Erro ao sincronizar grupos do chat');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { fetchOrg(); }, [fetchOrg]);

  const fetchTeams = useCallback(async () => {
    try {
      const [{ data: teamsData }, { data: membersData }] = await Promise.all([
        supabase.from('teams').select('*').order('created_at'),
        supabase.from('team_members').select('*'),
      ]);
      setTeams((teamsData || []).map(t => ({ ...t, board_id: t.board_id || null })));
      setTeamMembers((membersData || []).map(m => ({
        ...m,
        evaluated_metrics: (m.evaluated_metrics as string[]) || [],
      })));

      // Espelha o snapshot no Externo — o telão /tv/atividades e a RPC
      // tv_atividades_ranking leem teams/team_members de lá.
      if (teamsData && teamsData.length > 0) {
        try {
          await ensureExternalSession();
          await (externalSupabase as any).rpc('sync_teams_snapshot', {
            p_teams: teamsData.map(t => ({
              id: t.id, name: t.name, description: t.description, color: t.color,
            })),
            p_members: (membersData || []).map(m => ({ team_id: m.team_id, user_id: m.user_id })),
          });
        } catch (e) {
          console.warn('[TeamsManager] sync_teams_snapshot:', e);
        }
      }
    } catch (error) {
      console.error('Error fetching teams:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Informe o nome do time'); return; }
    setSaving(true);
    try {
      const payload = {
        name,
        description: description || null,
        color,
        board_id: boardId || null,
      };
      if (editingTeam) {
        const { error } = await supabase.from('teams').update(payload).eq('id', editingTeam.id);
        if (error) throw error;
        toast.success('Time atualizado!');
      } else {
        const { error } = await supabase.from('teams').insert(payload);
        if (error) throw error;
        toast.success('Time criado!');
      }
      setDialogOpen(false);
      resetForm();
      fetchTeams();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao salvar time');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setName(''); setDescription(''); setColor('#3b82f6'); setBoardId(null); setEditingTeam(null);
  };

  const handleDelete = async (teamId: string) => {
    try {
      const { error } = await supabase.from('teams').delete().eq('id', teamId);
      if (error) throw error;
      toast.success('Time removido!');
      fetchTeams();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao remover time');
    }
  };

  const handleAddMember = async (teamId: string, userId: string) => {
    try {
      const { error } = await supabase.from('team_members').insert({
        team_id: teamId,
        user_id: userId,
        evaluated_metrics: ALL_METRICS.map(m => m.key), // all metrics by default
      });
      if (error) throw error;
      toast.success('Membro adicionado ao time!');
      fetchTeams();
    } catch (error: any) {
      if (error.code === '23505') toast.error('Membro já está neste time');
      else toast.error(error.message || 'Erro ao adicionar membro');
    }
  };

  const handleRemoveMember = async (teamId: string, userId: string) => {
    try {
      const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId);
      if (error) throw error;
      toast.success('Membro removido do time!');
      fetchTeams();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao remover membro');
    }
  };

  const handleToggleMetric = async (teamId: string, userId: string, metricKey: string) => {
    const entry = teamMembers.find(tm => tm.team_id === teamId && tm.user_id === userId);
    if (!entry) return;

    const currentMetrics = entry.evaluated_metrics || [];
    const newMetrics = currentMetrics.includes(metricKey)
      ? currentMetrics.filter(m => m !== metricKey)
      : [...currentMetrics, metricKey];

    try {
      const { error } = await supabase
        .from('team_members')
        .update({ evaluated_metrics: newMetrics })
        .eq('team_id', teamId)
        .eq('user_id', userId);
      if (error) throw error;

      // Update local state
      setTeamMembers(prev => prev.map(tm =>
        tm.team_id === teamId && tm.user_id === userId
          ? { ...tm, evaluated_metrics: newMetrics }
          : tm
      ));
    } catch (error: any) {
      toast.error('Erro ao atualizar métricas');
    }
  };

  // team_members.user_id guarda ora o auth user_id, ora o id do profile
  // (dados legados) — casar pelos dois pra ninguém sumir da lista.
  const people = profilesList.map(p => ({ user_id: p.user_id, full_name: p.full_name, email: p.email }));

  const getTeamMembers = (teamId: string) => {
    const storedIds = teamMembers.filter(tm => tm.team_id === teamId).map(tm => tm.user_id);
    return storedIds.map(storedId => {
      const p = profilesList.find(pp => pp.user_id === storedId || pp.id === storedId);
      // user_id = id como está gravado em team_members (chave para remover/métricas)
      return { user_id: storedId, full_name: p?.full_name || null, email: p?.email || null };
    });
  };

  const getAvailableMembers = (teamId: string) => {
    const stored = new Set(teamMembers.filter(tm => tm.team_id === teamId).map(tm => tm.user_id));
    return profilesList
      .filter(p => !stored.has(p.user_id) && !stored.has(p.id))
      .map(p => ({ user_id: p.user_id, full_name: p.full_name, email: p.email }));
  };

  const unassignedPeople = profilesList.filter(
    p => !teamMembers.some(tm => tm.user_id === p.user_id || tm.user_id === p.id)
      && !managerIds.has(p.user_id)
      && !managerIds.has(p.id)
  );
  const unassignedActive = unassignedPeople.filter(p => !inactiveIds.has(p.user_id));
  const unassignedInactive = unassignedPeople.filter(p => inactiveIds.has(p.user_id));

  const getMemberMetrics = (teamId: string, userId: string): string[] => {
    const entry = teamMembers.find(tm => tm.team_id === teamId && tm.user_id === userId);
    return entry?.evaluated_metrics || [];
  };

  const getBoardInfo = (boardIdVal: string | null) => {
    if (!boardIdVal) return null;
    const b = boards.find(bb => bb.id === boardIdVal);
    if (!b) return null;
    return { name: b.name, label: b.board_type === 'workflow' ? 'POP' : 'Funil' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Times</h3>
          <p className="text-sm text-muted-foreground">Organize seus membros em times para facilitar a gestão</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Novo Time</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingTeam ? 'Editar Time' : 'Criar Time'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nome</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Comercial" />
              </div>
              <div>
                <Label>Descrição (opcional)</Label>
                <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição do time" />
              </div>
              <div>
                <Label>Funil (Quadro Kanban)</Label>
                <Select value={boardId || 'none'} onValueChange={v => setBoardId(v === 'none' ? null : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar funil" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {boards.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                          {b.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Associe um funil para que as metas diárias deste time sejam específicas
                </p>
              </div>
              <div>
                <Label>Cor</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-10 w-10 rounded cursor-pointer border" />
                  <span className="text-sm text-muted-foreground">{color}</span>
                </div>
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingTeam ? 'Salvar' : 'Criar Time'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Diretoria — dá a direção aos gestores dos times */}
      <DirectorPicker people={people} />

      {/* Instância controlada, aberta pelo botão "Atividades" na linha do inativo */}
      <RedistributeActivitiesDialog
        people={people}
        inactiveIds={inactiveIds}
        open={redistributeFor !== null}
        onOpenChange={(o) => { if (!o) setRedistributeFor(null); }}
        initialSourceId={redistributeFor}
      />

      <div className="flex justify-end gap-2">
        <RedistributeActivitiesDialog people={people} inactiveIds={inactiveIds} />
        <Button variant="outline" size="sm" onClick={syncChatGroups} disabled={syncing}>
          {syncing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Users className="h-3.5 w-3.5 mr-1" />}
          Sincronizar grupos do chat (👥 por time)
        </Button>
      </div>

      {/* Pessoas sem time + status de acesso */}
      {unassignedPeople.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserMinus className="h-4 w-4 text-muted-foreground" />
              Sem time
              <Badge variant="secondary">{unassignedActive.length}</Badge>
            </CardTitle>
            <CardDescription>
              Pessoas com login que não estão em nenhum time. Desative quem saiu da equipe — a pessoa é deslogada ao abrir o sistema.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(showInactive ? [...unassignedActive, ...unassignedInactive] : unassignedActive).map(p => {
                const active = !inactiveIds.has(p.user_id);
                return (
                  <div key={p.user_id} className={cn('flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50', !active && 'opacity-60')}>
                    <span className="text-sm truncate flex-1 min-w-0">
                      {p.full_name || p.email || 'Sem nome'}
                      {!active && <Badge variant="destructive" className="ml-2 text-[9px] h-4 px-1">inativo</Badge>}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {!active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          title="Redistribuir atividades pendentes deste membro"
                          onClick={() => setRedistributeFor(p.user_id)}
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />Atividades
                        </Button>
                      )}
                      {teams.length > 0 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title="Adicionar a um time">
                              <UserPlus className="h-3.5 w-3.5 mr-1" />Time
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-56 p-1">
                            <div className="text-[10px] uppercase text-muted-foreground px-2 py-1">Adicionar em</div>
                            <div className="max-h-64 overflow-y-auto">
                              {teams.map(t => (
                                <button
                                  key={t.id}
                                  onClick={() => handleAddMember(t.id, p.user_id)}
                                  className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted flex items-center gap-2"
                                >
                                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                                  <span className="truncate">{t.name}</span>
                                </button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                      <Switch
                        checked={active}
                        onCheckedChange={(checked) => toggleActive(p, checked)}
                        title={active ? 'Desativar acesso' : 'Reativar acesso'}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {unassignedInactive.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 text-xs text-muted-foreground"
                onClick={() => setShowInactive(v => !v)}
              >
                {showInactive ? 'Ocultar' : 'Mostrar'} {unassignedInactive.length} desativado{unassignedInactive.length !== 1 ? 's' : ''}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {teams.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Nenhum time criado ainda. Crie o primeiro!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map(team => {
            const currentMembers = getTeamMembers(team.id);
            const available = getAvailableMembers(team.id);
            const boardInfo = getBoardInfo(team.board_id);
            return (
              <Card key={team.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: team.color }} />
                      <CardTitle className="text-base">{team.name}</CardTitle>
                      <Badge variant="secondary">{currentMembers.length}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => {
                        setEditingTeam(team);
                        setName(team.name);
                        setDescription(team.description || '');
                        setColor(team.color);
                        setBoardId(team.board_id);
                        setDialogOpen(true);
                      }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir time "{team.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>Os membros não serão removidos do sistema, apenas desvinculados deste time.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(team.id)}>Excluir</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    {team.description && <CardDescription>{team.description}</CardDescription>}
                    {boardInfo && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <LayoutGrid className="h-3 w-3" />
                        <span>{boardInfo.label}: <strong className="text-foreground">{boardInfo.name}</strong></span>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Current members - collapsible */}
                  {currentMembers.length > 0 ? (
                    <CollapsibleMembers
                      members={currentMembers}
                      teamId={team.id}
                      teamName={team.name}
                      cargos={cargos}
                      onCargoSave={saveCargo}
                      getMemberMetrics={getMemberMetrics}
                      handleToggleMetric={handleToggleMetric}
                      handleRemoveMember={handleRemoveMember}
                      teamMembers={teamMembers}
                      setTeamMembers={setTeamMembers}
                      teamColor={team.color}
                      isHomeOffice={isHomeOffice}
                      onToggleHomeOffice={toggleHomeOffice}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-2">Nenhum membro alocado</p>
                  )}

                  {/* Collapsible add member section */}
                  {available.length > 0 && (
                    <CollapsibleAddMembers
                      available={available}
                      teamId={team.id}
                      onAdd={handleAddMember}
                    />
                  )}

                  {/* Gestor do time — recebe o relatório diário e a direção da diretoria */}
                  <TeamManagerPicker teamId={team.id} teamName={team.name} members={people} />

                  {/* Activity types exclusive to this team */}
                  <TeamActivityTypesPicker teamId={team.id} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
