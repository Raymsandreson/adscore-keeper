import { useMemo, useState } from 'react';
import { useProfilesList } from '@/hooks/useProfilesList';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** Cloud user_id */
  value: string | null;
  onChange: (userId: string | null) => void;
}

export function HearingMemberPicker({ value, onChange }: Props) {
  const profiles = useProfilesList();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(() => profiles.find((p) => p.user_id === value) || null, [profiles, value]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return profiles;
    return profiles.filter((p) =>
      (p.full_name || '').toLowerCase().includes(term) ||
      (p.email || '').toLowerCase().includes(term)
    );
  }, [profiles, query]);

  const label = selected
    ? (selected.full_name || selected.email || 'Membro sem nome')
    : 'Associar membro da equipe...';

  return (
    <div className="flex gap-2 items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="flex-1 justify-between font-normal">
            <span className="flex items-center gap-2 truncate">
              <User className="h-4 w-4 opacity-60" />
              <span className="truncate">{label}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar membro..." value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>Nenhum membro encontrado.</CommandEmpty>
              <CommandGroup>
                {filtered.map((p) => (
                  <CommandItem
                    key={p.user_id}
                    value={p.user_id}
                    onSelect={() => {
                      onChange(p.user_id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === p.user_id ? 'opacity-100' : 'opacity-0')} />
                    <div className="flex flex-col">
                      <span className="text-sm">{p.full_name || 'Sem nome'}</span>
                      {p.email && <span className="text-xs text-muted-foreground">{p.email}</span>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="icon" onClick={() => onChange(null)} title="Remover associação">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
