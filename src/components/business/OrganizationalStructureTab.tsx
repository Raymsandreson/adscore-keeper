import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Users, Briefcase, UserCheck, FolderTree, Lightbulb } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanies } from '@/hooks/useCompanies';
import { useCostCenters } from '@/hooks/useCostCenters';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';

interface JobPosition {
  id: string;
  name: string;
  department: string | null;
  level: number;
  is_active: boolean;
  salary_fixed: number | null;
  track_type: string | null;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  user_id: string;
}

interface Team {
  id: string;
  name: string;
  board_id: string | null;
}

interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
}

const FRAMEWORK_ITEMS = [
  { num: 5, label: 'Núcleos', desc: 'Especialização e criação de valor', icon: <Lightbulb className="h-4 w-4" />, color: 'text-amber-500' },
  { num: 6, label: 'Áreas', desc: 'Como cada empresa opera', icon: <FolderTree className="h-4 w-4" />, color: 'text-blue-500' },
  { num: 7, label: 'Cargos', desc: 'Responsabilidades formais', icon: <UserCheck className="h-4 w-4" />, color: 'text-purple-500' },
  { num: 8, label: 'Pessoas', desc: 'Quem executa', icon: <Users className="h-4 w-4" />, color: 'text-emerald-500' },
];

export function OrganizationalStructureTab() {
  const { companies } = useCompanies();
  const { costCenters } = useCostCenters();
  const { nuclei } = useSpecializedNuclei();
  const [positions, setPositions] = useState<JobPosition[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [posRes, profRes, teamsRes, tmRes] = await Promise.all([
        supabase.from('job_positions').select('id,name,department,level,is_active,salary_fixed,track_type').eq('is_active', true).order('level'),
        supabase.from('profiles').select('id,full_name,email,user_id'),
        supabase.from('teams').select('id,name,board_id'),
        supabase.from('team_members').select('id,team_id,user_id'),
      ]);
      setPositions((posRes.data as JobPosition[]) || []);
      setProfiles((profRes.data as Profile[]) || []);
      setTeams((teamsRes.data as Team[]) || []);
      setTeamMembers((tmRes.data as TeamMember[]) || []);
    } catch (err) {
      console.error('Error fetching org structure:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Derive unique areas from cost_centers (area is in DB but not in hook type)
  const areas = [...new Set(costCenters.filter(cc => cc.is_active && (cc as any).area).map(cc => (cc as any).area as string))];
  
  // Derive unique departments from positions
  const departments = [...new Set(positions.filter(p => p.department).map(p => p.department!))];

  // Group cost centers by company
  const areasByCompany = companies.filter(c => c.is_active).map(c => ({
    company: c,
    costCenters: costCenters.filter(cc => cc.company_id === c.id && cc.is_active),
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Framework overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {FRAMEWORK_ITEMS.map(item => (
          <Card key={item.num}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-lg font-bold ${item.color}`}>{item.num}.</span>
                <span className={item.color}>{item.icon}</span>
              </div>
              <p className="font-semibold text-sm">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Núcleos Especializados */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            Núcleos Especializados
            <Badge variant="secondary" className="ml-auto">{nuclei.filter(n => n.is_active).length} núcleos</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {nuclei.filter(n => n.is_active).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum núcleo cadastrado.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {nuclei.filter(n => n.is_active).map(nucleus => (
                <div key={nucleus.id} className="p-3 rounded-lg border bg-card flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: nucleus.color }} />
                  <div>
                    <p className="font-medium text-sm">{nucleus.name}</p>
                    <p className="text-xs text-muted-foreground">{nucleus.prefix}{nucleus.description ? ` · ${nucleus.description}` : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Áreas / Cost Centers by Company */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-blue-500" />
            Áreas por Empresa
            <Badge variant="secondary" className="ml-auto">{costCenters.filter(cc => cc.is_active).length} centros de custo</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {areasByCompany.map(({ company, costCenters: ccs }) => (
            <div key={company.id}>
              <p className="text-sm font-semibold flex items-center gap-2 mb-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                {company.name}
                <Badge variant="outline" className="text-xs">{ccs.length}</Badge>
              </p>
              {ccs.length === 0 ? (
                <p className="text-xs text-muted-foreground ml-6 italic">Nenhum centro de custo</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 ml-6">
                  {ccs.map(cc => (
                    <div key={cc.id} className="p-2.5 rounded-md border bg-card text-sm">
                      <p className="font-medium">{cc.name}</p>
                      <div className="flex gap-1.5 mt-1 flex-wrap">
                        {(cc as any).area && <Badge variant="outline" className="text-xs">{(cc as any).area}</Badge>}
                        {(cc as any).ticket_tier && <Badge variant="secondary" className="text-xs">{(cc as any).ticket_tier}</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Cargos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-purple-500" />
            Cargos
            <Badge variant="secondary" className="ml-auto">{positions.length} cargos ativos</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum cargo cadastrado. Cadastre cargos em Equipe → Plano de Carreira.
            </p>
          ) : (
            <div className="space-y-3">
              {departments.length > 0 ? departments.map(dept => {
                const deptPositions = positions.filter(p => p.department === dept);
                return (
                  <div key={dept}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{dept}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {deptPositions.map(pos => (
                        <div key={pos.id} className="p-2.5 rounded-md border bg-card text-sm flex items-center justify-between">
                          <div>
                            <p className="font-medium">{pos.name}</p>
                            <p className="text-xs text-muted-foreground">Nível {pos.level}</p>
                          </div>
                          {pos.track_type && <Badge variant="outline" className="text-xs">{pos.track_type}</Badge>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {positions.map(pos => (
                    <div key={pos.id} className="p-2.5 rounded-md border bg-card text-sm flex items-center justify-between">
                      <div>
                        <p className="font-medium">{pos.name}</p>
                        <p className="text-xs text-muted-foreground">Nível {pos.level}</p>
                      </div>
                      {pos.track_type && <Badge variant="outline" className="text-xs">{pos.track_type}</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pessoas / Times */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-500" />
            Pessoas & Times
            <Badge variant="secondary" className="ml-auto">{profiles.length} pessoas • {teams.length} times</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {teams.length === 0 && profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum time ou pessoa cadastrada. Gerencie times em Equipe → Times.
            </p>
          ) : (
            <>
              {teams.map(team => {
                const members = teamMembers.filter(tm => tm.team_id === team.id);
                const memberProfiles = members.map(m => profiles.find(p => p.user_id === m.user_id)).filter(Boolean);
                return (
                  <div key={team.id}>
                    <p className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {team.name}
                      <Badge variant="outline" className="text-xs">{members.length} membros</Badge>
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 ml-6">
                      {memberProfiles.map((profile: any) => (
                        <div key={profile.id} className="p-2 rounded-md border bg-card text-sm">
                          <p className="font-medium text-xs">{profile.full_name || profile.email || 'Sem nome'}</p>
                        </div>
                      ))}
                      {members.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">Sem membros</p>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Unassigned people */}
              {(() => {
                const assignedUserIds = new Set(teamMembers.map(tm => tm.user_id));
                const unassigned = profiles.filter(p => !assignedUserIds.has(p.user_id));
                if (unassigned.length === 0) return null;
                return (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Sem time definido</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {unassigned.map(p => (
                        <div key={p.id} className="p-2 rounded-md border bg-card text-sm">
                          <p className="font-medium text-xs">{p.full_name || p.email || 'Sem nome'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
