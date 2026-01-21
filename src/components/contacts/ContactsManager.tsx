import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Users,
  Plus,
  Upload,
  Download,
  Search,
  MoreVertical,
  Instagram,
  Phone,
  Mail,
  UserPlus,
  Trash2,
  Edit,
  ExternalLink,
  UserCheck,
  Building2,
  Handshake,
  Package,
  FileSpreadsheet,
} from 'lucide-react';
import { useContacts, Contact, ContactClassification } from '@/hooks/useContacts';
import { toast } from 'sonner';

const classificationConfig: Record<ContactClassification, { label: string; color: string; icon: React.ReactNode }> = {
  client: { label: 'Cliente', color: 'bg-green-500', icon: <UserCheck className="h-3 w-3" /> },
  non_client: { label: 'Não-Cliente', color: 'bg-gray-500', icon: <Users className="h-3 w-3" /> },
  prospect: { label: 'Prospect', color: 'bg-blue-500', icon: <UserPlus className="h-3 w-3" /> },
  partner: { label: 'Parceiro', color: 'bg-purple-500', icon: <Handshake className="h-3 w-3" /> },
  supplier: { label: 'Fornecedor', color: 'bg-orange-500', icon: <Package className="h-3 w-3" /> },
};

export const ContactsManager: React.FC = () => {
  const { contacts, stats, loading, addContact, updateContact, deleteContact, updateClassification, convertToLead, importFromCSV } = useContacts();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClassification, setFilterClassification] = useState<ContactClassification | 'all'>('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [csvPreview, setCsvPreview] = useState<Partial<Contact>[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newContact, setNewContact] = useState({
    full_name: '',
    phone: '',
    email: '',
    instagram_url: '',
    classification: 'prospect' as ContactClassification,
    city: '',
    state: '',
    notes: '',
  });

  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = 
      contact.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.phone?.includes(searchTerm) ||
      contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.instagram_username?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesFilter = filterClassification === 'all' || contact.classification === filterClassification;
    
    return matchesSearch && matchesFilter;
  });

  const handleAddContact = async () => {
    if (!newContact.full_name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    await addContact({
      full_name: newContact.full_name,
      phone: newContact.phone || null,
      email: newContact.email || null,
      instagram_url: newContact.instagram_url || null,
      classification: newContact.classification,
      city: newContact.city || null,
      state: newContact.state || null,
      notes: newContact.notes || null,
    });

    setNewContact({
      full_name: '',
      phone: '',
      email: '',
      instagram_url: '',
      classification: 'prospect',
      city: '',
      state: '',
      notes: '',
    });
    setIsAddDialogOpen(false);
  };

  const handleEditContact = async () => {
    if (!editingContact) return;

    await updateContact(editingContact.id, editingContact);
    setIsEditDialogOpen(false);
    setEditingContact(null);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        toast.error('Arquivo CSV inválido');
        return;
      }

      const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
      
      // Find column indices
      const findColumn = (names: string[]) => 
        headers.findIndex(h => names.some(n => h.includes(n)));

      const nameIdx = findColumn(['nome', 'name', 'full_name', 'nome completo']);
      const phoneIdx = findColumn(['phone', 'telefone', 'celular', 'whatsapp', 'fone']);
      const emailIdx = findColumn(['email', 'e-mail']);
      const instagramIdx = findColumn(['instagram', 'insta', 'ig']);
      const cityIdx = findColumn(['cidade', 'city']);
      const stateIdx = findColumn(['estado', 'state', 'uf']);
      const classificationIdx = findColumn(['classificacao', 'classification', 'tipo', 'type']);
      const notesIdx = findColumn(['notas', 'notes', 'observacoes', 'obs']);

      const parsedContacts = lines.slice(1).map(line => {
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());

        // Parse classification
        let classification: ContactClassification = 'prospect';
        if (classificationIdx >= 0) {
          const rawClassification = values[classificationIdx]?.replace(/"/g, '').toLowerCase();
          if (rawClassification?.includes('client') || rawClassification?.includes('cliente')) {
            classification = 'client';
          } else if (rawClassification?.includes('partner') || rawClassification?.includes('parceiro')) {
            classification = 'partner';
          } else if (rawClassification?.includes('supplier') || rawClassification?.includes('fornecedor')) {
            classification = 'supplier';
          } else if (rawClassification?.includes('non') || rawClassification?.includes('não')) {
            classification = 'non_client';
          }
        }

        // Extract Instagram username from URL
        let instagramUrl = instagramIdx >= 0 ? values[instagramIdx]?.replace(/"/g, '') : '';
        let instagramUsername = '';
        if (instagramUrl) {
          // Handle different formats: @username, username, full URL
          if (instagramUrl.startsWith('@')) {
            instagramUsername = instagramUrl.slice(1);
            instagramUrl = `https://instagram.com/${instagramUsername}`;
          } else if (instagramUrl.includes('instagram.com')) {
            const match = instagramUrl.match(/instagram\.com\/([^/?]+)/);
            if (match) instagramUsername = match[1];
          } else {
            instagramUsername = instagramUrl;
            instagramUrl = `https://instagram.com/${instagramUrl}`;
          }
        }

        return {
          full_name: nameIdx >= 0 ? values[nameIdx]?.replace(/"/g, '') : '',
          phone: phoneIdx >= 0 ? values[phoneIdx]?.replace(/"/g, '') : '',
          email: emailIdx >= 0 ? values[emailIdx]?.replace(/"/g, '') : '',
          instagram_url: instagramUrl,
          instagram_username: instagramUsername,
          city: cityIdx >= 0 ? values[cityIdx]?.replace(/"/g, '') : '',
          state: stateIdx >= 0 ? values[stateIdx]?.replace(/"/g, '') : '',
          classification,
          notes: notesIdx >= 0 ? values[notesIdx]?.replace(/"/g, '') : '',
        };
      }).filter(c => c.full_name || c.phone || c.email || c.instagram_username);

      setCsvPreview(parsedContacts);
      setIsImportDialogOpen(true);
    };

    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImportCSV = async () => {
    if (csvPreview.length === 0) return;

    setIsImporting(true);
    const result = await importFromCSV(csvPreview);
    setIsImporting(false);
    setCsvPreview([]);
    setIsImportDialogOpen(false);

    if (result.duplicates > 0) {
      toast.info(`${result.imported} importados, ${result.duplicates} duplicados ignorados`);
    } else if (result.errors > 0) {
      toast.warning(`${result.imported} importados, ${result.errors} erros`);
    } else {
      toast.success(`${result.imported} contatos importados!`);
    }
  };

  const handleConvertToLead = async (contact: Contact) => {
    await convertToLead(contact.id);
  };

  const downloadTemplate = () => {
    const template = 'nome,telefone,email,instagram,cidade,estado,classificacao,notas\n"João Silva","11999998888","joao@email.com","@joaosilva","São Paulo","SP","prospect","Notas aqui"';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo_contatos.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="bg-card/50">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card className="bg-green-500/10 border-green-500/30">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-green-500">{stats.clients}</p>
            <p className="text-xs text-muted-foreground">Clientes</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-500/10 border-blue-500/30">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-blue-500">{stats.prospects}</p>
            <p className="text-xs text-muted-foreground">Prospects</p>
          </CardContent>
        </Card>
        <Card className="bg-purple-500/10 border-purple-500/30">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-purple-500">{stats.partners}</p>
            <p className="text-xs text-muted-foreground">Parceiros</p>
          </CardContent>
        </Card>
        <Card className="bg-pink-500/10 border-pink-500/30">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-pink-500">{stats.withInstagram}</p>
            <p className="text-xs text-muted-foreground">Com Instagram</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500/10 border-emerald-500/30">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-emerald-500">{stats.convertedToLead}</p>
            <p className="text-xs text-muted-foreground">Leads</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="flex gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar contatos..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={filterClassification} onValueChange={(v) => setFilterClassification(v as any)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Classificação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(classificationConfig).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${config.color}`} />
                        {config.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex gap-2 w-full md:w-auto justify-end">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-1" />
                Modelo CSV
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" />
                Importar CSV
              </Button>
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Adicionar
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Novo Contato</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Nome *</Label>
                      <Input
                        value={newContact.full_name}
                        onChange={(e) => setNewContact({ ...newContact, full_name: e.target.value })}
                        placeholder="Nome completo"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Telefone</Label>
                        <Input
                          value={newContact.phone}
                          onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                          placeholder="11999998888"
                        />
                      </div>
                      <div>
                        <Label>Email</Label>
                        <Input
                          type="email"
                          value={newContact.email}
                          onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                          placeholder="email@exemplo.com"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Instagram (URL ou @username)</Label>
                      <Input
                        value={newContact.instagram_url}
                        onChange={(e) => setNewContact({ ...newContact, instagram_url: e.target.value })}
                        placeholder="@username ou instagram.com/username"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Cidade</Label>
                        <Input
                          value={newContact.city}
                          onChange={(e) => setNewContact({ ...newContact, city: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Estado</Label>
                        <Input
                          value={newContact.state}
                          onChange={(e) => setNewContact({ ...newContact, state: e.target.value })}
                          placeholder="SP"
                          maxLength={2}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Classificação</Label>
                      <Select 
                        value={newContact.classification} 
                        onValueChange={(v) => setNewContact({ ...newContact, classification: v as ContactClassification })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(classificationConfig).map(([key, config]) => (
                            <SelectItem key={key} value={key}>
                              <div className="flex items-center gap-2">
                                {config.icon}
                                {config.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Notas</Label>
                      <Textarea
                        value={newContact.notes}
                        onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                        placeholder="Observações sobre o contato..."
                        rows={2}
                      />
                    </div>
                    <Button onClick={handleAddContact} className="w-full">
                      Adicionar Contato
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contacts Table */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Contatos ({filteredContacts.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Instagram</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : filteredContacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Nenhum contato encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredContacts.map((contact) => {
                    const classConfig = classificationConfig[contact.classification];
                    return (
                      <TableRow key={contact.id}>
                        <TableCell className="font-medium">{contact.full_name}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {contact.phone && (
                              <a 
                                href={`https://wa.me/55${contact.phone.replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-green-600 hover:underline"
                              >
                                <Phone className="h-3 w-3" />
                                {contact.phone}
                              </a>
                            )}
                            {contact.email && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Mail className="h-3 w-3" />
                                {contact.email}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {contact.instagram_username ? (
                            <a
                              href={contact.instagram_url || `https://instagram.com/${contact.instagram_username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-pink-500 hover:underline text-sm"
                            >
                              <Instagram className="h-3 w-3" />
                              @{contact.instagram_username}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {contact.city || contact.state ? (
                            <span className="text-xs text-muted-foreground">
                              {[contact.city, contact.state].filter(Boolean).join(', ')}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${classConfig.color} text-white text-xs`}>
                            {classConfig.icon}
                            <span className="ml-1">{classConfig.label}</span>
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {contact.lead_id ? (
                            <Badge variant="outline" className="text-emerald-500 border-emerald-500/50 text-xs">
                              Lead
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Contato</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => {
                                setEditingContact(contact);
                                setIsEditDialogOpen(true);
                              }}>
                                <Edit className="h-4 w-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                              {contact.instagram_username && (
                                <DropdownMenuItem asChild>
                                  <a 
                                    href={contact.instagram_url || `https://instagram.com/${contact.instagram_username}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Abrir Instagram
                                  </a>
                                </DropdownMenuItem>
                              )}
                              {contact.phone && (
                                <DropdownMenuItem asChild>
                                  <a 
                                    href={`https://wa.me/55${contact.phone.replace(/\D/g, '')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Phone className="h-4 w-4 mr-2" />
                                    WhatsApp
                                  </a>
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {!contact.lead_id && (
                                <DropdownMenuItem onClick={() => handleConvertToLead(contact)}>
                                  <UserPlus className="h-4 w-4 mr-2" />
                                  Converter em Lead
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => deleteContact(contact.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Contato</DialogTitle>
          </DialogHeader>
          {editingContact && (
            <div className="space-y-4">
              <div>
                <Label>Nome</Label>
                <Input
                  value={editingContact.full_name}
                  onChange={(e) => setEditingContact({ ...editingContact, full_name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Telefone</Label>
                  <Input
                    value={editingContact.phone || ''}
                    onChange={(e) => setEditingContact({ ...editingContact, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={editingContact.email || ''}
                    onChange={(e) => setEditingContact({ ...editingContact, email: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>Instagram URL</Label>
                <Input
                  value={editingContact.instagram_url || ''}
                  onChange={(e) => setEditingContact({ ...editingContact, instagram_url: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Cidade</Label>
                  <Input
                    value={editingContact.city || ''}
                    onChange={(e) => setEditingContact({ ...editingContact, city: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Estado</Label>
                  <Input
                    value={editingContact.state || ''}
                    onChange={(e) => setEditingContact({ ...editingContact, state: e.target.value })}
                    maxLength={2}
                  />
                </div>
              </div>
              <div>
                <Label>Classificação</Label>
                <Select 
                  value={editingContact.classification} 
                  onValueChange={(v) => setEditingContact({ ...editingContact, classification: v as ContactClassification })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(classificationConfig).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          {config.icon}
                          {config.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notas</Label>
                <Textarea
                  value={editingContact.notes || ''}
                  onChange={(e) => setEditingContact({ ...editingContact, notes: e.target.value })}
                  rows={2}
                />
              </div>
              <Button onClick={handleEditContact} className="w-full">
                Salvar Alterações
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* CSV Import Preview Dialog */}
      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Pré-visualização da Importação
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {csvPreview.length} contatos encontrados no arquivo. Revise os dados antes de importar.
            </p>
            <div className="max-h-[400px] overflow-y-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Instagram</TableHead>
                    <TableHead>Classificação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {csvPreview.slice(0, 20).map((contact, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{contact.full_name || '-'}</TableCell>
                      <TableCell>{contact.phone || '-'}</TableCell>
                      <TableCell>{contact.email || '-'}</TableCell>
                      <TableCell>
                        {contact.instagram_username ? (
                          <span className="text-pink-500">@{contact.instagram_username}</span>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${classificationConfig[contact.classification || 'prospect'].color} text-white text-xs`}>
                          {classificationConfig[contact.classification || 'prospect'].label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {csvPreview.length > 20 && (
                <p className="text-center text-sm text-muted-foreground py-2">
                  ... e mais {csvPreview.length - 20} contatos
                </p>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleImportCSV} disabled={isImporting}>
                {isImporting ? 'Importando...' : `Importar ${csvPreview.length} Contatos`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ContactsManager;
