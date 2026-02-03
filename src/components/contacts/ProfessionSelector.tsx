import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  Briefcase, 
  Search, 
  Loader2, 
  Check,
  ChevronDown,
  X
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface CboProfession {
  id: string;
  cbo_code: string;
  title: string;
  family_code: string | null;
  family_title: string | null;
}

interface ProfessionSelectorProps {
  value: string;
  cboCode?: string;
  onSelect: (profession: string, cboCode: string) => void;
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export const ProfessionSelector: React.FC<ProfessionSelectorProps> = ({
  value,
  cboCode,
  onSelect,
  onClear,
  placeholder = 'Selecione a profissão...',
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

  // Search professions
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

  const handleSelectProfession = (profession: CboProfession) => {
    onSelect(profession.title, profession.cbo_code);
    setOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClear?.();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-10 font-normal"
          disabled={disabled}
        >
          <div className="flex items-center gap-2 truncate">
            <Briefcase className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            {value ? (
              <span className="truncate">{value}</span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {value && onClear && (
              <X 
                className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-pointer" 
                onClick={handleClear}
              />
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-3 z-[100]" align="start">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-amber-600" />
            <h4 className="font-medium text-sm">Profissão (CBO)</h4>
          </div>
          
          {value && (
            <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{value}</p>
              {cboCode && (
                <p className="text-xs text-amber-600 dark:text-amber-400">CBO: {cboCode}</p>
              )}
            </div>
          )}
          
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
                  const isSelected = cboCode === prof.cbo_code;
                  return (
                    <button
                      key={prof.id}
                      type="button"
                      className={`w-full flex items-center justify-between p-2 rounded-md border transition-colors cursor-pointer text-left ${
                        isSelected 
                          ? 'bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800' 
                          : 'bg-card hover:bg-accent/50 border-transparent hover:border-border'
                      }`}
                      onClick={() => handleSelectProfession(prof)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{prof.title}</p>
                        <p className="text-xs text-muted-foreground">
                          CBO: {prof.cbo_code}
                          {prof.family_title && ` • ${prof.family_title}`}
                        </p>
                      </div>
                      {isSelected ? (
                        <Check className="h-4 w-4 text-amber-600 flex-shrink-0" />
                      ) : (
                        <Briefcase className="h-4 w-4 text-muted-foreground flex-shrink-0" />
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
  );
};
