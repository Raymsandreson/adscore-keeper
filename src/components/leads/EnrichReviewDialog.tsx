import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles } from 'lucide-react';

export interface EnrichCustomFieldMeta {
  id: string;
  slug: string;
  name: string;
  type: string;
}

export interface EnrichReviewData {
  extracted: Record<string, any>;
  current: Record<string, any>;
  customFields: EnrichCustomFieldMeta[];
  leadNameLocked: boolean;
  /** true quando a função antiga (sem dry_run) já gravou direto — modo só-leitura */
  alreadyApplied?: boolean;
  groupJid: string;
}

interface EnrichReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: EnrichReviewData;
  applying: boolean;
  onApply: (selected: Record<string, any>) => void;
}

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Nome do lead',
  email: 'E-mail',
  city: 'Cidade',
  state: 'Estado (UF)',
  neighborhood: 'Bairro',
  notes: 'Anotações (resumo da IA)',
  victim_name: 'Nome da vítima',
  main_company: 'Empresa principal',
  damage_description: 'Dano/lesão',
  accident_date: 'Data do acidente',
  case_type: 'Tipo do caso',
  visit_city: 'Cidade da visita',
  visit_state: 'UF da visita',
  visit_address: 'Endereço da visita',
  lead_status: 'Resultado do lead',
};

const STATUS_LABELS: Record<string, string> = {
  closed: 'Fechado',
  refused: 'Recusado',
  unviable: 'Inviável',
};

// Campos extraídos que não têm destino no lead neste fluxo (vão pro contato ou são ignorados)
const SKIPPED_KEYS = new Set([
  'referrals', 'lead_status_reason', 'phone', 'street', 'cep', 'profession', 'instagram_url',
]);

interface Row {
  key: string;
  label: string;
  current: string;
  next: string;
  defaultChecked: boolean;
}

const norm = (v: any): string => (v === null || v === undefined ? '' : String(v).trim());

function buildRows(data: EnrichReviewData): { rows: Row[]; unchanged: number } {
  const cfBySlug = new Map(data.customFields.map((f) => [f.slug, f]));
  const rows: Row[] = [];
  let unchanged = 0;
  for (const [key, value] of Object.entries(data.extracted)) {
    if (SKIPPED_KEYS.has(key)) continue;
    if (key === 'full_name' && data.leadNameLocked) continue;
    const label = FIELD_LABELS[key] || cfBySlug.get(key)?.name;
    if (!label) continue;
    let next = norm(value);
    if (!next) continue;
    if (key === 'lead_status') {
      const status = String(value);
      if (!['closed', 'refused', 'unviable'].includes(status) || !data.extracted.lead_status_reason) continue;
      if (norm(data.current.lead_status) && norm(data.current.lead_status) !== 'active') { unchanged++; continue; }
      next = `${STATUS_LABELS[status] || status} — ${data.extracted.lead_status_reason}`;
      // status é mudança de alto impacto: começa desmarcado
      rows.push({ key, label, current: norm(data.current.lead_status) || '—', next, defaultChecked: false });
      continue;
    }
    const current = norm(data.current[key]);
    if (!data.alreadyApplied && current === next) { unchanged++; continue; }
    rows.push({ key, label, current, next, defaultChecked: true });
  }
  return { rows, unchanged };
}

export function EnrichReviewDialog({ open, onOpenChange, data, applying, onApply }: EnrichReviewDialogProps) {
  const { rows, unchanged } = useMemo(() => buildRows(data), [data]);
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, r.defaultChecked]))
  );

  const selectedCount = rows.filter((r) => checked[r.key]).length;
  const allChecked = rows.length > 0 && selectedCount === rows.length;

  const handleApply = () => {
    const selected: Record<string, any> = {};
    for (const r of rows) {
      if (!checked[r.key]) continue;
      selected[r.key] = data.extracted[r.key];
      if (r.key === 'lead_status') selected.lead_status_reason = data.extracted.lead_status_reason;
    }
    onApply(selected);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {data.alreadyApplied ? 'Informações aplicadas pela IA' : 'Revisar informações extraídas pela IA'}
          </DialogTitle>
          <DialogDescription>
            {data.alreadyApplied
              ? 'A versão atual da função aplicou os campos abaixo diretamente no lead (sem etapa de revisão).'
              : 'Extraído da conversa do grupo. Nada foi gravado ainda — marque o que deseja aplicar.'}
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            A IA não encontrou nenhuma informação nova em relação ao que o lead já tem.
            {unchanged > 0 && ` ${unchanged} campo(s) extraído(s) já estavam iguais.`}
          </p>
        ) : (
          <ScrollArea className="max-h-[50vh] pr-3">
            <div className="space-y-2">
              {rows.map((r) => (
                <label
                  key={r.key}
                  className="flex items-start gap-3 rounded-md border p-2.5 cursor-pointer hover:bg-muted/50"
                >
                  {!data.alreadyApplied && (
                    <Checkbox
                      checked={!!checked[r.key]}
                      onCheckedChange={(v) => setChecked((prev) => ({ ...prev, [r.key]: v === true }))}
                      className="mt-0.5"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-xs font-medium">{r.label}</p>
                    {r.current && r.current !== '—' && (
                      <p className="text-xs text-muted-foreground line-through break-words">{r.current}</p>
                    )}
                    <p className="text-xs break-words">{r.next}</p>
                  </div>
                </label>
              ))}
            </div>
          </ScrollArea>
        )}

        {unchanged > 0 && rows.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {unchanged} campo(s) extraído(s) já estavam iguais ao lead e foram omitidos.
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {!data.alreadyApplied && rows.length > 0 ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setChecked(Object.fromEntries(rows.map((r) => [r.key, !allChecked])))}
              >
                {allChecked ? 'Desmarcar todos' : 'Marcar todos'}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
                  Cancelar
                </Button>
                <Button type="button" onClick={handleApply} disabled={applying || selectedCount === 0}>
                  {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Aplicar selecionados ({selectedCount})
                </Button>
              </div>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="ml-auto">
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
