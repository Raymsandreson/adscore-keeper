// ============================================================================
// Índice de nomes do cadastro, em memória, para o matcher do INSS.
//
// Por que não continuar buscando no banco a cada tentativa: a busca antiga era
// `ilike '%sobrenome%' limit 30`, e isso erra de três jeitos ao mesmo tempo —
// não acha "Antônio" procurando "ANTONIO" (o e-mail do INSS vem sem acento),
// devolve 30 linhas quaisquer quando o sobrenome é Silva/Santos, e não olha
// `lead_name`, que é onde o nome do cliente costuma estar de fato.
//
// Aqui o cadastro inteiro entra na memória uma vez (22.7k leads + 36.2k
// contatos + 10k vínculos contato→lead, medido em 31/08/2026) e a comparação
// acontece sobre texto normalizado, sem acento e sem rótulo de funil. A
// varredura de órfãos roda de 15 em 15 min sobre ~312 requerimentos: com o
// índice são ~70 páginas a cada meia hora em vez de milhares de ILIKEs.
// ============================================================================

import { supabase } from './supabase';
import { tokensDePessoa, type AlvoNome } from './inss-nome-match';

const TTL_MS = Number(process.env.INSS_NOME_INDICE_TTL_MIN || 30) * 60 * 1000;
const PAGINA = 1000;

let cache: { quando: number; alvos: AlvoNome[] } | null = null;

/** Descarta o índice — usar depois de criar/renomear lead em lote. */
export function invalidarIndiceDeNomes(): void {
  cache = null;
}

async function paginar<T>(tabela: string, colunas: string, filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    let q = supabase.from(tabela).select(colunas).range(de, de + PAGINA - 1);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    const lote = (data || []) as T[];
    out.push(...lote);
    if (lote.length < PAGINA) return out;
  }
}

/**
 * Todos os nomes que podem identificar um lead: o nome do lead, o nome do
 * beneficiário e o nome de cada contato ligado a ele. Lead apagado fica de
 * fora — casar requerimento vivo com cadastro que alguém apagou é reviver
 * lixo (2 dos órfãos casariam assim, todos por homonímia).
 */
export async function alvosDeNome(): Promise<AlvoNome[]> {
  if (cache && Date.now() - cache.quando < TTL_MS) return cache.alvos;

  const alvos: AlvoNome[] = [];
  const guardar = (
    leadId: string | null | undefined,
    nome: string | null | undefined,
    fonte: 'lead' | 'contato',
  ) => {
    if (!leadId || !nome) return;
    const tokens = tokensDePessoa(nome);
    if (tokens.length >= 2) alvos.push({ leadId, nome, tokens, fonte });
  };

  const leads = await paginar<any>('leads', 'id, lead_name, victim_name', (q) => q.is('deleted_at', null));
  for (const l of leads) {
    guardar(l.id, l.lead_name, 'lead');
    guardar(l.id, l.victim_name, 'lead');
  }

  // Contato apagado é quase sempre duplicata mesclada — o nome continua lá com
  // `deleted_at` preenchido, e entrava no índice como se fosse gente viva.
  const contatos = await paginar<any>('contacts', 'id, full_name, lead_id', (q) => q.is('deleted_at', null));
  const nomePorContato = new Map<string, string>();
  for (const c of contatos) {
    if (c.full_name) nomePorContato.set(c.id, c.full_name);
    guardar(c.lead_id, c.full_name, 'contato');
  }

  const vinculos = await paginar<any>('contact_leads', 'contact_id, lead_id');
  for (const v of vinculos) guardar(v.lead_id, nomePorContato.get(v.contact_id), 'contato');

  cache = { quando: Date.now(), alvos };
  console.log(`[inss-nome-indice] ${alvos.length} nomes de ${leads.length} leads e ${contatos.length} contatos`);
  return alvos;
}
