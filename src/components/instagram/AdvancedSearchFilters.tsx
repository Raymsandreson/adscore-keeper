import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, Filter, Info, X } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface AdvancedFilters {
  allWords: string;      // AND - all these words
  exactPhrase: string;   // Exact phrase match
  anyWords: string;      // OR - any of these words
  excludeWords: string;  // NOT - exclude these words
}

interface AdvancedSearchFiltersProps {
  filters: AdvancedFilters;
  onFiltersChange: (filters: AdvancedFilters) => void;
  onClear: () => void;
  className?: string;
}

export const emptyFilters: AdvancedFilters = {
  allWords: '',
  exactPhrase: '',
  anyWords: '',
  excludeWords: '',
};

export function hasActiveFilters(filters: AdvancedFilters): boolean {
  return !!(filters.allWords || filters.exactPhrase || filters.anyWords || filters.excludeWords);
}

export function AdvancedSearchFilters({
  filters,
  onFiltersChange,
  onClear,
  className = '',
}: AdvancedSearchFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const updateFilter = (key: keyof AdvancedFilters, value: string) => {
    onFiltersChange({ ...filters, [key]: value });
  };
  
  const activeCount = [
    filters.allWords,
    filters.exactPhrase,
    filters.anyWords,
    filters.excludeWords,
  ].filter(Boolean).length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs text-muted-foreground hover:text-foreground"
        >
          <span className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            Filtros avançados
            {activeCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">
                {activeCount}
              </span>
            )}
          </span>
          {isOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="space-y-3 pt-3">
        <TooltipProvider>
          {/* All Words (AND) */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="allWords" className="text-xs text-muted-foreground">
                Todas essas palavras/expressões
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <p className="text-xs">Resultado deve conter TODAS as palavras digitadas</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="allWords"
              placeholder="Ex: acidente trabalho grave"
              value={filters.allWords}
              onChange={(e) => updateFilter('allWords', e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          
          {/* Exact Phrase */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="exactPhrase" className="text-xs text-muted-foreground">
                Esta expressão ou frase exata
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <p className="text-xs">Busca a frase exatamente como digitada</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="exactPhrase"
              placeholder='Ex: "acidente de trabalho"'
              value={filters.exactPhrase}
              onChange={(e) => updateFilter('exactPhrase', e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          
          {/* Any Words (OR) */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="anyWords" className="text-xs text-muted-foreground">
                Ao menos uma dessas palavras/expressões
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <p className="text-xs">Resultado deve conter PELO MENOS UMA das palavras</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="anyWords"
              placeholder="Ex: morte falecimento óbito"
              value={filters.anyWords}
              onChange={(e) => updateFilter('anyWords', e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          
          {/* Exclude Words (NOT) */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="excludeWords" className="text-xs text-muted-foreground">
                Nenhuma dessas palavras/expressões
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <p className="text-xs">Exclui resultados que contenham estas palavras</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="excludeWords"
              placeholder="Ex: propaganda venda promoção"
              value={filters.excludeWords}
              onChange={(e) => updateFilter('excludeWords', e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </TooltipProvider>
        
        {/* Actions */}
        {hasActiveFilters(filters) && (
          <div className="flex justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              Limpar filtros
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Apply advanced filters to a text
 */
export function applyAdvancedFilters(text: string, filters: AdvancedFilters): boolean {
  if (!hasActiveFilters(filters)) return true;
  
  const lowerText = text.toLowerCase();
  
  // All Words (AND) - all words must be present
  if (filters.allWords.trim()) {
    const words = filters.allWords.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every(word => lowerText.includes(word))) {
      return false;
    }
  }
  
  // Exact Phrase - exact match
  if (filters.exactPhrase.trim()) {
    const phrase = filters.exactPhrase.toLowerCase().trim();
    if (!lowerText.includes(phrase)) {
      return false;
    }
  }
  
  // Any Words (OR) - at least one word must be present
  if (filters.anyWords.trim()) {
    const words = filters.anyWords.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.some(word => lowerText.includes(word))) {
      return false;
    }
  }
  
  // Exclude Words (NOT) - none of the words should be present
  if (filters.excludeWords.trim()) {
    const words = filters.excludeWords.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.some(word => lowerText.includes(word))) {
      return false;
    }
  }
  
  return true;
}
