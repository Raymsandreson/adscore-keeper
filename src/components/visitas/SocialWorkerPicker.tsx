/**
 * Escolha da assistente social.
 *
 * Elas são parceiras EXTERNAS — não têm perfil no sistema. A lista sai de
 * `contacts` (as que já estão cadastradas com profissão de serviço social ou
 * como parceiras) e a busca livre varre o cadastro inteiro pelo nome.
 *
 * Quem ainda não está no cadastro não pode travar o agendamento: digitar o nome
 * e escolher "usar este nome" grava a visita só com o texto, sem vínculo. O
 * nome fica gravado nos dois casos, então o calendário nunca depende do join.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, UserPlus, X, Phone } from 'lucide-react';
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

export interface SocialWorkerValue {
  contactId: string | null;
  name: string;
  phone: string | null;
}

interface Props {
  value: SocialWorkerValue;
  onChange: (value: SocialWorkerValue) => void;
}

interface WorkerOption {
  id: string;
  full_name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  profession: string | null;
}

export function SocialWorkerPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const term = query.trim();

  // Sem termo: as candidatas naturais. Com termo: o cadastro inteiro por nome —
  // assistente social cadastrada como 'prospect' também precisa aparecer.
  const { data: options = [], isFetching } = useQuery({
    queryKey: ['social-worker-options', term],
    staleTime: 60_000,
    queryFn: async (): Promise<WorkerOption[]> => {
      const columns = 'id, full_name, phone, city, state, profession';
      const base = (db as any).from('contacts').select(columns).is('deleted_at', null);

      const { data, error } = term
        ? await base.ilike('full_name', `%${term}%`).order('full_name').limit(25)
        : await base
            .or('profession.ilike.%social%,classification.eq.partner')
            .order('full_name')
            .limit(50);

      if (error) throw error;
      return (data || []) as WorkerOption[];
    },
  });

  const selectedLabel = value.name?.trim() || '';
  const canUseFreeText = term.length >= 2 && !options.some(
    (o) => (o.full_name || '').trim().toLowerCase() === term.toLowerCase(),
  );

  const subtitle = useMemo(() => value.phone?.trim() || '', [value.phone]);

  const pick = (option: WorkerOption) => {
    onChange({
      contactId: option.id,
      name: option.full_name || '',
      phone: option.phone || null,
    });
    setOpen(false);
    setQuery('');
  };

  const useFreeText = () => {
    onChange({ contactId: null, name: term, phone: value.phone || null });
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="flex gap-2 items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="flex-1 justify-between font-normal h-auto py-2"
          >
            {selectedLabel ? (
              <span className="flex flex-col items-start min-w-0">
                <span className="truncate">{selectedLabel}</span>
                {!value.contactId && (
                  <span className="text-[10px] text-muted-foreground">fora do cadastro de contatos</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">Selecione a assistente social...</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar por nome..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {isFetching ? 'Buscando...' : 'Ninguém com esse nome nos contatos.'}
              </CommandEmpty>
              {canUseFreeText && (
                <CommandGroup heading="Não está no cadastro">
                  <CommandItem value={`__livre__${term}`} onSelect={useFreeText}>
                    <UserPlus className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span className="truncate">Usar "{term}"</span>
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup heading={term ? 'Contatos' : 'Assistentes sociais e parceiras'}>
                {options.map((option) => (
                  <CommandItem key={option.id} value={option.id} onSelect={() => pick(option)}>
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4 shrink-0',
                        value.contactId === option.id ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm truncate">{option.full_name || 'Sem nome'}</span>
                      <span className="text-[11px] text-muted-foreground truncate">
                        {[option.profession, [option.city, option.state].filter(Boolean).join('/')]
                          .filter(Boolean)
                          .join(' · ') || 'sem profissão cadastrada'}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedLabel && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Limpar assistente social"
          onClick={() => onChange({ contactId: null, name: '', phone: null })}
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      {subtitle && (
        <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Phone className="h-3 w-3" /> {subtitle}
        </span>
      )}
    </div>
  );
}
