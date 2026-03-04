import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Gavel, FileText, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AddProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  leadId: string;
  onProcessAdded: () => void;
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

export default function AddProcessDialog({ open, onOpenChange, caseId, leadId, onProcessAdded }: AddProcessDialogProps) {
  const [tab, setTab] = useState<'escavador' | 'manual'>('escavador');
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchType, setSearchType] = useState<'numero' | 'nome' | 'cpf'>('numero');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<EscavadorResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<EscavadorResult | null>(null);
  const [searchError, setSearchError] = useState('');

  // Manual form state
  const [manualForm, setManualForm] = useState({
    title: '',
    process_number: '',
    process_type: 'judicial' as 'judicial' | 'administrativo',
    description: '',
    fee_percentage: '',
  });

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError('');
    setResults([]);
    setSelectedResult(null);

    try {
      const actionMap = {
        numero: 'buscar_por_numero',
        nome: 'buscar_por_nome',
        cpf: 'buscar_por_cpf_cnpj',
      };

      const body: any = { action: actionMap[searchType] };
      if (searchType === 'numero') body.numero_cnj = searchQuery;
      if (searchType === 'nome') body.nome = searchQuery;
      if (searchType === 'cpf') body.cpf_cnpj = searchQuery;

      const { data, error } = await supabase.functions.invoke('search-escavador', { body });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      // Normalize response - Escavador v2 returns differently per endpoint
      const responseData = data.data;
      let processos: EscavadorResult[] = [];

      if (responseData.numero_cnj) {
        // Single process response
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

  const saveFromEscavador = async (result: EscavadorResult) => {
    setSaving(true);
    try {
      // Check if this process_number is already linked to a case
      const { data: existing } = await supabase
        .from('lead_processes')
        .select('id, case_id')
        .eq('process_number', result.numero_cnj)
        .not('case_id', 'is', null)
        .maybeSingle();

      if (existing) {
        toast.error('Este processo já está vinculado a outro caso.');
        setSaving(false);
        return;
      }

      const fonte = result.fontes?.[0];
      const title = fonte?.classe?.nome || 
        `${result.titulo_polo_ativo || 'Autor'} vs ${result.titulo_polo_passivo || 'Réu'}`;
      const description = [
        fonte?.area?.nome && `Área: ${fonte.area.nome}`,
        fonte?.nome && `Fonte: ${fonte.nome}`,
        fonte?.grau && `Grau: ${fonte.grau}`,
        fonte?.assuntos?.length && `Assuntos: ${fonte.assuntos.map(a => a.nome).join(', ')}`,
      ].filter(Boolean).join('\n');

      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('lead_processes')
        .insert({
          lead_id: leadId,
          case_id: caseId,
          process_type: 'judicial',
          process_number: result.numero_cnj,
          title,
          description,
          status: result.fontes_tribunais_estao_arquivadas ? 'arquivado' : 'em_andamento',
          created_by: user?.id,
        } as any);

      if (error) throw error;
      toast.success('Processo judicial vinculado ao caso');
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
          process_type: manualForm.process_type,
          process_number: manualForm.process_number || null,
          title: manualForm.title,
          description: manualForm.description || null,
          fee_percentage: manualForm.fee_percentage ? parseFloat(manualForm.fee_percentage) : null,
          status: 'em_andamento',
          created_by: user?.id,
        } as any);

      if (error) throw error;
      toast.success('Processo adicionado ao caso');
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
    setSelectedResult(null);
    setSearchError('');
    setManualForm({ title: '', process_number: '', process_type: 'judicial', description: '', fee_percentage: '' });
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
                </SelectContent>
              </Select>
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={
                  searchType === 'numero' ? '0000000-00.0000.0.00.0000' :
                  searchType === 'nome' ? 'Nome da parte...' : 'CPF ou CNPJ...'
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
                  return (
                    <div
                      key={r.numero_cnj || i}
                      className={`border rounded-lg p-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                        selectedResult?.numero_cnj === r.numero_cnj ? 'ring-2 ring-primary bg-primary/5' : ''
                      }`}
                      onClick={() => setSelectedResult(r)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
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

            {selectedResult && (
              <Button
                onClick={() => saveFromEscavador(selectedResult)}
                disabled={saving}
                className="w-full"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Vincular Processo ao Caso
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
                <Label>Tipo</Label>
                <Select value={manualForm.process_type} onValueChange={v => setManualForm(p => ({ ...p, process_type: v as any }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="judicial">Judicial</SelectItem>
                    <SelectItem value="administrativo">Administrativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Nº Processo</Label>
                <Input
                  value={manualForm.process_number}
                  onChange={e => setManualForm(p => ({ ...p, process_number: e.target.value }))}
                  placeholder="0000000-00.0000.0.00.0000"
                />
              </div>
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

            <div>
              <Label>Descrição</Label>
              <Textarea
                value={manualForm.description}
                onChange={e => setManualForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Detalhes do processo..."
                rows={3}
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
