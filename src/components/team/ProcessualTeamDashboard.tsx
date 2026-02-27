import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Search,
  Briefcase,
  FileText,
  Plus,
  Calendar,
  User,
  Hash,
  Clock,
  CheckCircle2,
  Archive,
  AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useLeadProcesses, type LeadProcess } from '@/hooks/useLeadProcesses';
import { useTeamMembers } from '@/hooks/useTeamMembers';

interface ClosedLead {
  id: string;
  lead_name: string | null;
  victim_name: string | null;
  case_number: string | null;
  became_client_date: string | null;
  case_type: string | null;
  board_id: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export function ProcessualTeamDashboard() {
  const [closedLeads, setClosedLeads] = useState<ClosedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedLead, setSelectedLead] = useState<ClosedLead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addingProcess, setAddingProcess] = useState(false);
  const { members } = useTeamMembers();

  // New process form
  const [newProcessTitle, setNewProcessTitle] = useState('');
  const [newProcessType, setNewProcessType] = useState<'judicial' | 'administrativo'>('judicial');
  const [newProcessNumber, setNewProcessNumber] = useState('');
  const [newProcessDescription, setNewProcessDescription] = useState('');

  const { processes, loading: processesLoading, fetchProcesses, addProcess, updateProcess, deleteProcess } = useLeadProcesses();

  const fetchClosedLeads = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('id, lead_name, victim_name, case_number, became_client_date, case_type, board_id, created_by, updated_by')
        .not('became_client_date', 'is', null)
        .order('became_client_date', { ascending: false });
      if (error) throw error;
      setClosedLeads((data || []) as ClosedLead[]);
    } catch (err) {
      console.error('Error fetching closed leads:', err);
      toast.error('Erro ao carregar casos fechados');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClosedLeads();
  }, [fetchClosedLeads]);

  const filteredLeads = useMemo(() => {
    if (!search.trim()) return closedLeads;
    const q = search.toLowerCase();
    return closedLeads.filter(l =>
      (l.lead_name || '').toLowerCase().includes(q) ||
      (l.victim_name || '').toLowerCase().includes(q) ||
      (l.case_number || '').toLowerCase().includes(q)
    );
  }, [closedLeads, search]);

  const handleSelectLead = (lead: ClosedLead) => {
    setSelectedLead(lead);
    setSheetOpen(true);
    fetchProcesses(lead.id);
  };

  const handleAddProcess = async () => {
    if (!selectedLead || !newProcessTitle.trim()) return;
    try {
      await addProcess({
        lead_id: selectedLead.id,
        title: newProcessTitle,
        process_type: newProcessType,
        process_number: newProcessNumber || null,
        description: newProcessDescription || null,
        status: 'em_andamento',
      });
      setNewProcessTitle('');
      setNewProcessNumber('');
      setNewProcessDescription('');
      setAddingProcess(false);
      fetchProcesses(selectedLead.id);
    } catch {}
  };

  const handleToggleStatus = async (process: LeadProcess) => {
    const nextStatus = process.status === 'em_andamento' ? 'concluido' : process.status === 'concluido' ? 'arquivado' : 'em_andamento';
    await updateProcess(process.id, { status: nextStatus, finished_at: nextStatus !== 'em_andamento' ? new Date().toISOString() : null });
    fetchProcesses(selectedLead!.id);
  };

  const statusIcon = (status: string) => {
    if (status === 'concluido') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (status === 'arquivado') return <Archive className="h-4 w-4 text-muted-foreground" />;
    return <Clock className="h-4 w-4 text-amber-500" />;
  };

  const statusLabel = (status: string) => {
    if (status === 'concluido') return 'Concluído';
    if (status === 'arquivado') return 'Arquivado';
    return 'Em Andamento';
  };

  // Stats
  const totalCases = closedLeads.length;
  const totalWithProcesses = 0; // We'd need a join for this, keep simple for now

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Briefcase className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalCases}</p>
                <p className="text-sm text-muted-foreground">Casos Fechados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <FileText className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{filteredLeads.length}</p>
                <p className="text-sm text-muted-foreground">Exibidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <User className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{members.length}</p>
                <p className="text-sm text-muted-foreground">Membros</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, vítima ou nº do caso..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Cases List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : filteredLeads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">
              {search ? 'Nenhum caso encontrado para esta busca' : 'Nenhum caso fechado encontrado'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filteredLeads.map(lead => (
            <Card
              key={lead.id}
              className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => handleSelectLead(lead)}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                      <Briefcase className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {lead.lead_name || lead.victim_name || 'Sem nome'}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        {lead.case_number && (
                          <span className="flex items-center gap-1">
                            <Hash className="h-3 w-3" />
                            {lead.case_number}
                          </span>
                        )}
                        {lead.case_type && (
                          <Badge variant="outline" className="text-[10px] h-4">
                            {lead.case_type}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  {lead.became_client_date && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(lead.became_client_date), 'dd/MM/yyyy', { locale: ptBR })}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              {selectedLead?.lead_name || selectedLead?.victim_name || 'Caso'}
            </SheetTitle>
            {selectedLead?.case_number && (
              <p className="text-sm text-muted-foreground">Caso #{selectedLead.case_number}</p>
            )}
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Processos</h3>
              <Button size="sm" variant="outline" onClick={() => setAddingProcess(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Novo Processo
              </Button>
            </div>

            {/* Add process form */}
            {addingProcess && (
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <Input
                    placeholder="Título do processo"
                    value={newProcessTitle}
                    onChange={e => setNewProcessTitle(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={newProcessType} onValueChange={v => setNewProcessType(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="judicial">Judicial</SelectItem>
                        <SelectItem value="administrativo">Administrativo</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Nº do processo"
                      value={newProcessNumber}
                      onChange={e => setNewProcessNumber(e.target.value)}
                    />
                  </div>
                  <Textarea
                    placeholder="Descrição (opcional)"
                    value={newProcessDescription}
                    onChange={e => setNewProcessDescription(e.target.value)}
                    rows={2}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setAddingProcess(false)}>Cancelar</Button>
                    <Button size="sm" onClick={handleAddProcess} disabled={!newProcessTitle.trim()}>Salvar</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Processes list */}
            <ScrollArea className="max-h-[60vh]">
              {processesLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : processes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhum processo cadastrado para este caso
                </p>
              ) : (
                <div className="space-y-2">
                  {processes.map(proc => (
                    <Card key={proc.id} className="group">
                      <CardContent className="py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {statusIcon(proc.status)}
                              <span className="font-medium text-sm truncate">{proc.title}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <Badge variant="outline" className="text-[10px] h-4">
                                {proc.process_type === 'judicial' ? 'Judicial' : 'Administrativo'}
                              </Badge>
                              {proc.process_number && (
                                <span className="flex items-center gap-0.5">
                                  <Hash className="h-3 w-3" />
                                  {proc.process_number}
                                </span>
                              )}
                              <span>{statusLabel(proc.status)}</span>
                            </div>
                            {proc.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{proc.description}</p>
                            )}
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleToggleStatus(proc)}>
                              {proc.status === 'em_andamento' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive"
                              onClick={() => { deleteProcess(proc.id); fetchProcesses(selectedLead!.id); }}
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
