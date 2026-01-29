import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { 
  Tag,
  UserCheck,
  AlertTriangle,
  Search,
  Utensils,
  Car,
  Bed,
  Fuel,
  Plane,
  Briefcase,
  Package
} from 'lucide-react';
import { ExpenseCategory, useExpenseCategories } from '@/hooks/useExpenseCategories';
import { useLeads, Lead } from '@/hooks/useLeads';

interface Transaction {
  id: string;
  description: string | null;
  amount: number;
  category: string | null;
  merchant_name: string | null;
  card_last_digits: string | null;
  transaction_date: string;
}

interface TransactionCategorizerProps {
  transaction: Transaction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  tag: Tag,
  utensils: Utensils,
  car: Car,
  bed: Bed,
  fuel: Fuel,
  plane: Plane,
  briefcase: Briefcase,
  package: Package,
  'car-taxi-front': Car,
};

export function TransactionCategorizer({ transaction, open, onOpenChange }: TransactionCategorizerProps) {
  const { 
    categories, 
    setTransactionOverride, 
    getTransactionOverride,
    getCategoryById,
    checkLimitViolation 
  } = useExpenseCategories();
  const { leads } = useLeads();
  
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedLead, setSelectedLead] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [notes, setNotes] = useState('');

  const existingOverride = getTransactionOverride(transaction.id);

  const filteredLeads = leads.filter(lead => 
    lead.lead_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.instagram_username?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = async () => {
    if (!selectedCategory) return;
    
    await setTransactionOverride(
      transaction.id, 
      selectedCategory, 
      selectedLead || undefined,
      notes || undefined
    );
    
    onOpenChange(false);
    setSelectedCategory('');
    setSelectedLead('');
    setNotes('');
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getLeadDisplay = (lead: Lead) => {
    return lead.lead_name || lead.instagram_username || 'Sem nome';
  };

  const selectedCategoryData = selectedCategory ? getCategoryById(selectedCategory) : null;
  const limitViolation = selectedCategoryData 
    ? checkLimitViolation(selectedCategoryData, transaction.amount) 
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Categorizar Transação
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Transaction Info */}
          <div className="p-3 rounded-lg bg-muted/50">
            <p className="font-medium">{transaction.description || transaction.merchant_name}</p>
            <p className="text-lg font-bold text-destructive">{formatCurrency(transaction.amount)}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(transaction.transaction_date).toLocaleDateString('pt-BR')}
              {transaction.card_last_digits && ` • **** ${transaction.card_last_digits}`}
            </p>
          </div>

          {/* Category Selection */}
          <div>
            <Label>Categoria</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {categories.map((category) => {
                const Icon = iconMap[category.icon] || Tag;
                const isSelected = selectedCategory === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategory(category.id)}
                    className={`flex items-center gap-2 p-3 rounded-lg border transition-all text-left ${
                      isSelected 
                        ? 'border-primary bg-primary/10' 
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className={`p-1.5 rounded ${category.color} text-white`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{category.name}</p>
                      {category.max_limit_per_unit && (
                        <p className="text-xs text-muted-foreground">
                          Limite: {formatCurrency(category.max_limit_per_unit)}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Limit Warning */}
          {limitViolation && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">Limite excedido!</p>
                  <p className="text-sm text-muted-foreground">
                    Gasto de {formatCurrency(limitViolation.amount)} excede o limite de{' '}
                    {formatCurrency(limitViolation.limit)} em{' '}
                    <span className="font-medium text-destructive">
                      {formatCurrency(limitViolation.diff)}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Lead Selection (Optional) */}
          <div>
            <Label className="flex items-center gap-2">
              <UserCheck className="h-4 w-4" />
              Vincular a Acolhedor (opcional)
            </Label>
            <div className="relative mb-2 mt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar acolhedor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <ScrollArea className="h-32 border rounded-md">
              <div className="p-2 space-y-1">
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    !selectedLead ? 'bg-muted' : 'hover:bg-muted'
                  }`}
                  onClick={() => setSelectedLead('')}
                >
                  Nenhum
                </button>
                {filteredLeads.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedLead === lead.id 
                        ? 'bg-primary text-primary-foreground' 
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => setSelectedLead(lead.id)}
                  >
                    {getLeadDisplay(lead)}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Notes */}
          <div>
            <Label>Observações (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Almoço com cliente..."
              className="mt-2"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!selectedCategory}>
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
