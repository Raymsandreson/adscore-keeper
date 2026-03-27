import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { useProcessTracking, ProcessTracking } from '@/hooks/useProcessTracking';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  FileSpreadsheet, Upload, Loader2, Search, AlertTriangle, Check,
  X, RefreshCw, FileUp, Briefcase, Shield, Plus,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProcessTrackingTable } from '@/components/process-tracking/ProcessTrackingTable';

interface ImportRow {
  cliente: string | null;
  caso: string | null;
  cpf: string | null;
  senha_gov: string | null;
  data_criacao: string | null;
  tipo: string | null;
  acolhedor: string | null;
  numero_processo: string | null;
  pendencia: string | null;
  data_gerar_guia: string | null;
  data_nascimento_bebe: string | null;
  protocolado: string | null;
  data_protocolo_cancelamento: string | null;
  tempo_dias: number | null;
  status_processo: string | null;
  data_decisao_final: string | null;
  motivo_indeferimento: string | null;
  observacao: string | null;
  cliente_no_grupo: string | null;
  atividade_criada: string | null;
  pago_acolhedor: string | null;
  data_pagamento: string | null;
  existing_id: string | null;
  has_conflict: boolean;
  import_source?: string;
}

const ProcessTrackingPage = () => {
  const { records, loading, fetchRecords, upsertRecord, bulkInsert } = useProcessTracking();
  const [searchTerm, setSearchTerm] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importData, setImportData] = useState<ImportRow[] | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflicts, setConflicts] = useState<ImportRow[]>([]);
  const [conflictDecisions, setConflictDecisions] = useState<Record<number, 'overwrite' | 'skip'>>({});
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState('trabalhista');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Split records: CASO = trabalhista, PREV = previdenciário
  const trabalhistaRecords = records.filter(r => {
    const caso = (r.caso || '').toUpperCase();
    return caso.includes('CASO') || (!caso.includes('PREV') && !caso.startsWith('PREV'));
  });

  const previdenciarioRecords = records.filter(r => {
    const caso = (r.caso || '').toUpperCase();
    return caso.includes('PREV') || caso.startsWith('PREV');
  });

  const handleUpdate = async (record: Partial<ProcessTracking> & { id: string }) => {
    try {
      await upsertRecord(record);
      toast.success('Registro atualizado');
    } catch {
      toast.error('Erro ao atualizar registro');
      throw new Error();
    }
  };

  // Import logic (same as before)
  const handleFetchSheet = async () => {
    if (!sheetUrl.trim()) { toast.error('Cole a URL da planilha'); return; }
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('import-sheets-to-tracking', {
        body: { spreadsheet_url: sheetUrl, sheet_name: sheetName || undefined },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      const rows = data.rows as ImportRow[];
      if (!rows.length) { toast.info('Nenhum dado encontrado na planilha'); return; }
      const withConflicts = rows.filter(r => r.has_conflict);
      setImportData(rows);
      if (withConflicts.length > 0) {
        setConflicts(withConflicts);
        setConflictDecisions({});
        setShowConflictDialog(true);
      } else {
        setSelectedRows(new Set(rows.filter(r => !r.has_conflict).map((_, i) => i)));
        setShowImportDialog(true);
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro ao ler planilha');
    } finally {
      setImporting(false);
    }
  };

  const CSV_COLUMN_MAP: Record<string, keyof ImportRow> = {
    'cliente': 'cliente', 'caso': 'caso', 'cpf': 'cpf', 'senha gov': 'senha_gov',
    'senha_gov': 'senha_gov', 'data criação': 'data_criacao', 'data_criacao': 'data_criacao',
    'tipo': 'tipo', 'acolhedor': 'acolhedor', 'nº processo': 'numero_processo',
    'numero_processo': 'numero_processo', 'n processo': 'numero_processo',
    'pendência': 'pendencia', 'pendencia': 'pendencia', 'data gerar guia': 'data_gerar_guia',
    'data_gerar_guia': 'data_gerar_guia', 'nasc. bebê': 'data_nascimento_bebe',
    'data_nascimento_bebe': 'data_nascimento_bebe', 'nasc bebe': 'data_nascimento_bebe',
    'protocolado': 'protocolado', 'data protocolo cancelamento': 'data_protocolo_cancelamento',
    'data_protocolo_cancelamento': 'data_protocolo_cancelamento',
    'tempo (dias)': 'tempo_dias', 'tempo_dias': 'tempo_dias', 'tempo dias': 'tempo_dias',
    'status processo': 'status_processo', 'status_processo': 'status_processo',
    'data decisão final': 'data_decisao_final', 'data_decisao_final': 'data_decisao_final',
    'motivo indeferimento': 'motivo_indeferimento', 'motivo_indeferimento': 'motivo_indeferimento',
    'observação': 'observacao', 'observacao': 'observacao',
    'cliente no grupo': 'cliente_no_grupo', 'cliente_no_grupo': 'cliente_no_grupo',
    'atividade criada': 'atividade_criada', 'atividade_criada': 'atividade_criada',
    'pago acolhedor': 'pago_acolhedor', 'pago_acolhedor': 'pago_acolhedor',
    'data pagamento': 'data_pagamento', 'data_pagamento': 'data_pagamento',
  };

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if ((char === ',' || char === ';') && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast.error('Arquivo CSV vazio ou sem dados'); return; }
      const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
      const columnIndices: Record<string, number> = {};
      headers.forEach((h, i) => {
        const mapped = CSV_COLUMN_MAP[h];
        if (mapped) columnIndices[mapped as string] = i;
      });
      if (!columnIndices['cliente'] && !columnIndices['cpf']) {
        toast.error('CSV não possui colunas reconhecidas (cliente, cpf, etc.)');
        return;
      }
      const rows: ImportRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.every(v => !v)) continue;
        const row: ImportRow = {
          cliente: values[columnIndices['cliente']] || null,
          caso: values[columnIndices['caso']] || null,
          cpf: values[columnIndices['cpf']] || null,
          senha_gov: values[columnIndices['senha_gov']] || null,
          data_criacao: values[columnIndices['data_criacao']] || null,
          tipo: values[columnIndices['tipo']] || null,
          acolhedor: values[columnIndices['acolhedor']] || null,
          numero_processo: values[columnIndices['numero_processo']] || null,
          pendencia: values[columnIndices['pendencia']] || null,
          data_gerar_guia: values[columnIndices['data_gerar_guia']] || null,
          data_nascimento_bebe: values[columnIndices['data_nascimento_bebe']] || null,
          protocolado: values[columnIndices['protocolado']] || null,
          data_protocolo_cancelamento: values[columnIndices['data_protocolo_cancelamento']] || null,
          tempo_dias: columnIndices['tempo_dias'] !== undefined ? (parseInt(values[columnIndices['tempo_dias']]) || null) : null,
          status_processo: values[columnIndices['status_processo']] || null,
          data_decisao_final: values[columnIndices['data_decisao_final']] || null,
          motivo_indeferimento: values[columnIndices['motivo_indeferimento']] || null,
          observacao: values[columnIndices['observacao']] || null,
          cliente_no_grupo: values[columnIndices['cliente_no_grupo']] || null,
          atividade_criada: values[columnIndices['atividade_criada']] || null,
          pago_acolhedor: values[columnIndices['pago_acolhedor']] || null,
          data_pagamento: values[columnIndices['data_pagamento']] || null,
          existing_id: null,
          has_conflict: false,
          import_source: 'csv',
        };
        if (row.cpf) {
          const existing = records.find(r => r.cpf === row.cpf);
          if (existing) { row.existing_id = existing.id; row.has_conflict = true; }
        }
        rows.push(row);
      }
      if (!rows.length) { toast.info('Nenhum dado válido encontrado no CSV'); return; }
      const withConflicts = rows.filter(r => r.has_conflict);
      setImportData(rows);
      if (withConflicts.length > 0) {
        setConflicts(withConflicts);
        setConflictDecisions({});
        setShowConflictDialog(true);
      } else {
        setSelectedRows(new Set(rows.filter(r => !r.has_conflict).map((_, i) => i)));
        setShowImportDialog(true);
      }
      toast.success(`${rows.length} registros lidos do CSV`);
    } catch (err: any) {
      toast.error('Erro ao ler CSV: ' + (err.message || ''));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleResolveConflicts = () => {
    setShowConflictDialog(false);
    if (importData) {
      const noConflict = importData.filter(r => !r.has_conflict);
      const overwrite = conflicts.filter((_, i) => conflictDecisions[i] === 'overwrite');
      const allToImport = [...noConflict, ...overwrite];
      setImportData(allToImport);
      setSelectedRows(new Set(allToImport.map((_, i) => i)));
      setShowImportDialog(true);
    }
  };

  const handleConfirmImport = async () => {
    if (!importData) return;
    const rowsToImport = importData.filter((_, i) => selectedRows.has(i));
    if (!rowsToImport.length) { toast.error('Selecione ao menos um registro'); return; }
    setImporting(true);
    try {
      const updates = rowsToImport.filter(r => r.existing_id);
      const inserts = rowsToImport.filter(r => !r.existing_id);
      for (const row of updates) {
        const { existing_id, has_conflict, ...data } = row;
        await upsertRecord({ id: existing_id!, ...data });
      }
      if (inserts.length > 0) {
        const cleanInserts = inserts.map(({ existing_id, has_conflict, ...data }) => data);
        await bulkInsert(cleanInserts);
      }
      toast.success(`${rowsToImport.length} registros importados com sucesso!`);
      setShowImportDialog(false);
      setImportData(null);
      fetchRecords();
    } catch (e: any) {
      toast.error('Erro ao importar: ' + (e.message || ''));
    } finally {
      setImporting(false);
    }
  };

  const toggleAllSelected = () => {
    if (!importData) return;
    if (selectedRows.size === importData.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(importData.map((_, i) => i)));
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Controle Processual</h1>
          <p className="text-sm text-muted-foreground">Acompanhamento de processos trabalhistas e previdenciários</p>
        </div>
        <Badge variant="outline" className="gap-1">
          <FileSpreadsheet className="h-3 w-3" />
          {records.length} registros
        </Badge>
      </div>

      {/* Import Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-primary" />
            Importar Dados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="csv" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="csv" className="gap-2">
                <FileUp className="h-4 w-4" />
                Arquivo CSV
              </TabsTrigger>
              <TabsTrigger value="sheets" className="gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Google Sheets
              </TabsTrigger>
            </TabsList>
            <TabsContent value="csv" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Selecione um arquivo CSV com as colunas correspondentes (Cliente, Caso, CPF, etc.)
              </p>
              <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVImport} className="hidden" />
              <Button onClick={() => fileInputRef.current?.click()} disabled={importing} className="gap-2">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                {importing ? 'Lendo CSV...' : 'Selecionar CSV'}
              </Button>
            </TabsContent>
            <TabsContent value="sheets" className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2 space-y-1">
                  <Label>URL da Planilha Google</Label>
                  <Input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
                </div>
                <div className="space-y-1">
                  <Label>Nome da Aba (opcional)</Label>
                  <Input value={sheetName} onChange={e => setSheetName(e.target.value)} placeholder="Ex: Previdenciário" />
                </div>
              </div>
              <Button onClick={handleFetchSheet} disabled={importing} className="gap-2">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {importing ? 'Lendo planilha...' : 'Importar Dados'}
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por cliente, caso, CPF ou nº processo..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
      </div>

      {/* Tabs: Trabalhista / Previdenciário */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="trabalhista" className="gap-2">
            <Briefcase className="h-4 w-4" />
            Trabalhista
            <Badge variant="secondary" className="ml-1 text-xs">{trabalhistaRecords.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="previdenciario" className="gap-2">
            <Shield className="h-4 w-4" />
            Previdenciário
            <Badge variant="secondary" className="ml-1 text-xs">{previdenciarioRecords.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trabalhista">
          <Card>
            <CardContent className="p-0">
              <ProcessTrackingTable
                records={trabalhistaRecords}
                loading={loading}
                searchTerm={searchTerm}
                onUpdate={handleUpdate}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="previdenciario">
          <Card>
            <CardContent className="p-0">
              <ProcessTrackingTable
                records={previdenciarioRecords}
                loading={loading}
                searchTerm={searchTerm}
                onUpdate={handleUpdate}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Import Preview Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Pré-visualização da Importação
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={importData ? selectedRows.size === importData.length : false} onCheckedChange={toggleAllSelected} />
                  </TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Caso</TableHead>
                  <TableHead>CPF</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(importData || []).map((row, i) => (
                  <TableRow key={i} className={row.existing_id ? 'bg-yellow-500/10' : ''}>
                    <TableCell>
                      <Checkbox checked={selectedRows.has(i)} onCheckedChange={checked => {
                        const next = new Set(selectedRows);
                        checked ? next.add(i) : next.delete(i);
                        setSelectedRows(next);
                      }} />
                    </TableCell>
                    <TableCell className="font-medium">{row.cliente || '—'}</TableCell>
                    <TableCell>{row.caso || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{row.cpf || '—'}</TableCell>
                    <TableCell>{row.tipo || '—'}</TableCell>
                    <TableCell>
                      {row.existing_id ? (
                        <Badge variant="secondary" className="gap-1 text-xs"><RefreshCw className="h-3 w-3" /> Atualizar</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Novo</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancelar</Button>
            <Button onClick={handleConfirmImport} disabled={importing} className="gap-2">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Importar {selectedRows.size} registros
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conflict Resolution Dialog */}
      <Dialog open={showConflictDialog} onOpenChange={setShowConflictDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Conflitos Encontrados ({conflicts.length})
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Os registros abaixo já existem no sistema. Escolha o que fazer com cada um:
          </p>
          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-3">
              {conflicts.map((row, i) => (
                <Card key={i} className="border-amber-200">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{row.cliente}</p>
                        <p className="text-xs text-muted-foreground">CPF: {row.cpf || '—'} • Caso: {row.caso || '—'}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant={conflictDecisions[i] === 'overwrite' ? 'default' : 'outline'}
                          onClick={() => setConflictDecisions(prev => ({ ...prev, [i]: 'overwrite' }))} className="gap-1 text-xs">
                          <RefreshCw className="h-3 w-3" /> Sobrescrever
                        </Button>
                        <Button size="sm" variant={conflictDecisions[i] === 'skip' ? 'destructive' : 'outline'}
                          onClick={() => setConflictDecisions(prev => ({ ...prev, [i]: 'skip' }))} className="gap-1 text-xs">
                          <X className="h-3 w-3" /> Pular
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConflictDialog(false)}>Cancelar</Button>
            <Button onClick={handleResolveConflicts} disabled={Object.keys(conflictDecisions).length < conflicts.length} className="gap-2">
              <Check className="h-4 w-4" />
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProcessTrackingPage;
