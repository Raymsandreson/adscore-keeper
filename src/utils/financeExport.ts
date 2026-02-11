import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ExportOptions {
  filename: string;
  sheetName?: string;
}

export function exportToXlsx(data: Record<string, any>[], options: ExportOptions) {
  if (data.length === 0) return;

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, options.sheetName || 'Dados');

  // Auto-size columns
  const colWidths = Object.keys(data[0]).map(key => {
    const maxLen = Math.max(
      key.length,
      ...data.map(row => String(row[key] ?? '').length)
    );
    return { wch: Math.min(maxLen + 2, 40) };
  });
  ws['!cols'] = colWidths;

  const dateStr = format(new Date(), 'yyyy-MM-dd');
  XLSX.writeFile(wb, `${options.filename}_${dateStr}.xlsx`);
}

export function exportCreditCardTransactions(transactions: any[], formatCurrency: (v: number) => string) {
  const data = transactions.map(t => ({
    'Data': format(new Date(t.transaction_date + 'T12:00:00'), 'dd/MM/yyyy'),
    'Descrição': t.description || '',
    'Estabelecimento': t.merchant_name || '',
    'Categoria': t.category || 'Sem categoria',
    'Cartão': t.card_last_digits ? `****${t.card_last_digits}` : '',
    'Cidade': t.merchant_city || '',
    'Estado': t.merchant_state || '',
    'Parcela': t.installment_number && t.total_installments
      ? `${t.installment_number}/${t.total_installments}`
      : '',
    'Valor': t.amount,
  }));
  exportToXlsx(data, { filename: 'cartao_credito', sheetName: 'Cartão de Crédito' });
}

export function exportBankTransactions(transactions: any[]) {
  const data = transactions.map(t => ({
    'Data': format(new Date(t.transaction_date + 'T12:00:00'), 'dd/MM/yyyy'),
    'Descrição': t.description || '',
    'Estabelecimento': t.merchant_name || '',
    'Categoria': t.category || '',
    'Tipo': t.transaction_type || '',
    'Cidade': t.merchant_city || '',
    'Estado': t.merchant_state || '',
    'Valor': t.amount,
  }));
  exportToXlsx(data, { filename: 'conta_corrente', sheetName: 'Conta Corrente' });
}

export function exportInvestments(investments: any[]) {
  const data = investments.map(i => ({
    'Nome': i.name || 'Investimento',
    'Tipo': i.type || '',
    'Emissor': i.issuer_name || '',
    'Status': i.status === 'active' ? 'Ativo' : (i.status || ''),
    'Saldo Atual': i.balance || 0,
    'Valor Aplicado': i.amount_original || 0,
    'Rendimento': i.amount_profit || 0,
    'Taxa a.a.': i.annual_rate ? `${i.annual_rate.toFixed(2)}%` : '',
    'Vencimento': i.due_date ? format(new Date(i.due_date + 'T12:00:00'), 'dd/MM/yyyy') : '',
  }));
  exportToXlsx(data, { filename: 'investimentos', sheetName: 'Investimentos' });
}

export function exportLoans(loans: any[]) {
  const data = loans.map(l => ({
    'Nome': l.name || 'Empréstimo',
    'Tipo': l.loan_type || '',
    'Status': l.status === 'active' ? 'Em andamento' : (l.status || ''),
    'Valor Total': l.total_amount || 0,
    'Saldo Devedor': l.outstanding_balance || 0,
    'Parcela Mensal': l.monthly_payment || 0,
    'Juros a.m.': l.interest_rate ? `${l.interest_rate.toFixed(2)}%` : '',
    'Parcelas Pagas': l.installments_paid || 0,
    'Total Parcelas': l.installments_total || 0,
    'Vencimento': l.due_date ? format(new Date(l.due_date + 'T12:00:00'), 'dd/MM/yyyy') : '',
  }));
  exportToXlsx(data, { filename: 'emprestimos', sheetName: 'Empréstimos' });
}
