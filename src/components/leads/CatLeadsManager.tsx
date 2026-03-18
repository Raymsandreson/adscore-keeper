import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Upload, Search, Phone, Skull, Filter, RefreshCw, Trash2,
  CheckCircle2, Clock, XCircle, AlertTriangle, MessageSquare
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useCatLeads, type CatLead, type CatLeadContact } from '@/hooks/useCatLeads';
import { CatImportDialog } from './CatImportDialog';
import { CatLeadContactDialog } from './CatLeadContactDialog';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: 'Pendente', color: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30', icon: Clock },
  contacted: { label: 'Contatado', color: 'bg-blue-500/10 text-blue-700 border-blue-500/30', icon: Phone },
  interested: { label: 'Interessado', color: 'bg-green-500/10 text-green-700 border-green-500/30', icon: CheckCircle2 },
  not_interested: { label: 'Não interessado', color: 'bg-red-500/10 text-red-700 border-red-500/30', icon: XCircle },
  converted: { label: 'Convertido', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30', icon: CheckCircle2 },
  unreachable: { label: 'Inalcançável', color: 'bg-gray-500/10 text-gray-700 border-gray-500/30', icon: AlertTriangle },
};

export function CatLeadsManager() {
  const { catLeads, loading, fetchCatLeads, importCatLeads, updateCatLead, deleteCatLead, addContact, fetchContacts } = useCatLeads();
  const [importOpen, setImportOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<CatLead | null>(null);
  const [leadContacts, setLeadContacts] = useState<CatLeadContact[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [obitoFilter, setObitoFilter] = useState('all');
  const [accidentDateFrom, setAccidentDateFrom] = useState('');
  const [accidentDateTo, setAccidentDateTo] = useState('');

  const filtered = useMemo(() => {
    return catLeads.filter(l => {
      const matchesSearch = !search ||
        l.nome_completo.toLowerCase().includes(search.toLowerCase()) ||
        l.cpf?.includes(search) ||
        l.municipio?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || l.contact_status === statusFilter;
      const matchesObito = obitoFilter === 'all' ||
        (obitoFilter === 'yes' && l.indica_obito) ||
        (obitoFilter === 'no' && !l.indica_obito);
      const matchesDateFrom = !accidentDateFrom || (l.data_acidente && l.data_acidente >= accidentDateFrom);
      const matchesDateTo = !accidentDateTo || (l.data_acidente && l.data_acidente <= accidentDateTo);
      return matchesSearch && matchesStatus && matchesObito && matchesDateFrom && matchesDateTo;
    });
  }, [catLeads, search, statusFilter, obitoFilter, accidentDateFrom, accidentDateTo]);

  const stats = useMemo(() => ({
    total: catLeads.length,
    pending: catLeads.filter(l => l.contact_status === 'pending').length,
    contacted: catLeads.filter(l => l.contact_status === 'contacted').length,
    interested: catLeads.filter(l => l.contact_status === 'interested').length,
    obitos: catLeads.filter(l => l.indica_obito).length,
  }), [catLeads]);

  const openContactDialog = async (lead: CatLead) => {
    setSelectedLead(lead);
    const contacts = await fetchContacts(lead.id);
    setLeadContacts(contacts);
    setContactDialogOpen(true);
  };

  const refreshContacts = async () => {
    if (selectedLead) {
      const contacts = await fetchContacts(selectedLead.id);
      setLeadContacts(contacts);
    }
  };

  const handleStatusChange = (lead: CatLead, status: string) => {
    updateCatLead(lead.id, { contact_status: status });
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total CATs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <p className="text-xs text-muted-foreground">Pendentes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-blue-600">{stats.contacted}</div>
            <p className="text-xs text-muted-foreground">Contatados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-green-600">{stats.interested}</div>
            <p className="text-xs text-muted-foreground">Interessados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-red-600">{stats.obitos}</div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Skull className="h-3 w-3" /> Óbitos
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, CPF ou município..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={obitoFilter} onValueChange={setObitoFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Óbito" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="yes">Somente óbitos</SelectItem>
            <SelectItem value="no">Sem óbito</SelectItem>
          </SelectContent>
        </Select>

        <Button onClick={() => setImportOpen(true)} className="gap-2">
          <Upload className="h-4 w-4" />
          Importar XLSX
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {catLeads.length === 0
                ? 'Nenhuma CAT importada ainda. Clique em "Importar XLSX" para começar.'
                : 'Nenhum resultado encontrado para os filtros aplicados.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Nome</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Município/UF</TableHead>
                    <TableHead>Óbito</TableHead>
                    <TableHead>Natureza Lesão</TableHead>
                    <TableHead>Data Acidente</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Celular</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 100).map(lead => {
                    const sc = STATUS_CONFIG[lead.contact_status] || STATUS_CONFIG.pending;
                    return (
                      <TableRow key={lead.id} className={lead.indica_obito ? 'bg-red-50/30 dark:bg-red-950/10' : ''}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm truncate max-w-[200px]">{lead.nome_completo}</p>
                            <p className="text-xs text-muted-foreground">{lead.cpf}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {lead.cnpj_cei_empregador || '-'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {lead.municipio}/{lead.uf}
                        </TableCell>
                        <TableCell>
                          {lead.indica_obito ? (
                            <Badge variant="destructive" className="text-[10px] gap-1">
                              <Skull className="h-3 w-3" /> Sim
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Não</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">
                          {lead.natureza_lesao}
                        </TableCell>
                        <TableCell className="text-xs">
                          {lead.data_acidente
                            ? format(new Date(lead.data_acidente), 'dd/MM/yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={lead.contact_status}
                            onValueChange={v => handleStatusChange(lead, v)}
                          >
                            <SelectTrigger className={`h-7 text-xs w-auto min-w-[130px] ${sc.color} border rounded-full`}>
                              <SelectValue>{sc.label}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                                <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1">
                            {lead.celular_1 ? (
                              <span className="font-medium text-primary">{lead.celular_1}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openContactDialog(lead)}
                              title="Registrar contato"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => deleteCatLead(lead.id)}
                              title="Remover"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {filtered.length > 100 && (
        <p className="text-xs text-muted-foreground text-center">
          Mostrando 100 de {filtered.length} registros
        </p>
      )}

      {/* Dialogs */}
      <CatImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={importCatLeads}
      />

      {selectedLead && (
        <CatLeadContactDialog
          open={contactDialogOpen}
          onOpenChange={setContactDialogOpen}
          catLead={selectedLead}
          contacts={leadContacts}
          onAddContact={addContact}
          onRefresh={() => { refreshContacts(); fetchCatLeads(); }}
          onUpdateCatLead={updateCatLead}
        />
      )}
    </div>
  );
}
