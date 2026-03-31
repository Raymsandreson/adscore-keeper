import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanies } from '@/hooks/useCompanies';
import { useCostCenters } from '@/hooks/useCostCenters';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { useProductsServices } from '@/hooks/useProductsServices';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { CreateValueSection } from './org-structure/CreateValueSection';
import { DeliverValueSection } from './org-structure/DeliverValueSection';
import { CaptureValueSection } from './org-structure/CaptureValueSection';
import { EcosystemConnectionsMap } from './org-structure/EcosystemConnectionsMap';

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

export function OrganizationalStructureTab() {
  const { companies } = useCompanies();
  const { costCenters } = useCostCenters();
  const { nuclei } = useSpecializedNuclei();
  const { products } = useProductsServices();
  const { boards } = useKanbanBoards();
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold">Fluxo de Valor</h1>
        <p className="text-sm text-muted-foreground">
          Criar → Entregar → Capturar — a marca é o eixo que multiplica valor em cada etapa
        </p>
      </div>

      {/* Ecosystem Connections Map */}
      <EcosystemConnectionsMap
        nuclei={nuclei}
        products={products}
        companies={companies}
        boards={boards}
        teams={teams}
        teamMembers={teamMembers}
        profiles={profiles}
      />

      <CreateValueSection
        companies={companies}
        nuclei={nuclei}
        products={products}
        profiles={profiles}
      />

      <DeliverValueSection
        companies={companies}
        costCenters={costCenters}
        positions={positions}
        teams={teams}
        teamMembers={teamMembers}
        profiles={profiles}
      />

      <CaptureValueSection
        companies={companies}
        products={products}
      />
    </div>
  );
}
