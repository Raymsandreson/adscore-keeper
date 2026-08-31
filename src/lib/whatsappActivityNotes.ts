/**
 * Card "Atividade Criada" da conversa -> ficha da atividade.
 *
 * A nota interna (`whatsapp_internal_notes`, banco CLOUD) é o registro que
 * aparece na conversa quando a atividade nasce fora de uma mensagem específica
 * (menu do topo da conversa). Ela agora guarda `activity_id`, então o card abre
 * a ficha direto — no painel lateral, sem tirar a pessoa da conversa.
 *
 * Notas antigas não têm a coluna preenchida: aí o id é reconstruído a partir do
 * próprio texto ("Atividade criada: \"TÍTULO\" (Tipo) — Lead: NOME") contra
 * `lead_activities` (banco EXTERNO), e o resultado é gravado de volta na nota
 * para que a próxima abertura seja direta.
 */
import { authClient, db, ensureExternalSession } from '@/integrations/supabase';

export interface NotaDeAtividade {
  id: string;
  content: string;
  created_at: string;
  activity_id?: string | null;
}

export interface DadosDaNotaDeAtividade {
  title: string;
  typeLabel: string | null;
  leadName: string | null;
}

/** Formato gravado por `handleActivityCreated` na caixa de entrada do WhatsApp. */
const PADRAO_DA_NOTA = /Atividade criada:\s*"(.+)"\s*\(([^)]*)\)(?:\s*—\s*Lead:\s*(.+))?$/;

/** Lê título, tipo e lead do texto da nota. Devolve null quando o texto foge do padrão. */
export function lerNotaDeAtividade(content: string | null | undefined): DadosDaNotaDeAtividade | null {
  if (!content) return null;
  const match = content.trim().match(PADRAO_DA_NOTA);
  if (!match) return null;
  const title = match[1]?.trim();
  if (!title) return null;
  return {
    title,
    typeLabel: match[2]?.trim() || null,
    leadName: match[3]?.trim() || null,
  };
}

/** Distância em milissegundos entre a atividade e a nota — desempata títulos repetidos. */
function distanciaDaNota(criadaEm: string | null, notaEm: string): number {
  if (!criadaEm) return Number.POSITIVE_INFINITY;
  const a = new Date(criadaEm).getTime();
  const b = new Date(notaEm).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b);
}

interface LinhaDeAtividade {
  id: string;
  created_at: string | null;
  lead_name: string | null;
}

/**
 * Entre as atividades de mesmo título, escolhe a que nasceu junto com a nota.
 * O lead da nota, quando existe, filtra antes — dois leads podem ter tarefa
 * com o mesmo nome no mesmo dia.
 */
export function escolherAtividadeDaNota(
  linhas: LinhaDeAtividade[],
  dados: DadosDaNotaDeAtividade,
  notaCriadaEm: string
): string | null {
  if (linhas.length === 0) return null;
  const doLead = dados.leadName
    ? linhas.filter(l => (l.lead_name || '').trim() === dados.leadName)
    : [];
  const candidatas = doLead.length > 0 ? doLead : linhas;
  let melhor = candidatas[0];
  let menor = distanciaDaNota(melhor.created_at, notaCriadaEm);
  for (const linha of candidatas.slice(1)) {
    const d = distanciaDaNota(linha.created_at, notaCriadaEm);
    if (d < menor) { melhor = linha; menor = d; }
  }
  return melhor?.id || null;
}

/** Grava o id descoberto na nota. Melhor esforço: a RLS só deixa o autor da nota atualizar. */
async function anotarAtividadeNaNota(noteId: string, activityId: string): Promise<void> {
  try {
    await authClient
      .from('whatsapp_internal_notes')
      .update({ activity_id: activityId })
      .eq('id', noteId);
  } catch (e) {
    console.warn('[whatsappActivityNotes] não consegui guardar o id da atividade na nota:', e);
  }
}

/**
 * Id da atividade que o card representa. Usa a coluna quando existe; senão
 * reconstrói pelo texto e guarda o resultado para as próximas vezes.
 */
export async function resolverAtividadeDaNota(nota: NotaDeAtividade): Promise<string | null> {
  if (nota.activity_id) return nota.activity_id;
  const dados = lerNotaDeAtividade(nota.content);
  if (!dados) return null;
  try {
    await ensureExternalSession();
    const { data, error } = await db
      .from('lead_activities')
      .select('id, created_at, lead_name')
      .eq('title', dados.title)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    const escolhida = escolherAtividadeDaNota((data as LinhaDeAtividade[]) || [], dados, nota.created_at);
    if (escolhida) await anotarAtividadeNaNota(nota.id, escolhida);
    return escolhida;
  } catch (e) {
    console.warn('[whatsappActivityNotes] não consegui achar a atividade da nota:', e);
    return null;
  }
}

/**
 * Caminho inverso: de qual conversa do WhatsApp a atividade nasceu, quando o
 * registro é a nota (e não o vínculo mensagem→atividade).
 */
export async function carregarConversaDaNotaDaAtividade(
  activityId: string
): Promise<{ phone: string; instance_name: string | null } | null> {
  if (!activityId) return null;
  try {
    const { data, error } = await authClient
      .from('whatsapp_internal_notes')
      .select('phone, instance_name')
      .eq('activity_id', activityId)
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw error;
    const linha = (data as { phone: string; instance_name: string | null }[] | null)?.[0];
    return linha?.phone ? { phone: linha.phone, instance_name: linha.instance_name } : null;
  } catch (e) {
    console.warn('[whatsappActivityNotes] não consegui achar a conversa de origem da atividade:', e);
    return null;
  }
}
