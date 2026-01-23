import React, { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Users, Search, UserPlus, Loader2, Check, X, Trash2, RefreshCw } from 'lucide-react';

interface Contact {
  id: string;
  full_name: string;
  instagram_username?: string | null;
}

interface EditRelationshipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relationshipId: string;
  relationshipType: string;
  currentRelatedContact: {
    id: string;
    full_name: string;
  };
  contactId: string;
  contactName: string;
  onComplete: () => void;
}

export const EditRelationshipDialog: React.FC<EditRelationshipDialogProps> = ({
  open,
  onOpenChange,
  relationshipId,
  relationshipType,
  currentRelatedContact,
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
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      resetState();
    }
  }, [open]);

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
        .neq('id', contactId)
        .neq('id', currentRelatedContact.id)
        .limit(10);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error('Error searching contacts:', error);
    } finally {
      setSearching(false);
    }
  }, [contactId, currentRelatedContact.id]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    searchContacts(value);
  };

  const handleUpdateRelationship = async () => {
    setSaving(true);
    try {
      let newRelatedContactId = selectedContact;

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
        newRelatedContactId = newContact?.id || null;
        toast.success(`Contato "${newContactName}" criado!`);
      }

      if (!newRelatedContactId) {
        toast.error('Selecione um contato');
        return;
      }

      // Update the relationship
      const { error } = await supabase
        .from('contact_relationships')
        .update({ related_contact_id: newRelatedContactId })
        .eq('id', relationshipId);

      if (error) throw error;

      toast.success('Relacionamento atualizado!');
      onComplete();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating relationship:', error);
      toast.error('Erro ao atualizar relacionamento');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRelationship = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('contact_relationships')
        .delete()
        .eq('id', relationshipId);

      if (error) throw error;

      toast.success('Vínculo removido!');
      onComplete();
      onOpenChange(false);
    } catch (error) {
      console.error('Error deleting relationship:', error);
      toast.error('Erro ao remover vínculo');
    } finally {
      setDeleting(false);
    }
  };

  const resetState = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedContact(null);
    setCreateNew(false);
    setNewContactName('');
  };

  const formattedType = relationshipType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());

  const firstName = currentRelatedContact.full_name.split(' ')[0];

  return (
    <Dialog open={open} onOpenChange={(value) => {
      if (!value) resetState();
      onOpenChange(value);
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Editar Relacionamento
          </DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{contactName}</strong> é{' '}
            <strong className="text-foreground">{formattedType}</strong> de{' '}
            <strong className="text-foreground">{currentRelatedContact.full_name}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current relationship info */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
            <div>
              <p className="text-sm text-muted-foreground">Vínculo atual:</p>
              <p className="font-medium">{formattedType} de {firstName}</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteRelationship}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Remover
                </>
              )}
            </Button>
          </div>

          <Separator />

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4" />
            <span>Alterar para outro contato:</span>
          </div>

          {!createNew ? (
            <>
              {/* Search existing contacts */}
              <div className="space-y-2">
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
                <ScrollArea className="h-[140px] border rounded-md p-2">
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
                  Um novo contato será criado e vinculado como "{formattedType}" de {contactName}
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button 
            variant="ghost" 
            onClick={() => onOpenChange(false)} 
            className="w-full sm:w-auto"
          >
            Cancelar
          </Button>
          <Button 
            onClick={handleUpdateRelationship}
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
                Alterar vínculo
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
