import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, Filter, Info, X, Sparkles, Plus } from 'lucide-react';
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

// Pre-defined keyword suggestions organized by category
const KEYWORD_SUGGESTIONS = {
  tipoAcidente: {
    label: 'Tipo de Acidente',
    keywords: ['acidente', 'morte', 'falecimento', 'óbito', 'fatal', 'grave', 'colisão', 'capotamento', 'atropelamento'],
  },
  contexto: {
    label: 'Contexto',
    keywords: ['trabalho', 'empresa', 'obra', 'construção', 'fábrica', 'máquina', 'equipamento', 'segurança'],
  },
  relacionamento: {
    label: 'Relacionamento',
    keywords: ['família', 'parente', 'amigo', 'colega', 'conhecido', 'vizinho', 'marido', 'esposa', 'filho', 'pai', 'mãe'],
  },
  sentimento: {
    label: 'Sentimento',
    keywords: ['triste', 'luto', 'saudade', 'descanse', 'paz', 'força', 'condolências', 'lamento'],
  },
  exclusao: {
    label: 'Excluir (spam)',
    keywords: ['advogado', 'processo', 'indenização', 'sigam', 'siga', 'promoção', 'link', 'bio'],
  },
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
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  const updateFilter = (key: keyof AdvancedFilters, value: string) => {
    onFiltersChange({ ...filters, [key]: value });
  };
  
  // Add a keyword to a specific filter field
  const addKeywordToFilter = (keyword: string, targetField: keyof AdvancedFilters) => {
    const currentValue = filters[targetField];
    const words = currentValue.split(/\s+/).filter(Boolean);
    
    // Don't add if already exists
    if (words.includes(keyword.toLowerCase())) return;
    
    const newValue = currentValue.trim() ? `${currentValue.trim()} ${keyword}` : keyword;
    updateFilter(targetField, newValue);
  };
  
  // Remove a keyword from a filter field
  const removeKeywordFromFilter = (keyword: string, targetField: keyof AdvancedFilters) => {
    const currentValue = filters[targetField];
    const words = currentValue.split(/\s+/).filter(Boolean);
    const newWords = words.filter(w => w.toLowerCase() !== keyword.toLowerCase());
    updateFilter(targetField, newWords.join(' '));
  };
  
  // Check if a keyword is active in any filter
  const isKeywordActive = (keyword: string): keyof AdvancedFilters | null => {
    const lowerKeyword = keyword.toLowerCase();
    
    for (const field of ['allWords', 'exactPhrase', 'anyWords', 'excludeWords'] as const) {
      const words = filters[field].toLowerCase().split(/\s+/).filter(Boolean);
      if (words.includes(lowerKeyword)) {
        return field;
      }
    }
    return null;
  };
  
  const activeCount = [
    filters.allWords,
    filters.exactPhrase,
    filters.anyWords,
    filters.excludeWords,
  ].filter(Boolean).length;

  // Get field color for visual feedback
  const getFieldColor = (field: keyof AdvancedFilters) => {
    switch (field) {
      case 'allWords': return 'bg-blue-500/20 text-blue-700 border-blue-500/30';
      case 'exactPhrase': return 'bg-purple-500/20 text-purple-700 border-purple-500/30';
      case 'anyWords': return 'bg-emerald-500/20 text-emerald-700 border-emerald-500/30';
      case 'excludeWords': return 'bg-red-500/20 text-red-700 border-red-500/30';
      default: return '';
    }
  };

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
          {/* Keyword Suggestions Section */}
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSuggestions(!showSuggestions)}
              className="w-full justify-between text-xs h-7"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" />
                Sugestões de palavras-chave
              </span>
              {showSuggestions ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>
            
            {showSuggestions && (
              <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
                <p className="text-[10px] text-muted-foreground">
                  Clique para adicionar ao campo desejado. Clique novamente para remover.
                </p>
                
                {Object.entries(KEYWORD_SUGGESTIONS).map(([categoryKey, category]) => (
                  <div key={categoryKey} className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      {category.label}
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {category.keywords.map((keyword) => {
                        const activeField = isKeywordActive(keyword);
                        
                        return (
                          <Tooltip key={keyword}>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className={`cursor-pointer text-[10px] px-1.5 py-0 h-5 transition-all ${
                                  activeField 
                                    ? getFieldColor(activeField)
                                    : 'hover:bg-accent'
                                }`}
                                onClick={() => {
                                  if (activeField) {
                                    removeKeywordFromFilter(keyword, activeField);
                                  } else {
                                    // Default: add to "anyWords" (OR) for most, "excludeWords" for exclusion category
                                    const targetField = categoryKey === 'exclusao' ? 'excludeWords' : 'anyWords';
                                    addKeywordToFilter(keyword, targetField);
                                  }
                                }}
                              >
                                {activeField && <X className="h-2 w-2 mr-0.5" />}
                                {keyword}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {activeField 
                                ? `Clique para remover de "${getFieldLabel(activeField)}"`
                                : `Clique para adicionar a "${categoryKey === 'exclusao' ? 'Excluir' : 'Ao menos uma'}"`
                              }
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                ))}
                
                {/* Quick action buttons */}
                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] flex-1"
                    onClick={() => {
                      // Add common accident-related words
                      const accidentWords = ['acidente', 'morte', 'trabalho'];
                      accidentWords.forEach(w => {
                        if (!isKeywordActive(w)) addKeywordToFilter(w, 'anyWords');
                      });
                    }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Acidentes de trabalho
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] flex-1"
                    onClick={() => {
                      // Add common family-related words
                      const familyWords = ['família', 'parente', 'amigo', 'conhecido'];
                      familyWords.forEach(w => {
                        if (!isKeywordActive(w)) addKeywordToFilter(w, 'anyWords');
                      });
                    }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Relacionamentos
                  </Button>
                </div>
              </div>
            )}
          </div>
          
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
              <div className="w-2 h-2 rounded-full bg-blue-500/50" title="Cor: Azul" />
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
              <div className="w-2 h-2 rounded-full bg-purple-500/50" title="Cor: Roxo" />
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
              <div className="w-2 h-2 rounded-full bg-emerald-500/50" title="Cor: Verde" />
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
              <div className="w-2 h-2 rounded-full bg-red-500/50" title="Cor: Vermelho" />
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

// Helper function to get field label
function getFieldLabel(field: keyof AdvancedFilters): string {
  switch (field) {
    case 'allWords': return 'Todas';
    case 'exactPhrase': return 'Frase exata';
    case 'anyWords': return 'Ao menos uma';
    case 'excludeWords': return 'Excluir';
    default: return '';
  }
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
