import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Trash2 } from 'lucide-react';
import type { AIFieldConflict, AIReviewedField } from '@/lib/activityAIFields';

export type AIFieldOrigin = 'áudio' | 'documento' | 'renomear';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** De onde veio a sugestão — só muda o texto do cabeçalho. */
  origin: AIFieldOrigin;
  conflicts: AIFieldConflict[];
  /** Recebe só os campos que o usuário marcou. */
  onApply: (fields: Partial<Record<AIReviewedField, string>>) => void;
}

const ORIGIN_TEXT: Record<AIFieldOrigin, string> = {
  'áudio': 'O áudio da ligação sugeriu trocar o texto abaixo.',
  'documento': 'O documento anexado sugeriu trocar o texto abaixo.',
  'renomear': 'A IA sugeriu este assunto a partir do conteúdo da atividade.',
};

/**
 * Revisão das substituições propostas pela IA em campos que o usuário JÁ escreveu.
 *
 * Campo vazio nunca chega aqui (é preenchido direto). Aqui ficam só os casos em
 * que aplicar significaria apagar ou reescrever texto do usuário — antes isso
 * acontecia calado, e a atividade "trocava de assunto e conteúdo sozinha".
 */
export function AIFieldMergeDialog({ open, onOpenChange, origin, conflicts, onApply }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Cada nova rodada da IA reabre o diálogo com as marcações padrão.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const c of conflicts) next[c.key] = c.defaultChecked;
    setChecked(next);
  }, [open, conflicts]);

  const selected = conflicts.filter((c) => checked[c.key]);

  const apply = () => {
    const fields: Partial<Record<AIReviewedField, string>> = {};
    for (const c of selected) fields[c.key] = c.incoming;
    onApply(fields);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            A IA quer alterar {conflicts.length} campo(s) que você já preencheu
          </DialogTitle>
          <DialogDescription>
            {ORIGIN_TEXT[origin]} Marque só o que você quer substituir —
            o que ficar desmarcado permanece exatamente como está.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="space-y-4">
            {conflicts.map((c) => {
              const isDelete = !c.incoming.trim();
              return (
                <div key={c.key} className="rounded-lg border p-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <Checkbox
                      checked={!!checked[c.key]}
                      onCheckedChange={(v) => setChecked((prev) => ({ ...prev, [c.key]: !!v }))}
                      className="mt-0.5"
                    />
                    <span className="font-medium text-sm">{c.label}</span>
                    {isDelete && (
                      <Badge variant="destructive" className="gap-1 text-[10px]">
                        <Trash2 className="h-3 w-3" /> apagar
                      </Badge>
                    )}
                  </label>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded bg-muted/50 p-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Seu texto</p>
                      <p className="text-xs whitespace-pre-wrap break-words">{c.current}</p>
                    </div>
                    <div className="rounded bg-primary/5 p-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Sugestão da IA</p>
                      <p className="text-xs whitespace-pre-wrap break-words">
                        {isDelete ? <span className="italic text-destructive">(deixar o campo vazio)</span> : c.incoming}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Manter tudo como está
          </Button>
          <Button onClick={apply} disabled={selected.length === 0}>
            Substituir {selected.length} campo(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
