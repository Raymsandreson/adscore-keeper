import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Users,
  Plus,
  Search,
  MoreVertical,
  Trash2,
  Link2,
  ArrowRight,
  ArrowLeft,
  Heart,
  Handshake,
  Megaphone,
  Briefcase,
  Baby,
  Smile,
  UserPlus,
  X,
} from 'lucide-react';
import { 
  useContactRelationships, 
  ContactRelationship,
  ContactRelationshipType 
} from '@/hooks/useContactRelationships';
import { Contact } from '@/hooks/useContacts';
import { supabase } from '@/integrations/supabase/client';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface ContactRelationshipsManagerProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const iconMap: Record<string, React.ReactNode> = {
  megaphone: <Megaphone className="h-4 w-4" />,
  handshake: <Handshake className="h-4 w-4" />,
  heart: <Heart className="h-4 w-4" />,
  baby: <Baby className="h-4 w-4" />,
  users: <Users className="h-4 w-4" />,
  briefcase: <Briefcase className="h-4 w-4" />,
  smile: <Smile className="h-4 w-4" />,
  'user-plus': <UserPlus className="h-4 w-4" />,
};

export const ContactRelationshipsManager: React.FC<ContactRelationshipsManagerProps> = ({
  contact,
  open,
  onOpenChange,
}) => {
  const {
    relationships,
    relationshipTypes,
    loading,
    addRelationship,
    removeRelationship,
    addRelationshipType,
  } = useContactRelationships(contact?.id);

  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedType, setSelectedType] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Add new type state
  const [isAddingType, setIsAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  // Search for contacts
  useEffect(() => {
    const searchContacts = async () => {
      if (!searchQuery.trim() || searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .neq('id', contact?.id || '')
          .or(`full_name.ilike.%${searchQuery}%,instagram_username.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`)
          .limit(10);

        if (error) throw error;
        setSearchResults((data || []) as Contact[]);
      } catch (error) {
        console.error('Error searching contacts:', error);
      } finally {
        setIsSearching(false);
      }
    };

    const debounce = setTimeout(searchContacts, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, contact?.id]);

  const handleAddRelationship = async () => {
    if (!selectedContact || !selectedType) return;

    await addRelationship(selectedContact.id, selectedType, notes);
    resetForm();
  };

  const handleAddNewType = async () => {
    if (!newTypeName.trim()) return;
    
    const result = await addRelationshipType(newTypeName);
    if (result) {
      setSelectedType(result.name);
      setIsAddingType(false);
      setNewTypeName('');
    }
  };

  const resetForm = () => {
    setIsAdding(false);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedContact(null);
    setSelectedType('');
    setNotes('');
  };

  const getIcon = (iconName: string) => {
    return iconMap[iconName] || <Users className="h-4 w-4" />;
  };

  const getInverseLabel = (type: string) => {
    const inverseMap: Record<string, string> = {
      'Indicação': 'Indicado por',
      'Parceiro': 'Parceiro de',
      'Mãe': 'Filho(a) de',
      'Pai': 'Filho(a) de',
      'Esposa': 'Marido de',
      'Marido': 'Esposa de',
      'Filho(a)': 'Pai/Mãe de',
      'Irmão(ã)': 'Irmão(ã) de',
      'Colega de trabalho': 'Colega de trabalho de',
      'Amigo(a)': 'Amigo(a) de',
      'Cliente indicado': 'Indicou',
    };
    return inverseMap[type] || type;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            Vínculos de {contact?.full_name}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 mt-4">
          {/* Add new relationship button */}
          {!isAdding ? (
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => setIsAdding(true)}
            >
              <Plus className="h-4 w-4" />
              Adicionar Vínculo
            </Button>
          ) : (
            <div className="p-4 border rounded-lg space-y-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">Novo Vínculo</h4>
                <Button variant="ghost" size="sm" onClick={resetForm}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Search contact */}
              {!selectedContact ? (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Buscar contato</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Digite nome, @instagram ou telefone..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8"
                      autoFocus
                    />
                  </div>
                  
                  {searchResults.length > 0 && (
                    <div className="border rounded-lg max-h-40 overflow-y-auto">
                      {searchResults.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setSelectedContact(c);
                            setSearchQuery('');
                            setSearchResults([]);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 text-sm"
                        >
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                            {c.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{c.full_name}</p>
                            {c.instagram_username && (
                              <p className="text-xs text-pink-500">@{c.instagram_username}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Nenhum contato encontrado
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {/* Selected contact preview */}
                  <div className="flex items-center gap-2 p-2 bg-primary/5 rounded-lg">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                      {selectedContact.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{selectedContact.full_name}</p>
                      {selectedContact.instagram_username && (
                        <p className="text-xs text-pink-500">@{selectedContact.instagram_username}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedContact(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Relationship type selection */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Tipo de vínculo</Label>
                    {isAddingType ? (
                      <div className="flex gap-2">
                        <Input
                          placeholder="Nome do vínculo"
                          value={newTypeName}
                          onChange={(e) => setNewTypeName(e.target.value)}
                          className="flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddNewType();
                            if (e.key === 'Escape') setIsAddingType(false);
                          }}
                        />
                        <Button size="sm" onClick={handleAddNewType}>
                          Criar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setIsAddingType(false)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Select value={selectedType} onValueChange={setSelectedType}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o tipo de vínculo" />
                        </SelectTrigger>
                        <SelectContent>
                          {relationshipTypes.map((type) => (
                            <SelectItem key={type.id} value={type.name}>
                              <div className="flex items-center gap-2">
                                {getIcon(type.icon)}
                                {type.name}
                              </div>
                            </SelectItem>
                          ))}
                          <div className="border-t mt-1 pt-1">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsAddingType(true);
                              }}
                              className="w-full px-2 py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2"
                            >
                              <Plus className="h-4 w-4" />
                              Novo tipo de vínculo...
                            </button>
                          </div>
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Observações (opcional)</Label>
                    <Textarea
                      placeholder="Detalhes sobre este vínculo..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={handleAddRelationship}
                    disabled={!selectedType}
                  >
                    <Link2 className="h-4 w-4 mr-2" />
                    Criar Vínculo
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Existing relationships */}
          <ScrollArea className="flex-1">
            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Carregando...
                </div>
              ) : relationships.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Nenhum vínculo cadastrado</p>
                  <p className="text-xs mt-1">
                    Adicione vínculos para rastrear indicações, parentesco e parcerias
                  </p>
                </div>
              ) : (
                relationships.map((rel) => {
                  const typeInfo = relationshipTypes.find(t => t.name === rel.relationship_type);
                  return (
                    <div
                      key={rel.id}
                      className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors"
                    >
                      {/* Direction indicator */}
                      <div className="flex-shrink-0">
                        {rel.isInverse ? (
                          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ArrowRight className="h-4 w-4 text-primary" />
                        )}
                      </div>

                      {/* Contact avatar */}
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-medium">
                        {rel.related_contact?.full_name?.charAt(0).toUpperCase() || '?'}
                      </div>

                      {/* Contact info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {rel.related_contact?.full_name || 'Contato desconhecido'}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs gap-1">
                            {getIcon(typeInfo?.icon || 'users')}
                            {rel.isInverse 
                              ? getInverseLabel(rel.relationship_type)
                              : rel.relationship_type}
                          </Badge>
                          {rel.related_contact?.instagram_username && (
                            <span className="text-xs text-pink-500">
                              @{rel.related_contact.instagram_username}
                            </span>
                          )}
                        </div>
                        {rel.notes && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {rel.notes}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => removeRelationship(rel.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remover vínculo
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ContactRelationshipsManager;
