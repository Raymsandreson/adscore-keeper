import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Gavel, FileText, Loader2, AlertCircle, CheckCircle2, ClipboardList, Plus } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { autoCreatePartiesFromEnvolvidos } from '@/utils/escavadorPartyUtils';

interface AddProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  leadId: string;
  onProcessAdded: () => void;
  boards?: KanbanBoard[];
}

interface EscavadorResult {
  numero_cnj: string;
  titulo_polo_ativo?: string;
  titulo_polo_passivo?: string;
  ano_inicio?: number;
  fontes?: Array<{
    nome: string;
    tipo: string;
    grau?: string;
    data_inicio?: string;
    data_fim?: string;
    assuntos?: Array<{ nome: string }>;
    classe?: { nome: string };
    area?: { nome: string };
    tribunal?: string;
    envolvidos?: Array<{ nome: string; tipo_participacao: string }>;
  }>;
  fontes_tribunais_estao_arquivadas?: boolean;
}

export default function AddProcessDialog({ open, onOpenChange, caseId, leadId, onProcessAdded, boards = [] }: AddProcessDialogProps) {
  const [tab, setTab] = useState<'escavador' | 'manual'>('escavador');
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchType, setSearchType] = useState<'numero' | 'nome' | 'cpf' | 'oab'>('numero');
  const [searchQuery, setSearchQuery] = useState('');
  const [oabEstado, setOabEstado] = useState('SP');
  const [results, setResults] = useState<EscavadorResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<number>>(new Set());
  const [searchError, setSearchError] = useState('');

  // Common fields - always asked
  const [processType, setProcessType] = useState<'judicial' | 'administrativo'>('judicial');
  const [workflowId, setWorkflowId] = useState('');

  // Manual form state
  const [manualForm, setManualForm] = useState({
    title: '',
    process_number: '',
    description: '',
    fee_percentage: '',
    valor_causa: '',
    estimated_fee_value: '',
    started_at: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  // Auto-calculate estimated fee when valor_causa or fee_percentage changes
  const autoCalculatedFee = manualForm.valor_causa && manualForm.fee_percentage
    ? (parseFloat(manualForm.valor_causa) * parseFloat(manualForm.fee_percentage) / 100).toFixed(2)
    : '';

  // Load boards if not provided
  const [loadedBoards, setLoadedBoards] = useState<KanbanBoard[]>([]);
  const activeBoards = (boards.length > 0 ? boards : loadedBoards).filter(b => b.board_type === 'workflow');

  useEffect(() => {
    if (open && boards.length === 0) {
      supabase.from('kanban_boards').select('*').order('display_order').then(({ data }) => {
        if (data) {
          setLoadedBoards(data.map(b => ({
            ...b,
            board_type: (b as any).board_type || 'funnel',
            stages: Array.isArray(b.stages) ? b.stages as any : [],
          } as KanbanBoard)));
        }
      });
    }
  }, [open, boards.length]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError('');
    setResults([]);
    setSelectedResults(new Set());

    try {
      const actionMap = {
        numero: 'buscar_por_numero',
        nome: 'buscar_por_nome',
        cpf: 'buscar_por_cpf_cnpj',
        oab: 'buscar_por_oab',
      };

      const body: any = { action: actionMap[searchType] };
      if (searchType === 'numero') body.numero_cnj = searchQuery;
      if (searchType === 'nome') body.nome = searchQuery;
      if (searchType === 'cpf') body.cpf_cnpj = searchQuery;
      if (searchType === 'oab') {
        body.oab_numero = searchQuery;
        body.oab_estado = oabEstado;
      }

      const { data, error } = await supabase.functions.invoke('search-escavador', { body });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      const responseData = data.data;
      let processos: EscavadorResult[] = [];

      if (responseData.numero_cnj) {
        processos = [responseData];
      } else if (responseData.items) {
        processos = responseData.items;
      } else if (Array.isArray(responseData)) {
        processos = responseData;
      } else if (responseData.processos) {
        processos = responseData.processos;
      }

      setResults(processos);
      if (processos.length === 0) {
        setSearchError('Nenhum processo encontrado.');
      }
    } catch (err: any) {
      console.error('Search error:', err);
      setSearchError(err.message || 'Erro ao buscar no Escavador');
    } finally {
      setSearching(false);
    }
  };

  const toggleResult = (index: number) => {
    setSelectedResults(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectedBoard = activeBoards.find(b => b.id === workflowId);

  // Imported from shared utility

  const saveSelectedFromEscavador = async () => {
    if (selectedResults.size === 0) return;
    setSaving(true);
    let successCount = 0;
    let skipCount = 0;
    try {
      const { data: { user } } = await supabase.auth.getUser();

      for (const idx of selectedResults) {
        const result = results[idx];
        if (!result) continue;

        // Check duplicate
        const { data: existing } = await supabase
          .from('lead_processes')
          .select('id, case_id')
          .eq('process_number', result.numero_cnj)
          .not('case_id', 'is', null)
          .maybeSingle();

        if (existing) {
          skipCount++;
          continue;
        }

        // Fetch complete data with movimentações
        let fullResult = result;
        let movimentacoes: any[] = [];
        if (result.numero_cnj) {
          try {
            const { data: completeData } = await supabase.functions.invoke('search-escavador', {
              body: { action: 'buscar_completo', numero_cnj: result.numero_cnj },
            });
            if (completeData?.success && completeData.data) {
              fullResult = { ...result, ...completeData.data };
              movimentacoes = completeData.data.movimentacoes_detalhadas || [];
            }
          } catch (e) {
            console.warn('Could not fetch complete data, using initial result:', e);
          }
        }

        const fonte = fullResult.fontes?.[0] || result.fontes?.[0];
        const title = fonte?.classe?.nome || 
          `${fullResult.titulo_polo_ativo || result.titulo_polo_ativo || 'Autor'} vs ${fullResult.titulo_polo_passivo || result.titulo_polo_passivo || 'Réu'}`;
        const description = [
          fonte?.area?.nome && `Área: ${fonte.area.nome}`,
          fonte?.nome && `Fonte: ${fonte.nome}`,
          fonte?.grau && `Grau: ${fonte.grau}`,
          fonte?.assuntos?.length && `Assuntos: ${fonte.assuntos.map(a => a.nome).join(', ')}`,
        ].filter(Boolean).join('\n');

        const { data: insertedProcess, error } = await supabase
          .from('lead_processes')
          .insert({
            lead_id: leadId,
            case_id: caseId,
            process_type: processType,
            process_number: result.numero_cnj,
            title,
            description,
            status: fullResult.fontes_tribunais_estao_arquivadas || result.fontes_tribunais_estao_arquivadas ? 'arquivado' : 'em_andamento',
            polo_ativo: fullResult.titulo_polo_ativo || result.titulo_polo_ativo || null,
            polo_passivo: fullResult.titulo_polo_passivo || result.titulo_polo_passivo || null,
            ano_inicio: fullResult.ano_inicio || result.ano_inicio || null,
            tribunal: fonte?.tribunal || fonte?.nome || null,
            grau: fonte?.grau || null,
            classe: fonte?.classe?.nome || null,
            area: fonte?.area?.nome || null,
            assuntos: fonte?.assuntos?.map((a: any) => a.nome) || null,
            valor_causa: (fullResult as any).valor_causa || (result as any).valor_causa || null,
            envolvidos: fonte?.envolvidos || null,
            movimentacoes: movimentacoes.length > 0 ? movimentacoes : ((fonte as any)?.movimentacoes || null),
            fonte_nome: fonte?.nome || null,
            fonte_tipo: fonte?.tipo || null,
            fonte_data_inicio: fonte?.data_inicio || null,
            fonte_data_fim: fonte?.data_fim || null,
            escavador_raw: fullResult,
            workflow_id: workflowId || null,
            workflow_name: selectedBoard?.name || null,
            created_by: user?.id,
          } as any)
          .select('id')
          .single();

        if (error) {
          console.error('Error saving process:', error);
          skipCount++;
        } else {
          successCount++;
          
          // Auto-create contacts and process_parties from envolvidos
          if (insertedProcess?.id && fonte?.envolvidos?.length) {
            await autoCreatePartiesFromEnvolvidos(insertedProcess.id, fonte.envolvidos, user?.id);
          }
          
          // Auto-create "Dar andamento" activity
          try {
            await supabase.from('lead_activities').insert({
              lead_id: leadId,
              lead_name: title,
              title: 'Dar andamento',
              description: `Atividade criada automaticamente para o processo: ${title} (Nº ${result.numero_cnj})`,
              activity_type: 'tarefa',
              status: 'pendente',
              priority: 'normal',
              assigned_to: user?.id,
              created_by: user?.id,
              deadline: new Date().toISOString().slice(0, 10),
            } as any);
          } catch (actErr) {
            console.error('Error auto-creating activity:', actErr);
          }
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} processo(s) vinculado(s) ao caso`);
        onProcessAdded();
      }
      if (skipCount > 0) {
        toast.warning(`${skipCount} processo(s) já vinculado(s) ou com erro`);
      }
      if (successCount > 0) {
        onOpenChange(false);
        resetForm();
      }
    } catch (err: any) {
      console.error('Save error:', err);
      toast.error(err.message || 'Erro ao salvar processos');
    } finally {
      setSaving(false);
    }
  };

  const saveManual = async () => {
    if (!manualForm.title.trim()) {
      toast.error('Informe o título do processo');
      return;
    }
    setSaving(true);
    try {
      if (manualForm.process_number) {
        const { data: existing } = await supabase
          .from('lead_processes')
          .select('id, case_id')
          .eq('process_number', manualForm.process_number)
          .not('case_id', 'is', null)
          .maybeSingle();

        if (existing) {
          toast.error('Este número de processo já está vinculado a outro caso.');
          setSaving(false);
          return;
        }
      }

      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('lead_processes')
        .insert({
          lead_id: leadId,
          case_id: caseId,
          process_type: processType,
          process_number: manualForm.process_number || null,
          title: manualForm.title,
          description: manualForm.description || null,
          fee_percentage: manualForm.fee_percentage ? parseFloat(manualForm.fee_percentage) : null,
          valor_causa: manualForm.valor_causa ? parseFloat(manualForm.valor_causa) : null,
          estimated_fee_value: manualForm.estimated_fee_value 
            ? parseFloat(manualForm.estimated_fee_value) 
            : (autoCalculatedFee ? parseFloat(autoCalculatedFee) : null),
          workflow_id: workflowId || null,
          workflow_name: selectedBoard?.name || null,
          started_at: manualForm.started_at || null,
          notes: manualForm.notes || null,
          status: 'em_andamento',
          created_by: user?.id,
        } as any);

      if (error) throw error;
      
      // Auto-create "Dar andamento" activity
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          lead_name: manualForm.title.trim(),
          title: 'Dar andamento',
          description: `Atividade criada automaticamente para o processo: ${manualForm.title.trim()}${manualForm.process_number ? ` (Nº ${manualForm.process_number})` : ''}`,
          activity_type: 'tarefa',
          status: 'pendente',
          priority: 'normal',
          assigned_to: currentUser?.id,
          created_by: currentUser?.id,
          deadline: new Date().toISOString().slice(0, 10),
        } as any);
        toast.success('Processo adicionado e atividade "Dar andamento" criada');
      } catch (actErr) {
        console.error('Error auto-creating activity:', actErr);
        toast.success('Processo adicionado ao caso');
      }
      
      onProcessAdded();
      onOpenChange(false);
      resetForm();
    } catch (err: any) {
      console.error('Save error:', err);
      toast.error(err.message || 'Erro ao salvar processo');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setSearchQuery('');
    setResults([]);
    setSelectedResults(new Set());
    setSearchError('');
    setOabEstado('SP');
    setProcessType('judicial');
    setWorkflowId('');
    setManualForm({ title: '', process_number: '', description: '', fee_percentage: '', valor_causa: '', estimated_fee_value: '', started_at: new Date().toISOString().slice(0, 10), notes: '' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-primary" />
            Cadastrar Processo
          </DialogTitle>
        </DialogHeader>

        {/* Common fields: Type + Workflow - Always visible */}
        <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Tipo do Processo *</Label>
              <Select value={processType} onValueChange={v => setProcessType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="judicial">
                    <span className="flex items-center gap-2"><Gavel className="h-3 w-3" /> Judicial</span>
                  </SelectItem>
                  <SelectItem value="administrativo">
                    <span className="flex items-center gap-2"><FileText className="h-3 w-3" /> Administrativo</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Fluxo de Trabalho *</Label>
              <Select value={workflowId} onValueChange={setWorkflowId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um fluxo..." />
                </SelectTrigger>
                <SelectContent>
                  {activeBoards.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="flex items-center gap-2">
                        <ClipboardList className="h-3 w-3" />
                        {b.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={v => setTab(v as any)}>
          <TabsList className="w-full">
            <TabsTrigger value="escavador" className="flex-1 gap-1.5">
              <Search className="h-3.5 w-3.5" /> Buscar no Escavador
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex-1 gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Cadastro Manual
            </TabsTrigger>
          </TabsList>

          <TabsContent value="escavador" className="space-y-3 mt-3">
            <div className="flex gap-2">
              <Select value={searchType} onValueChange={v => setSearchType(v as any)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="numero">Nº CNJ</SelectItem>
                  <SelectItem value="nome">Nome</SelectItem>
                  <SelectItem value="cpf">CPF/CNPJ</SelectItem>
                  <SelectItem value="oab">OAB</SelectItem>
                </SelectContent>
              </Select>
              {searchType === 'oab' && (
                <Select value={oabEstado} onValueChange={setOabEstado}>
                  <SelectTrigger className="w-[80px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'].map(uf => (
                      <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={
                  searchType === 'numero' ? '0000000-00.0000.0.00.0000' :
                  searchType === 'nome' ? 'Nome da parte...' :
                  searchType === 'oab' ? 'Nº da OAB...' : 'CPF ou CNPJ...'
                }
                className="flex-1"
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={searching} size="sm">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {searchError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {searchError}
              </div>
            )}

            {results.length > 0 && (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {results.map((r, i) => {
                  const fonte = r.fontes?.[0];
                  const isSelected = selectedResults.has(i);
                  return (
                    <div
                      key={r.numero_cnj || i}
                      className={`border rounded-lg p-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                        isSelected ? 'ring-2 ring-primary bg-primary/5' : ''
                      }`}
                      onClick={() => toggleResult(i)}
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox checked={isSelected} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{r.numero_cnj}</p>
                          {fonte?.classe && (
                            <p className="text-xs text-muted-foreground">{fonte.classe.nome}</p>
                          )}
                          {r.titulo_polo_ativo && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {r.titulo_polo_ativo} vs {r.titulo_polo_passivo || '—'}
                            </p>
                          )}
                          {fonte?.nome && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">{fonte.nome}</p>
                          )}
                        </div>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {r.fontes_tribunais_estao_arquivadas ? 'Arquivado' : 'Ativo'}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedResults.size > 0 && (
              <Button
                onClick={saveSelectedFromEscavador}
                disabled={saving}
                className="w-full"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Vincular {selectedResults.size} processo(s) ao Caso
              </Button>
            )}
          </TabsContent>

          <TabsContent value="manual" className="space-y-3 mt-3">
            <div>
              <Label>Título *</Label>
              <Input
                value={manualForm.title}
                onChange={e => setManualForm(p => ({ ...p, title: e.target.value }))}
                placeholder="Ex: Ação Indenizatória por Acidente de Trabalho"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nº Processo</Label>
                <Input
                  value={manualForm.process_number}
                  onChange={e => setManualForm(p => ({ ...p, process_number: e.target.value }))}
                  placeholder="0000000-00.0000.0.00.0000"
                />
              </div>
              <div>
                <Label>Honorários (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={manualForm.fee_percentage}
                  onChange={e => setManualForm(p => ({ ...p, fee_percentage: e.target.value }))}
                  placeholder="Ex: 30"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor da Causa (R$)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualForm.valor_causa}
                  onChange={e => setManualForm(p => ({ ...p, valor_causa: e.target.value }))}
                  placeholder="Ex: 150000.00"
                />
              </div>
              <div>
                <Label>Honorários Estimados (R$)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualForm.estimated_fee_value || autoCalculatedFee}
                  onChange={e => setManualForm(p => ({ ...p, estimated_fee_value: e.target.value }))}
                  placeholder={autoCalculatedFee ? `Auto: R$ ${parseFloat(autoCalculatedFee).toLocaleString('pt-BR')}` : 'Ex: 45000.00'}
                />
                {autoCalculatedFee && !manualForm.estimated_fee_value && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Calculado: {manualForm.fee_percentage}% de R$ {parseFloat(manualForm.valor_causa).toLocaleString('pt-BR')}
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label>Data de Início</Label>
              <Input
                type="date"
                value={manualForm.started_at}
                onChange={e => setManualForm(p => ({ ...p, started_at: e.target.value }))}
              />
            </div>

            <div>
              <Label>Descrição</Label>
              <Textarea
                value={manualForm.description}
                onChange={e => setManualForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Detalhes do processo..."
                rows={3}
              />
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea
                value={manualForm.notes}
                onChange={e => setManualForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Notas adicionais..."
                rows={2}
              />
            </div>

            <Button onClick={saveManual} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Gavel className="h-4 w-4 mr-2" />}
              Cadastrar Processo
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
