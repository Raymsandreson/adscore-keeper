import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';

interface ExportOptions {
  filename: string;
  sheetName?: string;
  format: ExportFormat;
}

function exportToXlsx(data: Record<string, any>[], filename: string, sheetName: string) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const colWidths = Object.keys(data[0]).map(key => {
    const maxLen = Math.max(key.length, ...data.map(row => String(row[key] ?? '').length));
    return { wch: Math.min(maxLen + 2, 40) };
  });
  ws['!cols'] = colWidths;
  const dateStr = format(new Date(), 'yyyy-MM-dd');
  XLSX.writeFile(wb, `${filename}_${dateStr}.xlsx`);
}

function exportToCsv(data: Record<string, any>[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = format(new Date(), 'yyyy-MM-dd');
  a.download = `${filename}_${dateStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportToPdf(data: Record<string, any>[], filename: string, title: string) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(title, 14, 15);
  doc.setFontSize(8);
  doc.text(`Exportado em ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 22);

  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(h => String(row[h] ?? '')));

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 26,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold' },
  });

  const dateStr = format(new Date(), 'yyyy-MM-dd');
  doc.save(`${filename}_${dateStr}.pdf`);
}

export function exportData(data: Record<string, any>[], options: ExportOptions) {
  if (data.length === 0) return;
  const sheetName = options.sheetName || 'Dados';
  switch (options.format) {
    case 'csv':
      exportToCsv(data, options.filename);
      break;
    case 'pdf':
      exportToPdf(data, options.filename, sheetName);
      break;
    case 'xlsx':
    default:
      exportToXlsx(data, options.filename, sheetName);
      break;
  }
}

export function exportCreditCardTransactions(transactions: any[], formatCurrency: (v: number) => string, fmt: ExportFormat = 'xlsx') {
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
  exportData(data, { filename: 'cartao_credito', sheetName: 'Cartão de Crédito', format: fmt });
}

export function exportBankTransactions(transactions: any[], fmt: ExportFormat = 'xlsx') {
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
  exportData(data, { filename: 'conta_corrente', sheetName: 'Conta Corrente', format: fmt });
}

export function exportInvestments(investments: any[], fmt: ExportFormat = 'xlsx') {
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
  exportData(data, { filename: 'investimentos', sheetName: 'Investimentos', format: fmt });
}

export function exportLoans(loans: any[], fmt: ExportFormat = 'xlsx') {
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
  exportData(data, { filename: 'emprestimos', sheetName: 'Empréstimos', format: fmt });
}
