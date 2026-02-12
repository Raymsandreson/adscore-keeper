import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { Plus, Users, Trash2, UserPlus, UserMinus, Loader2, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { toast } from 'sonner';

interface Team {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
}

interface TeamMemberEntry {
  id: string;
  team_id: string;
  user_id: string;
  created_at: string;
}

export function TeamsManager() {
  const { members } = useTeamMembers();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [saving, setSaving] = useState(false);

  const fetchTeams = useCallback(async () => {
    try {
      const [{ data: teamsData }, { data: membersData }] = await Promise.all([
        supabase.from('teams').select('*').order('created_at'),
        supabase.from('team_members').select('*'),
      ]);
      setTeams(teamsData || []);
      setTeamMembers(membersData || []);
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
      if (editingTeam) {
        const { error } = await supabase.from('teams').update({ name, description: description || null, color }).eq('id', editingTeam.id);
        if (error) throw error;
        toast.success('Time atualizado!');
      } else {
        const { error } = await supabase.from('teams').insert({ name, description: description || null, color });
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

  const resetForm = () => { setName(''); setDescription(''); setColor('#3b82f6'); setEditingTeam(null); };

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
      const { error } = await supabase.from('team_members').insert({ team_id: teamId, user_id: userId });
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

  const getTeamMembers = (teamId: string) => {
    const memberIds = teamMembers.filter(tm => tm.team_id === teamId).map(tm => tm.user_id);
    return members.filter(m => memberIds.includes(m.user_id));
  };

  const getAvailableMembers = (teamId: string) => {
    const memberIds = teamMembers.filter(tm => tm.team_id === teamId).map(tm => tm.user_id);
    return members.filter(m => !memberIds.includes(m.user_id));
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
                      <Button variant="ghost" size="icon" onClick={() => { setEditingTeam(team); setName(team.name); setDescription(team.description || ''); setColor(team.color); setDialogOpen(true); }}>
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
                  {team.description && <CardDescription>{team.description}</CardDescription>}
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Current members */}
                  {currentMembers.length > 0 ? (
                    <div className="space-y-2">
                      {currentMembers.map(m => (
                        <div key={m.user_id} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
                              <Users className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <span className="text-sm font-medium">{m.full_name || m.email || 'Sem nome'}</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveMember(team.id, m.user_id)}>
                            <UserMinus className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      ))}
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
