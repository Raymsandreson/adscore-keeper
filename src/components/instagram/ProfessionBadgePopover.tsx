import React, { useState, useCallback, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Briefcase, 
  Search, 
  Loader2, 
  Plus,
  Check,
  X
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CboProfession {
  id: string;
  cbo_code: string;
  title: string;
  family_code: string | null;
  family_title: string | null;
}

interface ProfessionBadgePopoverProps {
  contactId?: string;
  authorUsername?: string | null;
  profession?: string | null;
  professionCboCode?: string | null;
  compact?: boolean;
  interactive?: boolean;
  onDataChanged?: () => void;
}

export const ProfessionBadgePopover: React.FC<ProfessionBadgePopoverProps> = ({
  contactId,
  authorUsername,
  profession,
  professionCboCode,
  compact = false,
  interactive = false,
  onDataChanged
}) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CboProfession[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Search professions
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('cbo_professions')
        .select('*')
        .or(`title.ilike.%${query}%,cbo_code.ilike.%${query}%`)
        .order('title', { ascending: true })
        .limit(20);

      if (error) throw error;
      setSearchResults((data || []) as CboProfession[]);
    } catch (error) {
      console.error('Error searching professions:', error);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Load initial popular professions when popover opens
  useEffect(() => {
    if (open && searchQuery === '') {
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
        .limit(20);

      if (error) throw error;
      setSearchResults((data || []) as CboProfession[]);
    } catch (error) {
      console.error('Error loading professions:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSelectProfession = async (selected: CboProfession) => {
    if (!contactId && !authorUsername) {
      toast.error('Contato não encontrado');
      return;
    }

    setSaving(true);
    try {
      let targetContactId = contactId;
      
      // Create contact if doesn't exist
      if (!targetContactId && authorUsername) {
        const normalizedUsername = authorUsername.startsWith('@') ? authorUsername : `@${authorUsername}`;
        const cleanUsername = authorUsername.replace('@', '');
        
        const { data: newContact, error: createError } = await supabase
          .from('contacts')
          .insert({
            full_name: cleanUsername,
            instagram_username: normalizedUsername,
            profession: selected.title,
            profession_cbo_code: selected.cbo_code
          })
          .select('id')
          .single();
        
        if (createError) throw createError;
        targetContactId = newContact?.id;
      } else if (targetContactId) {
        // Update existing contact
        const { error } = await supabase
          .from('contacts')
          .update({ 
            profession: selected.title,
            profession_cbo_code: selected.cbo_code
          })
          .eq('id', targetContactId);
        
        if (error) throw error;
      }

      toast.success(`Profissão definida: ${selected.title}`);
      setOpen(false);
      setSearchQuery('');
      onDataChanged?.();
    } catch (error) {
      console.error('Error saving profession:', error);
      toast.error('Erro ao salvar profissão');
    } finally {
      setSaving(false);
    }
  };

  const handleClearProfession = async () => {
    if (!contactId) {
      toast.error('Contato não encontrado');
      return;
    }

    setClearing(true);
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ 
          profession: null,
          profession_cbo_code: null
        })
        .eq('id', contactId);
      
      if (error) throw error;

      toast.success('Profissão removida');
      setOpen(false);
      onDataChanged?.();
    } catch (error) {
      console.error('Error clearing profession:', error);
      toast.error('Erro ao remover profissão');
    } finally {
      setClearing(false);
    }
  };

  // If not interactive, just show static badge
  if (!interactive) {
    if (!profession) return null;
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className="text-xs gap-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
          >
            <Briefcase className="h-3 w-3" />
            {!compact && (profession.length > 20 ? `${profession.slice(0, 20)}...` : profession)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <p className="font-medium">{profession}</p>
            {professionCboCode && (
              <p className="text-muted-foreground">CBO: {professionCboCode}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Interactive mode - show popover
  return (
    <Popover modal={true} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" style={{ pointerEvents: "auto" }} className="inline-flex">
          {profession ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline" 
                  className="text-xs gap-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900"
                >
                  <Briefcase className="h-3 w-3" />
                  {!compact && (profession.length > 15 ? `${profession.slice(0, 15)}...` : profession)}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs">
                  <p className="font-medium">{profession}</p>
                  {professionCboCode && (
                    <p className="text-muted-foreground">CBO: {professionCboCode}</p>
                  )}
                  <p className="text-muted-foreground mt-1">Clique para alterar</p>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Badge 
              variant="outline" 
              className="text-xs gap-1 bg-muted/50 text-muted-foreground border-dashed cursor-pointer hover:bg-accent"
            >
              <Briefcase className="h-3 w-3" />
              {!compact && "Profissão"}
              <Plus className="h-2.5 w-2.5 ml-0.5 opacity-50" />
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Profissão (CBO)
            </h4>
            {profession && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={handleClearProfession}
                disabled={clearing}
              >
                {clearing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <X className="h-3 w-3 mr-1" />
                    Remover
                  </>
                )}
              </Button>
            )}
          </div>
          
          {profession && (
            <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{profession}</p>
              {professionCboCode && (
                <p className="text-xs text-amber-600 dark:text-amber-400">CBO: {professionCboCode}</p>
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
          
          <ScrollArea className="h-[200px]">
            {searchLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                {searchQuery.length < 2 ? 'Digite para buscar profissões' : 'Nenhuma profissão encontrada'}
              </div>
            ) : (
              <div className="space-y-1">
                {searchResults.map(prof => {
                  const isSelected = professionCboCode === prof.cbo_code;
                  return (
                    <button
                      key={prof.id}
                      type="button"
                      className={`w-full flex items-center justify-between p-2 rounded-md border transition-colors cursor-pointer text-left disabled:opacity-50 ${
                        isSelected 
                          ? 'bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800' 
                          : 'bg-card hover:bg-accent/50 border-transparent hover:border-border'
                      }`}
                      onClick={() => handleSelectProfession(prof)}
                      disabled={saving}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{prof.title}</p>
                        <p className="text-xs text-muted-foreground">CBO: {prof.cbo_code}</p>
                      </div>
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
                      ) : isSelected ? (
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
