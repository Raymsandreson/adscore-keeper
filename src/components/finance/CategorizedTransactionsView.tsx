import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2 } from 'lucide-react';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { useLeads } from '@/hooks/useLeads';
import { useContacts } from '@/hooks/useContacts';
import { PendingTransactionsList } from './PendingTransactionsList';

interface Transaction {
  id: string;
  pluggy_account_id: string;
  pluggy_transaction_id: string;
  description: string | null;
  amount: number;
  currency_code: string | null;
  transaction_date: string;
  transaction_time: string | null;
  category: string | null;
  payment_data: Record<string, any>;
  card_last_digits: string | null;
  merchant_name: string | null;
  merchant_cnpj: string | null;
  merchant_city: string | null;
  merchant_state: string | null;
  created_at: string;
}

interface CategorizedTransactionsViewProps {
  transactions: Transaction[];
}

export function CategorizedTransactionsView({ transactions }: CategorizedTransactionsViewProps) {
  const { overrides, getTransactionOverride } = useExpenseCategories();
  const { leads } = useLeads();
  const { contacts } = useContacts();

  const categorizedTransactions = useMemo(() => {
    return transactions.filter(t => {
      const override = getTransactionOverride(t.id);
      if (!override) return false;
      if (override.link_acknowledged) return true;
      if (override.lead_id || override.contact_id) return true;
      return false;
    });
  }, [transactions, getTransactionOverride, overrides]);

  const formattedLeads = useMemo(() =>
    (leads || []).map(l => ({ id: l.id, lead_name: l.lead_name, city: l.city || null, state: l.state || null })),
    [leads]
  );

  const formattedContacts = useMemo(() =>
    (contacts || []).map(c => ({ id: c.id, full_name: c.full_name, city: c.city || null, state: c.state || null })),
    [contacts]
  );

  if (categorizedTransactions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <CheckCircle2 className="h-12 w-12 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">Nenhuma transação categorizada ainda</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="rounded-full">
          {categorizedTransactions.length} categorizada(s)
        </Badge>
      </div>
      <Card className="border-0 shadow-card">
        <CardContent className="py-4">
          <PendingTransactionsList
            transactions={categorizedTransactions}
            leads={formattedLeads}
            contacts={formattedContacts}
          />
        </CardContent>
      </Card>
    </div>
  );
}
