import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useSharedFetch } from '@/lib/sharedFetch';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, UserCheck } from 'lucide-react';

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
 * Seletor de "Responsável pelo processo" — combobox com busca (Popover+Command,
 * o mesmo padrão do seletor de assessor das atividades). O Select do Radix
 * cortava a lista dentro da sheet e não tinha filtro por texto.
 * Valor de entrada/saída é o UUID do Externo, sem remap.
 *
 * A lista é a UNIÃO de duas fontes, pra bater com o seletor de assessor das
 * atividades sem perder ninguém:
 * 1. profiles do Cloud menos ASSIGNEE_BLOCKLIST — as mesmas pessoas das
 *    atividades. Quem não tem mapping grava o próprio UUID do Cloud (mesmo
 *    fallback que o remap antigo fazia).
 * 2. quem está no auth_uuid_mapping mas sem perfil no Cloud (ex.: Abderaman).
 */
export function ResponsibleUserSelect({ value, onChange, className, placeholder, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const team = useAssignableTeam();
  const cloudProfiles = useProfilesList();

  const options = useMemo(() => {
    const mappedByCloud = new Map(team.map(m => [m.user_id, m]));
    const seenCloud = new Set<string>();
    const opts: { ext_uuid: string; name: string }[] = [];
    for (const p of filterAssignableMembers(cloudProfiles)) {
      seenCloud.add(p.user_id);
      opts.push({
        ext_uuid: mappedByCloud.get(p.user_id)?.ext_uuid || p.user_id,
        name: p.full_name || p.email || p.user_id.slice(0, 8),
      });
    }
    for (const m of team) {
      if (seenCloud.has(m.user_id)) continue;
      opts.push({ ext_uuid: m.ext_uuid, name: m.ext_name || m.ext_uuid.slice(0, 8) });
    }
    return opts.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  }, [team, cloudProfiles]);

  const selected = value ? options.find(o => o.ext_uuid === value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between font-normal px-3', className)}
        >
          <span className="flex items-center gap-1.5 truncate">
            <UserCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected ? selected.name : (placeholder || 'Sem responsável')}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px] z-[9999]" align="start">
        <Command>
          <CommandInput placeholder="Buscar responsável..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="text-xs py-4 text-center">Nenhum encontrado</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__sem_responsavel__"
                onSelect={() => { onChange(null); setOpen(false); }}
                className="text-xs"
              >
                <Check className={cn('mr-2 h-3 w-3 shrink-0', !value ? 'opacity-100' : 'opacity-0')} />
                <span className="text-muted-foreground italic">Sem responsável</span>
              </CommandItem>
              {options.map(o => (
                <CommandItem
                  key={o.ext_uuid}
                  value={`${o.name} ${o.ext_uuid}`}
                  onSelect={() => { onChange(o.ext_uuid); setOpen(false); }}
                  className="text-xs"
                >
                  <Check className={cn('mr-2 h-3 w-3 shrink-0', value === o.ext_uuid ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{o.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
