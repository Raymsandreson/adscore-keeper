import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useViaCep } from '@/hooks/useViaCep';

type Common = {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
};

export function StateCombobox({ value, onChange, placeholder = 'UF', className, autoFocus }: Common) {
  const { states } = useBrazilianLocations();
  const [open, setOpen] = useState(false);
  const selected = states.find(s => s.sigla.toUpperCase() === (value || '').toUpperCase());
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          autoFocus={autoFocus}
          className={cn('w-full justify-between font-normal', !selected && 'text-muted-foreground', className)}
        >
          {selected ? `${selected.sigla} - ${selected.nome}` : (value || placeholder)}
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[260px]" align="start">
        <Command>
          <CommandInput placeholder="Buscar estado..." />
          <CommandList>
            <CommandEmpty>Nenhum estado encontrado.</CommandEmpty>
            <CommandGroup>
              {states.map(s => (
                <CommandItem
                  key={s.sigla}
                  value={`${s.sigla} ${s.nome}`}
                  onSelect={() => { onChange(s.sigla); setOpen(false); }}
                >
                  <Check className={cn('mr-2 h-4 w-4', selected?.sigla === s.sigla ? 'opacity-100' : 'opacity-0')} />
                  {s.sigla} - {s.nome}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CityCombobox({
  value, onChange, stateUf, placeholder = 'Cidade', className, autoFocus,
}: Common & { stateUf?: string }) {
  const { cities, fetchCities, loadingCities } = useBrazilianLocations();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (stateUf) fetchCities(stateUf.toUpperCase());
  }, [stateUf]);

  const sorted = useMemo(() => cities.slice().sort((a, b) => a.nome.localeCompare(b.nome)), [cities]);

  if (!stateUf) {
    return (
      <Input
        className={className}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Selecione a UF primeiro"
        autoFocus={autoFocus}
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          autoFocus={autoFocus}
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground', className)}
        >
          {value || placeholder}
          {loadingCities ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        <Command>
          <CommandInput placeholder="Buscar cidade..." />
          <CommandList>
            <CommandEmpty>{loadingCities ? 'Carregando...' : 'Nenhuma cidade encontrada.'}</CommandEmpty>
            <CommandGroup>
              {sorted.map(c => (
                <CommandItem
                  key={c.id}
                  value={c.nome}
                  onSelect={() => { onChange(c.nome); setOpen(false); }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === c.nome ? 'opacity-100' : 'opacity-0')} />
                  {c.nome}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CepInput({
  value, onChange, onAddressFound, className, autoFocus,
}: Common & { onAddressFound?: (addr: { city: string; state: string; street?: string; neighborhood?: string }) => void }) {
  const { fetchAddress, loading } = useViaCep();

  const handleChange = async (raw: string) => {
    const masked = raw.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
    onChange(masked);
    const digits = masked.replace(/\D/g, '');
    if (digits.length === 8) {
      const addr = await fetchAddress(digits);
      if (addr && onAddressFound) onAddressFound(addr);
    }
  };

  return (
    <div className="relative">
      <Input
        className={className}
        value={value}
        onChange={e => handleChange(e.target.value)}
        placeholder="00000-000"
        autoFocus={autoFocus}
        inputMode="numeric"
      />
      {loading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

/** Detecta o tipo de campo a partir do nome (ex: "uf", "estado", "cidade", "cep"). */
export function detectLocationFieldType(fieldName: string): 'state' | 'city' | 'cep' | null {
  const n = fieldName.toLowerCase().replace(/[{}_\s]/g, '');
  // Excluir campos que apenas CONTÊM "estado" mas não são UF (ex: estado_civil)
  if (n.includes('civil') || n.includes('saude') || n.includes('saúde')) return null;
  if (n === 'uf' || n === 'estado' || n === 'estadouf' || n.endsWith('uf') || n.startsWith('estadod') || n.startsWith('estadode')) return 'state';
  if (n.includes('cidade') || n.includes('municipio') || n.includes('município')) return 'city';
  if (n === 'cep' || n.includes('cep') || n.includes('codigopostal')) return 'cep';
  return null;
}
