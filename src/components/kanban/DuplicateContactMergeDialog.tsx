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
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, UserPlus, Merge, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface IncomingContact {
  full_name: string;
  phone?: string | null;
  email?: string | null;
  instagram_username?: string | null;
  classification?: string | null;
  notes?: string | null;
  city?: string | null;
  state?: string | null;
  neighborhood?: string | null;
  street?: string | null;
  cep?: string | null;
  profession?: string | null;
}

export interface ExistingContact extends IncomingContact {
  id: string;
  created_at?: string;
}

interface FieldDef {
  key: keyof IncomingContact;
  label: string;
}

const FIELDS: FieldDef[] = [
  { key: 'full_name', label: 'Nome' },
  { key: 'phone', label: 'Telefone' },
  { key: 'email', label: 'E-mail' },
  { key: 'instagram_username', label: 'Instagram' },
  { key: 'classification', label: 'Classificação' },
  { key: 'profession', label: 'Profissão' },
  { key: 'cep', label: 'CEP' },
  { key: 'street', label: 'Rua' },
  { key: 'neighborhood', label: 'Bairro' },
  { key: 'city', label: 'Cidade' },
  { key: 'state', label: 'Estado' },
  { key: 'notes', label: 'Observações' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incoming: IncomingContact;
  candidates: ExistingContact[];
  /** Called when user chose to merge into `targetId` with `merged` values */
  onMerge: (targetId: string, merged: Partial<IncomingContact>) => Promise<void> | void;
  /** Called when user chose to create a new contact anyway */
  onCreateNew: () => Promise<void> | void;
}

type Source = 'new' | string; // 'new' or candidate id

export function DuplicateContactMergeDialog({
  open,
  onOpenChange,
  incoming,
  candidates,
  onMerge,
  onCreateNew,
}: Props) {
  // Default: pick first candidate as target
  const [targetId, setTargetId] = useState<string>(candidates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  // Per-field source selection. Default: prefer non-empty in order [new, candidates...]
  const initialChoices = useMemo(() => {
    const c: Record<string, Source> = {};
    for (const f of FIELDS) {
      const newVal = incoming[f.key];
      if (newVal && String(newVal).trim()) {
        c[f.key as string] = 'new';
        continue;
      }
      const cand = candidates.find((x) => x[f.key] && String(x[f.key]).trim());
      c[f.key as string] = cand ? cand.id : 'new';
    }
    return c;
  }, [incoming, candidates]);

  const [choices, setChoices] = useState<Record<string, Source>>(initialChoices);

  const valueFor = (src: Source, key: keyof IncomingContact) => {
    if (src === 'new') return incoming[key] ?? null;
    return candidates.find((c) => c.id === src)?.[key] ?? null;
  };

  const handleMerge = async () => {
    if (!targetId) return;
    setBusy(true);
    try {
      const merged: Partial<IncomingContact> = {};
      for (const f of FIELDS) {
        const src = choices[f.key as string];
        const val = valueFor(src, f.key);
        (merged as any)[f.key] = val ?? null;
      }
      await onMerge(targetId, merged);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    setBusy(true);
    try {
      await onCreateNew();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Contato parecido já existe
          </DialogTitle>
          <DialogDescription>
            Encontramos {candidates.length} contato{candidates.length > 1 ? 's' : ''} com telefone ou nome parecido.
            Escolha qual valor manter em cada campo e juntaremos em um único contato.
          </DialogDescription>
        </DialogHeader>

        {/* Candidate selector */}
        {candidates.length > 1 && (
          <div className="border rounded-md p-2 space-y-1">
            <p className="text-xs text-muted-foreground px-1">Mesclar dentro de:</p>
            <div className="flex flex-wrap gap-2">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setTargetId(c.id)}
                  className={cn(
                    'text-xs px-2 py-1 rounded border transition-colors',
                    targetId === c.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted'
                  )}
                >
                  {targetId === c.id && <Check className="h-3 w-3 inline mr-1" />}
                  {c.full_name}
                  {c.phone ? ` · ${c.phone}` : ''}
                </button>
              ))}
            </div>
          </div>
        )}

        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="space-y-3">
            {FIELDS.map((f) => {
              const newVal = incoming[f.key];
              const sources: { id: Source; label: string; value: any }[] = [
                { id: 'new', label: 'Novo', value: newVal },
                ...candidates.map((c) => ({
                  id: c.id,
                  label: c.full_name.split(' ')[0] || 'Existente',
                  value: c[f.key],
                })),
              ];
              // Skip rows where all values are empty
              const anyValue = sources.some((s) => s.value && String(s.value).trim());
              if (!anyValue) return null;

              const selected = choices[f.key as string];

              return (
                <div key={f.key as string} className="border rounded-md p-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-muted-foreground">{f.label}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sources.map((s) => {
                      const empty = !s.value || !String(s.value).trim();
                      const isSelected = selected === s.id;
                      return (
                        <button
                          key={String(s.id)}
                          type="button"
                          disabled={empty}
                          onClick={() => setChoices((prev) => ({ ...prev, [f.key as string]: s.id }))}
                          className={cn(
                            'text-xs px-2 py-1 rounded border text-left max-w-full',
                            empty && 'opacity-40 cursor-not-allowed',
                            isSelected
                              ? 'bg-primary/10 border-primary text-foreground'
                              : 'bg-background hover:bg-muted border-border'
                          )}
                        >
                          <Badge
                            variant="outline"
                            className={cn(
                              'mr-1 text-[10px] py-0 px-1',
                              s.id === 'new' ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' : ''
                            )}
                          >
                            {s.label}
                          </Badge>
                          <span className="break-words">{empty ? '—' : String(s.value)}</span>
                          {isSelected && <Check className="h-3 w-3 inline ml-1 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={handleCreate} disabled={busy}>
            <UserPlus className="h-4 w-4 mr-1" />
            Criar como novo
          </Button>
          <Button onClick={handleMerge} disabled={busy || !targetId}>
            <Merge className="h-4 w-4 mr-1" />
            Mesclar no selecionado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
