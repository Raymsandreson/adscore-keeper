// =============================================================================
// Agenda de eventos (audiência, perícia, prazo) — regras puras.
//
// Pedido do escritório (ago/2026): ver hoje o que acontece AMANHÃ, separado por
// tipo de evento, "para saber as prioridades". Medição no Externo em 17/08/2026,
// que é o que define de onde cada aba lê:
//
//  - Audiência e perícia moram na MESMA tabela, `hearings` (555 linhas, 70
//    futuras), separadas por `hearing_type`: 73 são perícia ("Perícia Médica",
//    "Pericia", "Perícia Judicial") e o resto é audiência (Instrução, Inicial,
//    UNA, Conciliação...). O campo `lead_processes.pericia_medica_at`, criado em
//    13/08, tem 1 linha no banco inteiro — não serve de fonte.
//  - Prazo é atividade do TIPO "Prazo". Não é "toda atividade com deadline
//    amanhã": em 18/08/2026 seriam 274 linhas contra 8 do tipo Prazo. Uma tela
//    de prioridade com 274 linhas não é uma tela de prioridade.
//  - `hearings` guarda hora (69 das 70 futuras); `deadline` de atividade é DATE
//    e não tem hora. Por isso prazo aparece sem horário — não é bug de tela.
//
// O casamento de tipo de atividade tem que aceitar DUAS famílias de chave: as
// seeds hardcoded no código ('prazo', 'audiencia') e as `custom_*` da tabela
// `activity_types`. Em 17/08/2026, 7.452 das 8.705 pendentes (85,6%) usavam uma
// chave sem linha em `activity_types` — casar só pela tabela perderia a maioria.
// Mesmo remédio que `isMeetingType` já usa: chave seed OU rótulo normalizado.
// =============================================================================

export type CategoriaEvento = 'audiencia' | 'pericia' | 'prazo' | 'outros';

export const CATEGORIAS: CategoriaEvento[] = ['audiencia', 'pericia', 'prazo', 'outros'];

export const CATEGORIA_LABEL: Record<CategoriaEvento, string> = {
  audiencia: 'Audiências',
  pericia: 'Perícias',
  prazo: 'Prazos',
  outros: 'Outros',
};

function normalizar(texto?: string | null): string {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Em que aba uma linha de `hearings` cai.
 *
 * Perícia é reconhecida pelo radical ("Perícia Médica", "Pericia", "Perícia
 * Judicial" — as três grafias existem no banco), o que já cobre os tipos que a
 * atividade passou a gravar em 19/08/2026 ("Perícia Médica (INSS)").
 *
 * "Avaliação Social" precisa de regra própria: é a perícia social do BPC, não
 * tem o radical, e sem esta linha cairia em Outros — a aba onde ninguém procura
 * uma convocação de cliente.
 *
 * Sem tipo, ou tipo "Outro", vai para Outros. Todo o resto é audiência:
 * Instrução, Inicial, UNA, Conciliação, Encerramento de Instrução, Homologação,
 * Julgamento.
 */
export function categoriaDaAudiencia(hearingType?: string | null): CategoriaEvento {
  const t = normalizar(hearingType);
  if (!t) return 'outros';
  if (t.includes('peric') || t.includes('avaliacao social')) return 'pericia';
  if (t === 'outro' || t === 'outros') return 'outros';
  return 'audiencia';
}

/**
 * A atividade vira uma LINHA própria de evento? Só se for do tipo "Prazo".
 *
 * Atividade de tipo "Audiência"/"Perícia" NÃO entra como linha, e isso foi
 * medido, não suposto. Rodando a agenda de 18/08/2026 contra o banco, incluí-las
 * dava dois defeitos ao mesmo tempo:
 *
 *  1. Duplicata: as 3 audiências do dia viravam 7 linhas. `HearingActivityDialog`
 *     cria uma atividade a partir da audiência, então o mesmo evento aparecia
 *     uma vez pela `hearings` (com hora) e outra pela atividade (sem hora).
 *  2. Data errada: a atividade "Perícia Médica Judicial - 23/09" tem deadline
 *     18/08 e entrava como evento de 18/08. O `deadline` de uma atividade de
 *     audiência é quando PREPARAR, não quando o evento acontece — a data real do
 *     evento só existe no título, em texto.
 *
 * Com prazo é diferente: o `deadline` É a data do prazo. Por isso ele é a única
 * categoria que a atividade pode originar. Audiência e perícia saem só de
 * `hearings`, e a atividade correspondente aparece na coluna "Atividade".
 *
 * O casamento é por igualdade do rótulo normalizado, nunca por "contém": a
 * tabela `activity_types` tem tipo que é frase inteira ("atividade para se
 * manifestar no processo com prazo aberto, as vezes ir atrás de algum
 * documento", 25 atividades), fruto de alguém ter digitado a descrição no campo
 * do nome. Substring jogaria essas atividades na aba de prazo como se fossem
 * prazo de verdade.
 */
export function ehAtividadeDePrazo(key?: string | null, label?: string | null): boolean {
  // Chave seed hardcoded no código, que nunca ganhou linha em activity_types.
  if (normalizar(key) === 'prazo') return true;
  return normalizar(label) === 'prazo';
}

/** Dia seguinte de 'YYYY-MM-DD', sem passar por fuso (a data é literal). */
export function diaSeguinte(dia: string): string {
  const [y, m, d] = dia.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

/** Dia anterior de 'YYYY-MM-DD'. Usado só pela navegação da tela. */
export function diaAnterior(dia: string): string {
  const [y, m, d] = dia.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. Em UTC, para a data literal não escorregar de fuso. */
export function diaDaSemana(dia: string): number {
  const [y, m, d] = dia.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function ehFimDeSemana(dia: string): boolean {
  const dow = diaDaSemana(dia);
  return dow === 0 || dow === 6;
}

/**
 * Os dias que a véspera prepara: de D+1 até o próximo dia ÚTIL, inclusive.
 *
 * Na segunda a quinta é um dia só. Na sexta são três — sábado, domingo e
 * segunda: quem prepara na sexta precisa ver a segunda, senão a segunda nunca
 * tem véspera.
 *
 * Os dias pulados entram na janela em vez de serem saltados. Parece detalhe, mas
 * não é: audiência não cai em fim de semana (0 das 555 no banco em 17/08/2026),
 * só que PRAZO cai — 3 dos 81 prazos vivos vencem num sábado ou domingo. Pular
 * o fim de semana faria esses três nunca aparecerem em tela nenhuma.
 *
 * FERIADO NÃO É CONSIDERADO, pela mesma razão já documentada em `popPrazo.ts`:
 * não existe tabela de feriado forense neste sistema, e ela varia por tribunal e
 * por ano. Véspera de feriado vai mostrar o feriado, que costuma vir vazio.
 */
export function janelaDaVespera(vespera: string): string[] {
  const dias: string[] = [];
  let cursor = diaSeguinte(vespera);
  // Teto de 7 para nunca girar sem parar, mesmo com entrada estranha.
  for (let i = 0; i < 7; i++) {
    dias.push(cursor);
    if (!ehFimDeSemana(cursor)) break;
    cursor = diaSeguinte(cursor);
  }
  return dias;
}

/** 'HH:MM:SS' → 'HH:MM'. Null vira null (prazo não tem hora). */
export function horaCurta(hora?: string | null): string | null {
  const h = (hora || '').slice(0, 5);
  return /^\d{2}:\d{2}$/.test(h) ? h : null;
}

export interface AudienciaLite {
  id: string;
  hearing_date: string;
  hearing_time: string | null;
  hearing_type: string | null;
  status: string | null;
  process_number: string | null;
  lead_id: string | null;
  location: string | null;
}

export interface AtividadeLite {
  id: string;
  title: string | null;
  activity_type: string | null;
  deadline: string | null;
  priority: string | null;
  status: string | null;
  lead_id: string | null;
  lead_name: string | null;
  process_id: string | null;
  process_title: string | null;
  assigned_to_name: string | null;
}

/** O que a tela resolve por fora: número do processo → processo/cliente. */
export interface ProcessoResolvido {
  process_id: string | null;
  process_number: string | null;
  lead_id: string | null;
  lead_name: string | null;
}

export interface EventoAgenda {
  /** Único na lista inteira (prefixado pela origem, ids podem colidir). */
  chave: string;
  categoria: CategoriaEvento;
  origem: 'audiencia' | 'atividade';
  processo: string | null;
  cliente: string | null;
  /** Rótulo do evento: "Instrução", "Perícia Médica", "Prazo". */
  evento: string;
  dataEvento: string;
  horaEvento: string | null;
  /** Só preenchido quando a audiência não está 'ativa' (adiada/cancelada). */
  situacao: string | null;
  local: string | null;
  /** Atividade ligada ao evento; para prazo, é a própria atividade. */
  atividadeId: string | null;
  atividade: string | null;
  prioridade: string | null;
  responsavel: string | null;
}

/**
 * Escolhe qual atividade do processo representa o evento.
 *
 * `hearings` não tem FK para `lead_activities` — o vínculo é por processo. Entre
 * as pendentes do mesmo processo, fica a de prazo mais perto da data do evento;
 * empate resolve pela mais antiga, para a escolha ser estável entre renders.
 * Sem pendente no processo, a coluna Atividade fica vazia em vez de mentir.
 */
export function atividadeMaisProxima(
  candidatas: AtividadeLite[],
  dataEvento: string,
): AtividadeLite | null {
  const vivas = candidatas.filter(a => a.status !== 'concluida');
  if (vivas.length === 0) return null;
  const alvo = Date.parse(`${dataEvento}T00:00:00Z`);
  let melhor: AtividadeLite | null = null;
  let melhorDist = Number.POSITIVE_INFINITY;
  for (const a of vivas) {
    const dl = (a.deadline || '').slice(0, 10);
    const dist = dl ? Math.abs(Date.parse(`${dl}T00:00:00Z`) - alvo) : Number.MAX_SAFE_INTEGER;
    if (dist < melhorDist) { melhorDist = dist; melhor = a; }
  }
  return melhor;
}

/**
 * Monta as linhas da agenda da janela, ordenadas por dia e hora.
 *
 * Recebe tudo pronto — quem busca no banco é o hook. Assim a regra de quem entra
 * em qual aba fica testável sem rede.
 */
export function montarEventosDaJanela(params: {
  /** Os dias que a véspera prepara (ver `janelaDaVespera`). */
  dias: string[];
  audiencias: AudienciaLite[];
  /** Já filtradas pelos dias: as de tipo Prazo entram como linha própria. */
  atividades: AtividadeLite[];
  /** key do activity_type → label cadastrado (quando existe). */
  rotuloDoTipo: Map<string, string>;
  /** process_number normalizado → processo/cliente. */
  processoPorNumero: Map<string, ProcessoResolvido>;
  /** process_id → atividades vivas daquele processo (para a coluna Atividade). */
  atividadesPorProcesso: Map<string, AtividadeLite[]>;
}): EventoAgenda[] {
  const { dias, audiencias, atividades, rotuloDoTipo, processoPorNumero, atividadesPorProcesso } = params;
  const naJanela = new Set(dias);
  const linhas: EventoAgenda[] = [];

  for (const h of audiencias) {
    const dia = h.hearing_date.slice(0, 10);
    if (!naJanela.has(dia)) continue;
    const proc = h.process_number ? processoPorNumero.get(h.process_number.trim()) || null : null;
    const ligada = proc?.process_id
      ? atividadeMaisProxima(atividadesPorProcesso.get(proc.process_id) || [], dia)
      : null;
    const status = normalizar(h.status);
    linhas.push({
      chave: `audiencia:${h.id}`,
      categoria: categoriaDaAudiencia(h.hearing_type),
      origem: 'audiencia',
      processo: h.process_number || proc?.process_number || null,
      cliente: proc?.lead_name || null,
      evento: h.hearing_type || 'Audiência',
      dataEvento: h.hearing_date.slice(0, 10),
      horaEvento: horaCurta(h.hearing_time),
      situacao: status && status !== 'ativa' ? h.status : null,
      local: h.location || null,
      atividadeId: ligada?.id || null,
      atividade: ligada?.title || null,
      prioridade: ligada?.priority || null,
      responsavel: ligada?.assigned_to_name || null,
    });
  }

  for (const a of atividades) {
    if (!ehAtividadeDePrazo(a.activity_type, a.activity_type ? rotuloDoTipo.get(a.activity_type) : null)) continue;
    const dia = (a.deadline || '').slice(0, 10);
    if (!naJanela.has(dia)) continue;
    linhas.push({
      chave: `atividade:${a.id}`,
      categoria: 'prazo',
      origem: 'atividade',
      processo: a.process_title || null,
      cliente: a.lead_name || null,
      evento: 'Prazo',
      dataEvento: dia,
      horaEvento: null, // deadline é DATE: não existe hora para mostrar
      situacao: null,
      local: null,
      atividadeId: a.id,
      atividade: a.title || null,
      prioridade: a.priority || null,
      responsavel: a.assigned_to_name || null,
    });
  }

  // Dia primeiro (a janela pode ter três), hora depois, sem-hora no fim do dia.
  return linhas.sort((x, y) => {
    if (x.dataEvento !== y.dataEvento) return x.dataEvento.localeCompare(y.dataEvento);
    if (x.horaEvento && y.horaEvento) return x.horaEvento.localeCompare(y.horaEvento);
    if (x.horaEvento) return -1;
    if (y.horaEvento) return 1;
    return (x.cliente || '').localeCompare(y.cliente || '');
  });
}

/** Quantas linhas em cada aba, para o contador ao lado do nome. */
export function contarPorCategoria(eventos: EventoAgenda[]): Record<CategoriaEvento, number> {
  const out: Record<CategoriaEvento, number> = { audiencia: 0, pericia: 0, prazo: 0, outros: 0 };
  for (const e of eventos) out[e.categoria] += 1;
  return out;
}
