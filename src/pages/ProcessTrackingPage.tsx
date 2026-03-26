import { useState, useEffect, useRef, useCallback } from 'react';
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
  X, RefreshCw, Eye, FileUp,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const [detailRecord, setDetailRecord] = useState<ProcessTracking | null>(null);

  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableContentRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState(0);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Sync scroll between top and bottom scrollbars
  const syncing = useRef(false);
  const handleTopScroll = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    if (bottomScrollRef.current && topScrollRef.current) {
      bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
    syncing.current = false;
  }, []);

  const handleBottomScroll = useCallback(() => {
    if (syncing.current) return;
    syncing.current = true;
    if (topScrollRef.current && bottomScrollRef.current) {
      topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
    }
    syncing.current = false;
  }, []);

  // Measure table width for the top scrollbar
  useEffect(() => {
    const el = tableContentRef.current;
    if (!el) return;
    
    const measure = () => setTableWidth(el.scrollWidth);
    measure(); // immediate measure
    
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [records, loading]);

  const filteredRecords = records.filter(r => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.cliente?.toLowerCase().includes(term) ||
      r.caso?.toLowerCase().includes(term) ||
      r.cpf?.includes(term) ||
      r.numero_processo?.toLowerCase().includes(term)
    );
  });

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
      const withoutConflicts = rows.filter(r => !r.has_conflict);

      setImportData(rows);

      if (withConflicts.length > 0) {
        setConflicts(withConflicts);
        setConflictDecisions({});
        setShowConflictDialog(true);
      } else {
        setSelectedRows(new Set(withoutConflicts.map((_, i) => i)));
        setShowImportDialog(true);
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro ao ler planilha');
    } finally {
      setImporting(false);
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
    if (selectedRows.size === importData.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(importData.map((_, i) => i)));
    }
  };

  const statusColor = (status: string | null) => {
    if (!status) return 'secondary';
    const s = status.toLowerCase();
    if (s.includes('deferido') && !s.includes('in')) return 'default';
    if (s.includes('indeferido')) return 'destructive';
    if (s.includes('andamento') || s.includes('analise') || s.includes('análise')) return 'secondary';
    return 'outline';
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Controle Processual</h1>
          <p className="text-sm text-muted-foreground">Acompanhamento de processos previdenciários e auxílio maternidade</p>
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
            Importar da Planilha
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-1">
              <Label>URL da Planilha Google</Label>
              <Input
                value={sheetUrl}
                onChange={e => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
              />
            </div>
            <div className="space-y-1">
              <Label>Nome da Aba (opcional)</Label>
              <Input
                value={sheetName}
                onChange={e => setSheetName(e.target.value)}
                placeholder="Ex: Previdenciário"
              />
            </div>
          </div>
          <Button onClick={handleFetchSheet} disabled={importing} className="gap-2">
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importing ? 'Lendo planilha...' : 'Importar Dados'}
          </Button>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por cliente, caso, CPF ou nº processo..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          {/* Top scrollbar - always visible */}
          <div
            ref={topScrollRef}
            onScroll={handleTopScroll}
            className="overflow-x-auto w-full border-b border-border"
            style={{ minHeight: 20, overflowY: 'hidden' }}
          >
            <div style={{ width: tableWidth || '100%', height: 1 }} />
          </div>
          {/* Table with bottom scrollbar */}
          <div
            ref={bottomScrollRef}
            onScroll={handleBottomScroll}
            className="overflow-x-auto w-full"
          >
            <div ref={tableContentRef}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px] sticky left-0 bg-background z-10">Cliente</TableHead>
                  <TableHead className="min-w-[140px]">Caso</TableHead>
                  <TableHead className="min-w-[120px]">CPF</TableHead>
                  <TableHead className="min-w-[120px]">Senha Gov</TableHead>
                  <TableHead className="min-w-[140px]">Nº Processo</TableHead>
                  <TableHead className="min-w-[130px]">Tipo</TableHead>
                  <TableHead className="min-w-[140px]">Pendência</TableHead>
                  <TableHead className="min-w-[160px]">Data Gerar Guia</TableHead>
                  <TableHead className="min-w-[160px]">Nasc. Bebê</TableHead>
                  <TableHead className="min-w-[110px]">Protocolado</TableHead>
                  <TableHead className="min-w-[140px]">Data Criação Grupo</TableHead>
                  <TableHead className="min-w-[170px]">Data Protocolo/Cancel.</TableHead>
                  <TableHead className="min-w-[100px]">Tempo (dias)</TableHead>
                  <TableHead className="min-w-[130px]">Status Processo</TableHead>
                  <TableHead className="min-w-[140px]">Data Decisão Final</TableHead>
                  <TableHead className="min-w-[160px]">Motivo Indeferimento</TableHead>
                  <TableHead className="min-w-[180px]">Observação</TableHead>
                  <TableHead className="min-w-[130px]">Cliente no Grupo</TableHead>
                  <TableHead className="min-w-[130px]">Ativ. Criada</TableHead>
                  <TableHead className="min-w-[120px]">Acolhedor</TableHead>
                  <TableHead className="min-w-[140px]">Pago Acolhedor</TableHead>
                  <TableHead className="min-w-[130px]">Data Pagamento</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={23} className="text-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filteredRecords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={23} className="text-center py-8 text-muted-foreground">
                      {searchTerm ? 'Nenhum registro encontrado' : 'Importe dados da planilha para começar'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRecords.map(record => (
                    <TableRow key={record.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailRecord(record)}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10">{record.cliente || '—'}</TableCell>
                      <TableCell>{record.caso || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{record.cpf || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{record.senha_gov || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{record.numero_processo || '—'}</TableCell>
                      <TableCell>
                        {record.tipo ? <Badge variant="outline" className="text-xs">{record.tipo}</Badge> : '—'}
                      </TableCell>
                      <TableCell>{record.pendencia || '—'}</TableCell>
                      <TableCell>{record.data_gerar_guia || '—'}</TableCell>
                      <TableCell>{record.data_nascimento_bebe || '—'}</TableCell>
                      <TableCell>{record.protocolado || '—'}</TableCell>
                      <TableCell>{record.data_criacao || '—'}</TableCell>
                      <TableCell>{record.data_protocolo_cancelamento || '—'}</TableCell>
                      <TableCell className="text-center">{record.tempo_dias ?? '—'}</TableCell>
                      <TableCell>
                        {record.status_processo ? (
                          <Badge variant={statusColor(record.status_processo)} className="text-xs">
                            {record.status_processo}
                          </Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell>{record.data_decisao_final || '—'}</TableCell>
                      <TableCell>{record.motivo_indeferimento || '—'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{record.observacao || '—'}</TableCell>
                      <TableCell>{record.cliente_no_grupo || '—'}</TableCell>
                      <TableCell>{record.atividade_criada || '—'}</TableCell>
                      <TableCell>{record.acolhedor || '—'}</TableCell>
                      <TableCell>{record.pago_acolhedor || '—'}</TableCell>
                      <TableCell>{record.data_pagamento || '—'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!detailRecord} onOpenChange={open => !open && setDetailRecord(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Registro</DialogTitle>
          </DialogHeader>
          {detailRecord && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Cliente', detailRecord.cliente],
                ['Caso', detailRecord.caso],
                ['CPF', detailRecord.cpf],
                ['Senha Gov', detailRecord.senha_gov],
                ['Data de Criação', detailRecord.data_criacao],
                ['Tipo', detailRecord.tipo],
                ['Acolhedor', detailRecord.acolhedor],
                ['Nº Processo', detailRecord.numero_processo],
                ['Pendência', detailRecord.pendencia],
                ['Data Gerar Guia', detailRecord.data_gerar_guia],
                ['Nasc. Bebê', detailRecord.data_nascimento_bebe],
                ['Protocolado', detailRecord.protocolado],
                ['Data Protocolo', detailRecord.data_protocolo_cancelamento],
                ['Tempo (dias)', detailRecord.tempo_dias],
                ['Status', detailRecord.status_processo],
                ['Data Decisão Final', detailRecord.data_decisao_final],
                ['Motivo Indeferimento', detailRecord.motivo_indeferimento],
                ['Observação', detailRecord.observacao],
                ['Cliente no Grupo', detailRecord.cliente_no_grupo],
                ['Ativ. Criada', detailRecord.atividade_criada],
                ['Pago Acolhedor', detailRecord.pago_acolhedor],
                ['Data Pagamento', detailRecord.data_pagamento],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <p className="text-muted-foreground text-xs">{label}</p>
                  <p className="font-medium">{value ?? '—'}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

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
                    <Checkbox
                      checked={importData ? selectedRows.size === importData.length : false}
                      onCheckedChange={toggleAllSelected}
                    />
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
                      <Checkbox
                        checked={selectedRows.has(i)}
                        onCheckedChange={checked => {
                          const next = new Set(selectedRows);
                          checked ? next.add(i) : next.delete(i);
                          setSelectedRows(next);
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{row.cliente || '—'}</TableCell>
                    <TableCell>{row.caso || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{row.cpf || '—'}</TableCell>
                    <TableCell>{row.tipo || '—'}</TableCell>
                    <TableCell>
                      {row.existing_id ? (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <RefreshCw className="h-3 w-3" /> Atualizar
                        </Badge>
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
                        <Button
                          size="sm"
                          variant={conflictDecisions[i] === 'overwrite' ? 'default' : 'outline'}
                          onClick={() => setConflictDecisions(prev => ({ ...prev, [i]: 'overwrite' }))}
                          className="gap-1 text-xs"
                        >
                          <RefreshCw className="h-3 w-3" /> Sobrescrever
                        </Button>
                        <Button
                          size="sm"
                          variant={conflictDecisions[i] === 'skip' ? 'destructive' : 'outline'}
                          onClick={() => setConflictDecisions(prev => ({ ...prev, [i]: 'skip' }))}
                          className="gap-1 text-xs"
                        >
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
            <Button
              onClick={handleResolveConflicts}
              disabled={Object.keys(conflictDecisions).length < conflicts.length}
              className="gap-2"
            >
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
