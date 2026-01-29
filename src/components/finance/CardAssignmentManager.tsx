import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CreditCard, UserCheck, Trash2, Link2, Search, Pencil } from 'lucide-react';
import { CardAssignment, useExpenseCategories } from '@/hooks/useExpenseCategories';
import { useLeads, Lead } from '@/hooks/useLeads';

interface CardAssignmentManagerProps {
  availableCards: string[]; // card_last_digits from transactions
}

export function CardAssignmentManager({ availableCards }: CardAssignmentManagerProps) {
  const { cardAssignments, assignCard, updateCardAssignment, removeCardAssignment } = useExpenseCategories();
  const { leads } = useLeads();
  const [isOpen, setIsOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<CardAssignment | null>(null);
  const [selectedCard, setSelectedCard] = useState('');
  const [cardName, setCardName] = useState('');
  const [selectedLead, setSelectedLead] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const unassignedCards = availableCards.filter(
    card => !cardAssignments.some(a => a.card_last_digits === card)
  );

  const filteredLeads = leads.filter(lead => 
    lead.lead_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.instagram_username?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAssign = async () => {
    if (!selectedCard || !selectedLead) return;

    const lead = leads.find(l => l.id === selectedLead);
    
    await assignCard({
      card_last_digits: selectedCard,
      card_name: cardName || null,
      lead_id: selectedLead,
      lead_name: lead?.lead_name || lead?.instagram_username || 'Acolhedor',
    });

    closeDialog();
  };

  const handleEdit = async () => {
    if (!editingAssignment) return;

    await updateCardAssignment(editingAssignment.id, {
      card_name: cardName || null,
      lead_id: selectedLead || editingAssignment.lead_id,
      lead_name: selectedLead 
        ? (leads.find(l => l.id === selectedLead)?.lead_name || leads.find(l => l.id === selectedLead)?.instagram_username || 'Acolhedor')
        : editingAssignment.lead_name,
    });

    closeDialog();
  };

  const openEditDialog = (assignment: CardAssignment) => {
    setEditingAssignment(assignment);
    setSelectedCard(assignment.card_last_digits);
    setCardName(assignment.card_name || '');
    setSelectedLead(assignment.lead_id || '');
    setIsOpen(true);
  };

  const closeDialog = () => {
    setIsOpen(false);
    setEditingAssignment(null);
    setSelectedCard('');
    setCardName('');
    setSelectedLead('');
    setSearchTerm('');
  };

  const getLeadDisplay = (lead: Lead) => {
    return lead.lead_name || lead.instagram_username || 'Sem nome';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Cartões x Acolhedores
          </CardTitle>
          <Dialog open={isOpen} onOpenChange={(open) => !open && closeDialog()}>
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
                      <SelectContent>
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
                  <Label>Acolhedor (Lead)</Label>
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
                      {filteredLeads.length === 0 ? (
                        <p className="text-sm text-muted-foreground p-2 text-center">
                          Nenhum lead encontrado
                        </p>
                      ) : (
                        filteredLeads.map((lead) => (
                          <button
                            key={lead.id}
                            type="button"
                            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                              selectedLead === lead.id 
                                ? 'bg-primary text-primary-foreground' 
                                : 'hover:bg-muted'
                            }`}
                            onClick={() => setSelectedLead(lead.id)}
                          >
                            <p className="font-medium">{getLeadDisplay(lead)}</p>
                            {lead.lead_phone && (
                              <p className="text-xs opacity-70">{lead.lead_phone}</p>
                            )}
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
                    <Button onClick={handleAssign} disabled={!selectedCard || !selectedLead}>
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
                    <p className="text-xs text-muted-foreground">
                      {assignment.lead_name || 'Acolhedor'}
                    </p>
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
      </CardContent>
    </Card>
  );
}
