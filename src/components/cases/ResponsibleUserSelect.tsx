import { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useSharedFetch } from '@/lib/sharedFetch';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
import { UserCheck } from 'lucide-react';

interface Props {
  /** External UUID stored in lead_processes.responsible_user_id */
  value: string | null | undefined;
  /** Receives External UUID (or null) */
  onChange: (extUuid: string | null) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

interface TeamOption {
  /** UUID do Externo — o que vai gravado em lead_processes.responsible_user_id */
  ext_uuid: string;
  /** UUID do Cloud — chave da ASSIGNEE_BLOCKLIST (mesma das atividades) */
  user_id: string;
  /** Nome vindo do profiles do Externo (fallback quando o Cloud não tem o perfil) */
  ext_name: string | null;
}

const EMPTY: TeamOption[] = [];

/**
 * Equipe atribuível: todo mundo do auth_uuid_mapping menos a ASSIGNEE_BLOCKLIST
 * — o mesmo critério do seletor de assessor das atividades. O roster vem do
 * mapping (e não do profiles do Cloud) porque responsible_user_id guarda UUID
 * do Externo: quem não tem conta no Externo não pode ser responsável, e quem
 * tem aparece mesmo que o perfil do Cloud esteja faltando (ex.: Abderaman).
 */
function useAssignableTeam(): TeamOption[] {
  const { data } = useSharedFetch<TeamOption[]>(
    'responsible_team_options',
    async () => {
      const { data: mapping, error } = await (externalSupabase as any)
        .from('auth_uuid_mapping')
        .select('cloud_uuid, ext_uuid');
      if (error) throw error;
      const rows = (mapping as { cloud_uuid: string; ext_uuid: string }[]) || [];
      const { data: profs, error: profErr } = await (externalSupabase as any)
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', rows.map(r => r.ext_uuid));
      if (profErr) throw profErr;
      const nameByExt = new Map(
        ((profs as { user_id: string; full_name: string | null }[]) || []).map(p => [p.user_id, p.full_name]),
      );
      return filterAssignableMembers(rows.map(r => ({
        ext_uuid: r.ext_uuid,
        user_id: r.cloud_uuid,
        ext_name: nameByExt.get(r.ext_uuid) ?? null,
      })));
    },
    EMPTY,
  );
  return data;
}

/**
 * Seletor de "Responsável pelo processo".
 * Valor de entrada/saída é o UUID do Externo, sem remap.
 */
export function ResponsibleUserSelect({ value, onChange, className, placeholder, disabled }: Props) {
  const team = useAssignableTeam();
  const cloudProfiles = useProfilesList();

  const options = useMemo(() => {
    const nameByCloud = new Map(cloudProfiles.map(p => [p.user_id, p.full_name || p.email]));
    return team
      .map(m => ({
        ext_uuid: m.ext_uuid,
        name: nameByCloud.get(m.user_id) || m.ext_name || m.ext_uuid.slice(0, 8),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  }, [team, cloudProfiles]);

  return (
    <Select
      value={value || '__none__'}
      onValueChange={(v) => onChange(v === '__none__' ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <span className="flex items-center gap-1.5 truncate">
          <UserCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <SelectValue placeholder={placeholder || 'Sem responsável'} />
        </span>
      </SelectTrigger>
      <SelectContent className="z-[9999]">
        <SelectItem value="__none__">Sem responsável</SelectItem>
        {options.map(o => (
          <SelectItem key={o.ext_uuid} value={o.ext_uuid}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
