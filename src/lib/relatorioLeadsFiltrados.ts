/**
 * Relatório em TEXTO dos leads que sobraram do filtro do funil (botão na barra
 * de filtros do kanban/lista).
 *
 * De onde vêm os dados — e por quê:
 *   - As linhas saem da view `lead_list_view` pelo MESMO caminho da
 *     visualização em lista (`fetchLeadListRows`), não do array que o kanban
 *     tem em memória. O kanban carrega colunas reduzidas e nem sempre cobre o
 *     que o relatório precisa; a view cobre, e a tradução dos filtros para
 *     PostgREST já existe lá — duplicá-la seria criar duas verdades sobre o
 *     que "filtrado" significa.
 *   - A data da visita vem de `social_visits`, única fonte viva: o campo
 *     `leads.first_visit_at` está zerado em 100% dos leads do Trabalhista.
 *     Só entra visita com status `realizada` — é o que o relatório pede.
 */
import { db, ensureExternalSession } from '@/integrations/supabase';
import { fetchLeadListRows, type LeadListParams, type LeadListRow } from '@/hooks/useLeadListView';
import type { KanbanBoard } from '@/hooks/useKanbanBoards';
import { describeLeadFilters, type LeadFilters } from '@/components/kanban/LeadAdvancedFilters';
import type { ProfileItem } from '@/hooks/useProfilesList';

/** Rótulos de `lead_status` que vencem a etapa do funil (mesmos da lista). */
const STATUS_FIXOS: Record<string, string> = {
  closed: 'Fechado',
  refused: 'Recusado',
  inviavel: 'Inviável',
  cancelled: 'Cancelado',
};

const SEM_DADO = '—';

/** `YYYY-MM-DD` → `DD/MM/YYYY`. Sem Date: data pura não tem fuso a respeitar. */
export function formatarDataSimples(data: string | null | undefined): string {
  if (!data) return SEM_DADO;
  const [y, m, d] = data.slice(0, 10).split('-');
  if (!y || !m || !d) return SEM_DADO;
  return `${d}/${m}/${y}`;
}

/** Cidade e UF como a tela mostra: o que houver, separado por barra. */
export function formatarLocal(cidade: string | null, uf: string | null): string {
  const partes = [cidade, uf].map(v => (v || '').trim()).filter(Boolean);
  return partes.length ? partes.join('/') : SEM_DADO;
}

/**
 * Identificação do lead: `lead_number` é o número oficial da tabela (o mesmo
 * que a lista usa como código). Sem ele, o nº do caso serve de âncora.
 */
export function numeroDoLead(row: Pick<LeadListRow, 'lead_number' | 'case_number'>): string {
  if (row.lead_number != null) return `LEAD ${row.lead_number}`;
  if (row.case_number) return `CASO ${row.case_number}`;
  return '(sem número)';
}

export function etapaDoLead(row: LeadListRow, board: Pick<KanbanBoard, 'stages'>): string {
  if (row.lead_status && STATUS_FIXOS[row.lead_status]) return STATUS_FIXOS[row.lead_status];
  const stage = board.stages?.find(s => s.id === row.status);
  return stage?.name || row.status || SEM_DADO;
}

/** Filtros cujo valor é data pura — no cabeçalho saem em dd/mm/aaaa. */
const FILTROS_DE_DATA = new Set<keyof LeadFilters>([
  'createdFrom', 'createdTo', 'updatedFrom', 'updatedTo', 'accidentDateFrom', 'accidentDateTo',
]);

export interface DescricaoOpts {
  /** Busca do cabeçalho e filtro de acolhedor vivem fora de `LeadFilters`. */
  searchQuery?: string;
  acolhedorFilter?: string;
  profiles?: ProfileItem[];
}

/** Linha "Filtros:" do relatório — o mesmo vocabulário dos chips da barra. */
export function descreverFiltrosDoRelatorio(
  filtros: LeadFilters,
  { searchQuery, acolhedorFilter, profiles = [] }: DescricaoOpts = {},
): string[] {
  const descricao = describeLeadFilters(filtros, profiles).map(c =>
    `${c.label}: ${FILTROS_DE_DATA.has(c.key) ? formatarDataSimples(c.value) : c.value}`,
  );
  if (searchQuery?.trim()) descricao.unshift(`Busca: "${searchQuery.trim()}"`);
  if (acolhedorFilter) descricao.unshift(`Acolhedor: ${acolhedorFilter}`);
  return descricao;
}

export interface RelatorioOpts {
  board: Pick<KanbanBoard, 'name' | 'stages'>;
  rows: LeadListRow[];
  /** lead_id → data da última visita realizada (YYYY-MM-DD). */
  visitasRealizadas: Map<string, string>;
  /** Filtros ativos, já em forma legível (cabeçalho do relatório). */
  filtros: string[];
  /** Injetável para teste; default é o relógio. */
  geradoEm?: Date;
}

/**
 * Monta o texto. Função pura: o que entra aqui já passou por filtro e fetch.
 * Um bloco por lead, na ordem em que a tela lista.
 */
export function montarRelatorioLeads({
  board,
  rows,
  visitasRealizadas,
  filtros,
  geradoEm = new Date(),
}: RelatorioOpts): string {
  // Montado à mão: `toLocaleString('pt-BR')` intercala vírgula entre data e
  // hora, e o formato do carimbo muda conforme o ICU do navegador.
  const dois = (n: number) => String(n).padStart(2, '0');
  const carimbo =
    `${dois(geradoEm.getDate())}/${dois(geradoEm.getMonth() + 1)}/${geradoEm.getFullYear()} ` +
    `${dois(geradoEm.getHours())}:${dois(geradoEm.getMinutes())}`;

  const cabecalho = [
    `RELATÓRIO DE LEADS — ${(board.name || '').toUpperCase()}`,
    `Gerado em ${carimbo} · ${rows.length} ${rows.length === 1 ? 'lead' : 'leads'}`,
    filtros.length ? `Filtros: ${filtros.join(' · ')}` : 'Filtros: nenhum (funil inteiro)',
  ];

  if (rows.length === 0) {
    return `${cabecalho.join('\n')}\n\nNenhum lead corresponde ao filtro atual.`;
  }

  const blocos = rows.map(row => {
    const nome = row.victim_name_trim || row.lead_name || '(sem nome)';
    return [
      `${numeroDoLead(row)} — ${nome}`,
      `  Cidade/UF: ${formatarLocal(row.display_city, row.display_state)}`,
      `  Acidente: ${formatarDataSimples(row.accident_date)}`,
      `  Visita: ${formatarDataSimples(visitasRealizadas.get(row.id))}`,
      `  Etapa: ${etapaDoLead(row, board)}`,
    ].join('\n');
  });

  return [cabecalho.join('\n'), ...blocos].join('\n\n');
}

/**
 * Visitas JÁ REALIZADAS dos leads de um funil, indexadas por lead.
 *
 * O recorte sai do banco por inner join no board (a mesma solução do
 * calendário de visitas): mandar milhares de ids num `.in()` estouraria a URL.
 * Quando um lead tem mais de uma visita realizada, fica a mais recente.
 */
export async function buscarVisitasRealizadas(boardId: string): Promise<Map<string, string>> {
  const { data, error } = await (db as any)
    .from('social_visits')
    .select('lead_id, visit_date, leads!inner(board_id)')
    .eq('leads.board_id', boardId)
    .eq('status', 'realizada')
    .is('deleted_at', null)
    .order('visit_date', { ascending: true });

  if (error) throw error;

  const porLead = new Map<string, string>();
  for (const v of (data || []) as Array<{ lead_id: string; visit_date: string }>) {
    if (v.lead_id && v.visit_date) porLead.set(v.lead_id, v.visit_date);
  }
  return porLead;
}

export interface GerarRelatorioParams {
  params: LeadListParams;
  board: Pick<KanbanBoard, 'id' | 'name' | 'stages'>;
  filtros: LeadFilters;
  /** Busca do cabeçalho e filtro de acolhedor vivem fora de `LeadFilters`. */
  searchQuery?: string;
  acolhedorFilter?: string;
  profiles?: ProfileItem[];
}

export interface RelatorioGerado {
  texto: string;
  total: number;
}

/** Busca as linhas filtradas + visitas e devolve o texto pronto. */
export async function gerarRelatorioLeadsFiltrados({
  params,
  board,
  filtros,
  searchQuery,
  acolhedorFilter,
  profiles = [],
}: GerarRelatorioParams): Promise<RelatorioGerado> {
  try {
    await ensureExternalSession();
  } catch {
    /* sessão anônima é best-effort; a leitura da view é aberta */
  }

  const [rows, visitasRealizadas] = await Promise.all([
    fetchLeadListRows(params),
    buscarVisitasRealizadas(board.id),
  ]);

  const descricao = descreverFiltrosDoRelatorio(filtros, { searchQuery, acolhedorFilter, profiles });

  return {
    texto: montarRelatorioLeads({ board, rows, visitasRealizadas, filtros: descricao }),
    total: rows.length,
  };
}
