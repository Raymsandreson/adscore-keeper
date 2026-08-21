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

import {
  formatCasoSequencia,
  parseCasoSequencia,
  type CasoSequencia,
  type FamiliaCaso,
} from '@/lib/casoSequencia';

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
  /** "CASO 348", "PREV 203" — 54 das 74 futuras têm (19/08/2026). */
  case_ref: string | null;
  /** trabalhista | previdenciario | civel | outro — 74 de 74 têm. */
  category: string | null;
  /** Só 6 das 74 têm: o responsável real vem das atividades do processo. */
  assigned_user_id: string | null;
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
  /** 71% das atividades têm caso mesmo sem processo — é o que salva a coluna. */
  case_id: string | null;
  case_title: string | null;
  /** UUID do Externo. O filtro de assessor da página guarda UUID do Cloud. */
  assigned_to: string | null;
  /** Co-responsáveis: a atividade pode ser de mais de uma pessoa. */
  assigned_to_ids: string[] | null;
  assigned_to_names: string[] | null;
  /** Desempate estável quando duas atividades ficam à mesma distância. */
  created_at: string | null;
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
  /** Nome como está no banco — vai no title, para o parse nunca esconder dado. */
  clienteBruto: string | null;
  /** "PREV 704", "CASO 341": como a equipe chama o caso na conversa. */
  casoBadge: string | null;
  /** Família da sequência, para o filtro Caso/Prev. */
  familia: FamiliaCaso | null;
  /** `hearings.category` (trabalhista, previdenciario, civel, outro). */
  area: string | null;
  /** Ids (Externo) de quem responde pelo evento — alimenta o filtro Assessor. */
  responsaveisIds: string[];
  responsaveisNomes: string[];
  /** Sem ninguém: a linha continua visível sob filtro, marcada na tela. */
  semResponsavel: boolean;
  caseId: string | null;
  leadId: string | null;
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
 * O nome do cliente dentro do nome do grupo.
 *
 * `lead_name` guarda o nome do GRUPO de WhatsApp, não o do cliente: "✅PREV 704
 * | ADRIANA CARVALHO", "✅ Caso 341 Walter x Construtora", "FAMÍLIA 249 -
 * Maicon". Com a coluna Processo vazia em 5 dos 8 prazos de 20/08/2026, era só
 * isso que a pessoa tinha para saber de quem era a linha — e vinha coberto de
 * emoji e prefixo.
 *
 * O corte é conservador e reversível: tira o selo, o prefixo de sequência e o
 * separador, e para no primeiro "|". Se sobrar menos que duas letras, devolve o
 * texto original em vez de entregar um pedaço sem sentido. A tela mostra o bruto
 * no `title`, então um corte errado nunca esconde a informação.
 */
export function nomeDoCliente(bruto?: string | null): string | null {
  const cru = (bruto || '').trim();
  if (!cru) return null;
  let t = cru
    // Selos e emojis do começo (✅, ⚠️, ✔️ e afins) mais espaços.
    .replace(/^[^\p{L}\p{N}]+/u, '')
    // "PREV 704", "CASO-897", "FAMÍLIA 249", "LEAD 12" no início.
    .replace(/^(PREV|CASO|LEAD|SM|DG|FAM[IÍ]LIA)\s*[-–:]?\s*\d{1,5}\s*/iu, '')
    // Separador que sobrou entre o código e o nome.
    .replace(/^[\s|\-–:/]+/u, '')
    .trim();
  // O nome do cliente é o primeiro segmento; o resto do título do grupo costuma
  // trazer comarca, parte contrária e datas.
  const [primeiro] = t.split('|');
  t = (primeiro || '').trim();
  const letras = t.replace(/[^\p{L}]/gu, '');
  return letras.length >= 2 ? t : cru;
}

/**
 * A sequência do caso, procurada em cascata pelas fontes que existem.
 *
 * Medido nas 338 atividades vivas de 20/08/2026: só `case_title` classifica 67%;
 * caindo para `lead_name` e depois para o título, chega a 89% (PREV 209, CASO
 * 92, LEAD 2, 35 sem). Por isso a cascata, e não uma fonte só.
 *
 * Uma fonte que devolve "NUM" (número solto, sem prefixo) não encerra a busca:
 * ela fica guardada e as próximas ainda podem dizer que aquilo é PREV ou CASO.
 * Sem isso, "FAMÍLIA 249 - Maicon" viraria "nº 249" mesmo com o `case_title`
 * dizendo "CASO 249".
 */
export function sequenciaDoEvento(...fontes: (string | null | undefined)[]): CasoSequencia | null {
  let fallback: CasoSequencia | null = null;
  for (const fonte of fontes) {
    const seq = parseCasoSequencia(fonte);
    if (!seq) continue;
    if (seq.familia !== 'NUM') return seq;
    fallback = fallback || seq;
  }
  return fallback;
}

/** O que a equipe usa para reconhecer a linha: "PREV 704", "CASO 341". */
export function badgeDoCaso(seq: CasoSequencia | null): string | null {
  const texto = formatCasoSequencia(seq);
  return texto || null;
}

export interface FiltrosDeEvento {
  /** Ids do Externo. Vazio = todos. */
  assessores?: string[];
  /** Famílias de sequência ("PREV", "CASO"...). Vazio = todas. */
  familias?: FamiliaCaso[];
  /** `hearings.category`. Vazio = todas. Só filtra linha que tem área. */
  areas?: string[];
  leadIds?: string[];
  caseIds?: string[];
  /** Busca livre sobre processo, cliente, evento, atividade e badge. */
  busca?: string;
}

export function filtrosAtivos(f: FiltrosDeEvento): boolean {
  return Boolean(
    f.assessores?.length || f.familias?.length || f.areas?.length ||
    f.leadIds?.length || f.caseIds?.length || (f.busca || '').trim(),
  );
}

/**
 * Aplica os filtros da página às linhas da agenda.
 *
 * Uma regra foge do literal, de propósito: **evento sem responsável nenhum
 * continua aparecendo** mesmo com filtro de assessor ligado. Em 19/08/2026,
 * `hearings.assigned_user_id` estava preenchido em 6 das 74 audiências futuras —
 * o dono real vem das atividades do processo, e audiência sem atividade nenhuma
 * não tem dono em lugar algum. Sumir com ela enquanto qualquer assessor está
 * selecionado esconderia de TODA a equipe justamente o evento órfão de amanhã,
 * que é o que ninguém pode perder. A tela marca essas linhas com um selo.
 *
 * Área só filtra linha que tem área: `category` é 100% em `hearings` e não
 * existe em atividade, então filtrar por área nunca deve varrer os prazos.
 */
export function aplicarFiltrosDeEvento(
  eventos: EventoAgenda[],
  filtros: FiltrosDeEvento,
): EventoAgenda[] {
  const { assessores, familias, areas, leadIds, caseIds } = filtros;
  const busca = normalizar(filtros.busca);
  return eventos.filter(e => {
    if (assessores?.length) {
      const meu = e.responsaveisIds.some(id => assessores.includes(id));
      if (!meu && !e.semResponsavel) return false;
    }
    if (familias?.length && (!e.familia || !familias.includes(e.familia))) return false;
    if (areas?.length && e.area && !areas.includes(e.area)) return false;
    if (leadIds?.length && (!e.leadId || !leadIds.includes(e.leadId))) return false;
    if (caseIds?.length && (!e.caseId || !caseIds.includes(e.caseId))) return false;
    if (busca) {
      const alvo = normalizar(
        [e.processo, e.cliente, e.clienteBruto, e.casoBadge, e.evento, e.atividade,
         e.local, ...e.responsaveisNomes].filter(Boolean).join(' '),
      );
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/**
 * Todos os dias entre duas datas, inclusive — o modo "período" do seletor.
 *
 * Teto de 92 dias (um trimestre) para uma digitação errada no campo de data não
 * virar uma varredura de anos. Fora de ordem, as pontas são trocadas.
 */
export function diasDoIntervalo(de: string, ate: string, maxDias = 92): string[] {
  const a = de.slice(0, 10);
  const b = ate.slice(0, 10);
  const [inicio, fim] = a <= b ? [a, b] : [b, a];
  const dias: string[] = [];
  let cursor = inicio;
  for (let i = 0; i < maxDias; i++) {
    dias.push(cursor);
    if (cursor >= fim) break;
    cursor = diaSeguinte(cursor);
  }
  return dias;
}

/**
 * Escolhe qual atividade do processo representa o evento.
 *
 * `hearings` não tem FK para `lead_activities` — o vínculo é por processo. Entre
 * as pendentes do mesmo processo, fica a de prazo mais perto da data do evento;
 * empate resolve pela mais antiga, para a escolha ser estável entre renders.
 * Sem pendente no processo, a coluna Atividade fica vazia em vez de mentir.
 *
 * O DESEMPATE É EXPLÍCITO desde 19/08/2026. Até então ficava a primeira do array
 * com a menor distância — e o array vem do PostgREST **sem ORDER BY**, cuja
 * ordem não é garantida. Com duas atividades no mesmo dia (o normal num processo
 * com audiência marcada) a coluna Atividade podia apontar para uma num
 * carregamento e para outra no seguinte, sem nada ter mudado no banco.
 */
export function atividadeMaisProxima(
  candidatas: AtividadeLite[],
  dataEvento: string,
): AtividadeLite | null {
  const vivas = candidatas.filter(a => a.status !== 'concluida');
  if (vivas.length === 0) return null;
  const alvo = Date.parse(`${dataEvento}T00:00:00Z`);
  const distancia = (a: AtividadeLite) => {
    const dl = (a.deadline || '').slice(0, 10);
    return dl ? Math.abs(Date.parse(`${dl}T00:00:00Z`) - alvo) : Number.MAX_SAFE_INTEGER;
  };
  let melhor: AtividadeLite | null = null;
  for (const a of vivas) {
    if (!melhor) { melhor = a; continue; }
    const d = distancia(a), dMelhor = distancia(melhor);
    if (d < dMelhor) { melhor = a; continue; }
    if (d > dMelhor) continue;
    // Empate: a mais antiga. `created_at` pode faltar (coluna nova no tipo), daí
    // o id como último critério — qualquer um serve, desde que seja o mesmo
    // sempre.
    const chave = (x: AtividadeLite) => `${x.created_at || '9999'}|${x.id}`;
    if (chave(a) < chave(melhor)) melhor = a;
  }
  return melhor;
}

/**
 * Quem responde pelo evento: o titular e os co-responsáveis de cada atividade.
 *
 * `assigned_to_ids`/`assigned_to_names` são as colunas de co-responsável — uma
 * atividade pode ser de mais de uma pessoa, e filtrar só pelo titular deixaria o
 * co-responsável sem ver o próprio evento.
 */
export function responsaveisDe(
  atividades: AtividadeLite[],
  assignedUserId?: string | null,
): { ids: string[]; nomes: string[] } {
  const ids = new Set<string>();
  const nomes = new Set<string>();
  if (assignedUserId) ids.add(assignedUserId);
  for (const a of atividades) {
    if (a.assigned_to) ids.add(a.assigned_to);
    (a.assigned_to_ids || []).forEach(id => id && ids.add(id));
    if (a.assigned_to_name) nomes.add(a.assigned_to_name);
    (a.assigned_to_names || []).forEach(n => n && nomes.add(n));
  }
  return { ids: [...ids], nomes: [...nomes] };
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
  /** lead_id → nome, para a audiência/perícia que traz o cliente e não o processo. */
  nomePorLead?: Map<string, string | null>;
}): EventoAgenda[] {
  const { dias, audiencias, atividades, rotuloDoTipo, processoPorNumero, atividadesPorProcesso } = params;
  const nomePorLead = params.nomePorLead || new Map<string, string | null>();
  const naJanela = new Set(dias);
  const linhas: EventoAgenda[] = [];

  for (const h of audiencias) {
    const dia = h.hearing_date.slice(0, 10);
    if (!naJanela.has(dia)) continue;
    const proc = h.process_number ? processoPorNumero.get(h.process_number.trim()) || null : null;
    const doProcesso = proc?.process_id ? atividadesPorProcesso.get(proc.process_id) || [] : [];
    const ligada = atividadeMaisProxima(doProcesso, dia);
    const status = normalizar(h.status);
    // O responsável do evento é QUEM TEM ATIVIDADE VIVA NO PROCESSO, todas elas —
    // não só a atividade que aparece na coluna. Em 19/08/2026 as 3 audiências do
    // dia seguinte tinham 4, 1 e 2 atividades vivas com donos diferentes; casar
    // só pela "mais próxima" faria a audiência sumir para o outro dono.
    const resp = responsaveisDe(doProcesso, h.assigned_user_id);
    // Cliente: pelo processo primeiro (é assim que a planilha resolve), pelo
    // `lead_id` da própria linha depois — a perícia marcada no chip da atividade
    // pode ter só o cliente, sem processo nem número.
    const nomeDoLead = proc?.lead_name || (h.lead_id ? nomePorLead.get(h.lead_id) ?? null : null);
    const seq = sequenciaDoEvento(h.case_ref, nomeDoLead, ligada?.case_title);
    linhas.push({
      chave: `audiencia:${h.id}`,
      categoria: categoriaDaAudiencia(h.hearing_type),
      origem: 'audiencia',
      processo: h.process_number || proc?.process_number || null,
      // Sem lead resolvido a coluna fica vazia de propósito: repetir aqui o
      // `case_ref` que já é o badge só encheria a linha de "CASO 347 | CASO 347".
      cliente: nomeDoCliente(nomeDoLead),
      clienteBruto: nomeDoLead || null,
      casoBadge: badgeDoCaso(seq) || (h.case_ref ? h.case_ref.trim() : null),
      familia: seq?.familia ?? null,
      area: h.category || null,
      responsaveisIds: resp.ids,
      responsaveisNomes: resp.nomes,
      semResponsavel: resp.ids.length === 0,
      caseId: ligada?.case_id || null,
      leadId: proc?.lead_id || h.lead_id || null,
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
    const seq = sequenciaDoEvento(a.case_title, a.lead_name, a.process_title, a.title);
    const resp = responsaveisDe([a], null);
    linhas.push({
      chave: `atividade:${a.id}`,
      categoria: 'prazo',
      origem: 'atividade',
      // Degradê de identificação: 55% das atividades têm processo, 71% têm caso
      // e 86% têm lead (medido em 20/08/2026). Sem o degradê a coluna Processo
      // vinha vazia em 5 dos 8 prazos do dia.
      processo: a.process_title || a.case_title || null,
      cliente: nomeDoCliente(a.lead_name),
      clienteBruto: a.lead_name || null,
      casoBadge: badgeDoCaso(seq),
      familia: seq?.familia ?? null,
      area: null,
      responsaveisIds: resp.ids,
      responsaveisNomes: resp.nomes,
      semResponsavel: resp.ids.length === 0,
      caseId: a.case_id || null,
      leadId: a.lead_id || null,
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
