import React, { useState, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Users, Search, UserPlus, Loader2, Check, X } from 'lucide-react';

interface Contact {
  id: string;
  full_name: string;
  instagram_username?: string | null;
}

interface RelationshipPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relationshipClassification: string;
  contactId: string | null;
  contactName: string;
  onComplete: (relatedContactId: string | null) => void;
}

// Relationship keywords to detect
export const RELATIONSHIP_KEYWORDS = [
  'primo', 'prima', 'tio', 'tia', 'pai', 'mãe', 'filho', 'filha', 
  'irmão', 'irmã', 'esposa', 'esposo', 'marido', 'parente', 'familia', 
  'familiar', 'cunhado', 'cunhada', 'sogro', 'sogra', 'genro', 'nora',
  'sobrinho', 'sobrinha', 'avô', 'avó', 'neto', 'neta', 'padrinho', 
  'madrinha', 'afilhado', 'afilhada', 'compadre', 'comadre'
];

export const isRelationshipClassification = (classification: string): boolean => {
  const lowerCase = classification.toLowerCase();
  return RELATIONSHIP_KEYWORDS.some(keyword => lowerCase.includes(keyword));
};

export const getRelationshipClassificationsFromList = (classifications: string[]): string[] => {
  return classifications.filter(cls => isRelationshipClassification(cls));
};

export const RelationshipPromptDialog: React.FC<RelationshipPromptDialogProps> = ({
  open,
  onOpenChange,
  relationshipClassification,
  contactId,
  contactName,
  onComplete
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [createNew, setCreateNew] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [saving, setSaving] = useState(false);

  const searchContacts = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, instagram_username')
        .or(`full_name.ilike.%${query}%,instagram_username.ilike.%${query}%`)
        .neq('id', contactId || '')
        .limit(10);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error('Error searching contacts:', error);
    } finally {
      setSearching(false);
    }
  }, [contactId]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    searchContacts(value);
  };

  const handleSave = async () => {
    if (!contactId) {
      toast.error('Contato de origem não encontrado');
      return;
    }

    setSaving(true);
    try {
      let relatedContactId = selectedContact;

      // Create new contact if needed
      if (createNew && newContactName.trim()) {
        const { data: newContact, error: createError } = await supabase
          .from('contacts')
          .insert({
            full_name: newContactName.trim(),
            classifications: []
          })
          .select('id')
          .single();

        if (createError) throw createError;
        relatedContactId = newContact?.id || null;
        toast.success(`Contato "${newContactName}" criado!`);
      }

      // Create relationship if we have a related contact
      if (relatedContactId) {
        // Check if relationship already exists
        const { data: existing } = await supabase
          .from('contact_relationships')
          .select('id')
          .eq('contact_id', contactId)
          .eq('related_contact_id', relatedContactId)
          .maybeSingle();

        if (!existing) {
          const { error: relError } = await supabase
            .from('contact_relationships')
            .insert({
              contact_id: contactId,
              related_contact_id: relatedContactId,
              relationship_type: relationshipClassification
            });

          if (relError) throw relError;
        } else {
          // Update existing relationship
          const { error: updateError } = await supabase
            .from('contact_relationships')
            .update({ relationship_type: relationshipClassification })
            .eq('id', existing.id);

          if (updateError) throw updateError;
        }

        toast.success('Relacionamento registrado!');
      }

      onComplete(relatedContactId);
      onOpenChange(false);
      resetState();
    } catch (error) {
      console.error('Error saving relationship:', error);
      toast.error('Erro ao salvar relacionamento');
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    onComplete(null);
    onOpenChange(false);
    resetState();
  };

  const resetState = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedContact(null);
    setCreateNew(false);
    setNewContactName('');
  };

  const formattedClassification = useMemo(() => {
    return relationshipClassification
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }, [relationshipClassification]);

  return (
    <Dialog open={open} onOpenChange={(value) => {
      if (!value) resetState();
      onOpenChange(value);
    }}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Em relação a quem?
          </DialogTitle>
          <DialogDescription>
            A classificação <strong className="text-foreground">{formattedClassification}</strong> de{' '}
            <strong className="text-foreground">{contactName}</strong> é em relação a quem?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 flex-1 overflow-y-auto">
          {!createNew ? (
            <>
              {/* Search existing contacts */}
              <div className="space-y-2">
                <Label>Buscar contato existente</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Digite o nome ou @instagram..."
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Search results */}
              {(searchResults.length > 0 || searching) && (
                <ScrollArea className="h-[160px] border rounded-md p-2">
                  {searching ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <RadioGroup value={selectedContact || ''} onValueChange={setSelectedContact}>
                      {searchResults.map(contact => (
                        <div 
                          key={contact.id}
                          className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-muted ${
                            selectedContact === contact.id ? 'bg-primary/10' : ''
                          }`}
                          onClick={() => setSelectedContact(contact.id)}
                        >
                          <RadioGroupItem value={contact.id} id={contact.id} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{contact.full_name}</p>
                            {contact.instagram_username && (
                              <p className="text-xs text-muted-foreground truncate">
                                @{contact.instagram_username.replace('@', '')}
                              </p>
                            )}
                          </div>
                          {selectedContact === contact.id && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      ))}
                    </RadioGroup>
                  )}
                </ScrollArea>
              )}

              {/* Create new option */}
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => setCreateNew(true)}
              >
                <UserPlus className="h-4 w-4" />
                Criar novo contato
              </Button>
            </>
          ) : (
            <>
              {/* New contact form */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Nome do novo contato</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreateNew(false)}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancelar
                  </Button>
                </div>
                <Input
                  placeholder="Ex: João da Silva"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Um novo contato será criado e vinculado como "{formattedClassification}" de {contactName}
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={handleSkip} className="w-full sm:w-auto">
            Pular
          </Button>
          <Button 
            onClick={handleSave}
            disabled={saving || (!selectedContact && (!createNew || !newContactName.trim()))}
            className="w-full sm:w-auto"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Confirmar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
