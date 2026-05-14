import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface InstanceRow {
  instance: string;
  value: number | string;
  secondary?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  valueLabel: string;
  secondaryLabel?: string;
  rows: InstanceRow[];
  total: number | string;
  totalSecondary?: string;
  formatValue?: (v: number | string) => string;
}

export function InstanceComparisonDialog({
  open, onClose, title, valueLabel, secondaryLabel, rows, total, totalSecondary, formatValue,
}: Props) {
  const fmt = (v: number | string) => (formatValue ? formatValue(v) : String(v));
  const sorted = [...rows].sort((a, b) => {
    const av = typeof a.value === 'number' ? a.value : parseFloat(String(a.value)) || 0;
    const bv = typeof b.value === 'number' ? b.value : parseFloat(String(b.value)) || 0;
    return bv - av;
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Comparativo por Instância — {title}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Instância</TableHead>
                <TableHead className="text-right">{valueLabel}</TableHead>
                {secondaryLabel && <TableHead className="text-right">{secondaryLabel}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={secondaryLabel ? 3 : 2} className="text-center text-muted-foreground py-6">
                    Sem dados por instância para este indicador.
                  </TableCell>
                </TableRow>
              ) : sorted.map((row) => (
                <TableRow key={row.instance}>
                  <TableCell className="font-medium">{row.instance}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(row.value)}</TableCell>
                  {secondaryLabel && (
                    <TableCell className="text-right text-muted-foreground text-xs">{row.secondary || '—'}</TableCell>
                  )}
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-semibold border-t-2">
                <TableCell>
                  <span>Total</span>
                  <Badge variant="default" className="ml-2">{sorted.length} inst.</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">{fmt(total)}</TableCell>
                {secondaryLabel && (
                  <TableCell className="text-right text-xs">{totalSecondary || '—'}</TableCell>
                )}
              </TableRow>
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
