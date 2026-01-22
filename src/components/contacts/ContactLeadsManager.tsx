import React, { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Users,
  Search,
  Plus,
  Unlink,
  MoreVertical,
  MapPin,
  Phone,
  Mail,
  Sparkles,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { useContactLeads, useSearchLeads } from '@/hooks/useContactLeads';
import { useContactBridges } from '@/hooks/useContactBridges';
import { Contact } from '@/hooks/useContacts';

interface ContactLeadsManagerProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ContactLeadsManager: React.FC<ContactLeadsManagerProps> = ({
  contact,
  open,
  onOpenChange,
}) => {
  const { leads, loading, linkLead, unlinkLead } = useContactLeads(contact?.id);
  const { results: searchResults, loading: searchLoading, searchLeads } = useSearchLeads();
  const { suggestions, loading: bridgesLoading, findBridgesForContact } = useContactBridges();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [showBridges, setShowBridges] = useState(false);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        const excludeIds = leads.map(l => l.lead_id);
        searchLeads(searchQuery, excludeIds);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, leads]);

  // Load bridge suggestions
  useEffect(() => {
    if (showBridges && contact?.id) {
      findBridgesForContact(contact.id);
    }
  }, [showBridges, contact?.id, findBridgesForContact]);

  const handleLinkLead = async (leadId: string) => {
    await linkLead(leadId);
    setSearchQuery('');
  };

  if (!contact) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[500px] sm:max-w-[500px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Leads vinculados a {contact.full_name}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Search to add new lead link */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Vincular novo lead</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar lead por nome, telefone ou email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Search results */}
            {searchQuery && (
              <div className="border rounded-lg overflow-hidden">
                {searchLoading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Nenhum lead encontrado
                  </div>
                ) : (
                  <div className="divide-y max-h-[200px] overflow-y-auto">
                    {searchResults.map((lead) => (
                      <div
                        key={lead.id}
                        className="p-3 hover:bg-muted/50 flex items-center justify-between cursor-pointer"
                        onClick={() => handleLinkLead(lead.id)}
                      >
                        <div>
                          <p className="font-medium text-sm">{lead.lead_name || 'Sem nome'}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {lead.city && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {lead.city}{lead.state && `, ${lead.state}`}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button size="sm" variant="ghost">
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bridge Suggestions Toggle */}
          <div className="flex items-center justify-between">
            <Button
              variant={showBridges ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowBridges(!showBridges)}
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Sugestões de Pontes
            </Button>
            {contact.city && (
              <Badge variant="outline" className="text-xs">
                <MapPin className="h-3 w-3 mr-1" />
                {contact.city}{contact.state && `, ${contact.state}`}
              </Badge>
            )}
          </div>

          {/* Bridge Suggestions */}
          {showBridges && (
            <div className="border rounded-lg p-3 bg-gradient-to-br from-purple-50/50 to-blue-50/50 dark:from-purple-950/20 dark:to-blue-950/20">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                Leads próximos para conectar
              </h4>
              {bridgesLoading ? (
                <div className="py-4 text-center">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </div>
              ) : suggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  Nenhuma sugestão encontrada. Adicione dados de localização ao contato para ver sugestões.
                </p>
              ) : (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {suggestions.map((suggestion) => (
                    <div
                      key={suggestion.leadId}
                      className="bg-background rounded-lg p-2 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium text-sm">{suggestion.leadName}</p>
                        <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleLinkLead(suggestion.leadId)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Linked Leads List */}
          <div>
            <h4 className="text-sm font-medium mb-2">
              Leads vinculados ({leads.length})
            </h4>
            {loading ? (
              <div className="py-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : leads.length === 0 ? (
              <div className="py-8 text-center border rounded-lg bg-muted/30">
                <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Este contato não está vinculado a nenhum lead
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {leads.map((link) => (
                    <div
                      key={link.id}
                      className="border rounded-lg p-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <p className="font-medium text-sm">
                            {link.lead?.lead_name || 'Lead sem nome'}
                          </p>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            {link.lead?.lead_phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {link.lead.lead_phone}
                              </span>
                            )}
                            {link.lead?.lead_email && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {link.lead.lead_email}
                              </span>
                            )}
                            {link.lead?.city && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {link.lead.city}{link.lead.state && `, ${link.lead.state}`}
                              </span>
                            )}
                          </div>
                          {link.lead?.status && (
                            <Badge variant="outline" className="text-xs mt-1">
                              {link.lead.status}
                            </Badge>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => window.open(`/leads?lead=${link.lead_id}`, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Ver Lead
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => unlinkLead(link.lead_id)}
                            >
                              <Unlink className="h-4 w-4 mr-2" />
                              Desvincular
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ContactLeadsManager;
