import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Users,
  Plus,
  Search,
  MoreVertical,
  Trash2,
  ArrowRight,
  ArrowLeft,
  Heart,
  Handshake,
  Megaphone,
  Briefcase,
  Baby,
  Smile,
  UserPlus,
  Building2,
  Gavel,
  X,
  Filter,
} from 'lucide-react';
import { useContactRelationships } from '@/hooks/useContactRelationships';
import { Contact } from '@/hooks/useContacts';
import { supabase } from '@/integrations/supabase/client';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const iconMap: Record<string, React.ReactNode> = {
  megaphone: <Megaphone className="h-4 w-4" />,
  handshake: <Handshake className="h-4 w-4" />,
  heart: <Heart className="h-4 w-4" />,
  baby: <Baby className="h-4 w-4" />,
  users: <Users className="h-4 w-4" />,
  briefcase: <Briefcase className="h-4 w-4" />,
  smile: <Smile className="h-4 w-4" />,
  'user-plus': <UserPlus className="h-4 w-4" />,
  building: <Building2 className="h-4 w-4" />,
  gavel: <Gavel className="h-4 w-4" />,
};

export const getRelationshipIcon = (iconName?: string) =>
  iconMap[iconName || 'users'] || <Users className="h-4 w-4" />;

const INVERSE_LABELS: Record<string, string> = {
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
  'Empregado de': 'Empregador de',
  'Ex-empregado de': 'Ex-empregador de',
  'Terceirizado em': 'Contratante de terceirizado',
  'Chefe/Supervisor de': 'Subordinado de',
  'RH/Preposto de': 'Empresa de',
  'Sindicato/CIPA de': 'Tem representante sindical/CIPA',
  'Testemunha de': 'Tem como testemunha',
  'Ponte na empresa': 'Tem ponte',
};

export const getInverseRelationshipLabel = (type: string) => INVERSE_LABELS[type] || type;

interface ContactRelationshipsPanelProps {
  contact: Contact | null;
  /**
   * true quando o painel já está dentro de um container que rola (ex.: aba do
   * ContactDetailSheet). Evita ScrollArea aninhada, que trava a rolagem.
   */
  embedded?: boolean;
}

/**
 * Corpo da gestão de vínculos: formulário de adicionar + filtro + lista.
 * Usado tanto pelo ContactRelationshipsManager (dentro de um Sheet próprio)
 * quanto embutido na aba "Vínculos" do ContactDetailSheet.
 */
export const ContactRelationshipsPanel: React.FC<ContactRelationshipsPanelProps> = ({
  contact,
  embedded = false,
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
  const [saving, setSaving] = useState(false);

  // Novo tipo de vínculo
  const [isAddingType, setIsAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  // Filtro
  const [filterType, setFilterType] = useState<string>('all');

  const filteredRelationships = filterType === 'all'
    ? relationships
    : relationships.filter((rel) => rel.relationship_type === filterType);

  const usedTypes = Array.from(new Set(relationships.map((r) => r.relationship_type)));

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

  const resetForm = () => {
    setIsAdding(false);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedContact(null);
    setSelectedType('');
    setNotes('');
  };

  const handleAddRelationship = async () => {
    if (!selectedContact || !selectedType || saving) return;
    setSaving(true);
    try {
      await addRelationship(selectedContact.id, selectedType, notes);
      resetForm();
    } finally {
      setSaving(false);
    }
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

  const list = (
    <div className="space-y-2">
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Carregando...</div>
      ) : relationships.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>Nenhum vínculo cadastrado</p>
          <p className="text-xs mt-1">
            Use o botão acima para registrar indicações, parentesco, parcerias e
            vínculos de trabalho (empregado de uma empresa, testemunha, ponte).
          </p>
        </div>
      ) : filteredRelationships.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Filter className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Nenhum vínculo deste tipo</p>
        </div>
      ) : (
        filteredRelationships.map((rel) => {
          const typeInfo = relationshipTypes.find((t) => t.name === rel.relationship_type);
          return (
            <div
              key={rel.id}
              className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors"
            >
              <div className="flex-shrink-0">
                {rel.isInverse ? (
                  <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ArrowRight className="h-4 w-4 text-primary" />
                )}
              </div>

              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-medium">
                {rel.related_contact?.full_name?.charAt(0).toUpperCase() || '?'}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {rel.related_contact?.full_name || 'Contato desconhecido'}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs gap-1">
                    {getRelationshipIcon(typeInfo?.icon)}
                    {rel.isInverse
                      ? getInverseRelationshipLabel(rel.relationship_type)
                      : rel.relationship_type}
                  </Badge>
                  {rel.related_contact?.instagram_username && (
                    <span className="text-xs text-pink-500">
                      @{rel.related_contact.instagram_username}
                    </span>
                  )}
                </div>
                {rel.notes && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">{rel.notes}</p>
                )}
              </div>

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
  );

  return (
    <div className={embedded ? 'flex flex-col gap-4' : 'flex-1 overflow-hidden flex flex-col gap-4'}>
      {/* Adicionar vínculo */}
      {!isAdding ? (
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => setIsAdding(true)}
          disabled={!contact}
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

          {!selectedContact ? (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Buscar contato ou empresa
              </Label>
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
                <Button variant="ghost" size="sm" onClick={() => setSelectedContact(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

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
                            {getRelationshipIcon(type.icon)}
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

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Observações (opcional)</Label>
                <Textarea
                  placeholder="Ex.: setor, cargo, desde quando trabalha lá, se pode falar da gente..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>

              <Button
                className="w-full"
                onClick={handleAddRelationship}
                disabled={!selectedType || saving}
              >
                <Plus className="h-4 w-4 mr-2" />
                {saving ? 'Criando...' : 'Criar Vínculo'}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Filtro por tipo */}
      {relationships.length > 0 && (
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Filtrar por tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os vínculos</SelectItem>
              {usedTypes.map((type) => {
                const typeInfo = relationshipTypes.find((t) => t.name === type);
                const count = relationships.filter((r) => r.relationship_type === type).length;
                return (
                  <SelectItem key={type} value={type}>
                    <div className="flex items-center gap-2">
                      {getRelationshipIcon(typeInfo?.icon)}
                      {type}
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {count}
                      </Badge>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      {embedded ? list : <ScrollArea className="flex-1">{list}</ScrollArea>}
    </div>
  );
};

export default ContactRelationshipsPanel;
