// =============================================================================
// Mensagens selecionadas → rascunho de atividade pronto pra revisar.
//
// Este é o caminho que a caixa de entrada do WhatsApp já usava, agora também
// disponível pra prévia da conversa (a que abre dentro do lead, do contato e da
// própria ficha da atividade). Antes cada tela fazia o seu: a caixa de entrada
// chamava a IA e abria a ficha cheia; a prévia jogava o texto cru num formulário
// em branco. Mesmo botão, dois resultados diferentes.
//
// O que acontece aqui, na ordem:
//   1. junta os tipos de atividade válidos (busca no banco se a tela não tiver)
//   2. manda texto + anexos pro `chat-to-activity`, que lê PDF/áudio/link
//   3. usa o nº de processo e as partes que a IA leu pra achar o vínculo
//   4. devolve o rascunho com processo, caso e lead já preenchidos
//
// Lança quando a IA falha — quem chama cai no formulário em branco, que é o
// comportamento antigo e não deixa ninguém na mão.
// =============================================================================
import { format } from 'date-fns';
import { toast } from 'sonner';
import { db } from '@/integrations/supabase';
import { cloudFunctions as routedFunctions } from '@/lib/functionRouter';
import type { ActivityDraft } from '@/components/activities/ActivityFullSheet';
import type { MidiaDaMensagem } from './midiaDaConversa';
import { acharVinculoDaAtividade, descreverVinculo, type VinculoSugerido } from './vinculoDaAtividade';

export interface PessoaDaEquipe {
  user_id: string;
  full_name: string | null;
}

export interface PedidoDeRascunho {
  /** As mensagens selecionadas, já no formato "[Quem · quando] texto". */
  prefillText?: string;
  /** Anexos e links dessas mensagens — o que a IA vai baixar e ler. */
  midias?: MidiaDaMensagem[];
  /** Lead da conversa aberta, quando há. */
  leadId?: string;
  leadName?: string;
  /** Tipos já carregados na tela; sem eles a lib busca no banco. */
  activityTypes?: { key: string; label: string }[];
  profiles: PessoaDaEquipe[];
  currentUserId?: string | null;
}

export interface RascunhoDaConversa {
  draft: ActivityDraft;
  vinculo: VinculoSugerido | null;
}

/** Há o que mandar pra IA? Texto ou anexo serve; os dois vazios, não. */
export const daPraGerarRascunho = (prefillText?: string, midias?: MidiaDaMensagem[]): boolean =>
  !!(prefillText || '').trim() || (midias || []).length > 0;

/** Ler PDF/áudio/link demora mais que texto — sem aviso, o assessor clica de novo. */
export function avisarLeituraDeAnexos(midias: MidiaDaMensagem[]): void {
  if (midias.length === 0) return;
  toast.info(`Lendo ${midias.length === 1 ? 'o anexo' : `os ${midias.length} anexos`} da conversa…`, { duration: 3000 });
}

export async function gerarRascunhoDaConversa(pedido: PedidoDeRascunho): Promise<RascunhoDaConversa> {
  const { prefillText, leadId, leadName, profiles, currentUserId } = pedido;
  const midias = pedido.midias || [];

  // Tipos ainda não carregados no clique (cache frio) → busca direto; com
  // lista vazia a IA é instruída a deixar o TIPO em branco.
  let typeOptions = pedido.activityTypes || [];
  if (typeOptions.length === 0) {
    const { data } = await db
      .from('activity_types')
      .select('key, label, is_active')
      .order('display_order', { ascending: true });
    typeOptions = ((data as { key: string; label: string; is_active: boolean }[]) || [])
      .filter((t) => t.is_active)
      .map((t) => ({ key: t.key, label: t.label }));
  }
  const memberNames = profiles.map((p) => p.full_name).filter(Boolean) as string[];

  const { data, error } = await routedFunctions.invoke('chat-to-activity', {
    body: { transcript: prefillText, media: midias, activity_types: typeOptions, member_names: memberNames },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Falha ao gerar o rascunho da atividade');

  const f = data.fields || {};

  // Anexo que não deu pra ler não derruba a atividade, mas o assessor tem que
  // saber que ela nasceu sem aquela parte.
  const ignorados = (data.media_read?.ignorados || []) as { url: string; motivo: string }[];
  if (ignorados.length > 0) {
    toast.warning(
      ignorados.length === 1
        ? `Um anexo não pôde ser lido: ${ignorados[0].motivo}.`
        : `${ignorados.length} anexos não puderam ser lidos (o primeiro: ${ignorados[0].motivo}).`,
      { duration: 7000 },
    );
  }

  // Nº do processo e partes lidos no material viram vínculo: o rascunho já abre
  // no processo/caso/lead certos, em vez de o assessor procurar a ficha logo
  // depois de a IA ter lido o número na tela dele.
  const vinculo = await acharVinculoDaAtividade({
    processNumber: f.process_number,
    partyNames: f.party_names,
    leadName: leadId ? null : f.lead_name,
  });
  if (vinculo) toast.success(descreverVinculo(vinculo), { duration: 6000 });

  // Assessor sugerido pela IA (nome exato) vence; sem sugestão, fica com quem
  // está criando. Mesmo critério para o prazo: o citado na conversa vence,
  // senão hoje.
  const suggested = f.assignee_name
    ? profiles.find((p) => (p.full_name || '').trim().toLowerCase() === String(f.assignee_name).trim().toLowerCase())
    : null;
  const me = profiles.find((p) => p.user_id === currentUserId);
  const assignee = suggested || me || null;

  // Achou o processo? Então lead/caso/processo vêm todos dele — misturar o lead
  // da conversa com o processo do documento deixaria o vínculo torto (atividade
  // no lead A apontando pro processo do lead B). Sem processo, a conversa aberta
  // manda: quem clicou está falando com aquele cliente.
  const leadDoVinculo = vinculo?.process_id ? vinculo.lead_id : undefined;
  const origemNotas = [
    prefillText ? `— Origem: conversa do WhatsApp —\n${prefillText}` : '— Origem: anexo da conversa do WhatsApp —',
    vinculo ? descreverVinculo(vinculo) : '',
  ].filter(Boolean).join('\n\n');

  return {
    vinculo,
    draft: {
      title: f.title || '',
      activity_type: f.activity_type || 'tarefa',
      priority: f.priority || 'normal',
      deadline: f.deadline || format(new Date(), 'yyyy-MM-dd'),
      lead_id: leadDoVinculo || leadId || vinculo?.lead_id || undefined,
      lead_name: leadDoVinculo ? (vinculo?.lead_name || leadName) : (leadName || vinculo?.lead_name || f.lead_name || undefined),
      case_id: vinculo?.case_id,
      case_title: vinculo?.case_title,
      process_id: vinculo?.process_id,
      process_title: vinculo?.process_title,
      workflow_id: vinculo?.workflow_id,
      assigned_to: assignee?.user_id || undefined,
      assigned_to_name: assignee?.full_name || undefined,
      what_was_done: f.what_was_done || '',
      current_status_notes: f.current_status || '',
      next_steps: f.next_steps || '',
      notes: [f.notes || '', origemNotas].filter(Boolean).join('\n\n'),
    },
  };
}
