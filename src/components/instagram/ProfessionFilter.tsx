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
  X,
  ChevronDown,
  Check
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface CboProfession {
  id: string;
  cbo_code: string;
  title: string;
  family_code: string | null;
  family_title: string | null;
}

interface ProfessionFilterProps {
  selectedProfessions: string[];
  onSelectionChange: (professions: string[]) => void;
  compact?: boolean;
}

export const ProfessionFilter: React.FC<ProfessionFilterProps> = ({
  selectedProfessions,
  onSelectionChange,
  compact = false
}) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CboProfession[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [popularProfessions, setPopularProfessions] = useState<CboProfession[]>([]);

  // Load popular professions when popover opens
  useEffect(() => {
    if (open && popularProfessions.length === 0) {
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
      setPopularProfessions((data || []) as CboProfession[]);
      if (!searchQuery) {
        setSearchResults((data || []) as CboProfession[]);
      }
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
      setSearchResults(popularProfessions);
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
  }, [popularProfessions]);

  const toggleProfession = (title: string) => {
    if (selectedProfessions.includes(title)) {
      onSelectionChange(selectedProfessions.filter(p => p !== title));
    } else {
      onSelectionChange([...selectedProfessions, title]);
    }
  };

  const clearSelection = () => {
    onSelectionChange([]);
    setOpen(false);
  };

  const hasSelection = selectedProfessions.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={hasSelection ? "default" : "outline"}
          size="sm"
          className={`h-8 gap-2 ${hasSelection ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}`}
        >
          <Briefcase className="h-3.5 w-3.5" />
          {!compact && (
            <>
              {hasSelection ? (
                <>
                  Profissão
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs bg-white/20 text-white">
                    {selectedProfessions.length}
                  </Badge>
                </>
              ) : (
                'Profissão'
              )}
            </>
          )}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 z-50 bg-popover border shadow-lg" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Filtrar por Profissão
            </h4>
            {hasSelection && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={clearSelection}
              >
                <X className="h-3 w-3 mr-1" />
                Limpar
              </Button>
            )}
          </div>
          
          {/* Selected professions badges */}
          {hasSelection && (
            <div className="flex flex-wrap gap-1">
              {selectedProfessions.map(prof => (
                <Badge 
                  key={prof}
                  variant="secondary" 
                  className="text-xs gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 cursor-pointer hover:bg-amber-200 dark:hover:bg-amber-800"
                  onClick={() => toggleProfession(prof)}
                >
                  {prof.length > 25 ? `${prof.slice(0, 25)}...` : prof}
                  <X className="h-3 w-3" />
                </Badge>
              ))}
            </div>
          )}
          
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar profissão ou CBO..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          
          <ScrollArea className="h-[250px]">
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
                  const isSelected = selectedProfessions.includes(prof.title);
                  return (
                    <button
                      key={prof.id}
                      type="button"
                      className={`w-full flex items-center justify-between p-2 rounded-md border transition-colors cursor-pointer text-left ${
                        isSelected 
                          ? 'bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800' 
                          : 'bg-card hover:bg-accent/50 border-transparent hover:border-border'
                      }`}
                      onClick={() => toggleProfession(prof.title)}
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
