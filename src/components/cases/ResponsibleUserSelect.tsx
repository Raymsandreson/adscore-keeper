import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProfilesList } from '@/hooks/useProfilesList';
import {
  ensureRemapCache,
  remapToCloudSync,
  remapToExternalSync,
} from '@/integrations/supabase/uuid-remap';
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

/**
 * Seletor de "Responsável pelo processo".
 * Lista perfis do Cloud, mas o valor de entrada/saída é o UUID do Externo.
 */
export function ResponsibleUserSelect({ value, onChange, className, placeholder, disabled }: Props) {
  const profiles = useProfilesList();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureRemapCache().then(() => setReady(true));
  }, []);

  // Converte ext → cloud para casar com profiles.user_id
  const cloudValue = ready ? remapToCloudSync(value || null) : null;

  return (
    <Select
      value={cloudValue || '__none__'}
      onValueChange={(v) => {
        if (v === '__none__') {
          onChange(null);
        } else {
          onChange(remapToExternalSync(v));
        }
      }}
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
        {profiles.map(p => (
          <SelectItem key={p.user_id} value={p.user_id}>
            {p.full_name || p.email || p.user_id.slice(0, 8)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
