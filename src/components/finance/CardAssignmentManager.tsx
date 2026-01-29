import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CreditCard, UserCheck, Trash2, Link2, Search, Pencil, Users } from 'lucide-react';
import { CardAssignment, useExpenseCategories } from '@/hooks/useExpenseCategories';
import { supabase } from '@/integrations/supabase/client';

interface Contact {
  id: string;
  full_name: string;
  instagram_username: string | null;
  phone: string | null;
  classification: string | null;
  classifications: string[] | null;
}

interface CardAssignmentManagerProps {
  availableCards: string[]; // card_last_digits from transactions
}

export function CardAssignmentManager({ availableCards }: CardAssignmentManagerProps) {
  const { cardAssignments, assignCard, updateCardAssignment, removeCardAssignment } = useExpenseCategories();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<CardAssignment | null>(null);
  const [selectedCard, setSelectedCard] = useState('');
  const [cardName, setCardName] = useState('');
  const [selectedContact, setSelectedContact] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Fetch contacts with "acolhedor" classification
  useEffect(() => {
    const fetchAcolhedores = async () => {
      setLoadingContacts(true);
      try {
        const { data, error } = await supabase
          .from('contacts')
          .select('id, full_name, instagram_username, phone, classification, classifications')
          .order('full_name', { ascending: true });

        if (error) throw error;
        
        // Filter contacts that have "acolhedor" in their classifications
        const acolhedores = (data || []).filter(contact => {
          const hasAcolhedorClassification = 
            contact.classification?.toLowerCase() === 'acolhedor' ||
            (contact.classifications || []).some(c => c.toLowerCase() === 'acolhedor');
          return hasAcolhedorClassification;
        });
        
        setContacts(acolhedores);
      } catch (err) {
        console.error('Error fetching contacts:', err);
      } finally {
        setLoadingContacts(false);
      }
    };

    fetchAcolhedores();
  }, []);

  const unassignedCards = availableCards.filter(
    card => !cardAssignments.some(a => a.card_last_digits === card)
  );

  const filteredContacts = contacts.filter(contact => 
    contact.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.instagram_username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.phone?.includes(searchTerm)
  );

  const handleAssign = async () => {
    if (!selectedCard || !selectedContact) return;

    const contact = contacts.find(c => c.id === selectedContact);
    
    await assignCard({
      card_last_digits: selectedCard,
      card_name: cardName || null,
      contact_id: selectedContact,
      lead_name: contact?.full_name || contact?.instagram_username || 'Acolhedor',
    });

    closeDialog();
  };

  const handleEdit = async () => {
    if (!editingAssignment) return;

    const contact = selectedContact ? contacts.find(c => c.id === selectedContact) : null;
    
    await updateCardAssignment(editingAssignment.id, {
      card_name: cardName || null,
      contact_id: selectedContact || editingAssignment.contact_id,
      lead_name: contact 
        ? (contact.full_name || contact.instagram_username || 'Acolhedor')
        : editingAssignment.lead_name,
    });

    closeDialog();
  };

  const openEditDialog = (assignment: CardAssignment) => {
    setEditingAssignment(assignment);
    setSelectedCard(assignment.card_last_digits);
    setCardName(assignment.card_name || '');
    setSelectedContact(assignment.contact_id || '');
    setIsOpen(true);
  };

  const closeDialog = () => {
    setIsOpen(false);
    setEditingAssignment(null);
    setSelectedCard('');
    setCardName('');
    setSelectedContact('');
    setSearchTerm('');
  };

  const getContactDisplay = (contact: Contact) => {
    return contact.full_name || contact.instagram_username || 'Sem nome';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Cartões x Acolhedores
          </CardTitle>
          <Dialog open={isOpen} onOpenChange={(open) => open ? setIsOpen(true) : closeDialog()}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={unassignedCards.length === 0}>
                <Link2 className="h-4 w-4 mr-2" />
                Vincular Cartão
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingAssignment ? 'Editar Cartão' : 'Vincular Cartão a Acolhedor'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {!editingAssignment && (
                  <div>
                    <Label>Cartão</Label>
                    <Select value={selectedCard} onValueChange={setSelectedCard}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o cartão..." />
                      </SelectTrigger>
                      <SelectContent className="z-[100] bg-popover">
                        {unassignedCards.map((card) => (
                          <SelectItem key={card} value={card}>
                            <div className="flex items-center gap-2">
                              <CreditCard className="h-4 w-4" />
                              **** {card}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {editingAssignment && (
                  <div>
                    <Label>Cartão</Label>
                    <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
                      <CreditCard className="h-4 w-4" />
                      <span className="font-mono">**** {editingAssignment.card_last_digits}</span>
                    </div>
                  </div>
                )}

                <div>
                  <Label>Nome do Cartão (opcional)</Label>
                  <Input
                    placeholder="Ex: Cartão Corporativo João"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Um nome amigável para identificar este cartão
                  </p>
                </div>

                <div>
                  <Label className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Acolhedor (Contato)
                  </Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Apenas contatos com classificação "acolhedor" aparecem aqui
                  </p>
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar acolhedor..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <ScrollArea className="h-48 border rounded-md">
                    <div className="p-2 space-y-1">
                      {loadingContacts ? (
                        <p className="text-sm text-muted-foreground p-2 text-center">
                          Carregando...
                        </p>
                      ) : filteredContacts.length === 0 ? (
                        <div className="text-sm text-muted-foreground p-4 text-center space-y-2">
                          <p>Nenhum acolhedor encontrado</p>
                          <p className="text-xs">
                            Adicione a classificação "acolhedor" a um contato para vinculá-lo
                          </p>
                        </div>
                      ) : (
                        filteredContacts.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                              selectedContact === contact.id 
                                ? 'bg-primary text-primary-foreground' 
                                : 'hover:bg-muted'
                            }`}
                            onClick={() => setSelectedContact(contact.id)}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium">{getContactDisplay(contact)}</p>
                                {contact.instagram_username && contact.full_name && (
                                  <p className="text-xs opacity-70">@{contact.instagram_username}</p>
                                )}
                                {contact.phone && (
                                  <p className="text-xs opacity-70">{contact.phone}</p>
                                )}
                              </div>
                              <Badge variant="secondary" className="text-xs">
                                Acolhedor
                              </Badge>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={closeDialog}>
                    Cancelar
                  </Button>
                  {editingAssignment ? (
                    <Button onClick={handleEdit}>
                      Salvar
                    </Button>
                  ) : (
                    <Button onClick={handleAssign} disabled={!selectedCard || !selectedContact}>
                      Vincular
                    </Button>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {cardAssignments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhum cartão vinculado ainda
          </p>
        ) : (
          <div className="space-y-2">
            {cardAssignments.map((assignment) => (
              <div
                key={assignment.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <CreditCard className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {assignment.card_name || `**** ${assignment.card_last_digits}`}
                    </p>
                    {assignment.card_name && (
                      <p className="text-xs text-muted-foreground font-mono">
                        **** {assignment.card_last_digits}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        {assignment.lead_name || 'Acolhedor'}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(assignment)}
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCardAssignment(assignment.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {unassignedCards.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-muted-foreground mb-2">
              Cartões sem vínculo:
            </p>
            <div className="flex flex-wrap gap-2">
              {unassignedCards.map((card) => (
                <span
                  key={card}
                  className="px-2 py-1 bg-muted rounded text-xs font-mono"
                >
                  **** {card}
                </span>
              ))}
            </div>
          </div>
        )}

        {contacts.length === 0 && !loadingContacts && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-amber-600 dark:text-amber-400">
              💡 Dica: Para vincular cartões, adicione a classificação "acolhedor" aos contatos desejados em Contatos
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
