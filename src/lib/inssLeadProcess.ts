/**
 * Ponte entre o processo administrativo do INSS (ingerido dos e-mails pelo
 * `gmail-inss-sync`) e o processo do caso (`lead_processes`).
 *
 * Existe porque o dado do INSS mora em duas tabelas com papéis diferentes:
 *   - `inss_admin_processes` → espelho do que o INSS mandou por e-mail
 *   - `lead_processes`       → o processo como o escritório trabalha (POP,
 *                              responsável, atividades, ficha do caso)
 *
 * Sem esta ponte o requerimento fica visível só na aba "INSS Administrativo"
 * e a ficha do caso mostra "Processos (0)".
 *
 * Usado por:
 *   - `InssAdminProcessesTab` (vínculo manual e revisão de ambíguos)
 *   - `InssEmailSearchTab` (aba "Buscar no E-mail" do Cadastrar Processo)
 */
import { db } from '@/integrations/supabase';

export interface InssProcessRow {
  id: string;
  requerimento_number: string;
  current_status?: string | null;
  benefit_type?: string | null;
  benefit_number?: string | null;
  cpf_segurado?: string | null;
  nome_segurado?: string | null;
  protocol_date?: string | null;
  last_email_at?: string | null;
  last_email_subject?: string | null;
  servico?: string | null;
  despacho?: string | null;
  resultado?: string | null;
  created_at?: string | null;
  lead_id?: string | null;
  case_id?: string | null;
}

const fmtDateBr = (s?: string | null): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR');
};

/** Título padrão do processo INSS no caso. Mantido igual ao que já existia. */
export const inssProcessTitle = (proc: InssProcessRow): string =>
  `INSS Administrativo — Req. ${proc.requerimento_number}${proc.benefit_type ? ` (${proc.benefit_type})` : ''}`;

export interface UpsertInssLeadProcessParams {
  caseId: string;
  leadId: string | null;
  proc: InssProcessRow;
  /** UUID Externo de quem está cadastrando (grava em created_by). */
  createdBy?: string | null;
  /** POP escolhido no modal — só é gravado quando informado. */
  workflowId?: string | null;
  workflowName?: string | null;
  /** Responsável escolhido no modal (UUID Externo). */
  responsibleUserId?: string | null;
}

/**
 * Cria (ou atualiza) a linha em `lead_processes` a partir do processo INSS.
 * Idempotente por `process_number` (o nº do requerimento é único no INSS).
 *
 * Retorna o id do `lead_processes` resultante — quem chama usa pra amarrar a
 * atividade de andamento.
 */
export async function upsertInssLeadProcess(
  params: UpsertInssLeadProcessParams,
): Promise<{ id: string | null; created: boolean }> {
  const { caseId, leadId, proc, createdBy, workflowId, workflowName, responsibleUserId } = params;
  if (!proc.requerimento_number) return { id: null, created: false };

  // Último e-mail do histórico alimenta a descrição (o despacho é o que o
  // assessor precisa ler pra saber o que fazer).
  const { data: lastHist } = await db
    .from('inss_status_history' as any)
    .select('email_snippet, email_subject, email_received_at, to_status')
    .eq('process_id', proc.id)
    .order('email_received_at', { ascending: false })
    .limit(1);
  const last = (lastHist || [])[0] as any;

  const descLines = [
    proc.nome_segurado ? `Segurado: ${proc.nome_segurado}` : null,
    proc.cpf_segurado ? `CPF: ${proc.cpf_segurado}` : null,
    proc.benefit_type ? `Benefício: ${proc.benefit_type}` : null,
    proc.servico ? `Serviço: ${proc.servico}` : null,
    proc.benefit_number ? `NB: ${proc.benefit_number}` : null,
    proc.protocol_date ? `Protocolo: ${fmtDateBr(proc.protocol_date)}` : null,
    proc.current_status ? `Status: ${proc.current_status}` : null,
    last?.email_snippet ? `\nÚltimo despacho: ${last.email_snippet}` : null,
  ].filter(Boolean);

  const { data: existing } = await db
    .from('lead_processes' as any)
    .select('id')
    .eq('process_number', proc.requerimento_number)
    .limit(1);

  const payload: Record<string, unknown> = {
    lead_id: leadId,
    case_id: caseId,
    process_type: 'inss_admin',
    process_number: proc.requerimento_number,
    title: inssProcessTitle(proc),
    description: descLines.join('\n'),
    status: proc.current_status || 'Em andamento',
    started_at: proc.protocol_date || proc.created_at,
    fonte_nome: 'INSS',
    fonte_tipo: 'Administrativo',
    data_ultima_verificacao: proc.last_email_at,
  };
  // POP/responsável só entram no payload quando escolhidos, pra um re-vínculo
  // sem POP não apagar o que já estava gravado.
  if (workflowId) {
    payload.workflow_id = workflowId;
    payload.workflow_name = workflowName || null;
  }
  if (responsibleUserId) payload.responsible_user_id = responsibleUserId;

  if (existing && existing[0]) {
    const id = (existing[0] as any).id as string;
    const { error } = await db.from('lead_processes' as any).update(payload).eq('id', id);
    if (error) throw error;
    return { id, created: false };
  }

  const { data: inserted, error } = await db
    .from('lead_processes' as any)
    .insert({ ...payload, created_by: createdBy || null })
    .select('id')
    .single();
  if (error) throw error;
  return { id: (inserted as any)?.id || null, created: true };
}
