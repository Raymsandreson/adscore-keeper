import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  Briefcase, 
  Search, 
  Loader2, 
  Plus,
  X,
  Star,
  ChevronDown
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface CboProfession {
  id: string;
  cbo_code: string;
  title: string;
  family_code: string | null;
  family_title: string | null;
}

interface SelectedProfession {
  cbo_code: string;
  title: string;
  is_primary: boolean;
}

interface MultiProfessionSelectorProps {
  value: SelectedProfession[];
  onChange: (professions: SelectedProfession[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const MultiProfessionSelector: React.FC<MultiProfessionSelectorProps> = ({
  value,
  onChange,
  placeholder = 'Selecione profissões...',
  disabled = false
}) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CboProfession[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Load popular professions when popover opens
  useEffect(() => {
    if (open) {
      loadPopularProfessions();
    }
  }, [open]);

  const loadPopularProfessions = async () => {
    setSearchLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('cbo_professions')
        .select('*')
        .order('title', { ascending: true })
        .limit(30);

      if (error) throw error;
      setSearchResults((data || []) as CboProfession[]);
    } catch (error) {
      console.error('Error loading professions:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    
    if (query.length < 2) {
      loadPopularProfessions();
      return;
    }

    setSearchLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('cbo_professions')
        .select('*')
        .or(`title.ilike.%${query}%,cbo_code.ilike.%${query}%,family_title.ilike.%${query}%`)
        .order('title', { ascending: true })
        .limit(50);

      if (error) throw error;
      setSearchResults((data || []) as CboProfession[]);
    } catch (error) {
      console.error('Error searching professions:', error);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const addProfession = (profession: CboProfession) => {
    if (value.some(p => p.cbo_code === profession.cbo_code)) {
      return; // Already selected
    }
    
    const newProfession: SelectedProfession = {
      cbo_code: profession.cbo_code,
      title: profession.title,
      is_primary: value.length === 0 // First one is primary
    };
    
    onChange([...value, newProfession]);
  };

  const removeProfession = (cboCode: string) => {
    const updated = value.filter(p => p.cbo_code !== cboCode);
    // If we removed the primary and there are others, make the first one primary
    if (updated.length > 0 && !updated.some(p => p.is_primary)) {
      updated[0].is_primary = true;
    }
    onChange(updated);
  };

  const setPrimary = (cboCode: string) => {
    const updated = value.map(p => ({
      ...p,
      is_primary: p.cbo_code === cboCode
    }));
    onChange(updated);
  };

  const isSelected = (cboCode: string) => value.some(p => p.cbo_code === cboCode);

  return (
    <div className="space-y-2">
      {/* Selected professions display */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map(prof => (
            <Badge 
              key={prof.cbo_code}
              variant="secondary" 
              className={`text-xs gap-1 pr-1 ${
                prof.is_primary 
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' 
                  : 'bg-muted'
              }`}
            >
              {prof.is_primary && <Star className="h-3 w-3 fill-current" />}
              <span className="truncate max-w-[150px]">{prof.title}</span>
              <div className="flex items-center gap-0.5 ml-1">
                {!prof.is_primary && value.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPrimary(prof.cbo_code);
                    }}
                    className="p-0.5 hover:bg-amber-200 dark:hover:bg-amber-800 rounded"
                    title="Definir como principal"
                  >
                    <Star className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeProfession(prof.cbo_code);
                  }}
                  className="p-0.5 hover:bg-destructive/20 rounded"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </Badge>
          ))}
        </div>
      )}

      {/* Add profession button */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between h-9 font-normal"
            disabled={disabled}
          >
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {value.length === 0 ? placeholder : 'Adicionar profissão...'}
              </span>
            </div>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-3 z-[100]" align="start">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-amber-600" />
              <h4 className="font-medium text-sm">Profissões (CBO)</h4>
            </div>
            
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar profissão ou código CBO..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-8 h-9"
                autoFocus
              />
            </div>
            
            <ScrollArea className="h-[220px]">
              {searchLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  {searchQuery.length >= 2 ? 'Nenhuma profissão encontrada' : 'Carregando profissões...'}
                </div>
              ) : (
                <div className="space-y-1">
                  {searchResults.map(prof => {
                    const selected = isSelected(prof.cbo_code);
                    return (
                      <button
                        key={prof.id}
                        type="button"
                        className={`w-full flex items-center justify-between p-2 rounded-md border transition-colors cursor-pointer text-left ${
                          selected 
                            ? 'bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800 opacity-60' 
                            : 'bg-card hover:bg-accent/50 border-transparent hover:border-border'
                        }`}
                        onClick={() => !selected && addProfession(prof)}
                        disabled={selected}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{prof.title}</p>
                          <p className="text-xs text-muted-foreground">
                            CBO: {prof.cbo_code}
                            {prof.family_title && ` • ${prof.family_title}`}
                          </p>
                        </div>
                        {selected ? (
                          <Badge variant="secondary" className="text-xs">Adicionada</Badge>
                        ) : (
                          <Plus className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
