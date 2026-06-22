import { useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LeadLite {
  id: string;
  lead_name: string | null;
  lead_phone: string | null;
}

interface Props {
  value: string | null;
  onChange: (leadId: string | null, lead?: LeadLite | null) => void;
}

export function HearingLeadPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LeadLite[]>([]);
  const [selected, setSelected] = useState<LeadLite | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch selected lead info when value changes externally
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!value) { setSelected(null); return; }
      if (selected?.id === value) return;
      const { data } = await (db as any)
        .from('leads')
        .select('id, lead_name, lead_phone')
        .eq('id', value)
        .maybeSingle();
      if (!cancel) setSelected(data || null);
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Search
  useEffect(() => {
    let cancel = false;
    const term = query.trim();
    setLoading(true);
    const t = setTimeout(async () => {
      let q = (db as any).from('leads').select('id, lead_name, lead_phone').is('deleted_at', null).limit(20);
      if (term) {
        q = q.or(`lead_name.ilike.%${term}%,lead_phone.ilike.%${term}%`);
      } else {
        q = q.order('created_at', { ascending: false });
      }
      const { data } = await q;
      if (!cancel) {
        setResults((data || []) as LeadLite[]);
        setLoading(false);
      }
    }, 200);
    return () => { cancel = true; clearTimeout(t); };
  }, [query, open]);

  const label = useMemo(() => {
    if (!selected) return 'Associar pessoa (lead)...';
    return selected.lead_name || selected.lead_phone || 'Lead sem nome';
  }, [selected]);

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
            <CommandInput placeholder="Buscar por nome ou telefone..." value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>{loading ? 'Buscando...' : 'Nenhum lead encontrado.'}</CommandEmpty>
              <CommandGroup>
                {results.map((l) => (
                  <CommandItem
                    key={l.id}
                    value={l.id}
                    onSelect={() => {
                      onChange(l.id, l);
                      setSelected(l);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === l.id ? 'opacity-100' : 'opacity-0')} />
                    <div className="flex flex-col">
                      <span className="text-sm">{l.lead_name || 'Sem nome'}</span>
                      {l.lead_phone && <span className="text-xs text-muted-foreground">{l.lead_phone}</span>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="icon" onClick={() => { onChange(null, null); setSelected(null); }} title="Remover associação">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
