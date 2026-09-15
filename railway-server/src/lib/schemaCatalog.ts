/**
 * schemaCatalog — o mapa do banco que o analista de relatórios recebe no prompt.
 *
 * POR QUE ESTE ARQUIVO EXISTE (09/09/2026): o catálogo era escrito à mão dentro
 * do report-query e envelheceu. `inss_admin_processes.resultado` (498 registros
 * preenchidos) nunca entrou na lista, e o prompt manda "nunca invente coluna,
 * use só as listadas". Resultado: a IA respondeu à diretoria que "o requerimento
 * não tem campo de resultado" — obedecendo o mapa, não alucinando. Trocar de
 * modelo não conserta isso; parar de manter o mapa à mão, sim.
 *
 * Agora as COLUNAS vêm do banco a cada refresh e só a CURADORIA fica aqui:
 * o que cada tabela significa, o vocabulário real dos status e os joins que já
 * foram testados — isso o schema não conta.
 *
 * Fonte das colunas: o documento OpenAPI que o PostgREST publica em
 * `GET /rest/v1/` (aceita SOMENTE a service_role, que o server já tem em
 * EXTERNAL_SUPABASE_SERVICE_ROLE_KEY). Sem migration, sem RPC nova, sem env nova.
 *
 * Falhou a leitura? O catálogo sai em modo DEGRADADO: mantém as tabelas e a
 * curadoria, tira a lista de colunas e troca a regra "só use as colunas abaixo"
 * por "não afirme que um campo não existe — teste". Nunca cai num segundo
 * catálogo escrito à mão, porque esse envelheceria igual ao primeiro.
 *
 * Custo: 1 GET + N HEAD de contagem por refresh (1x/hora por processo). No
 * prompt, as 462 colunas medidas em 09/09/2026 dão ~10k caracteres; com a
 * curadoria o catálogo fica em ~5k tokens contra os ~4k do antigo — e vai
 * cacheado (cache_system), então os passos 2..4 da mesma pergunta custam ~10%.
 */
import { supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './supabase';

/** Quanto tempo o catálogo montado vale antes de reler o banco. */
const TTL_MS = Number(process.env.REPORT_SCHEMA_TTL_MS || 60 * 60 * 1000);
const FETCH_TIMEOUT_MS = Number(process.env.REPORT_SCHEMA_TIMEOUT_MS || 10_000);

/**
 * Coluna que guarda credencial (case_process_tracking.senha_gov é a que existe
 * hoje). Fica FORA do catálogo: a IA não tem por que consultar senha de gov.br,
 * e o mascaramento do report-query só protege o valor depois de já ter saído do
 * banco. Esconder isto não repete o bug do catálogo velho — a IA não vai
 * "deixar de responder" uma pergunta de negócio por não ver uma senha.
 */
const COLUNA_SECRETA = /(^|_)(senha|password|secret|token|api_key|apikey)($|_)/i;

interface TabelaExposta {
  nome: string;
  /** O que a tabela é, em uma linha — vira o texto depois do travessão. */
  titulo: string;
  /** Curadoria livre (vocabulário, armadilhas, o que NÃO usar). Já indentada. */
  notas?: string;
}

/**
 * As tabelas que o analista pode ver. Tudo que não está aqui fica invisível pra
 * ele — auth, vault, whatsapp_messages, filas internas. Tabela nova de negócio
 * só entra no relatório depois de ganhar uma linha aqui (o /health conta quantas
 * tabelas do banco estão fora desta lista, pra ninguém esquecer).
 */
const TABELAS: TabelaExposta[] = [
  {
    nome: 'leads',
    titulo: 'leads do CRM / clientes captados',
    notas: `  IMPORTANTE: o responsável processual do escritório fica AQUI, no lead (processual_responsible_id),
  e é herdado pelos processos e casos daquele lead (via lead_id). Sempre junte por profiles.user_id.
  FUNIL/PIPELINE: "funil X" ou "pipeline X" = leads cujo board_id aponta pra um kanban_boards
    com aquele nome. Ex.: "funil BPC" = leads JOIN kanban_boards b ON b.id=l.board_id WHERE b.name ILIKE '%bpc%'.
  lead_status (VOCABULÁRIO REAL, em inglês — use estes valores exatos, não invente):
    'closed' = FECHADO (o que o usuário chama de "fechado"/"ganho"/"cliente fechado");
    'no_response' = sem resposta;  'refused' = recusou;  'inviavel' = inviável;
    'cancelled' = cancelado;  'in_progress' = em andamento.
    Para "fechados" use l.lead_status = 'closed'.
  status (texto) = a COLUNA atual do lead dentro do funil/kanban (nomes gerados, ex.:
    'procuracao_assinada', 'prospecção_e_triagem_...'). NÃO é o mesmo que lead_status. Para "fechado"
    prefira lead_status='closed'; para etapa específica do funil, filtre status ILIKE '%termo%'.
  became_client_date = data em que virou cliente (preenchida quando fechou contrato).`,
  },
  {
    nome: 'lead_activities',
    titulo: 'ATIVIDADES/tarefas',
    notas: `  Responsável = assigned_to_name (ou algum de assigned_to_names, que é text[]).
  "atrasada" = completed_at IS NULL AND deadline < CURRENT_DATE.`,
  },
  {
    nome: 'legal_cases',
    titulo: 'CASOS jurídicos',
    notas: `  RESPONSÁVEL: assigned_to está quase sempre vazio; use o responsável do LEAD
  (legal_cases.lead_id → leads.processual_responsible_id → profiles.user_id).
  outcome = resultado do caso. Antes de dizer que "ninguém preenche", MEÇA quantos estão nulos.`,
  },
  {
    nome: 'lead_processes',
    titulo: 'PROCESSOS judiciais vinculados a lead',
    notas: `  RESPONSÁVEL: NÃO use responsible_user_id (quase sempre nulo). O responsável vem do LEAD:
  junte lead_processes.lead_id → leads.id → leads.processual_responsible_id → profiles.user_id.
  RESULTADO do processo: família resultado_atingido* (tipo, data, fonte, status).
  protocolo_administrativo (jsonb) guarda o vínculo com o requerimento no INSS.
  Colunas de payload bruto (escavador_raw, envolvidos, movimentacoes, audiencias,
  processos_relacionados, informacoes_complementares) são jsonb grandes: não faça SELECT delas
  numa listagem; use só dentro de contagem/filtro se precisar mesmo.`,
  },
  {
    nome: 'inss_admin_processes',
    titulo: 'PROCESSOS/REQUERIMENTOS ADMINISTRATIVOS no INSS',
    notas: `  ESTA é a fonte da verdade de "protocolo administrativo".
  "protocolado administrativamente" = protocol_date IS NOT NULL.
  "NÃO protocolado / sem protocolo administrativo" = NÃO existir aqui um registro do lead com protocol_date
    preenchido. Padrão: NOT EXISTS (SELECT 1 FROM inss_admin_processes i WHERE i.lead_id = l.id
    AND i.deleted_at IS NULL AND i.protocol_date IS NOT NULL). Junte por lead_id (ou case_id).
  current_status (vocabulário real): 'Exigência', 'Concluída', 'Em análise'/'Em Análise', 'Cancelada', 'Pendente'.
  resultado (vocabulário real, minúsculo): 'deferido', 'indeferido', 'arquivado_decurso'.
    É ESTE o campo de RESULTADO do requerimento — current_status='Concluída' diz que acabou,
    resultado diz COMO acabou. benefit_number só costuma existir quando foi deferido.
  despacho / servico = texto do INSS sobre o andamento; details (jsonb) = payload cru do e-mail.`,
  },
  {
    nome: 'hearings',
    titulo: 'AUDIÊNCIAS',
  },
  {
    nome: 'case_process_tracking',
    titulo: 'planilha LEGADA importada. USO LIMITADO',
    notas: `  ATENÇÃO: colunas status_processo, protocolado e tipo estão QUASE SEMPRE NULAS (dados nunca migrados).
  NÃO use esta tabela para responder "fechado", "protocolado" ou "tipo/funil BPC" — daria 0 resultados.
  Para status do cliente use leads.lead_status; para funil use kanban_boards; para protocolo
  administrativo use inss_admin_processes.protocol_date. Só use case_process_tracking se o pedido citar
  explicitamente acolhedor/pagamento de acolhedor (pago_acolhedor) ou tempo_dias.
  Esta tabela guarda credencial de cliente (senha do gov.br). Essa coluna está fora do catálogo
  de propósito: nunca a inclua numa consulta, nem para contar quantas estão preenchidas.`,
  },
  {
    nome: 'process_movements',
    titulo: 'marcos/movimentações processuais (append-only)',
  },
  {
    nome: 'contacts',
    titulo: 'CONTATOS (agenda ampla, redes) — não confundir com leads',
  },
  {
    nome: 'profiles',
    titulo: 'USUÁRIOS/equipe (para resolver responsáveis por nome)',
    notas: `  Para achar um responsável por nome: filtre profiles.full_name ILIKE '%nome%' e junte pelo id
  correspondente (assigned_to / responsible_user_id costumam referenciar profiles.id;
  processual_responsible_id referencia profiles.user_id; quando não casar por id, tente a coluna *_name).`,
  },
  { nome: 'specialized_nuclei', titulo: 'núcleos especializados' },
  {
    nome: 'kanban_boards',
    titulo: 'FUNIS/quadros do CRM',
    notas: `  É a tabela dos FUNIS. Leads se ligam por leads.board_id. board_type: 'funnel' = funil de captação,
  'workflow' = fluxo operacional. Para "funil BPC/LOAS" filtre name ILIKE '%bpc%'
  (existem "BPC - Autismo" e "Fluxo BPC - Administrativo"). Para outros: name ILIKE '%acidente%', '%maternidade%' etc.`,
  },
  { nome: 'activity_types', titulo: 'tipos de atividade' },
];

const REGRAS_DE_OURO = `Banco Postgres (Supabase) de um escritório de advocacia brasileiro. Todas as tabelas no schema public.
Regras de ouro:
- SOMENTE SELECT. Nunca escreva. A conexão é read-only.
- SEMPRE filtre "deleted_at IS NULL" nas tabelas que têm essa coluna (registros apagados).
- Para filtrar por NOME de pessoa (responsável, cliente, acolhedor), use ILIKE '%termo%' (case-insensitive). Seja tolerante a acento e nome parcial.
- Datas em português: "hoje", "essa semana", "esse mês", "atrasado" (deadline < CURRENT_DATE). Use CURRENT_DATE / date_trunc.
- Sempre inclua colunas legíveis (nomes, títulos, datas, status) — evite despejar só IDs.
- Ordene por algo útil (data desc, deadline asc) e use LIMIT razoável (ex: 500). Para "relação completa/todos", use LIMIT 5000.`;

const DICAS_DE_JOIN = `== DICAS DE JOIN P/ RESPONSÁVEL (padrões testados neste banco) ==
- Processos de um responsável (ex: Gisele) — responsável vem do LEAD via profiles.user_id:
    SELECT p.process_number, p.title, p.status, p.tribunal, l.lead_name AS cliente, pr.full_name AS responsavel
    FROM lead_processes p
    JOIN leads l ON l.id = p.lead_id
    JOIN profiles pr ON pr.user_id = l.processual_responsible_id
    WHERE p.deleted_at IS NULL AND l.deleted_at IS NULL AND pr.full_name ILIKE '%gisele%'
    ORDER BY p.created_at DESC LIMIT 500;
- Casos de um responsável — mesmo padrão via lead:
    SELECT c.case_number, c.title, c.status, l.lead_name AS cliente, pr.full_name AS responsavel
    FROM legal_cases c
    JOIN leads l ON l.id = c.lead_id
    JOIN profiles pr ON pr.user_id = l.processual_responsible_id
    WHERE c.deleted_at IS NULL AND l.deleted_at IS NULL AND pr.full_name ILIKE '%nome%'
    ORDER BY c.created_at DESC LIMIT 500;
- Atividades de um responsável (ex: João Manoel) — o nome já está no texto da própria atividade:
    SELECT a.title, a.status, a.deadline, a.assigned_to_name, a.lead_name
    FROM lead_activities a
    WHERE a.deleted_at IS NULL
      AND (a.assigned_to_name ILIKE '%joão manoel%' OR EXISTS (
            SELECT 1 FROM unnest(a.assigned_to_names) n WHERE n ILIKE '%joão manoel%'))
    ORDER BY a.deadline ASC NULLS LAST LIMIT 500;
- Clientes/leads de um responsável: leads l JOIN profiles pr ON pr.user_id = l.processual_responsible_id WHERE pr.full_name ILIKE '%nome%'.
- Resultado do requerimento administrativo (ex.: "quantos BPC foram deferidos"):
    SELECT i.resultado, COUNT(*) AS total
    FROM inss_admin_processes i
    WHERE i.deleted_at IS NULL AND i.current_status = 'Concluída'
    GROUP BY i.resultado ORDER BY total DESC;
- Leads de um FUNIL fechados e SEM protocolo administrativo (ex.: "funil BPC fechados não protocolados"):
    SELECT l.lead_name, l.lead_phone, b.name AS funil, l.became_client_date,
           pr.full_name AS responsavel
    FROM leads l
    JOIN kanban_boards b ON b.id = l.board_id
    LEFT JOIN profiles pr ON pr.user_id = l.processual_responsible_id
    WHERE l.deleted_at IS NULL
      AND b.name ILIKE '%bpc%'
      AND l.lead_status = 'closed'
      AND NOT EXISTS (
        SELECT 1 FROM inss_admin_processes i
        WHERE i.lead_id = l.id AND i.deleted_at IS NULL AND i.protocol_date IS NOT NULL)
    ORDER BY l.became_client_date DESC NULLS LAST LIMIT 500;`;

export interface DiagnosticoCatalogo {
  /** 'banco' = colunas lidas agora; 'degradado' = leitura falhou, catálogo sem colunas. */
  fonte: 'banco' | 'degradado';
  tabelas: number;
  colunas: number;
  /** Tabelas da curadoria que o banco não devolveu (renomeada? removida?). */
  faltando: string[];
  /** Quantas tabelas o banco expõe que NÃO estão na curadoria — nomes ficam fora daqui de propósito. */
  fora_do_catalogo: number;
  gerado_em: string;
  erro?: string;
}

interface CatalogoMontado {
  texto: string;
  diagnostico: DiagnosticoCatalogo;
  expiraEm: number;
}

let cache: CatalogoMontado | null = null;
let emVoo: Promise<CatalogoMontado> | null = null;

/**
 * Lê o OpenAPI do PostgREST e devolve coluna:tipo por tabela, na ordem ordinal.
 * Aceita o Swagger 2.0 que o PostgREST publica hoje (`definitions`) e o OpenAPI
 * 3 (`components.schemas`), pra uma virada de versão não derrubar o catálogo.
 */
export function colunasDoOpenApi(doc: any): Map<string, string[]> {
  const defs = doc?.definitions || doc?.components?.schemas || {};
  const mapa = new Map<string, string[]>();
  for (const [tabela, spec] of Object.entries<any>(defs)) {
    const props = spec?.properties;
    if (!props || typeof props !== 'object') continue;
    const colunas = Object.entries<any>(props)
      .filter(([nome]) => !COLUNA_SECRETA.test(nome))
      .map(([nome, info]) => {
        // PostgREST põe o tipo Postgres em `format` ("uuid", "timestamp with
        // time zone", "jsonb"); `type` é só o tipo JSON, bem mais pobre.
        const tipo = String(info?.format || info?.type || '?')
          .replace('timestamp with time zone', 'timestamptz')
          .replace('timestamp without time zone', 'timestamp')
          .replace('character varying', 'varchar')
          .replace('double precision', 'float8');
        return `${nome}:${tipo}`;
      });
    mapa.set(tabela, colunas);
  }
  return mapa;
}

async function buscarOpenApi(): Promise<any> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('EXTERNAL_SUPABASE_* não configurado');
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/openapi+json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`GET /rest/v1/ devolveu ${resp.status}`);
  return resp.json();
}

/**
 * Quantos registros VIVOS cada tabela tem. O número velho no catálogo ("leads
 * (16k)" quando são 23,6k) faz a IA calibrar errado o que é "muito" e o que é
 * "pouco". Contagem que falhar simplesmente não aparece: melhor sem número do
 * que com número chutado.
 */
async function contarLinhas(tabela: string, temDeletedAt: boolean): Promise<number | null> {
  try {
    let q = supabase.from(tabela).select('*', { count: 'exact', head: true });
    if (temDeletedAt) q = q.is('deleted_at', null);
    const { count, error } = await q;
    if (error) return null;
    return typeof count === 'number' ? count : null;
  } catch {
    return null;
  }
}

function formatarQuantidade(n: number | null, temDeletedAt: boolean): string {
  if (n === null) return '';
  const numero = n.toLocaleString('pt-BR');
  return temDeletedAt ? ` (${numero} ativos)` : ` (${numero})`;
}

export async function montarCatalogo(): Promise<CatalogoMontado> {
  const geradoEm = new Date().toISOString();
  let colunasPorTabela: Map<string, string[]> | null = null;
  let erro: string | undefined;

  try {
    const lido = colunasDoOpenApi(await buscarOpenApi());
    if (!lido.size) throw new Error('OpenAPI veio sem definitions');
    colunasPorTabela = lido;
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
    console.warn('[schemaCatalog] não consegui ler o schema do banco, catálogo em modo degradado:', erro);
    colunasPorTabela = null;
  }

  const faltando: string[] = [];
  const blocos: string[] = [];
  let totalColunas = 0;

  const preparadas = await Promise.all(
    TABELAS.map(async (t) => {
      const cols = colunasPorTabela ? colunasPorTabela.get(t.nome) || null : null;
      if (colunasPorTabela && !cols) return { t, cols, n: null as number | null, temDeletedAt: false };
      const temDeletedAt = !!cols?.some((c) => c.startsWith('deleted_at:'));
      return { t, cols, n: await contarLinhas(t.nome, temDeletedAt), temDeletedAt };
    }),
  );

  for (const { t, cols, n, temDeletedAt } of preparadas) {
    if (colunasPorTabela && !cols) {
      faltando.push(t.nome);
      continue;
    }
    const linhas = [`${t.nome}${formatarQuantidade(n, temDeletedAt)} — ${t.titulo}.`];
    if (cols) {
      totalColunas += cols.length;
      linhas.push(`  colunas: ${cols.join(', ')}`);
      linhas.push(`  ${temDeletedAt ? 'tem deleted_at (filtre sempre).' : 'não tem deleted_at.'}`);
    }
    if (t.notas) linhas.push(t.notas);
    blocos.push(linhas.join('\n'));
  }

  const foraDoCatalogo = colunasPorTabela
    ? [...colunasPorTabela.keys()].filter((t) => !TABELAS.some((c) => c.nome === t)).length
    : 0;

  // A regra sobre coluna muda conforme a fonte. Com o schema lido, a lista é
  // fechada e confiável. Sem ele, a IA NÃO pode concluir que um campo não
  // existe — foi exatamente esse salto ("não está na minha lista" → "o sistema
  // não registra isso") que produziu o diagnóstico errado de 09/09/2026.
  const regraDeColuna = colunasPorTabela
    ? `- As colunas abaixo foram lidas do banco em ${geradoEm} — é a lista completa e atual de cada tabela. Não invente coluna fora dela.
- Faltou o campo que você queria? Diga qual coluna listada cobre o que a pergunta pede. Nunca conclua que "o escritório não registra isso" sem antes MEDIR a coluna que existe (quantos nulos, quais valores aparecem).`
    : `- ATENÇÃO: não consegui ler a lista de colunas do banco neste momento (${erro || 'motivo desconhecido'}). Você NÃO sabe quais colunas existem.
- É PROIBIDO afirmar que um campo não existe ou que "o sistema não registra isso". Precisa de um campo? Tente a consulta: se a coluna não existir, o banco recusa e aí sim você sabe. Use as colunas citadas nas notas abaixo como ponto de partida.`;

  const texto = [
    REGRAS_DE_OURO,
    regraDeColuna,
    '',
    '== TABELAS ==',
    '',
    blocos.join('\n\n'),
    '',
    DICAS_DE_JOIN,
  ].join('\n');

  return {
    texto,
    diagnostico: {
      fonte: colunasPorTabela ? 'banco' : 'degradado',
      tabelas: blocos.length,
      colunas: totalColunas,
      faltando,
      fora_do_catalogo: foraDoCatalogo,
      gerado_em: geradoEm,
      erro,
    },
    // Falha expira em 5min pro modo degradado não durar uma hora à toa.
    expiraEm: Date.now() + (colunasPorTabela ? TTL_MS : Math.min(TTL_MS, 5 * 60 * 1000)),
  };
}

/**
 * O catálogo pronto pra entrar no prompt. Cacheado por TTL_MS e compartilhado
 * entre chamadas simultâneas (emVoo), pra 3 perguntas ao mesmo tempo não
 * dispararem 3 leituras de schema.
 */
export async function catalogoDeSchema(): Promise<string> {
  if (cache && cache.expiraEm > Date.now()) return cache.texto;
  if (!emVoo) {
    emVoo = montarCatalogo()
      .then((c) => { cache = c; return c; })
      .finally(() => { emVoo = null; });
  }
  try {
    return (await emVoo).texto;
  } catch (e) {
    // Montagem quebrou de um jeito não previsto: melhor devolver o catálogo
    // velho do que derrubar a pergunta da diretoria.
    if (cache) return cache.texto;
    throw e;
  }
}

/** O que o /health mostra. Não força leitura: só conta o que já está em cache. */
export function diagnosticoDoCatalogo(): DiagnosticoCatalogo | { fonte: 'nao_carregado' } {
  return cache ? cache.diagnostico : { fonte: 'nao_carregado' };
}

/** Só para teste: zera o cache entre casos. */
export function _resetCatalogoParaTeste(): void {
  cache = null;
  emVoo = null;
}
