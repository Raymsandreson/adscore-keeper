import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Link2, CalendarIcon, Copy, Check, Loader2, ExternalLink, 
  MessageCircle, CreditCard 
} from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface Transaction {
  id: string;
  pluggy_transaction_id: string;
  description: string;
  amount: number;
  transaction_date: string;
  merchant_name: string | null;
  card_last_digits: string;
}

interface ExpenseFormLinkGeneratorProps {
  knownCards: string[];
  transactions?: Transaction[];
}

export function ExpenseFormLinkGenerator({ knownCards, transactions = [] }: ExpenseFormLinkGeneratorProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const [selectedCard, setSelectedCard] = useState('');
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(new Date()));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(new Date()));
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [filterSpecific, setFilterSpecific] = useState(false);

  const filteredTransactions = transactions.filter(t => 
    t.card_last_digits === selectedCard &&
    t.transaction_date >= format(dateFrom, 'yyyy-MM-dd') &&
    t.transaction_date <= format(dateTo, 'yyyy-MM-dd')
  );

  const toggleTx = (txId: string) => {
    setSelectedTxIds(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!selectedCard || !user) return;

    setGenerating(true);
    try {
      const insertData: any = {
        card_last_digits: selectedCard,
        date_from: format(dateFrom, 'yyyy-MM-dd'),
        date_to: format(dateTo, 'yyyy-MM-dd'),
        created_by: user.id,
        transaction_ids: filterSpecific && selectedTxIds.size > 0 
          ? Array.from(selectedTxIds).map(id => {
              const tx = transactions.find(t => t.id === id);
              return tx?.pluggy_transaction_id || id;
            })
          : null,
      };

      const { data, error } = await supabase
        .from('expense_form_tokens')
        .insert(insertData)
        .select('token')
        .single();

      if (error) throw error;

      // Always use the published app URL for external sharing
      const link = `https://adscore-keeper.lovable.app/expense-form/${data.token}`;
      setGeneratedLink(link);
    } catch (err: any) {
      toast.error('Erro ao gerar link: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = async () => {
    if (!generatedLink) return;
    await navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    toast.success('Link copiado!');
    setTimeout(() => setCopied(false), 2000);
  };


  const resetForm = () => {
    setGeneratedLink(null);
    setCopied(false);
    setSelectedTxIds(new Set());
    setFilterSpecific(false);
  };

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) resetForm(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Link2 className="h-4 w-4" />
          Gerar Link Despesas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Gerar Link de Justificativa
          </DialogTitle>
        </DialogHeader>

        {!generatedLink ? (
          <div className="space-y-4">
            <div>
              <Label>Cartão</Label>
              <Select value={selectedCard} onValueChange={v => { setSelectedCard(v); setSelectedTxIds(new Set()); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cartão" />
                </SelectTrigger>
                <SelectContent>
                  {knownCards.map(card => (
                    <SelectItem key={card} value={card}>
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-3 w-3" />
                        ****{card}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data início</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left text-xs font-normal h-9")}>
                      <CalendarIcon className="mr-1 h-3 w-3" />
                      {format(dateFrom, 'dd/MM/yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateFrom}
                      onSelect={d => d && setDateFrom(d)}
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Data fim</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left text-xs font-normal h-9")}>
                      <CalendarIcon className="mr-1 h-3 w-3" />
                      {format(dateTo, 'dd/MM/yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateTo}
                      onSelect={d => d && setDateTo(d)}
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {selectedCard && filteredTransactions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Checkbox
                    checked={filterSpecific}
                    onCheckedChange={v => setFilterSpecific(!!v)}
                  />
                  <Label className="text-sm cursor-pointer" onClick={() => setFilterSpecific(!filterSpecific)}>
                    Selecionar transações específicas ({filteredTransactions.length} disponíveis)
                  </Label>
                </div>

                {filterSpecific && (
                  <ScrollArea className="max-h-[200px] border rounded-md p-2">
                    {filteredTransactions.map(tx => (
                      <div key={tx.id} className="flex items-center gap-2 py-1.5 border-b last:border-0">
                        <Checkbox
                          checked={selectedTxIds.has(tx.id)}
                          onCheckedChange={() => toggleTx(tx.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate">{tx.merchant_name || tx.description}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {format(new Date(tx.transaction_date + 'T12:00:00'), 'dd/MM')} • R$ {Math.abs(tx.amount).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </ScrollArea>
                )}
              </div>
            )}

            <Button 
              className="w-full" 
              onClick={handleGenerate} 
              disabled={!selectedCard || generating}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
              Gerar Link
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Link gerado:</p>
              <p className="text-sm font-mono break-all">{generatedLink}</p>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={copyLink}>
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? 'Copiado!' : 'Copiar Link'}
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="w-full" onClick={resetForm}>
              Gerar outro link
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
