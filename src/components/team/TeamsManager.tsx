import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Plus, Users, Trash2, UserPlus, UserMinus, Loader2, Pencil, LayoutGrid, Settings2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { toast } from 'sonner';

const ALL_METRICS = [
  { key: 'replies', label: 'Respostas' },
  { key: 'dms', label: 'DMs' },
  { key: 'leads', label: 'Leads cadastrados' },
  { key: 'session_minutes', label: 'Tempo de sessão' },
  { key: 'contacts', label: 'Contatos' },
  { key: 'calls', label: 'Ligações' },
  { key: 'activities', label: 'Atividades' },
  { key: 'stage_changes', label: 'Etapas' },
  { key: 'leads_closed', label: 'Fechados' },
  { key: 'checklist_items', label: 'Checklist' },
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

export function TeamsManager() {
  const { members } = useTeamMembers();
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

  const getTeamMembers = (teamId: string) => {
    const memberIds = teamMembers.filter(tm => tm.team_id === teamId).map(tm => tm.user_id);
    return members.filter(m => memberIds.includes(m.user_id));
  };

  const getAvailableMembers = (teamId: string) => {
    const memberIds = teamMembers.filter(tm => tm.team_id === teamId).map(tm => tm.user_id);
    return members.filter(m => !memberIds.includes(m.user_id));
  };

  const getMemberMetrics = (teamId: string, userId: string): string[] => {
    const entry = teamMembers.find(tm => tm.team_id === teamId && tm.user_id === userId);
    return entry?.evaluated_metrics || [];
  };

  const getBoardName = (boardIdVal: string | null) => {
    if (!boardIdVal) return null;
    return boards.find(b => b.id === boardIdVal)?.name || null;
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
            const boardName = getBoardName(team.board_id);
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
                    {boardName && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <LayoutGrid className="h-3 w-3" />
                        <span>Funil: <strong className="text-foreground">{boardName}</strong></span>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Current members */}
                  {currentMembers.length > 0 ? (
                    <div className="space-y-2">
                      {currentMembers.map(m => {
                        const memberMetrics = getMemberMetrics(team.id, m.user_id);
                        return (
                          <div key={m.user_id} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <Users className="h-3.5 w-3.5 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <span className="text-sm font-medium block truncate">{m.full_name || m.email || 'Sem nome'}</span>
                                {memberMetrics.length > 0 && memberMetrics.length < ALL_METRICS.length && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {memberMetrics.length} métrica{memberMetrics.length !== 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {/* Metrics config popover */}
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <Settings2 className="h-3.5 w-3.5" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-56 p-3">
                                  <p className="text-xs font-medium mb-2">Métricas avaliadas</p>
                                  <div className="space-y-1.5">
                                    {ALL_METRICS.map(metric => (
                                      <label key={metric.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded p-1 -mx-1">
                                        <Checkbox
                                          checked={memberMetrics.includes(metric.key)}
                                          onCheckedChange={() => handleToggleMetric(team.id, m.user_id, metric.key)}
                                        />
                                        {metric.label}
                                      </label>
                                    ))}
                                  </div>
                                </PopoverContent>
                              </Popover>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveMember(team.id, m.user_id)}>
                                <UserMinus className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-2">Nenhum membro alocado</p>
                  )}

                  {/* Add member dropdown */}
                  {available.length > 0 && (
                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground mb-2">Adicionar membro:</p>
                      <div className="flex flex-wrap gap-1">
                        {available.map(m => (
                          <Button key={m.user_id} variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleAddMember(team.id, m.user_id)}>
                            <UserPlus className="h-3 w-3 mr-1" />
                            {m.full_name || m.email || 'Sem nome'}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
