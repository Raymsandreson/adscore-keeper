import { useState, useRef, useCallback, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Check, X, Pencil } from 'lucide-react';
import type { ProcessTracking } from '@/hooks/useProcessTracking';

interface ProcessTrackingTableProps {
  records: ProcessTracking[];
  loading: boolean;
  searchTerm: string;
  onUpdate: (record: Partial<ProcessTracking> & { id: string }) => Promise<any>;
}

const COLUMNS: { key: keyof ProcessTracking; label: string; minW: string; mono?: boolean }[] = [
  { key: 'cliente', label: 'Cliente', minW: '180px' },
  { key: 'caso', label: 'Caso', minW: '140px' },
  { key: 'cpf', label: 'CPF', minW: '120px', mono: true },
  { key: 'senha_gov', label: 'Senha Gov', minW: '120px', mono: true },
  { key: 'numero_processo', label: 'Nº Processo', minW: '140px', mono: true },
  { key: 'tipo', label: 'Tipo', minW: '130px' },
  { key: 'pendencia', label: 'Pendência', minW: '140px' },
  { key: 'data_gerar_guia', label: 'Data Gerar Guia', minW: '160px' },
  { key: 'data_nascimento_bebe', label: 'Nasc. Bebê', minW: '160px' },
  { key: 'protocolado', label: 'Protocolado', minW: '110px' },
  { key: 'data_criacao', label: 'Data Criação Grupo', minW: '140px' },
  { key: 'data_protocolo_cancelamento', label: 'Data Protocolo/Cancel.', minW: '170px' },
  { key: 'tempo_dias', label: 'Tempo (dias)', minW: '100px' },
  { key: 'status_processo', label: 'Status Processo', minW: '130px' },
  { key: 'data_decisao_final', label: 'Data Decisão Final', minW: '140px' },
  { key: 'motivo_indeferimento', label: 'Motivo Indeferimento', minW: '160px' },
  { key: 'observacao', label: 'Observação', minW: '180px' },
  { key: 'cliente_no_grupo', label: 'Cliente no Grupo', minW: '130px' },
  { key: 'atividade_criada', label: 'Ativ. Criada', minW: '130px' },
  { key: 'acolhedor', label: 'Acolhedor', minW: '120px' },
  { key: 'pago_acolhedor', label: 'Pago Acolhedor', minW: '140px' },
  { key: 'data_pagamento', label: 'Data Pagamento', minW: '130px' },
];

const statusColor = (status: string | null) => {
  if (!status) return 'secondary' as const;
  const s = status.toLowerCase();
  if (s.includes('deferido') && !s.includes('in')) return 'default' as const;
  if (s.includes('indeferido')) return 'destructive' as const;
  if (s.includes('andamento') || s.includes('analise') || s.includes('análise')) return 'secondary' as const;
  return 'outline' as const;
};

export function ProcessTrackingTable({ records, loading, searchTerm, onUpdate }: ProcessTrackingTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableContentRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState(0);

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

  useEffect(() => {
    const el = tableContentRef.current;
    if (!el) return;
    const measure = () => setTableWidth(el.scrollWidth);
    measure();
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

  const startEdit = (record: ProcessTracking) => {
    setEditingId(record.id);
    setEditData({ ...record });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await onUpdate({ id: editingId, ...editData });
      setEditingId(null);
      setEditData({});
    } catch {
      // handled upstream
    } finally {
      setSaving(false);
    }
  };

  const renderCell = (record: ProcessTracking, col: typeof COLUMNS[number]) => {
    const isEditing = editingId === record.id;
    const value = isEditing ? editData[col.key] : (record as any)[col.key];

    if (isEditing) {
      return (
        <Input
          value={value ?? ''}
          onChange={e => setEditData(prev => ({ ...prev, [col.key]: e.target.value || null }))}
          className="h-7 text-xs min-w-[80px]"
        />
      );
    }

    if (col.key === 'tipo' && value) {
      return <Badge variant="outline" className="text-xs">{value}</Badge>;
    }
    if (col.key === 'status_processo' && value) {
      return <Badge variant={statusColor(value)} className="text-xs">{value}</Badge>;
    }

    return <span className={col.mono ? 'font-mono text-xs' : ''}>{value ?? '—'}</span>;
  };

  return (
    <div className="p-0">
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="overflow-x-auto w-full border-b border-border"
        style={{ minHeight: 20, overflowY: 'hidden' }}
      >
        <div style={{ width: tableWidth || '100%', height: 1 }} />
      </div>
      <div ref={bottomScrollRef} onScroll={handleBottomScroll} className="overflow-x-auto w-full">
        <div ref={tableContentRef}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px] sticky left-0 bg-background z-10">Cliente</TableHead>
                {COLUMNS.slice(1).map(col => (
                  <TableHead key={col.key} style={{ minWidth: col.minW }}>{col.label}</TableHead>
                ))}
                <TableHead className="w-20">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length + 1} className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filteredRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length + 1} className="text-center py-8 text-muted-foreground">
                    {searchTerm ? 'Nenhum registro encontrado' : 'Nenhum registro nesta categoria'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRecords.map(record => (
                  <TableRow key={record.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium sticky left-0 bg-background z-10">
                      {renderCell(record, COLUMNS[0])}
                    </TableCell>
                    {COLUMNS.slice(1).map(col => (
                      <TableCell key={col.key}>{renderCell(record, col)}</TableCell>
                    ))}
                    <TableCell>
                      {editingId === record.id ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveEdit} disabled={saving}>
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-green-600" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdit}>
                            <X className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(record)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
