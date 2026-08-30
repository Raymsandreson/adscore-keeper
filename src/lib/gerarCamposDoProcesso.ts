// =============================================================================
// "Gerar do processo": rascunho dos campos da atividade a partir do que o
// processo ANDOU — movimentações do Escavador + e-mails do push — desde que a
// atividade foi criada (pedido do usuário, 30/08/2026).
//
// Não inventa função nova: usa a activity-from-movement (Railway), a MESMA que
// redige a dica do sino e o rascunho da aba de movimentações — com
// include_email_history, que puxa os processual_emails do CNJ no servidor.
// Aqui só se decide O QUE entra: as movimentações a partir de `desdeISO`
// (a criação da atividade); se nenhuma for tão recente, vão as últimas 8 para
// a IA ter contexto — dizer "nada mudou" também é informação.
// =============================================================================
import { db } from '@/integrations/supabase';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

export interface CamposGerados {
  what_was_done?: string;
  current_status?: string;
  next_steps?: string;
  solicitacao?: string;
  resposta_juizo?: string;
  notes?: string;
  title?: string;
}

interface ContextoAtividade {
  processId: string;
  /** created_at da atividade — o "desde quando" das movimentações. Null = últimas 8. */
  desdeISO: string | null;
  leadName?: string | null;
  caseTitle?: string | null;
  workflowName?: string | null;
}

interface MovCru {
  data?: string; data_hora?: string; tipo?: string; titulo?: string;
  conteudo?: string; descricao?: string;
  classificacao_predita?: { nome?: string } | null;
}

export async function gerarCamposDoProcesso(ctx: ContextoAtividade): Promise<CamposGerados> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: proc } = await (db as any)
    .from('lead_processes')
    .select('process_number, title, movimentacoes')
    .eq('id', ctx.processId)
    .maybeSingle();
  if (!proc) throw new Error('Processo não encontrado');

  const todas: MovCru[] = Array.isArray(proc.movimentacoes) ? proc.movimentacoes : [];
  const normaliza = (m: MovCru) => ({
    data: (m.data || m.data_hora || '').toString().slice(0, 10) || null,
    tipo: (m.tipo || m.classificacao_predita?.nome || '').toString(),
    conteudo: (m.conteudo || m.titulo || m.descricao || '').toString().replace(/\s+/g, ' ').trim().slice(0, 600),
  });
  const ordenadas = todas
    .map(normaliza)
    .filter(m => m.conteudo)
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  const desde = ctx.desdeISO ? ctx.desdeISO.slice(0, 10) : null;
  const desdeCriacao = desde ? ordenadas.filter(m => (m.data || '') >= desde) : [];
  const recentes = (desdeCriacao.length > 0 ? desdeCriacao : ordenadas).slice(0, 8);
  if (recentes.length === 0) throw new Error('Este processo não tem movimentação baixada ainda');

  const { data, error } = await cloudFunctions.invoke('activity-from-movement', {
    body: {
      movement: recentes[0],
      recent_movements: recentes.slice(1),
      include_email_history: true,
      activity_context: {
        process_title: proc.title || null,
        process_number: proc.process_number || null,
        lead_name: ctx.leadName || null,
        case_title: ctx.caseTitle || null,
        workflow: ctx.workflowName ? { name: ctx.workflowName } : undefined,
      },
      instrucao_extra: desde
        ? `Esta atividade foi criada em ${desde}. Descreva o que aconteceu no processo A PARTIR dessa data; o que veio antes é só contexto. Se nada relevante aconteceu desde então, diga isso com clareza.`
        : undefined,
    },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'A IA não conseguiu gerar o rascunho');
  return (data.fields || {}) as CamposGerados;
}

/** Rascunho (texto puro) → HTML simples para o RichTextEditor. */
export function rascunhoParaHtml(texto: string): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .split(/\n{2,}/)
    .map(par => `<p>${par.replace(/\n/g, '<br>')}</p>`)
    .join('');
}
