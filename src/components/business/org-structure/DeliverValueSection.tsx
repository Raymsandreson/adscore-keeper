import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FolderTree, Users, UserCheck, Building2 } from 'lucide-react';
import { Company } from '@/hooks/useCompanies';
import { CostCenter } from '@/hooks/useCostCenters';
import { ValueFlowSection } from './ValueFlowSection';

interface JobPosition {
  id: string;
  name: string;
  department: string | null;
  level: number;
  is_active: boolean;
  track_type: string | null;
}

interface Team {
  id: string;
  name: string;
}

interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  user_id: string;
}

interface DeliverValueSectionProps {
  companies: Company[];
  costCenters: CostCenter[];
  positions: JobPosition[];
  teams: Team[];
  teamMembers: TeamMember[];
  profiles: Profile[];
}

export function DeliverValueSection({ companies, costCenters, positions, teams, teamMembers, profiles }: DeliverValueSectionProps) {
  const activeCostCenters = costCenters.filter(cc => cc.is_active);
  const departments = [...new Set(positions.filter(p => p.department).map(p => p.department!))];

  const areasByCompany = companies.filter(c => c.is_active).map(c => ({
    company: c,
    ccs: costCenters.filter(cc => cc.company_id === c.id && cc.is_active),
  }));

  return (
    <ValueFlowSection
      color="blue"
      number={2}
      title="Entregar Valor"
      subtitle="Sistemas + Times + Processos — experiência consistente da marca"
    >
      {/* Áreas / Cost Centers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-blue-500" />
            Áreas & Centros de Custo
            <Badge variant="secondary" className="ml-auto">{activeCostCenters.length} centros</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Garantem que a experiência de marca seja uniforme em toda a operação.
          </p>
          {areasByCompany.map(({ company, ccs }) => (
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

      {/* Times */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-500" />
            Times
            <Badge variant="secondary" className="ml-auto">{teams.length} times</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Executam com o padrão da marca — o sistema replica a experiência sem depender de heróis.
          </p>
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3 italic">Nenhum time cadastrado</p>
          ) : (
            <div className="space-y-3">
              {teams.map(team => {
                const members = teamMembers.filter(tm => tm.team_id === team.id);
                const memberProfiles = members.map(m => profiles.find(p => p.user_id === m.user_id)).filter(Boolean);
                return (
                  <div key={team.id}>
                    <p className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <Users className="h-3 w-3 text-muted-foreground" />
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cargos & Funções */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-purple-500" />
            Cargos & Funções
            <Badge variant="secondary" className="ml-auto">{positions.length} cargos</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Responsabilidades formais que garantem que o sistema escala independente de indivíduos.
          </p>
          {positions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3 italic">Nenhum cargo cadastrado</p>
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
    </ValueFlowSection>
  );
}
