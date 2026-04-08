import { useState, useEffect } from 'react';
import { useConfirmDelete } from '@/hooks/useConfirmDelete';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Users,
  Phone,
  Mail,
  Instagram,
  Search,
  Link2,
  Unlink,
  MoreVertical,
  Trash2,
  Edit2,
  MessageSquare,
  UserPlus,
  X,
} from 'lucide-react';
import { Lead } from '@/hooks/useLeads';
import { useLeadContacts, LeadContact } from '@/hooks/useLeadContacts';
import { useContactClassifications } from '@/hooks/useContactClassifications';

interface LeadContactsManagerProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadContactsManager({ lead, open, onOpenChange }: LeadContactsManagerProps) {
  const [activeTab, setActiveTab] = useState<'contacts' | 'add' | 'link'>('contacts');
  const [searchQuery, setSearchQuery] = useState('');
  const [unlinkedContacts, setUnlinkedContacts] = useState<LeadContact[]>([]);
  const [editingContact, setEditingContact] = useState<LeadContact | null>(null);

  // New contact form
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formInstagram, setFormInstagram] = useState('');
  const [formClassification, setFormClassification] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const {
    contacts,
    loading,
    addContactToLead,
    linkExistingContact,
    unlinkContact,
    updateContact,
    deleteContact,
    fetchUnlinkedContacts,
  } = useLeadContacts(lead?.id);

  // Use dynamic classifications from database
  const { classifications, classificationConfig } = useContactClassifications();

  // Helper to get label for a classification
  const getClassificationLabel = (name: string): string => {
    if (!name) return 'Sem classificação';
    return classificationConfig[name]?.label || name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Helper to get color for a classification
  const getClassificationColor = (name: string | null): string => {
    if (!name) return 'bg-slate-100 text-slate-600';
    const config = classificationConfig[name];
    if (config?.color) {
      // Convert bg-xxx-500 to bg-xxx-100 text-xxx-700 for badge styling
      const colorBase = config.color.replace('bg-', '').replace('-500', '');
      return `bg-${colorBase}-100 text-${colorBase}-700`;
    }
    return 'bg-gray-100 text-gray-700';
  };

  // Search unlinked contacts
  useEffect(() => {
    if (activeTab === 'link') {
      fetchUnlinkedContacts(searchQuery).then(setUnlinkedContacts);
    }
  }, [activeTab, searchQuery]);

  const resetForm = () => {
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormInstagram('');
    setFormClassification('');
    setFormNotes('');
    setEditingContact(null);
  };

  const handleAddContact = async () => {
    if (!formName.trim()) return;

    await addContactToLead({
      full_name: formName,
      phone: formPhone || null,
      email: formEmail || null,
      instagram_username: formInstagram || null,
      classification: formClassification || null,
      notes: formNotes || null,
      // Inherit location and profession data from lead
      city: lead?.city || null,
      state: lead?.state || null,
      neighborhood: lead?.neighborhood || null,
      profession: null, // profession is on contact, not inherited from lead directly
    });

    resetForm();
    setActiveTab('contacts');
  };

  const handleUpdateContact = async () => {
    if (!editingContact || !formName.trim()) return;

    await updateContact(editingContact.id, {
      full_name: formName,
      phone: formPhone || null,
      email: formEmail || null,
      instagram_username: formInstagram || null,
      classification: formClassification || null,
      notes: formNotes || null,
    });

    resetForm();
  };

  const handleEditClick = (contact: LeadContact) => {
    setEditingContact(contact);
    setFormName(contact.full_name);
    setFormPhone(contact.phone || '');
    setFormEmail(contact.email || '');
    setFormInstagram(contact.instagram_username || '');
    setFormClassification(contact.classification || '');
    setFormNotes(contact.notes || '');
    setActiveTab('add');
  };

  const handleDeleteClick = async (contactId: string) => {
    if (confirm('Tem certeza que deseja remover este contato permanentemente?')) {
      await deleteContact(contactId);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // This function is no longer needed, using getClassificationLabel and getClassificationColor instead

  if (!lead) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Contatos do Lead
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {lead.lead_name || 'Lead sem nome'} • {contacts.length} contato(s)
          </p>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="contacts">
              <Users className="h-4 w-4 mr-1" />
              Contatos ({contacts.length})
            </TabsTrigger>
            <TabsTrigger value="add">
              <UserPlus className="h-4 w-4 mr-1" />
              {editingContact ? 'Editar' : 'Novo'}
            </TabsTrigger>
            <TabsTrigger value="link">
              <Link2 className="h-4 w-4 mr-1" />
              Vincular
            </TabsTrigger>
          </TabsList>

          {/* Contacts List */}
          <TabsContent value="contacts" className="mt-4">
            <ScrollArea className="h-[calc(100vh-250px)]">
              {contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <h3 className="font-medium mb-2">Nenhum contato vinculado</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Adicione contatos relacionados a este lead
                  </p>
                  <Button onClick={() => setActiveTab('add')}>
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar Contato
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {contacts.map((contact) => {
                    return (
                      <Card key={contact.id}>
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {getInitials(contact.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm truncate">
                                  {contact.full_name}
                                </p>
                                <Badge variant="secondary" className={`text-xs ${getClassificationColor(contact.classification)}`}>
                                  {getClassificationLabel(contact.classification || '')}
                                </Badge>
                              </div>
                              
                              <div className="mt-1 space-y-0.5">
                                {contact.phone && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Phone className="h-3 w-3" />
                                    <span>{contact.phone}</span>
                                  </div>
                                )}
                                {contact.email && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Mail className="h-3 w-3" />
                                    <span className="truncate">{contact.email}</span>
                                  </div>
                                )}
                                {contact.instagram_username && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Instagram className="h-3 w-3" />
                                    <span>@{contact.instagram_username.replace('@', '')}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleEditClick(contact)}>
                                  <Edit2 className="h-3 w-3 mr-2" />
                                  Editar
                                </DropdownMenuItem>
                                {contact.phone && (
                                  <DropdownMenuItem
                                    onClick={() => window.open(`https://wa.me/${contact.phone?.replace(/\D/g, '')}`, '_blank')}
                                  >
                                    <MessageSquare className="h-3 w-3 mr-2" />
                                    WhatsApp
                                  </DropdownMenuItem>
                                )}
                                {contact.instagram_username && (
                                  <DropdownMenuItem
                                    onClick={() => window.open(`https://instagram.com/${contact.instagram_username?.replace('@', '')}`, '_blank')}
                                  >
                                    <Instagram className="h-3 w-3 mr-2" />
                                    Ver Instagram
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => unlinkContact(contact.id)}>
                                  <Unlink className="h-3 w-3 mr-2" />
                                  Desvincular
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  className="text-destructive"
                                  onClick={() => handleDeleteClick(contact.id)}
                                >
                                  <Trash2 className="h-3 w-3 mr-2" />
                                  Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Add/Edit Contact Form */}
          <TabsContent value="add" className="mt-4">
            <ScrollArea className="h-[calc(100vh-250px)]">
              <div className="space-y-4 pr-2">
                {editingContact && (
                  <div className="flex items-center justify-between p-2 bg-muted rounded-md">
                    <span className="text-sm">Editando: {editingContact.full_name}</span>
                    <Button variant="ghost" size="sm" onClick={resetForm}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                <div>
                  <Label>Nome Completo *</Label>
                  <Input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Nome do contato"
                  />
                </div>

                <div>
                  <Label>Classificação</Label>
                  <Select 
                    value={formClassification || '__none__'} 
                    onValueChange={(val) => setFormClassification(val === '__none__' ? '' : val)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sem classificação</SelectItem>
                      {classifications.map((c) => (
                        <SelectItem key={c.id} value={c.name}>
                          {getClassificationLabel(c.name)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Telefone</Label>
                  <Input
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>

                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                  />
                </div>

                <div>
                  <Label>Instagram</Label>
                  <Input
                    value={formInstagram}
                    onChange={(e) => setFormInstagram(e.target.value)}
                    placeholder="@usuario"
                  />
                </div>

                <div>
                  <Label>Observações</Label>
                  <Input
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Notas sobre o contato..."
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  {editingContact ? (
                    <>
                      <Button variant="outline" onClick={resetForm} className="flex-1">
                        Cancelar
                      </Button>
                      <Button onClick={handleUpdateContact} disabled={!formName.trim()} className="flex-1">
                        Salvar
                      </Button>
                    </>
                  ) : (
                    <Button onClick={handleAddContact} disabled={!formName.trim()} className="w-full">
                      <Plus className="h-4 w-4 mr-2" />
                      Adicionar Contato
                    </Button>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Link Existing Contacts */}
          <TabsContent value="link" className="mt-4">
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar contatos não vinculados..."
                  className="pl-8"
                />
              </div>

              <ScrollArea className="h-[calc(100vh-320px)]">
                {unlinkedContacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Link2 className="h-12 w-12 text-muted-foreground/40 mb-4" />
                    <h3 className="font-medium mb-2">Nenhum contato disponível</h3>
                    <p className="text-sm text-muted-foreground">
                      Todos os contatos já estão vinculados a leads
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {unlinkedContacts.map((contact) => (
                      <Card key={contact.id} className="hover:bg-muted/50 transition-colors">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {getInitials(contact.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">
                                {contact.full_name}
                              </p>
                              {contact.phone && (
                                <p className="text-xs text-muted-foreground">
                                  {contact.phone}
                                </p>
                              )}
                            </div>

                            <Button
                              size="sm"
                              onClick={() => linkExistingContact(contact.id)}
                            >
                              <Link2 className="h-4 w-4 mr-1" />
                              Vincular
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
