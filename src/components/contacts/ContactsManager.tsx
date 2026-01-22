import React, { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
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
  UserMinus,
  Users2,
  X,
  Tag,
  ChevronDown,
} from 'lucide-react';
import { useContacts, Contact, ContactClassification, FollowerStatus } from '@/hooks/useContacts';
import { toast } from 'sonner';

const classificationConfig: Record<NonNullable<ContactClassification> | 'none', { label: string; color: string; icon: React.ReactNode }> = {
  client: { label: 'Cliente', color: 'bg-green-500', icon: <UserCheck className="h-3 w-3" /> },
  non_client: { label: 'Não-Cliente', color: 'bg-gray-500', icon: <Users className="h-3 w-3" /> },
  prospect: { label: 'Prospect', color: 'bg-blue-500', icon: <UserPlus className="h-3 w-3" /> },
  partner: { label: 'Parceiro', color: 'bg-purple-500', icon: <Handshake className="h-3 w-3" /> },
  supplier: { label: 'Fornecedor', color: 'bg-orange-500', icon: <Package className="h-3 w-3" /> },
  none: { label: 'Sem classificação', color: 'bg-slate-400', icon: <X className="h-3 w-3" /> },
};

const followerStatusConfig: Record<FollowerStatus, { label: string; color: string; icon: React.ReactNode }> = {
  follower: { label: 'Seguidor', color: 'bg-pink-500', icon: <UserPlus className="h-3 w-3" /> },
  following: { label: 'Seguindo', color: 'bg-indigo-500', icon: <UserMinus className="h-3 w-3" /> },
  mutual: { label: 'Mútuo', color: 'bg-emerald-500', icon: <Users2 className="h-3 w-3" /> },
  none: { label: '', color: '', icon: null },
};

export const ContactsManager: React.FC = () => {
  const { contacts, stats, loading, addContact, updateContact, deleteContact, updateClassification, convertToLead, importFromCSV, importFromMetaExport } = useContacts();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClassification, setFilterClassification] = useState<ContactClassification | 'all' | 'none'>('all');
  const [filterTag, setFilterTag] = useState<'all' | 'seguidor' | 'seguindo' | 'mutual'>('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isMetaImportDialogOpen, setIsMetaImportDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [csvPreview, setCsvPreview] = useState<Partial<Contact>[]>([]);
  const [metaImportData, setMetaImportData] = useState<{ followers: any[]; following: any[] }>({ followers: [], following: [] });
  const [metaImportType, setMetaImportType] = useState<'followers' | 'following' | 'both'>('followers');
  const [metaImportClassification, setMetaImportClassification] = useState<ContactClassification>('prospect');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    imported: number;
    errors: number;
    duplicates: number;
    upgradedToMutual: number;
  } | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [showBatchTagDialog, setShowBatchTagDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const metaFileInputRef = useRef<HTMLInputElement>(null);

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

  // Calculate tag stats based on follower_status field
  const tagStats = {
    seguidores: contacts.filter(c => c.follower_status === 'follower' || c.follower_status === 'mutual').length,
    seguindo: contacts.filter(c => c.follower_status === 'following' || c.follower_status === 'mutual').length,
    mutuos: contacts.filter(c => c.follower_status === 'mutual').length,
  };

  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = 
      contact.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.phone?.includes(searchTerm) ||
      contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.instagram_username?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesFilter = filterClassification === 'all' || 
      (filterClassification === 'none' ? contact.classification === null : contact.classification === filterClassification);
    
    // Tag filter using follower_status field
    let matchesTag = true;
    if (filterTag === 'seguidor') {
      matchesTag = contact.follower_status === 'follower' || contact.follower_status === 'mutual';
    } else if (filterTag === 'seguindo') {
      matchesTag = contact.follower_status === 'following' || contact.follower_status === 'mutual';
    } else if (filterTag === 'mutual') {
      matchesTag = contact.follower_status === 'mutual';
    }
    
    return matchesSearch && matchesFilter && matchesTag;
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

  // Selection handlers
  const toggleSelectContact = (contactId: string) => {
    const newSelected = new Set(selectedContacts);
    if (newSelected.has(contactId)) {
      newSelected.delete(contactId);
    } else {
      newSelected.add(contactId);
    }
    setSelectedContacts(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedContacts.size === filteredContacts.length) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(filteredContacts.map(c => c.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedContacts.size === 0) return;
    
    const confirmDelete = window.confirm(
      `Tem certeza que deseja excluir ${selectedContacts.size} contato(s)? Esta ação não pode ser desfeita.`
    );
    
    if (!confirmDelete) return;
    
    setIsDeleting(true);
    let deleted = 0;
    let errors = 0;
    
    for (const contactId of selectedContacts) {
      try {
        await deleteContact(contactId);
        deleted++;
      } catch {
        errors++;
      }
    }
    
    setIsDeleting(false);
    setSelectedContacts(new Set());
    
    if (errors > 0) {
      toast.warning(`${deleted} excluídos, ${errors} erros`);
    } else {
      toast.success(`${deleted} contatos excluídos!`);
    }
  };

  // Batch classification change
  const handleBatchClassification = async (newClassification: ContactClassification) => {
    if (selectedContacts.size === 0) return;
    
    setIsBatchProcessing(true);
    let updated = 0;
    let errors = 0;
    
    for (const contactId of selectedContacts) {
      try {
        await updateContact(contactId, { classification: newClassification });
        updated++;
      } catch {
        errors++;
      }
    }
    
    setIsBatchProcessing(false);
    setSelectedContacts(new Set());
    
    if (errors > 0) {
      toast.warning(`${updated} atualizados, ${errors} erros`);
    } else {
      const label = newClassification === null ? 'Sem classificação' : classificationConfig[newClassification].label;
      toast.success(`${updated} contatos classificados como ${label}!`);
    }
  };

  // Batch add tags
  const handleBatchAddTags = async () => {
    if (selectedContacts.size === 0 || !batchTagInput.trim()) return;
    
    const newTags = batchTagInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (newTags.length === 0) return;
    
    setIsBatchProcessing(true);
    let updated = 0;
    let errors = 0;
    
    for (const contactId of selectedContacts) {
      try {
        const contact = contacts.find(c => c.id === contactId);
        if (contact) {
          const currentTags = contact.tags || [];
          const mergedTags = [...new Set([...currentTags, ...newTags])];
          await updateContact(contactId, { tags: mergedTags });
          updated++;
        }
      } catch {
        errors++;
      }
    }
    
    setIsBatchProcessing(false);
    setSelectedContacts(new Set());
    setBatchTagInput('');
    setShowBatchTagDialog(false);
    
    if (errors > 0) {
      toast.warning(`${updated} atualizados, ${errors} erros`);
    } else {
      toast.success(`Tags adicionadas a ${updated} contatos!`);
    }
  };

  // Batch convert to leads
  const handleBatchConvertToLeads = async () => {
    if (selectedContacts.size === 0) return;
    
    // Filter only contacts not already converted
    const contactsToConvert = Array.from(selectedContacts)
      .map(id => contacts.find(c => c.id === id))
      .filter(c => c && !c.lead_id);
    
    if (contactsToConvert.length === 0) {
      toast.info('Todos os contatos selecionados já foram convertidos em leads');
      return;
    }
    
    const confirmConvert = window.confirm(
      `Converter ${contactsToConvert.length} contato(s) em leads?`
    );
    
    if (!confirmConvert) return;
    
    setIsBatchProcessing(true);
    let converted = 0;
    let errors = 0;
    
    for (const contact of contactsToConvert) {
      if (!contact) continue;
      try {
        await convertToLead(contact.id);
        converted++;
      } catch {
        errors++;
      }
    }
    
    setIsBatchProcessing(false);
    setSelectedContacts(new Set());
    
    if (errors > 0) {
      toast.warning(`${converted} convertidos, ${errors} erros`);
    } else {
      toast.success(`${converted} contatos convertidos em leads!`);
    }
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

  // Handle Meta export file (JSON format)
  const handleMetaFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        
        // Try to parse as JSON first
        let data: any = null;
        
        try {
          data = JSON.parse(text);
        } catch {
          // If not JSON, try to parse HTML format
          const parser = new DOMParser();
          const doc = parser.parseFromString(text, 'text/html');
          
          // Look for links with instagram.com
          const links = doc.querySelectorAll('a[href*="instagram.com"]');
          const usernames: string[] = [];
          
          links.forEach(link => {
            const href = link.getAttribute('href') || '';
            const match = href.match(/instagram\.com\/([^/?]+)/);
            if (match && match[1] !== 'accounts') {
              usernames.push(match[1]);
            }
          });
          
          if (usernames.length > 0) {
            setMetaImportData({
              followers: usernames.map(u => ({ username: u })),
              following: [],
            });
            setIsMetaImportDialogOpen(true);
            if (metaFileInputRef.current) metaFileInputRef.current.value = '';
            return;
          }
          
          toast.error('Formato de arquivo não reconhecido');
          return;
        }

        // Parse Meta JSON export structure
        let followers: any[] = [];
        let following: any[] = [];

        // Handle different possible structures
        if (data.relationships_followers) {
          followers = data.relationships_followers;
        } else if (data.followers) {
          followers = Array.isArray(data.followers) ? data.followers : [data.followers];
        } else if (Array.isArray(data) && data[0]?.string_list_data) {
          // Direct array of follower objects
          followers = data;
        }

        if (data.relationships_following) {
          following = data.relationships_following;
        } else if (data.following) {
          following = Array.isArray(data.following) ? data.following : [data.following];
        }

        // If it's a simple array, assume it's followers
        if (Array.isArray(data) && !data[0]?.string_list_data) {
          followers = data;
        }

        if (followers.length === 0 && following.length === 0) {
          // Try to find any array in the data
          const findArrays = (obj: any): any[] => {
            if (Array.isArray(obj)) return obj;
            if (typeof obj === 'object' && obj !== null) {
              for (const key of Object.keys(obj)) {
                const result = findArrays(obj[key]);
                if (result.length > 0) return result;
              }
            }
            return [];
          };
          followers = findArrays(data);
        }

        setMetaImportData({ followers, following });
        setIsMetaImportDialogOpen(true);
      } catch (error) {
        console.error('Parse error:', error);
        toast.error('Erro ao processar arquivo. Verifique se é um arquivo JSON válido da exportação Meta.');
      }
    };

    reader.readAsText(file);
    if (metaFileInputRef.current) metaFileInputRef.current.value = '';
  };

  const handleProgressUpdate = useCallback((progress: typeof importProgress) => {
    setImportProgress(progress);
  }, []);

  const handleMetaImport = async () => {
    let dataToImport: any[] = [];
    
    if (metaImportType === 'followers') {
      dataToImport = metaImportData.followers;
    } else if (metaImportType === 'following') {
      dataToImport = metaImportData.following;
    } else {
      dataToImport = [...metaImportData.followers, ...metaImportData.following];
    }

    if (dataToImport.length === 0) {
      toast.error('Nenhum dado para importar');
      return;
    }

    setIsImporting(true);
    setImportProgress({ current: 0, total: dataToImport.length, imported: 0, errors: 0, duplicates: 0, upgradedToMutual: 0 });
    
    const result = await importFromMetaExport(dataToImport, metaImportType, metaImportClassification, handleProgressUpdate);
    
    setIsImporting(false);
    setImportProgress(null);
    setMetaImportData({ followers: [], following: [] });
    setIsMetaImportDialogOpen(false);

    // Build result message
    const messages: string[] = [];
    if (result.imported > 0) messages.push(`${result.imported} novos`);
    if (result.upgradedToMutual > 0) messages.push(`${result.upgradedToMutual} promovidos a mútuo`);
    if (result.duplicates > 0) messages.push(`${result.duplicates} já existentes`);
    if (result.errors > 0) messages.push(`${result.errors} erros`);

    if (result.upgradedToMutual > 0) {
      toast.success(`🎉 ${messages.join(', ')}`, {
        description: 'Contatos que seguem você e que você segue foram marcados como mútuos!'
      });
    } else if (result.imported > 0) {
      toast.success(`${result.imported} contatos do Instagram importados!`);
    } else if (result.duplicates > 0) {
      toast.info(messages.join(', '));
    } else if (result.errors > 0) {
      toast.warning(messages.join(', '));
    }
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
            
            {/* Quick Tag Filters */}
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={filterTag === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTag('all')}
                className="h-8"
              >
                <Users className="h-3 w-3 mr-1" />
                Todos
              </Button>
              <Button
                variant={filterTag === 'seguidor' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTag('seguidor')}
                className="h-8"
              >
                <UserPlus className="h-3 w-3 mr-1" />
                Seguidores
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {tagStats.seguidores}
                </Badge>
              </Button>
              <Button
                variant={filterTag === 'seguindo' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTag('seguindo')}
                className="h-8"
              >
                <UserMinus className="h-3 w-3 mr-1" />
                Seguindo
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {tagStats.seguindo}
                </Badge>
              </Button>
              <Button
                variant={filterTag === 'mutual' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTag('mutual')}
                className="h-8"
              >
                <Users2 className="h-3 w-3 mr-1" />
                Mútuos
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {tagStats.mutuos}
                </Badge>
              </Button>
              {filterTag !== 'all' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilterTag('all')}
                  className="h-8 px-2"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            
            <div className="flex gap-2 w-full md:w-auto justify-end flex-wrap">
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
              <input
                ref={metaFileInputRef}
                type="file"
                accept=".json,.html"
                onChange={handleMetaFileUpload}
                className="hidden"
              />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => metaFileInputRef.current?.click()} className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-pink-500/30 hover:border-pink-500/50">
                <Instagram className="h-4 w-4 mr-1 text-pink-500" />
                Meta Export
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
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Contatos ({filteredContacts.length})
            </CardTitle>
            {selectedContacts.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">
                  {selectedContacts.size} selecionado(s)
                </Badge>
                
                {/* Classification dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isBatchProcessing}>
                      <UserCheck className="h-4 w-4 mr-1" />
                      Classificar
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {Object.entries(classificationConfig).map(([key, config]) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => handleBatchClassification(key === 'none' ? null : key as NonNullable<ContactClassification>)}
                      >
                        {config.icon}
                        <span className="ml-2">{config.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Add tags button */}
                <Dialog open={showBatchTagDialog} onOpenChange={setShowBatchTagDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isBatchProcessing}>
                      <Tag className="h-4 w-4 mr-1" />
                      Adicionar Tags
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Adicionar Tags em Lote</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Tags (separadas por vírgula)</Label>
                        <Input
                          value={batchTagInput}
                          onChange={(e) => setBatchTagInput(e.target.value)}
                          placeholder="tag1, tag2, tag3"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          As tags serão adicionadas a {selectedContacts.size} contato(s)
                        </p>
                      </div>
                      <Button 
                        onClick={handleBatchAddTags} 
                        className="w-full"
                        disabled={isBatchProcessing || !batchTagInput.trim()}
                      >
                        {isBatchProcessing ? 'Processando...' : 'Adicionar Tags'}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Convert to leads button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBatchConvertToLeads}
                  disabled={isBatchProcessing}
                >
                  <UserPlus className="h-4 w-4 mr-1" />
                  Converter em Leads
                </Button>

                {/* Delete button */}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBatchDelete}
                  disabled={isDeleting || isBatchProcessing}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  {isDeleting ? 'Excluindo...' : 'Excluir'}
                </Button>
                
                {/* Clear selection */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedContacts(new Set())}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={filteredContacts.length > 0 && selectedContacts.size === filteredContacts.length}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Selecionar todos"
                    />
                  </TableHead>
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
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : filteredContacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Nenhum contato encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredContacts.map((contact) => {
                    const classConfig = classificationConfig[contact.classification || 'none'];
                    const isSelected = selectedContacts.has(contact.id);
                    return (
                      <TableRow key={contact.id} className={isSelected ? 'bg-muted/50' : ''}>
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelectContact(contact.id)}
                            aria-label={`Selecionar ${contact.full_name}`}
                          />
                        </TableCell>
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
                          <div className="flex flex-col gap-1">
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
                            {/* Follower Status Badge */}
                            {contact.follower_status && contact.follower_status !== 'none' && (
                              <Badge className={`${followerStatusConfig[contact.follower_status].color} text-white text-xs w-fit`}>
                                {followerStatusConfig[contact.follower_status].icon}
                                <span className="ml-1">{followerStatusConfig[contact.follower_status].label}</span>
                              </Badge>
                            )}
                          </div>
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

      {/* Meta Import Dialog */}
      <Dialog open={isMetaImportDialogOpen} onOpenChange={setIsMetaImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Instagram className="h-5 w-5 text-pink-500" />
              Importar do Meta (Instagram)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg border border-pink-500/20">
              <h4 className="font-medium text-sm mb-2">📥 Dados Encontrados</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-pink-500 border-pink-500/50">
                    {metaImportData.followers.length}
                  </Badge>
                  <span>Seguidores</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-purple-500 border-purple-500/50">
                    {metaImportData.following.length}
                  </Badge>
                  <span>Seguindo</span>
                </div>
              </div>
            </div>

            <div>
              <Label>O que importar?</Label>
              <Select value={metaImportType} onValueChange={(v) => setMetaImportType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="followers">
                    Apenas Seguidores ({metaImportData.followers.length})
                  </SelectItem>
                  <SelectItem value="following">
                    Apenas Seguindo ({metaImportData.following.length})
                  </SelectItem>
                  <SelectItem value="both">
                    Ambos ({metaImportData.followers.length + metaImportData.following.length})
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Classificação inicial</Label>
              <Select value={metaImportClassification} onValueChange={(v) => setMetaImportClassification(v as ContactClassification)}>
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

            {!isImporting && (
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <p className="font-medium mb-1">💡 Como obter os dados:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Acesse a Central de Contas da Meta</li>
                  <li>Vá em "Suas informações e permissões"</li>
                  <li>Clique em "Exportar suas informações"</li>
                  <li>Selecione "Seguidores e Seguindo"</li>
                  <li>Escolha formato JSON e baixe o arquivo</li>
                </ol>
              </div>
            )}

            {/* Progress indicator during import */}
            {isImporting && importProgress && (
              <div className="space-y-4 p-4 bg-gradient-to-r from-purple-500/5 to-pink-500/5 rounded-lg border border-pink-500/20">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Importando contatos...</span>
                  <span className="text-muted-foreground">
                    {importProgress.current} / {importProgress.total}
                  </span>
                </div>
                <Progress 
                  value={(importProgress.current / importProgress.total) * 100} 
                  className="h-2"
                />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span>{importProgress.imported} novos</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>{importProgress.upgradedToMutual} mútuos</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-yellow-500" />
                    <span>{importProgress.duplicates} existentes</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span>{importProgress.errors} erros</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button 
                variant="outline" 
                onClick={() => setIsMetaImportDialogOpen(false)}
                disabled={isImporting}
              >
                Cancelar
              </Button>
              <Button 
                onClick={handleMetaImport} 
                disabled={isImporting || (metaImportData.followers.length === 0 && metaImportData.following.length === 0)}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              >
                {isImporting ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    Importando...
                  </span>
                ) : 'Importar Contatos'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ContactsManager;
