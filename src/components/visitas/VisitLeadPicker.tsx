/**
 * Escolha do lead a ser visitado (só no painel — dentro do lead o vínculo já
 * está dado). Junto com o id devolve o endereço da visita já cadastrado, que o
 * formulário usa para pré-preencher local, cidade e UF.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, MapPin } from 'lucide-react';
import { db } from '@/integrations/supabase';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface VisitLeadOption {
  id: string;
  lead_name: string | null;
  visit_address: string | null;
  visit_city: string | null;
  visit_state: string | null;
  city: string | null;
  state: string | null;
}

interface Props {
  value: { id: string | null; name: string | null };
  onChange: (lead: VisitLeadOption) => void;
}

export function VisitLeadPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const term = query.trim();

  const { data: leads = [], isFetching } = useQuery({
    queryKey: ['visit-lead-options', term],
    staleTime: 30_000,
    queryFn: async (): Promise<VisitLeadOption[]> => {
      let request = (db as any)
        .from('leads')
        .select('id, lead_name, visit_address, visit_city, visit_state, city, state')
        .is('deleted_at', null);

      if (term) request = request.ilike('lead_name', `%${term}%`);

      const { data, error } = await request
        .order('created_at', { ascending: false })
        .limit(term ? 30 : 20);

      if (error) throw error;
      return (data || []) as VisitLeadOption[];
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !value.name && 'text-muted-foreground')}>
            {value.name || 'Selecione o lead a ser visitado...'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar lead pelo nome..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{isFetching ? 'Buscando...' : 'Nenhum lead encontrado.'}</CommandEmpty>
            <CommandGroup heading={term ? 'Resultados' : 'Leads recentes'}>
              {leads.map((lead) => {
                const place = [lead.visit_city || lead.city, lead.visit_state || lead.state]
                  .filter(Boolean)
                  .join('/');
                return (
                  <CommandItem
                    key={lead.id}
                    value={lead.id}
                    onSelect={() => {
                      onChange(lead);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <Check
                      className={cn('mr-2 h-4 w-4 shrink-0', value.id === lead.id ? 'opacity-100' : 'opacity-0')}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm truncate">{lead.lead_name || 'Lead sem nome'}</span>
                      {place && (
                        <span className="text-[11px] text-muted-foreground truncate inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {place}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
