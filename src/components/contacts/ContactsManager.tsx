import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useConfirmDelete } from '@/hooks/useConfirmDelete';
import { useSearchParams } from 'react-router-dom';
import { usePageState } from '@/hooks/usePageState';
import { supabase } from '@/integrations/supabase/client';
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
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { ShareMenu } from '@/components/ShareMenu';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
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
  Eye,
  Settings2,
  MapPin,
  Loader2,
  Link2,
  Network,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  GitMerge,
  Briefcase,
  Calendar,
  Link,
  MessageSquare,
} from 'lucide-react';
import { Chrome } from 'lucide-react';
import { useContacts, Contact, ContactClassification, FollowerStatus } from '@/hooks/useContacts';
import { useGoogleIntegration } from '@/hooks/useGoogleIntegration';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useContactColumnVisibility } from '@/hooks/useContactColumnVisibility';
import { useContactClassifications, classificationColors } from '@/hooks/useContactClassifications';
import { toast } from 'sonner';
import { InstagramProfileHoverCard } from '@/components/instagram/InstagramProfileHoverCard';
import { ContactRelationshipsManager } from '@/components/contacts/ContactRelationshipsManager';
import { ContactNetworkGraph } from '@/components/contacts/ContactNetworkGraph';
import { ContactLeadsManager } from '@/components/contacts/ContactLeadsManager';
import { MergeDuplicatesDialog } from '@/components/contacts/MergeDuplicatesDialog';
import { MultiClassificationSelect } from '@/components/contacts/MultiClassificationSelect';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { ProfessionBadgePopover } from '@/components/instagram/ProfessionBadgePopover';
import { ProfessionFilter } from '@/components/instagram/ProfessionFilter';
import { ProfessionSelector } from '@/components/contacts/ProfessionSelector';
import { MultiProfessionSelector } from '@/components/contacts/MultiProfessionSelector';
import { ProfessionStatsCard } from '@/components/contacts/ProfessionStatsCard';
import { useContactRelationshipCounts, useRelationshipTypes, useContactsByRelationshipType } from '@/hooks/useContactRelationships';
import { useContactLeadCounts } from '@/hooks/useContactLeads';
import { useKanbanBoards, KanbanBoard } from '@/hooks/useKanbanBoards';
import { useCboProfessions } from '@/hooks/useCboProfessions';

// Inline editable text component
interface InlineEditableTextProps {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  className?: string;
  renderDisplay?: (value: string) => React.ReactNode;
}

const InlineEditableText: React.FC<InlineEditableTextProps> = ({ 
  value, 
  onSave, 
  placeholder = 'Clique para editar',
  className = '',
  renderDisplay 
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (editValue !== value) {
      onSave(editValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={`h-7 text-xs px-2 ${className}`}
      />
    );
  }

  const displayContent = renderDisplay ? renderDisplay(value) : value;

  return (
    <div
      onClick={() => {
        setEditValue(value);
        setIsEditing(true);
      }}
      className={`cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 min-w-[40px] ${className}`}
      title="Clique para editar"
    >
      {displayContent || <span className="text-muted-foreground italic text-xs">{placeholder}</span>}
    </div>
  );
};

// Inline classification select component with dynamic options
interface InlineClassificationSelectProps {
  value: ContactClassification;
  onChange: (value: ContactClassification) => void;
  classifications: { name: string; color: string; label: string; isSystem: boolean }[];
  onAddNew: (name: string, color: string) => Promise<any>;
}

const InlineClassificationSelect: React.FC<InlineClassificationSelectProps> = ({ 
  value, 
  onChange, 
  classifications,
  onAddNew 
}) => {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('bg-blue-500');

  const getLabel = (name: string) => {
    const systemLabels: Record<string, string> = {
      client: 'Cliente',
      non_client: 'Não-Cliente',
      prospect: 'Prospect',
      partner: 'Parceiro',
      supplier: 'Fornecedor',
    };
    return systemLabels[name] || name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const current = classifications.find(c => c.name === value) || { 
    name: 'none', 
    color: 'bg-slate-400', 
    label: 'Sem status',
    isSystem: false 
  };

  const handleAddNew = async () => {
    if (!newName.trim()) return;
    const result = await onAddNew(newName, newColor);
    if (result) {
      onChange(result.name);
      setIsAddingNew(false);
      setNewName('');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 hover:bg-muted/50"
        >
          <Badge className={`${current.color} text-white text-xs cursor-pointer`}>
            <Tag className="h-3 w-3" />
            <span className="ml-1">{getLabel(current.name)}</span>
            <ChevronDown className="h-3 w-3 ml-1" />
          </Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {/* None option */}
        <DropdownMenuItem
          onClick={() => onChange(null)}
          className={value === null ? 'bg-muted' : ''}
        >
          <Badge className="bg-slate-400 text-white text-xs mr-2">
            <X className="h-3 w-3" />
            <span className="ml-1">Sem status</span>
          </Badge>
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        {/* Existing classifications */}
        {classifications.map((option) => (
          <DropdownMenuItem
            key={option.name}
            onClick={() => onChange(option.name as ContactClassification)}
            className={value === option.name ? 'bg-muted' : ''}
          >
            <Badge className={`${option.color} text-white text-xs mr-2`}>
              <Tag className="h-3 w-3" />
              <span className="ml-1">{getLabel(option.name)}</span>
            </Badge>
          </DropdownMenuItem>
        ))}
        
        <DropdownMenuSeparator />
        
        {/* Add new classification */}
        {isAddingNew ? (
          <div className="p-2 space-y-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome do status"
              className="h-8 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddNew();
                if (e.key === 'Escape') setIsAddingNew(false);
              }}
            />
            <div className="flex gap-1 flex-wrap">
              {classificationColors.slice(0, 8).map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setNewColor(c.value)}
                  className={`w-5 h-5 rounded-full ${c.value} ${newColor === c.value ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
                  title={c.label}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <Button size="sm" className="h-7 text-xs flex-1" onClick={handleAddNew}>
                Criar
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setIsAddingNew(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <DropdownMenuItem onClick={() => setIsAddingNew(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo status...
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// Static fallback config for older code paths
const classificationConfig: Record<NonNullable<ContactClassification> | 'none', { label: string; color: string; icon: React.ReactNode }> = {
  client: { label: 'Cliente', color: 'bg-green-500', icon: <UserCheck className="h-3 w-3" /> },
  non_client: { label: 'Não-Cliente', color: 'bg-gray-500', icon: <Users className="h-3 w-3" /> },
  prospect: { label: 'Prospect', color: 'bg-blue-500', icon: <UserPlus className="h-3 w-3" /> },
  partner: { label: 'Parceiro', color: 'bg-purple-500', icon: <Handshake className="h-3 w-3" /> },
  supplier: { label: 'Fornecedor', color: 'bg-orange-500', icon: <Package className="h-3 w-3" /> },
  none: { label: 'Sem status', color: 'bg-slate-400', icon: <X className="h-3 w-3" /> },
};

const followerStatusConfig: Record<FollowerStatus, { label: string; color: string; icon: React.ReactNode }> = {
  follower: { label: 'Seguidor', color: 'bg-pink-500', icon: <UserPlus className="h-3 w-3" /> },
  following: { label: 'Seguindo', color: 'bg-indigo-500', icon: <UserMinus className="h-3 w-3" /> },
  mutual: { label: 'Mútuo', color: 'bg-emerald-500', icon: <Users2 className="h-3 w-3" /> },
  none: { label: '', color: '', icon: null },
};

export const ContactsManager: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { contacts, totalCount, stats, tagStats, loading, fetchContacts, fetchStats, fetchTagStats, addContact, updateContact, deleteContact, updateClassification, convertToLead, importFromCSV, importFromMetaExport, mergeDuplicateContacts } = useContacts();
  const { confirmDelete, ConfirmDeleteDialog } = useConfirmDelete();
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const { visibility, toggleColumn, resetToDefault } = useContactColumnVisibility();
  const { classifications, addClassification } = useContactClassifications();
  const { isConnected: googleConnected, importContacts: googleImportContacts } = useGoogleIntegration();
  const [importingGoogle, setImportingGoogle] = useState(false);
  
  // Fetch kanban boards for conversion dialog
  const { boards: kanbanBoards, loading: loadingBoards } = useKanbanBoards();
  
  // Fetch relationship counts for displayed contacts
  const contactIds = contacts.map(c => c.id);
  const { counts: relationshipCounts } = useContactRelationshipCounts(contactIds);
  
  // Fetch lead counts for displayed contacts
  const { counts: leadCounts } = useContactLeadCounts(contactIds);
  
  // Fetch relationship types for filter
  const { relationshipTypes } = useRelationshipTypes();
  
  // Relationship type filter state
  const [filterRelationshipType, setFilterRelationshipType] = useState<string | null>(null);
  const { contactIds: filteredByRelationshipIds, loading: loadingRelationshipFilter } = useContactsByRelationshipType(filterRelationshipType);
  
  // Sorting state for leads column
  const [sortByLeads, setSortByLeads] = useState<'asc' | 'desc' | null>(null);
  
  // Build classifications list for the inline select
  const classificationsList = classifications.map(c => ({
    name: c.name,
    color: c.color,
    label: c.name === 'client' ? 'Cliente' :
           c.name === 'non_client' ? 'Não-Cliente' :
           c.name === 'prospect' ? 'Prospect' :
           c.name === 'partner' ? 'Parceiro' :
           c.name === 'supplier' ? 'Fornecedor' :
           c.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    isSystem: c.is_system
  }));
  
  const [searchTerm, setSearchTerm] = usePageState<string>('contacts_searchTerm', '');
  const [filterClassification, setFilterClassification] = usePageState<ContactClassification | 'all' | 'none'>('contacts_filterClass', 'all');
  const [filterTag, setFilterTag] = usePageState<'all' | 'seguidor' | 'seguindo' | 'mutual'>('contacts_filterTag', 'all');
  const [filterProfessions, setFilterProfessions] = usePageState<string[]>('contacts_filterProf', []);
  const [filterDateFrom, setFilterDateFrom] = usePageState<string>('contacts_dateFrom', '');
  const [filterDateTo, setFilterDateTo] = usePageState<string>('contacts_dateTo', '');
  const [filterLeadLinked, setFilterLeadLinked] = usePageState<'all' | 'linked' | 'not_linked'>('contacts_filterLead', 'all');
  const [isAddDialogOpen, setIsAddDialogOpen] = usePageState<boolean>('contacts_addOpen', false);
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
  const [currentPage, setCurrentPage] = usePageState<number>('contacts_page', 1);
  const [itemsPerPage, setItemsPerPage] = usePageState<number>('contacts_perPage', 50);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const metaFileInputRef = useRef<HTMLInputElement>(null);
  
  // State for edit dialog location fields
  const [editCities, setEditCities] = useState<{ id: number; nome: string }[]>([]);
  const [loadingEditCities, setLoadingEditCities] = useState(false);

  // State for relationships manager
  const [relationshipsContact, setRelationshipsContact] = useState<Contact | null>(null);
  const [isRelationshipsOpen, setIsRelationshipsOpen] = useState(false);
  
  const [isNetworkGraphOpen, setIsNetworkGraphOpen] = useState(false);
  
  // State for leads manager
  const [leadsContact, setLeadsContact] = useState<Contact | null>(null);
  const [isLeadsManagerOpen, setIsLeadsManagerOpen] = useState(false);
  
  // State for convert to lead dialog
  const [isConvertDialogOpen, setIsConvertDialogOpen] = useState(false);
  const [contactToConvert, setContactToConvert] = useState<Contact | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [selectedStageId, setSelectedStageId] = useState<string>('');
  
  // State for merge duplicates dialog
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  
  // State for contact detail sheet
  const [detailContactId, setDetailContactId] = usePageState<string | null>('contacts_detailId', null);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = usePageState<boolean>('contacts_detailOpen', false);
  const detailContact = contacts.find(c => c.id === detailContactId) ?? null;

  // Handle URL param to auto-open a contact
  useEffect(() => {
    const openContactId = searchParams.get('openContact');
    if (openContactId && contacts.length > 0) {
      setDetailContactId(openContactId);
      setIsDetailSheetOpen(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('openContact');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, contacts.length]);

  const [newContact, setNewContact] = useState({
    full_name: '',
    phone: '',
    email: '',
    instagram_url: '',
    classification: 'prospect' as ContactClassification,
    city: '',
    state: '',
    neighborhood: '',
    street: '',
    cep: '',
    notes: '',
    follower_status: 'none' as FollowerStatus,
    professions: [] as { cbo_code: string; title: string; is_primary: boolean }[],
  });
  
  // Cities for new contact dialog
  const [newContactCities, setNewContactCities] = useState<{ id: number; nome: string }[]>([]);
  const [loadingNewContactCities, setLoadingNewContactCities] = useState(false);
  
  // Fetch cities when new contact's state changes
  useEffect(() => {
    if (newContact.state) {
      setLoadingNewContactCities(true);
      const state = states.find(s => s.sigla === newContact.state);
      if (state) {
        fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state.id}/municipios?orderBy=nome`)
          .then(res => res.json())
          .then(data => {
            setNewContactCities(data);
            setLoadingNewContactCities(false);
          })
          .catch(() => {
            setNewContactCities([]);
            setLoadingNewContactCities(false);
          });
      } else {
        setNewContactCities([]);
        setLoadingNewContactCities(false);
      }
    } else {
      setNewContactCities([]);
    }
  }, [newContact.state, states]);

  // Fetch cities when editing contact's state changes
  useEffect(() => {
    if (editingContact?.state) {
      setLoadingEditCities(true);
      const state = states.find(s => s.sigla === editingContact.state);
      if (state) {
        fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state.id}/municipios?orderBy=nome`)
          .then(res => res.json())
          .then(data => {
            setEditCities(data);
            setLoadingEditCities(false);
          })
          .catch(() => {
            setEditCities([]);
            setLoadingEditCities(false);
          });
      } else {
        setEditCities([]);
        setLoadingEditCities(false);
      }
    } else {
      setEditCities([]);
    }
  }, [editingContact?.state, states]);

  // Fetch contacts with server-side pagination
  React.useEffect(() => {
    const filters = {
      search: searchTerm || undefined,
      classification: filterClassification !== 'all' ? filterClassification : undefined,
      followerStatus: filterTag !== 'all' ? filterTag : undefined,
      professions: filterProfessions.length > 0 ? filterProfessions : undefined,
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      leadLinked: filterLeadLinked !== 'all' ? filterLeadLinked : undefined,
    };
    fetchContacts(currentPage, itemsPerPage, filters);
  }, [currentPage, itemsPerPage, searchTerm, filterClassification, filterTag, filterProfessions, filterDateFrom, filterDateTo, filterLeadLinked, fetchContacts]);

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterClassification, filterTag, filterRelationshipType, filterProfessions, filterDateFrom, filterDateTo, filterLeadLinked]);

  // Filter contacts by relationship type (client-side since it's a join) and sort by leads
  const displayedContacts = React.useMemo(() => {
    let result = contacts;
    
    // Filter by relationship type
    if (filterRelationshipType) {
      result = result.filter(c => filteredByRelationshipIds.has(c.id));
    }
    
    // Sort by lead count if enabled
    if (sortByLeads) {
      result = [...result].sort((a, b) => {
        const countA = leadCounts[a.id] || 0;
        const countB = leadCounts[b.id] || 0;
        return sortByLeads === 'asc' ? countA - countB : countB - countA;
      });
    }
    
    return result;
  }, [contacts, filterRelationshipType, filteredByRelationshipIds, sortByLeads, leadCounts]);

  // Pagination calculations (server-side for main filters, adjusted for relationship filter)
  const effectiveCount = filterRelationshipType ? displayedContacts.length : totalCount;
  const totalPages = Math.ceil(effectiveCount / itemsPerPage);

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisiblePages = 5;
    
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      
      if (currentPage > 3) pages.push('ellipsis');
      
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      
      for (let i = start; i <= end; i++) pages.push(i);
      
      if (currentPage < totalPages - 2) pages.push('ellipsis');
      
      pages.push(totalPages);
    }
    
    return pages;
  };

  const handleAddContact = async () => {
    if (!newContact.full_name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    // Get primary profession for backwards compatibility
    const primaryProfession = newContact.professions.find(p => p.is_primary);
    
    const result = await addContact({
      full_name: newContact.full_name,
      phone: newContact.phone || null,
      email: newContact.email || null,
      instagram_url: newContact.instagram_url || null,
      classification: newContact.classification,
      city: newContact.city || null,
      state: newContact.state || null,
      notes: newContact.notes || null,
      follower_status: newContact.follower_status !== 'none' ? newContact.follower_status : null,
      profession: primaryProfession?.title || null,
      profession_cbo_code: primaryProfession?.cbo_code || null,
    });

    // Add professions to the junction table if contact was created
    if (result && newContact.professions.length > 0) {
      for (const prof of newContact.professions) {
        await (supabase as any)
          .from('contact_professions')
          .insert({
            contact_id: result.id,
            cbo_code: prof.cbo_code,
            profession_title: prof.title,
            is_primary: prof.is_primary
          });
      }
    }

    setNewContact({
      full_name: '',
      phone: '',
      email: '',
      instagram_url: '',
      classification: 'prospect',
      city: '',
      state: '',
      neighborhood: '',
      street: '',
      cep: '',
      notes: '',
      follower_status: 'none',
      professions: [],
    });
    setNewContactCities([]);
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

  // Open link to lead dialog
  const handleLinkToLead = (contact: Contact) => {
    setContactToConvert(contact);
    // Pre-select default board if available
    const defaultBoard = kanbanBoards.find(b => b.is_default) || kanbanBoards[0];
    if (defaultBoard) {
      setSelectedBoardId(defaultBoard.id);
      if (defaultBoard.stages.length > 0) {
        setSelectedStageId(defaultBoard.stages[0].id);
      }
    }
    setIsConvertDialogOpen(true);
  };

  // Confirm creating and linking lead
  const handleConfirmLinkLead = async () => {
    if (!contactToConvert) return;
    
    // Use the stage ID directly as status, since kanban boards use UUIDs for stages
    // The leads table stores the stage ID in the status field when using dynamic kanban boards
    await convertToLead(contactToConvert.id, {
      board_id: selectedBoardId || null,
      status: selectedStageId || 'new',
    });
    
    setIsConvertDialogOpen(false);
    setContactToConvert(null);
    setSelectedBoardId('');
    setSelectedStageId('');
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
    if (selectedContacts.size === contacts.length) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(contacts.map(c => c.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedContacts.size === 0) return;
    
    confirmDelete(
      'Excluir Contatos',
      `Tem certeza que deseja excluir ${selectedContacts.size} contato(s)? Esta ação não pode ser desfeita.`,
      async () => {
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
        
        setSelectedContacts(new Set());
        toast.success(`${deleted} contato(s) excluído(s)${errors > 0 ? `, ${errors} erro(s)` : ''}`);
        setIsDeleting(false);
      }
    );
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
      const label = newClassification === null ? 'Sem status' : classificationConfig[newClassification].label;
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

  // Batch link contacts to new leads
  const handleBatchLinkToLeads = async () => {
    if (selectedContacts.size === 0) return;
    
    // Filter only contacts not already converted
    const contactsToConvert = Array.from(selectedContacts)
      .map(id => contacts.find(c => c.id === id))
      .filter(c => c && !c.lead_id);
    
    if (contactsToConvert.length === 0) {
      toast.info('Todos os contatos selecionados já foram convertidos em leads');
      return;
    }
    
    confirmDelete(
      'Criar Leads',
      `Criar e vincular leads para ${contactsToConvert.length} contato(s)?`,
      async () => {
        setIsBatchProcessing(true);
        let linked = 0;
        let errors = 0;
        
        for (const contact of contactsToConvert) {
          if (!contact) continue;
          try {
            await convertToLead(contact.id);
            linked++;
          } catch {
            errors++;
          }
        }
        
        setIsBatchProcessing(false);
        setSelectedContacts(new Set());
        
        if (errors > 0) {
          toast.warning(`${linked} vinculados, ${errors} erros`);
        } else {
          toast.success(`${linked} leads criados e vinculados!`);
        }
      }
    );
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
          // Direct array of follower objects (Meta export format)
          followers = data;
        } else if (Array.isArray(data)) {
          // Simple array without string_list_data, assume followers
          followers = data;
        }

        if (data.relationships_following) {
          following = data.relationships_following;
        } else if (data.following) {
          following = Array.isArray(data.following) ? data.following : [data.following];
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

  // Handle merge duplicates - now opens dialog
  const handleMergeDuplicates = () => {
    setIsMergeDialogOpen(true);
  };
  
  const handleMergeComplete = () => {
    // Refetch contacts after merge
    fetchContacts();
    fetchStats();
    fetchTagStats();
  };

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Main Stats */}
        <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
        
        {/* Profession Stats Card */}
        <div className="lg:col-span-1">
          <ProfessionStatsCard
            selectedProfessions={filterProfessions}
            onProfessionClick={(profession) => {
              if (filterProfessions.includes(profession)) {
                setFilterProfessions(filterProfessions.filter(p => p !== profession));
              } else {
                setFilterProfessions([...filterProfessions, profession]);
              }
            }}
          />
        </div>
      </div>

      {/* Actions Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3">
            {/* Row 1: Search full width */}
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar contatos por nome, telefone, email, Instagram..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-10"
              />
            </div>

            {/* Row 2: Main actions left, Import/Export right */}
            <div className="flex flex-col md:flex-row gap-2 items-start md:items-center justify-between">
              <div className="flex gap-2 flex-wrap">
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" />
                      Adicionar
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
                    <DialogHeader className="flex-shrink-0">
                      <DialogTitle>Novo Contato</DialogTitle>
                    </DialogHeader>
                  <div className="space-y-4 flex-1 overflow-y-auto pr-2">
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
                        <Label>Estado</Label>
                        <Select 
                          value={newContact.state || 'none'} 
                          onValueChange={(v) => setNewContact({ 
                            ...newContact, 
                            state: v === 'none' ? '' : v,
                            city: '' // Reset city when state changes
                          })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Selecione o estado</SelectItem>
                            {states.map(state => (
                              <SelectItem key={state.sigla} value={state.sigla}>
                                {state.sigla} - {state.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Cidade</Label>
                        <Select 
                          value={newContact.city || 'none'} 
                          onValueChange={(v) => setNewContact({ ...newContact, city: v === 'none' ? '' : v })}
                          disabled={!newContact.state || loadingNewContactCities}
                        >
                          <SelectTrigger>
                            {loadingNewContactCities ? (
                              <span className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Carregando...
                              </span>
                            ) : (
                              <SelectValue placeholder={newContact.state ? "Selecione a cidade" : "Selecione o estado primeiro"} />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Selecione a cidade</SelectItem>
                            {newContactCities.map(city => (
                              <SelectItem key={city.id} value={city.nome}>
                                {city.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Status de Seguidor</Label>
                        <Select 
                          value={newContact.follower_status} 
                          onValueChange={(v) => setNewContact({ ...newContact, follower_status: v as FollowerStatus })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              <div className="flex items-center gap-2 text-muted-foreground">
                                Não definido
                              </div>
                            </SelectItem>
                            <SelectItem value="follower">
                              <div className="flex items-center gap-2">
                                <UserPlus className="h-4 w-4 text-pink-500" />
                                Seguidor (me segue)
                              </div>
                            </SelectItem>
                            <SelectItem value="following">
                              <div className="flex items-center gap-2">
                                <UserMinus className="h-4 w-4 text-indigo-500" />
                                Seguindo (eu sigo)
                              </div>
                            </SelectItem>
                            <SelectItem value="mutual">
                              <div className="flex items-center gap-2">
                                <Users2 className="h-4 w-4 text-emerald-500" />
                                Mútuo (ambos)
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label>Profissões</Label>
                        <MultiProfessionSelector
                          value={newContact.professions}
                          onChange={(professions) => setNewContact({ 
                            ...newContact, 
                            professions 
                          })}
                          placeholder="Selecione profissões..."
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Status</Label>
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
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsNetworkGraphOpen(true)}
                  className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border-blue-500/30 hover:border-blue-500/50"
                >
                  <Network className="h-4 w-4 mr-1 text-blue-500" />
                  Rede de Vínculos
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleMergeDuplicates}
                  className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-amber-500/30 hover:border-amber-500/50"
                >
                  <GitMerge className="h-4 w-4 mr-1 text-amber-500" />
                  Mesclar Duplicados
                </Button>
              </div>
              <div className="flex flex-col gap-2">
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
                <Button variant="outline" size="sm" onClick={downloadTemplate}>
                  <Download className="h-4 w-4 mr-1" />
                  Modelo CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" />
                  Importar CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => metaFileInputRef.current?.click()} className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-pink-500/30 hover:border-pink-500/50">
                  <Instagram className="h-4 w-4 mr-1 text-pink-500" />
                  Meta Export
                </Button>
                {googleConnected && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={importingGoogle}
                    onClick={async () => {
                      setImportingGoogle(true);
                      try {
                        const result = await googleImportContacts();
                        toast.success(`Google: ${result.imported} novos, ${result.skipped} já existentes`);
                        fetchContacts();
                      } catch {
                        toast.error('Erro ao importar do Google');
                      } finally {
                        setImportingGoogle(false);
                      }
                    }}
                  >
                    <Chrome className="h-4 w-4 mr-1" />
                    {importingGoogle ? 'Importando...' : 'Google Contacts'}
                  </Button>
                )}
              </div>
            </div>
            
            {/* Row 2: Date range - prominent */}
            <div className="flex gap-2 items-center bg-muted/50 rounded-lg px-3 py-2 border border-border">
              <Calendar className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-medium text-foreground whitespace-nowrap">Período:</span>
              <Input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-[160px] h-9 text-sm bg-background"
                placeholder="Data inicial"
              />
              <span className="text-muted-foreground text-xs font-medium">até</span>
              <Input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-[160px] h-9 text-sm bg-background"
                placeholder="Data final"
              />
              {(filterDateFrom || filterDateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {/* Row 3: People & CRM filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={filterClassification} onValueChange={(v) => setFilterClassification(v as any)}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas classificações</SelectItem>
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
              
              <Select 
                value={filterRelationshipType || 'all'} 
                onValueChange={(v) => setFilterRelationshipType(v === 'all' ? null : v)}
              >
                <SelectTrigger className="w-[145px] h-8 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue placeholder="Vínculo" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os vínculos</SelectItem>
                  {relationshipTypes.map((type) => (
                    <SelectItem key={type.id} value={type.name}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <ProfessionFilter
                selectedProfessions={filterProfessions}
                onSelectionChange={setFilterProfessions}
              />
              
              <Select value={filterLeadLinked} onValueChange={(v) => setFilterLeadLinked(v as any)}>
                <SelectTrigger className="w-[155px] h-8 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Link className="h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue placeholder="Leads" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os leads</SelectItem>
                  <SelectItem value="linked">Vinculados a Lead</SelectItem>
                  <SelectItem value="not_linked">Sem Lead</SelectItem>
                </SelectContent>
              </Select>

              {filterRelationshipType && (
                <Badge 
                  variant="secondary" 
                  className="h-7 px-2 gap-1.5 bg-blue-500/10 text-blue-600 border-blue-500/30 cursor-pointer hover:bg-blue-500/20 text-xs"
                  onClick={() => setFilterRelationshipType(null)}
                >
                  <Link2 className="h-3 w-3" />
                  {filterRelationshipType}
                  {loadingRelationshipFilter ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <span className="text-[10px]">({filteredByRelationshipIds.size})</span>
                      <X className="h-3 w-3" />
                    </>
                  )}
                </Badge>
              )}
            </div>

            {/* Row 4: Instagram status */}
            <div className="flex gap-1.5 items-center">
              <Button
                variant={filterTag === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTag('all')}
                className="h-7 text-xs"
              >
                <Users className="h-3 w-3 mr-1" />
                Todos os status
              </Button>
              <Button
                variant={filterTag === 'seguidor' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTag('seguidor')}
                className="h-7 text-xs"
              >
                <UserPlus className="h-3 w-3 mr-1" />
                Seguidores
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {tagStats.seguidores}
                </Badge>
              </Button>
              <Button
                variant={filterTag === 'seguindo' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTag('seguindo')}
                className="h-7 text-xs"
              >
                <UserMinus className="h-3 w-3 mr-1" />
                Seguindo
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {tagStats.seguindo}
                </Badge>
              </Button>
              <Button
                variant={filterTag === 'mutual' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTag('mutual')}
                className="h-7 text-xs"
              >
                <Users2 className="h-3 w-3 mr-1" />
                Mútuos
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {tagStats.mutuos}
                </Badge>
              </Button>
              {filterTag !== 'all' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilterTag('all')}
                  className="h-7 w-7 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contacts Table */}
      <Card>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Contatos ({totalCount})
              </CardTitle>
              
              {/* Column visibility settings */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Configurar colunas visíveis">
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={visibility.name}
                    onCheckedChange={() => toggleColumn('name')}
                  >
                    Nome
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibility.phone}
                    onCheckedChange={() => toggleColumn('phone')}
                  >
                    Telefone
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibility.email}
                    onCheckedChange={() => toggleColumn('email')}
                  >
                    Email
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibility.instagram}
                    onCheckedChange={() => toggleColumn('instagram')}
                  >
                    Instagram
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibility.followerStatus}
                    onCheckedChange={() => toggleColumn('followerStatus')}
                  >
                    Status Seguidor
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibility.city}
                    onCheckedChange={() => toggleColumn('city')}
                  >
                    Cidade
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibility.state}
                    onCheckedChange={() => toggleColumn('state')}
                  >
                    Estado
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibility.classification}
                    onCheckedChange={() => toggleColumn('classification')}
                  >
                    Status
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibility.profession}
                    onCheckedChange={() => toggleColumn('profession')}
                  >
                    Profissão
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibility.status}
                    onCheckedChange={() => toggleColumn('status')}
                  >
                    Status
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibility.leads}
                    onCheckedChange={() => toggleColumn('leads')}
                  >
                    Leads Vinculados
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={resetToDefault}>
                    Restaurar padrão
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            
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

                {/* Link to leads button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBatchLinkToLeads}
                  disabled={isBatchProcessing}
                >
                  <Link2 className="h-4 w-4 mr-1" />
                  Vincular a Leads
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
                      checked={contacts.length > 0 && selectedContacts.size === contacts.length}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Selecionar todos"
                    />
                  </TableHead>
                  {visibility.name && <TableHead>Nome</TableHead>}
                  {(visibility.phone || visibility.email) && <TableHead>Contato</TableHead>}
                  {(visibility.instagram || visibility.followerStatus) && <TableHead>Instagram</TableHead>}
                  {(visibility.city || visibility.state) && <TableHead>Localização</TableHead>}
                  {visibility.classification && <TableHead>Status</TableHead>}
                  {visibility.profession && <TableHead>Profissão</TableHead>}
                  {visibility.status && <TableHead>Status</TableHead>}
                  {visibility.leads && (
                    <TableHead 
                      className="cursor-pointer select-none hover:bg-muted/50 transition-colors"
                      onClick={() => {
                        setSortByLeads(prev => 
                          prev === null ? 'desc' : prev === 'desc' ? 'asc' : null
                        );
                      }}
                    >
                      <div className="flex items-center gap-1">
                        Leads
                        {sortByLeads === null && <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />}
                        {sortByLeads === 'desc' && <ArrowDown className="h-3.5 w-3.5 text-primary" />}
                        {sortByLeads === 'asc' && <ArrowUp className="h-3.5 w-3.5 text-primary" />}
                      </div>
                    </TableHead>
                  )}
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
                ) : displayedContacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {filterRelationshipType 
                        ? `Nenhum contato com vínculo "${filterRelationshipType}" encontrado`
                        : 'Nenhum contato encontrado'}
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedContacts.map((contact) => {
                    const classConfig = classificationConfig[contact.classification || 'none'];
                    const isSelected = selectedContacts.has(contact.id);
                    return (
                      <ContextMenu key={contact.id}>
                        <ContextMenuTrigger asChild>
                      <TableRow className={isSelected ? 'bg-muted/50' : ''}>
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelectContact(contact.id)}
                            aria-label={`Selecionar ${contact.full_name}`}
                          />
                        </TableCell>
                        {visibility.name && (
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 flex-shrink-0"
                                 onClick={() => {
                                   setDetailContactId(contact.id);
                                   setIsDetailSheetOpen(true);
                                 }}
                                title="Ver detalhes completos"
                              >
                                <Eye className="h-3.5 w-3.5 text-primary" />
                              </Button>
                              <InlineEditableText
                                value={contact.full_name}
                                onSave={(value) => updateContact(contact.id, { full_name: value })}
                                className="font-medium"
                              />
                              {relationshipCounts[contact.id] > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 gap-1"
                                  onClick={() => {
                                    setRelationshipsContact(contact);
                                    setIsRelationshipsOpen(true);
                                  }}
                                  title={`${relationshipCounts[contact.id]} vínculo(s)`}
                                >
                                  <Link2 className="h-3 w-3 text-primary" />
                                  <span className="text-xs font-medium">{relationshipCounts[contact.id]}</span>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                        {(visibility.phone || visibility.email) && (
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {visibility.phone && (
                                <InlineEditableText
                                  value={contact.phone || ''}
                                  onSave={(value) => updateContact(contact.id, { phone: value || null })}
                                  placeholder="Telefone"
                                  className="text-xs"
                                  renderDisplay={(val) => val ? (
                                    <a 
                                      href={`https://wa.me/55${val.replace(/\D/g, '')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 text-green-600 hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Phone className="h-3 w-3" />
                                      {val}
                                    </a>
                                  ) : null}
                                />
                              )}
                              {visibility.email && (
                                <InlineEditableText
                                  value={contact.email || ''}
                                  onSave={(value) => updateContact(contact.id, { email: value || null })}
                                  placeholder="Email"
                                  className="text-xs text-muted-foreground"
                                  renderDisplay={(val) => val ? (
                                    <span className="flex items-center gap-1">
                                      <Mail className="h-3 w-3" />
                                      {val}
                                    </span>
                                  ) : null}
                                />
                              )}
                            </div>
                          </TableCell>
                        )}
                        {(visibility.instagram || visibility.followerStatus) && (
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {visibility.instagram && (
                                <>
                                  {contact.instagram_username ? (
                                    <div className="flex items-center gap-2">
                                      <InstagramProfileHoverCard 
                                        username={contact.instagram_username}
                                        className="text-pink-500 text-sm"
                                      >
                                        <Instagram className="h-3 w-3" />
                                        <span>@{contact.instagram_username}</span>
                                      </InstagramProfileHoverCard>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        asChild
                                      >
                                        <a
                                          href={`https://instagram.com/${contact.instagram_username}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Abrir perfil no Instagram"
                                        >
                                          <Eye className="h-3 w-3 text-pink-500" />
                                        </a>
                                      </Button>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">-</span>
                                  )}
                                </>
                              )}
                              {/* Follower Status Badge */}
                              {visibility.followerStatus && contact.follower_status && contact.follower_status !== 'none' && (
                                <Badge className={`${followerStatusConfig[contact.follower_status].color} text-white text-xs w-fit`}>
                                  {followerStatusConfig[contact.follower_status].icon}
                                  <span className="ml-1">{followerStatusConfig[contact.follower_status].label}</span>
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                        )}
                        {(visibility.city || visibility.state) && (
                          <TableCell>
                            <div className="flex gap-1 text-xs text-muted-foreground">
                              {visibility.city && (contact.city || '-')}
                              {visibility.city && visibility.state && ', '}
                              {visibility.state && (contact.state || '-')}
                            </div>
                          </TableCell>
                        )}
                        {visibility.classification && (
                          <TableCell>
                            <InlineClassificationSelect
                              value={contact.classification}
                              onChange={(value) => updateContact(contact.id, { classification: value })}
                              classifications={classificationsList}
                              onAddNew={addClassification}
                            />
                          </TableCell>
                        )}
                        {visibility.profession && (
                          <TableCell>
                            <ProfessionBadgePopover
                              contactId={contact.id}
                              authorUsername={contact.instagram_username}
                              profession={contact.profession}
                              professionCboCode={contact.profession_cbo_code}
                              compact={false}
                              interactive={true}
                              onDataChanged={() => fetchContacts(currentPage, itemsPerPage, { search: searchTerm, classification: filterClassification, followerStatus: filterTag })}
                            />
                          </TableCell>
                        )}
                        {visibility.status && (
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {leadCounts[contact.id] > 0 ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 gap-1"
                                  onClick={() => {
                                    setLeadsContact(contact);
                                    setIsLeadsManagerOpen(true);
                                  }}
                                  title={`${leadCounts[contact.id]} lead(s) vinculado(s)`}
                                >
                                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/50 text-xs gap-1">
                                    <Users className="h-3 w-3" />
                                    {leadCounts[contact.id]} Lead{leadCounts[contact.id] > 1 ? 's' : ''}
                                  </Badge>
                                </Button>
                              ) : contact.lead_id ? (
                                <Badge variant="outline" className="text-emerald-500 border-emerald-500/50 text-xs">
                                  Lead
                                </Badge>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
                                  onClick={() => {
                                    setLeadsContact(contact);
                                    setIsLeadsManagerOpen(true);
                                  }}
                                >
                                  + Vincular
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                        {visibility.leads && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 gap-1"
                              onClick={() => {
                                setLeadsContact(contact);
                                setIsLeadsManagerOpen(true);
                              }}
                            >
                              {(leadCounts[contact.id] || 0) > 0 ? (
                                <Badge variant="outline" className="text-emerald-500 border-emerald-500/50 text-xs gap-1">
                                  <Users className="h-3 w-3" />
                                  {leadCounts[contact.id]}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">0</span>
                              )}
                            </Button>
                          </TableCell>
                        )}
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
                              <DropdownMenuItem onClick={() => {
                                setRelationshipsContact(contact);
                                setIsRelationshipsOpen(true);
                              }}>
                                <Link2 className="h-4 w-4 mr-2" />
                                Vínculos
                              </DropdownMenuItem>
                              {!contact.lead_id && (
                                <DropdownMenuItem onClick={() => handleLinkToLead(contact)}>
                                  <Link2 className="h-4 w-4 mr-2" />
                                  Vincular a Lead
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => confirmDelete('Excluir Contato', `Tem certeza que deseja excluir "${contact.full_name}"? Esta ação não pode ser desfeita.`, () => deleteContact(contact.id))}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                            onClick={() => {
                              window.open(`${window.location.origin}/leads?tab=contacts&openContact=${contact.id}`, '_blank');
                            }}
                          >
                            <ExternalLink className="h-3.5 w-3.5 mr-2" />
                            Abrir em nova aba
                          </ContextMenuItem>
                          <ContextMenuItem
                            onClick={() => {
                              const url = `${window.location.origin}/leads?tab=contacts&openContact=${contact.id}`;
                              navigator.clipboard.writeText(url);
                              toast.success('Link copiado!');
                            }}
                          >
                            <Link2 className="h-3.5 w-3.5 mr-2" />
                            Copiar link
                          </ContextMenuItem>
                          <ContextMenuItem
                            onClick={() => {
                              const url = `${window.location.origin}/leads?tab=contacts&openContact=${contact.id}`;
                              const text = `Contato: *${contact.full_name}*\n${url}`;
                              window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                            }}
                          >
                            <MessageSquare className="h-3.5 w-3.5 mr-2" />
                            Enviar via WhatsApp
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>
                  Mostrando {((currentPage - 1) * itemsPerPage) + 1}-{Math.min(currentPage * itemsPerPage, totalCount)} de {totalCount}
                </span>
                <Select
                  value={itemsPerPage.toString()}
                  onValueChange={(value) => {
                    setItemsPerPage(Number(value));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-[100px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25 / pág</SelectItem>
                    <SelectItem value="50">50 / pág</SelectItem>
                    <SelectItem value="100">100 / pág</SelectItem>
                    <SelectItem value="200">200 / pág</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  
                  {getPageNumbers().map((page, idx) => (
                    <PaginationItem key={idx}>
                      {page === 'ellipsis' ? (
                        <span className="px-2">...</span>
                      ) : (
                        <PaginationLink
                          onClick={() => setCurrentPage(page)}
                          isActive={currentPage === page}
                          className="cursor-pointer"
                        >
                          {page}
                        </PaginationLink>
                      )}
                    </PaginationItem>
                  ))}
                  
                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Instagram Username</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
                    <Input
                      value={editingContact.instagram_username?.replace(/^@/, '') || ''}
                      onChange={(e) => {
                        const value = e.target.value.replace(/^@/, '').replace(/\s/g, '');
                        setEditingContact({ ...editingContact, instagram_username: value });
                      }}
                      className="pl-7"
                      placeholder="username"
                    />
                  </div>
                </div>
                <div>
                  <Label>Instagram URL</Label>
                  <Input
                    value={editingContact.instagram_url || ''}
                    onChange={(e) => {
                      const url = e.target.value;
                      setEditingContact({ ...editingContact, instagram_url: url });
                      
                      // Auto-extract username from URL
                      const match = url.match(/(?:instagram\.com|instagr\.am)\/([^/?#]+)/i);
                      if (match && match[1] && !['p', 'reel', 'stories', 'explore', 'accounts'].includes(match[1].toLowerCase())) {
                        const extractedUsername = match[1].replace(/^@/, '');
                        if (extractedUsername && extractedUsername !== editingContact.instagram_username) {
                          setEditingContact(prev => ({ ...prev!, instagram_url: url, instagram_username: extractedUsername }));
                        }
                      }
                    }}
                    placeholder="Cole a URL do perfil aqui"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Cole a URL e o username será preenchido automaticamente
                  </p>
                </div>
              </div>
              
              {/* Location with CEP lookup */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Localização
                </Label>
                
                {/* CEP with auto-fill button */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">CEP (digite para buscar endereço)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={(editingContact as any).cep || ''}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '');
                          const formatted = value.length > 5 
                            ? `${value.slice(0, 5)}-${value.slice(5, 8)}`
                            : value;
                          setEditingContact({ ...editingContact, cep: formatted } as any);
                        }}
                        placeholder="00000-000"
                        maxLength={9}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!((editingContact as any).cep?.replace(/\D/g, '')?.length === 8)}
                        onClick={async () => {
                          const cep = ((editingContact as any).cep || '').replace(/\D/g, '');
                          if (cep.length !== 8) {
                            toast.error('CEP deve ter 8 dígitos');
                            return;
                          }
                          
                          try {
                            const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                            const data = await response.json();
                            
                            if (data.erro) {
                              toast.error('CEP não encontrado');
                              return;
                            }
                            
                            setEditingContact({
                              ...editingContact,
                              state: data.uf || editingContact.state,
                              city: data.localidade || editingContact.city,
                              neighborhood: data.bairro || (editingContact as any).neighborhood,
                              street: data.logradouro || (editingContact as any).street,
                            } as any);
                            
                            toast.success('Endereço preenchido automaticamente!');
                          } catch (error) {
                            toast.error('Erro ao buscar CEP');
                          }
                        }}
                      >
                        <Search className="h-4 w-4 mr-1" />
                        Buscar
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Digite o CEP e clique em Buscar para preencher o endereço automaticamente
                    </p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Estado</Label>
                    <Select
                      value={editingContact.state || ''}
                      onValueChange={(value) => {
                        setEditingContact({ 
                          ...editingContact, 
                          state: value,
                          city: '' // Reset city when state changes
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o estado" />
                      </SelectTrigger>
                      <SelectContent>
                        {states.map((state) => (
                          <SelectItem key={state.sigla} value={state.sigla}>
                            {state.nome} ({state.sigla})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Cidade</Label>
                    <Select
                      value={editingContact.city || ''}
                      onValueChange={(value) => setEditingContact({ ...editingContact, city: value })}
                      disabled={!editingContact.state || loadingEditCities}
                    >
                      <SelectTrigger>
                        {loadingEditCities ? (
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Carregando...</span>
                          </div>
                        ) : (
                          <SelectValue placeholder={editingContact.state ? "Selecione a cidade" : "Primeiro selecione o estado"} />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        {editCities.map((city) => (
                          <SelectItem key={city.id} value={city.nome}>
                            {city.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Bairro</Label>
                  <Input
                    value={(editingContact as any).neighborhood || ''}
                    onChange={(e) => setEditingContact({ ...editingContact, neighborhood: e.target.value } as any)}
                    placeholder="Bairro"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Rua / Logradouro</Label>
                  <Input
                    value={(editingContact as any).street || ''}
                    onChange={(e) => setEditingContact({ ...editingContact, street: e.target.value } as any)}
                    placeholder="Rua, Avenida, etc."
                  />
                </div>
              </div>
              <div>
                <Label>Status</Label>
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
                    <TableHead>Status</TableHead>
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
              <Label>Status inicial</Label>
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

      {/* Contact Relationships Manager */}
      <ContactRelationshipsManager
        contact={relationshipsContact}
        open={isRelationshipsOpen}
        onOpenChange={setIsRelationshipsOpen}
      />

      {/* Network Graph */}
      <ContactNetworkGraph
        isOpen={isNetworkGraphOpen}
        onClose={() => setIsNetworkGraphOpen(false)}
        contacts={contacts}
        onSelectContact={(contact) => {
          setRelationshipsContact(contact);
          setIsRelationshipsOpen(true);
        }}
      />

      {/* Contact Leads Manager */}
      <ContactLeadsManager
        contact={leadsContact}
        open={isLeadsManagerOpen}
        onOpenChange={setIsLeadsManagerOpen}
      />

      {/* Link to Lead Dialog */}
      <Dialog open={isConvertDialogOpen} onOpenChange={setIsConvertDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Vincular a Lead
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 flex-1 overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              Criar um novo lead para <strong>{contactToConvert?.full_name}</strong> e vinculá-lo automaticamente:
            </p>
            
            <div className="space-y-3">
              <div>
                <Label>Quadro Kanban</Label>
                <Select
                  value={selectedBoardId}
                  onValueChange={(value) => {
                    setSelectedBoardId(value);
                    const board = kanbanBoards.find(b => b.id === value);
                    if (board && board.stages.length > 0) {
                      setSelectedStageId(board.stages[0].id);
                    } else {
                      setSelectedStageId('');
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um quadro" />
                  </SelectTrigger>
                  <SelectContent>
                    {kanbanBoards.map((board) => (
                      <SelectItem key={board.id} value={board.id}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: board.color || '#3b82f6' }}
                          />
                          {board.name}
                          {board.is_default && (
                            <Badge variant="secondary" className="text-xs ml-1">Padrão</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedBoardId && (
                <div>
                  <Label>Estágio inicial</Label>
                  <Select
                    value={selectedStageId}
                    onValueChange={setSelectedStageId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o estágio" />
                    </SelectTrigger>
                    <SelectContent>
                      {kanbanBoards
                        .find(b => b.id === selectedBoardId)
                        ?.stages.map((stage) => (
                          <SelectItem key={stage.id} value={stage.id}>
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-full" 
                                style={{ backgroundColor: stage.color }}
                              />
                              {stage.name}
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button 
              variant="outline" 
              onClick={() => {
                setIsConvertDialogOpen(false);
                setContactToConvert(null);
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleConfirmLinkLead}>
              Criar e Vincular
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Merge Duplicates Dialog */}
      <MergeDuplicatesDialog
        open={isMergeDialogOpen}
        onOpenChange={setIsMergeDialogOpen}
        onMergeComplete={handleMergeComplete}
      />
      
      {/* Contact Detail Sheet */}
      <ContactDetailSheet
        contact={detailContact}
        open={isDetailSheetOpen}
        onOpenChange={(open) => {
          setIsDetailSheetOpen(open);
          if (!open) setDetailContactId(null);
        }}
        onContactUpdated={() => {
          fetchContacts(currentPage, itemsPerPage);
        }}
      />
      <ConfirmDeleteDialog />
    </div>
  );
};

export default ContactsManager;
