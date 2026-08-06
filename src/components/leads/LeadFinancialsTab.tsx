import { EntityFinancialsPanel } from '@/components/finance/EntityFinancialsPanel';

interface LeadFinancialsTabProps {
  leadId: string;
  caseId?: string | null;
}

/**
 * Aba Financeiro da ficha do lead.
 *
 * A implementação vive em `EntityFinancialsPanel`, compartilhada com a aba
 * Financeiro do processo e com o lançamento feito de dentro da atividade —
 * assim as três telas gravam na mesma tabela, com as mesmas categorias e o
 * mesmo gatilho de cronômetro. Aqui o escopo é o lead: continua listando os
 * lançamentos do lead (e do caso vinculado, quando houver), como antes.
 */
export function LeadFinancialsTab({ leadId, caseId }: LeadFinancialsTabProps) {
  return <EntityFinancialsPanel scope="lead" leadId={leadId} caseId={caseId} />;
}
