import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getAcolhedorPhoto } from '@/lib/acolhedorPhotos';
import { cn } from '@/lib/utils';

interface AcolhedorComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
}

function AcolhedorAvatar({ name, className }: { name: string; className?: string }) {
  const photo = getAcolhedorPhoto(name);
  return (
    <Avatar className={className}>
      {photo && <AvatarImage src={photo} alt={name} className="object-cover" />}
      <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
        {name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

export function AcolhedorCombobox({ value, onChange, options, placeholder = 'Selecione o acolhedor...' }: AcolhedorComboboxProps) {
  const [open, setOpen] = useState(false);
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
          {value ? (
            <span className="flex items-center gap-2 min-w-0">
              <AcolhedorAvatar name={value} className="h-5 w-5 flex-shrink-0" />
              <span className="truncate">{value}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Digite para filtrar..." />
          <CommandList>
            <CommandEmpty>Nenhum acolhedor encontrado.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__nenhum__"
                onSelect={() => { onChange(''); setOpen(false); }}
              >
                <span className="text-muted-foreground">Nenhum</span>
                <Check className={cn('ml-auto h-4 w-4', !value ? 'opacity-100' : 'opacity-0')} />
              </CommandItem>
              {options.map((name) => (
                <CommandItem
                  key={name}
                  value={name}
                  onSelect={() => { onChange(name); setOpen(false); }}
                >
                  <AcolhedorAvatar name={name} className="h-6 w-6 mr-2 flex-shrink-0" />
                  <span className="truncate">{name}</span>
                  <Check className={cn('ml-auto h-4 w-4', value === name ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
