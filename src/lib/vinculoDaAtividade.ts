// =============================================================================
// De qual processo é esta atividade?
//
// Quando a atividade nasce de uma mídia da conversa (a intimação em PDF, o
// print do PJe), a IA devolve o número CNJ e as partes que leu no documento.
// Aqui essas pistas viram vínculo de verdade: `process_id`, `case_id` e
// `lead_id` já preenchidos no rascunho, em vez de o assessor procurar a ficha
// na mão logo depois de o robô ter lido o número na tela dele.
//
// DUAS PISTAS, NESTA ORDEM:
//   1. número CNJ  — casa exato em `lead_processes.process_number`. É a pista
//      forte: número é único, não tem homônimo.
//   2. partes      — nome do autor/réu contra `polo_ativo`/`polo_passivo`, e
//      contra o nome do lead. Só entra quando o número não achou nada, e só
//      quando o nome é longo o bastante pra não casar com meio mundo.
//
// O vínculo é SUGESTÃO: vai pro rascunho, que o assessor revisa antes de salvar.
// =============================================================================
import { db, ensureExternalSession } from '@/integrations/supabase';
import { cnjVariantes, onlyDigits } from './cnj';

export interface VinculoSugerido {
  lead_id?: string;
  lead_name?: string;
  case_id?: string;
  case_title?: string;
  process_id?: string;
  process_title?: string;
  workflow_id?: string;
  /** Por qual pista casou — o rascunho mostra isso pro assessor conferir. */
  origem: 'numero' | 'parte';
  /** O valor que casou (o número lido, ou o nome da parte). */
  chave: string;
}

/** Nome curto demais casa com qualquer um: "Ana", "B&Q" viram ruído. */
const MIN_NOME = 6;

/**
 * PostgREST corta o `or=(...)` na vírgula e nos parênteses. Nome de parte vem
 * do documento com pontuação ("B&Q ENERGIA LTDA.", "SILVA, JOÃO"), então o que
 * for separador some antes de virar filtro.
 */
export function termoParaFiltro(nome: string): string {
  return String(nome || '')
    .replace(/[(),*%\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ProcessoRow {
  id: string;
  title: string | null;
  process_number: string | null;
  case_id: string | null;
  lead_id: string | null;
  workflow_id: string | null;
}

const COLUNAS = 'id, title, process_number, case_id, lead_id, workflow_id';

/** Preenche caso e lead a partir do processo achado. */
async function completar(proc: ProcessoRow, origem: VinculoSugerido['origem'], chave: string): Promise<VinculoSugerido> {
  const vinculo: VinculoSugerido = {
    process_id: proc.id,
    process_title: proc.title || proc.process_number || 'Processo',
    case_id: proc.case_id || undefined,
    lead_id: proc.lead_id || undefined,
    workflow_id: proc.workflow_id || undefined,
    origem,
    chave,
  };
  if (proc.case_id) {
    const { data } = await db.from('legal_cases').select('id, title, case_number').eq('id', proc.case_id).maybeSingle();
    const caso = data as { title: string | null; case_number: string | null } | null;
    if (caso) vinculo.case_title = caso.title || caso.case_number || undefined;
  }
  if (proc.lead_id) {
    const { data } = await db.from('leads').select('id, lead_name').eq('id', proc.lead_id).maybeSingle();
    const lead = data as { lead_name: string | null } | null;
    if (lead?.lead_name) vinculo.lead_name = lead.lead_name;
  }
  return vinculo;
}

/** Processo pelo número, aceitando com e sem máscara. */
async function porNumero(numero: string): Promise<VinculoSugerido | null> {
  const variantes = cnjVariantes(numero);
  if (variantes.length === 0) return null;

  const { data, error } = await db
    .from('lead_processes')
    .select(COLUNAS)
    .in('process_number', variantes)
    .is('deleted_at', null)
    .limit(1);
  if (error) throw error;
  const exato = (data as ProcessoRow[] | null)?.[0];
  if (exato) return completar(exato, 'numero', numero);

  // A equipe às vezes digita o número com espaço ou barra no meio, e aí nenhuma
  // das variantes bate. O sequencial (7 primeiros dígitos) é seletivo o
  // bastante pra buscar por semelhança e conferir dígito a dígito aqui.
  const digitos = onlyDigits(numero);
  if (digitos.length !== 20) return null;
  const { data: parecidos, error: erroParecidos } = await db
    .from('lead_processes')
    .select(COLUNAS)
    .ilike('process_number', `%${digitos.slice(0, 7)}%`)
    .is('deleted_at', null)
    .limit(20);
  if (erroParecidos) throw erroParecidos;
  const casou = (parecidos as ProcessoRow[] | null)?.find((p) => onlyDigits(p.process_number) === digitos);
  return casou ? completar(casou, 'numero', numero) : null;
}

/** Processo pelas partes: autor/réu da ficha, ou o nome do lead. */
async function porParte(nomes: string[]): Promise<VinculoSugerido | null> {
  for (const bruto of nomes) {
    const nome = termoParaFiltro(bruto);
    if (nome.length < MIN_NOME) continue;

    const { data, error } = await db
      .from('lead_processes')
      .select(COLUNAS)
      .or(`polo_ativo.ilike.%${nome}%,polo_passivo.ilike.%${nome}%`)
      .is('deleted_at', null)
      .limit(2);
    if (error) throw error;
    const achados = (data as ProcessoRow[] | null) || [];
    // Dois processos com a mesma parte = ambíguo (réu que responde a vários).
    // Nesse caso é melhor não vincular do que vincular no processo errado.
    if (achados.length === 1) return completar(achados[0], 'parte', bruto);
  }

  // Nenhum processo: pelo menos amarra o lead, que já economiza o assessor
  // procurar o cliente na lista.
  for (const bruto of nomes) {
    const nome = termoParaFiltro(bruto);
    if (nome.length < MIN_NOME) continue;
    const { data, error } = await db
      .from('leads')
      .select('id, lead_name')
      .ilike('lead_name', `%${nome}%`)
      .limit(2);
    if (error) throw error;
    const leads = (data as { id: string; lead_name: string | null }[] | null) || [];
    if (leads.length === 1) {
      return { lead_id: leads[0].id, lead_name: leads[0].lead_name || bruto, origem: 'parte', chave: bruto };
    }
  }
  return null;
}

/**
 * Acha o processo/caso/lead a partir do que a IA leu no material.
 * Nunca lança: sem vínculo o rascunho abre igual, só sem os campos preenchidos.
 */
export async function acharVinculoDaAtividade(pistas: {
  processNumber?: string | null;
  partyNames?: string[] | null;
  leadName?: string | null;
}): Promise<VinculoSugerido | null> {
  try {
    await ensureExternalSession();

    const numero = String(pistas.processNumber || '').trim();
    if (numero) {
      const porCnj = await porNumero(numero);
      if (porCnj) return porCnj;
    }

    const nomes = [
      ...(Array.isArray(pistas.partyNames) ? pistas.partyNames : []),
      ...(pistas.leadName ? [pistas.leadName] : []),
    ].map((n) => String(n || '').trim()).filter(Boolean);
    if (nomes.length === 0) return null;
    return await porParte(nomes);
  } catch (e) {
    // O rascunho é o que importa; o vínculo é conveniência.
    console.warn('[vinculoDaAtividade] não consegui sugerir o vínculo:', e);
    return null;
  }
}

/** Frase curta pro toast/selo: "vinculado ao processo pelo número lido no PDF". */
export function descreverVinculo(v: VinculoSugerido): string {
  const alvo = v.process_title
    ? `processo ${v.process_title}`
    : v.lead_name
      ? `lead ${v.lead_name}`
      : 'ficha encontrada';
  return v.origem === 'numero'
    ? `Vinculado ao ${alvo} pelo nº ${v.chave} lido no material.`
    : `Vinculado ao ${alvo} pela parte "${v.chave}".`;
}
