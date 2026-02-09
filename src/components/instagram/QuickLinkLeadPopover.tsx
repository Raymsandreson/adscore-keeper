import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Link2, 
  Search, 
  Plus, 
  Loader2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface Lead {
  id: string;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  status: string | null;
  board_id: string | null;
}

interface QuickLinkLeadPopoverProps {
  authorUsername: string | null;
  onLeadLinked?: () => void;
  hasLinkedLead?: boolean;
}

export const QuickLinkLeadPopover: React.FC<QuickLinkLeadPopoverProps> = ({
  authorUsername,
  onLeadLinked,
  hasLinkedLead = false,
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [contactId, setContactId] = useState<string | null>(null);

  // Find or create contact for this username
  const findOrCreateContact = useCallback(async () => {
    if (!authorUsername) return null;
    
    const normalizedUsername = authorUsername.startsWith('@') 
      ? authorUsername 
      : `@${authorUsername}`;
    
    // Check if contact exists
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('instagram_username', normalizedUsername)
      .maybeSingle();
    
    if (existingContact) {
      return existingContact.id;
    }
    
    // Create new contact
    const { data: newContact, error } = await supabase
      .from('contacts')
      .insert({
        full_name: authorUsername.replace('@', ''),
        instagram_username: normalizedUsername
      })
      .select('id')
      .single();
    
    if (error) {
      console.error('Error creating contact:', error);
      return null;
    }
    
    return newContact?.id || null;
  }, [authorUsername]);

  // Initialize contact on open
  useEffect(() => {
    if (open && authorUsername) {
      findOrCreateContact().then(id => setContactId(id));
    }
  }, [open, authorUsername, findOrCreateContact]);

  // Search leads with debounce
  useEffect(() => {
    if (!open) return;
    
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('leads')
          .select('id, lead_name, lead_phone, lead_email, status, board_id')
          .limit(10);
        
        if (searchQuery.trim()) {
          query = query.or(`lead_name.ilike.%${searchQuery}%,lead_phone.ilike.%${searchQuery}%,lead_email.ilike.%${searchQuery}%`);
        }
        
        const { data, error } = await query.order('created_at', { ascending: false });
        
        if (!error && data) {
          setSearchResults(data);
        }
      } catch (error) {
        console.error('Error searching leads:', error);
      } finally {
        setLoading(false);
      }
    }, 300);
    
    return () => clearTimeout(timer);
  }, [searchQuery, open]);

  const handleLinkLead = async (leadId: string) => {
    if (!contactId) {
      toast.error('Erro ao encontrar contato');
      return;
    }
    
    setLinking(true);
    try {
      const supabaseAny = supabase as any;
      const { error } = await supabaseAny
        .from('contact_leads')
        .insert({
          contact_id: contactId,
          lead_id: leadId
        });
      
      if (error) {
        if (error.code === '23505') {
          toast.info('Lead já está vinculado a este contato');
        } else {
          throw error;
        }
      } else {
        toast.success('Lead vinculado com sucesso!');
        onLeadLinked?.();
      }
      
      setOpen(false);
    } catch (error) {
      console.error('Error linking lead:', error);
      toast.error('Erro ao vincular lead');
    } finally {
      setLinking(false);
    }
  };

  const handleCreateNewLead = () => {
    const params = new URLSearchParams();
    if (authorUsername) {
      params.set('instagram', authorUsername.replace('@', ''));
      params.set('name', authorUsername.replace('@', ''));
    }
    if (contactId) {
      params.set('linkContact', contactId);
    }
    navigate(`/leads?${params.toString()}`);
    setOpen(false);
  };

  if (!authorUsername) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={hasLinkedLead 
            ? "h-7 text-xs border-green-500/50 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700/50"
            : "h-7 text-xs bg-blue-50 border-blue-200 hover:bg-blue-100 text-blue-700"
          }
        >
          <Link2 className="h-3 w-3 mr-1" />
          {hasLinkedLead ? "Lead ✓" : "Vincular Lead"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Vincular a um Lead</h4>
            <Badge variant="secondary" className="text-xs">
              @{authorUsername.replace('@', '')}
            </Badge>
          </div>
          
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar lead por nome, telefone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          
          <ScrollArea className="h-[200px]">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {searchQuery ? 'Nenhum lead encontrado' : 'Digite para buscar leads'}
              </div>
            ) : (
                <div className="space-y-2">
                {searchResults.map(lead => (
                  <button
                    key={lead.id}
                    type="button"
                    className="w-full flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => handleLinkLead(lead.id)}
                    disabled={linking}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {lead.lead_name || 'Sem nome'}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {lead.lead_phone && <span>{lead.lead_phone}</span>}
                        <Badge variant="secondary" className="text-xs">
                          {lead.status || 'new'}
                        </Badge>
                      </div>
                    </div>
                    <div className="ml-2 flex-shrink-0">
                      {linking ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <Link2 className="h-4 w-4 text-primary" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
          
          <div className="border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleCreateNewLead}
            >
              <Plus className="h-3 w-3 mr-1" />
              Criar novo lead
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
