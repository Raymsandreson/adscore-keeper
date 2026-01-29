import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Trash2, ArrowRight } from 'lucide-react';
import { ExpenseCategory } from '@/hooks/useExpenseCategories';

interface DeleteCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: ExpenseCategory | null;
  expenseCount: number;
  availableCategories: ExpenseCategory[];
  onConfirm: (reassignToCategoryId?: string) => void;
  loading?: boolean;
}

export function DeleteCategoryDialog({
  open,
  onOpenChange,
  category,
  expenseCount,
  availableCategories,
  onConfirm,
  loading = false,
}: DeleteCategoryDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  useEffect(() => {
    if (!open) {
      setSelectedCategory('');
    }
  }, [open]);

  if (!category) return null;

  const hasExpenses = expenseCount > 0;

  const handleConfirm = () => {
    if (hasExpenses && !selectedCategory) return;
    onConfirm(hasExpenses ? selectedCategory : undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Excluir Categoria
          </DialogTitle>
          <DialogDescription>
            {hasExpenses 
              ? `Esta categoria possui ${expenseCount} despesa(s) vinculada(s).`
              : 'Tem certeza que deseja excluir esta categoria?'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-muted/50">
            <p className="font-medium">{category.name}</p>
            {category.parent_id && (
              <p className="text-xs text-muted-foreground">Subcategoria</p>
            )}
          </div>

          {hasExpenses && (
            <>
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      Reatribuir despesas obrigatório
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Selecione outra categoria para transferir as {expenseCount} despesa(s) antes de excluir.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <Label>Transferir despesas para:</Label>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="Selecione uma categoria..." />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-[200]">
                    {availableCategories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        <div className="flex items-center gap-2">
                          <div className={`h-3 w-3 rounded ${cat.color}`} />
                          {cat.name}
                          {cat.parent_id && (
                            <span className="text-xs text-muted-foreground">(sub)</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedCategory && (
                <div className="flex items-center justify-center gap-2 p-2 rounded bg-muted/50">
                  <span className="text-sm">{category.name}</span>
                  <ArrowRight className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {availableCategories.find(c => c.id === selectedCategory)?.name}
                  </span>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleConfirm}
              disabled={loading || (hasExpenses && !selectedCategory)}
            >
              {loading ? 'Excluindo...' : hasExpenses ? 'Transferir e Excluir' : 'Excluir'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
