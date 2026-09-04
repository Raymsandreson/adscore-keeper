// Painel de métricas: uma chamada devolve tudo que a aba mostra.
//
// Fica no Railway (e não no navegador) por três motivos:
//  1. o token da Meta nunca pode chegar ao front;
//  2. `meta_capi_events` tem RLS sem policy — só service role lê;
//  3. agregar 3.400 leads no cliente seria baixar 3.400 leads no cliente.
//
// O que sai daqui é AGREGADO. Nenhum nome, telefone ou e-mail de cliente
// atravessa esta resposta.
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { CAPI_TOKEN, GRAPH_VERSION } from '../lib/metaCapi';

// PostgREST corta em 1000. Não é teoria: o dedup da planilha leu 1000 de 7.255
// e teria recriado lead por 10 minutos até alguém notar. Toda leitura de volume
// aqui pagina.
const PAGINA = 1000;
const TETO_PAGINAS = 20;

const hojeISO = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function leTudo<T>(
  monta: (de: number, ate: number) => any,
): Promise<T[]> {
  const acc: T[] = [];
  for (let p = 0; p < TETO_PAGINAS; p++) {
    const { data, error } = await monta(p * PAGINA, (p + 1) * PAGINA - 1);
    if (error) throw new Error(error.message);
    const linhas = (data || []) as T[];
    acc.push(...linhas);
    if (linhas.length < PAGINA) break;
  }
  return acc;
}

function contaPor<T>(linhas: T[], chave: (l: T) => string | null): Array<{ nome: string; qtd: number }> {
  const m: Record<string, number> = {};
  for (const l of linhas) {
    const k = chave(l);
    if (!k) continue;
    m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m)
    .map(([nome, qtd]) => ({ nome, qtd }))
    .sort((a, b) => b.qtd - a.qtd);
}

/**
 * Investimento vindo da Marketing API, ao vivo.
 *
 * `time_increment=1` traz o gasto DIA A DIA numa chamada só — dá a série do
 * gráfico e os totais de hoje/7d/30d sem três requisições por conta.
 *
 * Conta sem permissão ou sem gasto não pode derrubar o painel inteiro: o erro
 * fica na própria conta e o resto da aba continua de pé.
 */
async function investimento() {
  const g = async (path: string) => {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${path}` +
        `${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(CAPI_TOKEN)}`,
    );
    return (await r.json()) as any;
  };

  const contas = await g('me/adaccounts?fields=id,name,account_status,currency&limit=50');
  if (contas?.error) {
    return { disponivel: false, erro: contas.error.message, contas: [], serie: [], total_hoje: 0, total_7d: 0, total_30d: 0 };
  }

  const hoje = hojeISO();
  const corte7 = diasAtras(7);
  const porDia: Record<string, number> = {};
  const detalhe: Array<Record<string, unknown>> = [];
  let t30 = 0, t7 = 0, tHoje = 0;

  for (const c of contas?.data ?? []) {
    const ins = await g(
      `${c.id}/insights?fields=spend,impressions,clicks&date_preset=last_30d&time_increment=1&limit=100`,
    );
    if (ins?.error) {
      detalhe.push({ conta: c.name, id: c.id, erro: ins.error.message });
      continue;
    }
    let c30 = 0, c7 = 0, cHoje = 0;
    for (const d of ins?.data ?? []) {
      const dia = String(d.date_start || '').slice(0, 10);
      const v = Number(d.spend || 0);
      if (!dia || !Number.isFinite(v)) continue;
      porDia[dia] = (porDia[dia] || 0) + v;
      c30 += v;
      if (dia >= corte7) c7 += v;
      if (dia === hoje) cHoje += v;
    }
    t30 += c30; t7 += c7; tHoje += cHoje;
    detalhe.push({
      conta: c.name,
      id: c.id,
      moeda: c.currency || 'BRL',
      ativa: c.account_status === 1,
      hoje: Number(cHoje.toFixed(2)),
      ultimos_7d: Number(c7.toFixed(2)),
      ultimos_30d: Number(c30.toFixed(2)),
    });
  }

  const serie = Object.entries(porDia)
    .map(([dia, valor]) => ({ dia, valor: Number(valor.toFixed(2)) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  return {
    disponivel: true,
    contas: detalhe,
    serie,
    total_hoje: Number(tHoje.toFixed(2)),
    total_7d: Number(t7.toFixed(2)),
    total_30d: Number(t30.toFixed(2)),
  };
}

export const handler: RequestHandler = async (_req, res) => {
  try {
    const hoje = hojeISO();
    const corte7 = diasAtras(7);
    const corte30 = diasAtras(30);

    const [boards, leads, fechados, gasto, filaCapi] = await Promise.all([
      supabase.from('kanban_boards').select('id, name'),
      leTudo<any>((de, ate) =>
        supabase
          .from('leads')
          .select('created_at, source, board_id')
          .is('deleted_at', null)
          .gte('created_at', `${corte30}T00:00:00Z`)
          .order('created_at', { ascending: false })
          .range(de, ate),
      ),
      leTudo<any>((de, ate) =>
        supabase
          .from('leads')
          .select('became_client_date, source, board_id')
          .is('deleted_at', null)
          .eq('lead_status', 'closed')
          .gte('became_client_date', corte30)
          .order('became_client_date', { ascending: false })
          .range(de, ate),
      ),
      investimento(),
      Promise.all(
        ['pending', 'sent', 'failed', 'skipped'].map(async (s) => {
          const { count } = await supabase
            .from('meta_capi_events')
            .select('id', { count: 'exact', head: true })
            .eq('status', s);
          return [s, count ?? 0] as const;
        }),
      ),
    ]);

    const nomeBoard: Record<string, string> = {};
    for (const b of (boards.data || []) as any[]) nomeBoard[b.id] = b.name;

    const dia = (v: any) => String(v || '').slice(0, 10);
    const leadsPorDia: Record<string, number> = {};
    for (const l of leads) {
      const d = dia(l.created_at);
      if (d) leadsPorDia[d] = (leadsPorDia[d] || 0) + 1;
    }
    const fechPorDia: Record<string, number> = {};
    for (const f of fechados) {
      const d = dia(f.became_client_date);
      if (d) fechPorDia[d] = (fechPorDia[d] || 0) + 1;
    }

    const leads7 = leads.filter((l) => dia(l.created_at) >= corte7).length;
    const leadsHoje = leads.filter((l) => dia(l.created_at) === hoje).length;
    const fech7 = fechados.filter((f) => dia(f.became_client_date) >= corte7).length;
    const fechHoje = fechados.filter((f) => dia(f.became_client_date) === hoje).length;

    const serieDias = Array.from({ length: 30 }, (_, i) => diasAtras(29 - i));

    return res.status(200).json({
      gerado_em: new Date().toISOString(),
      janela: { de: corte30, ate: hoje },
      investimento: gasto,
      leads: {
        hoje: leadsHoje,
        ultimos_7d: leads7,
        ultimos_30d: leads.length,
        por_fonte: contaPor(leads, (l) => l.source || '(sem origem)').slice(0, 15),
        por_board: contaPor(leads, (l) => nomeBoard[l.board_id] || null).slice(0, 15),
      },
      fechamentos: {
        hoje: fechHoje,
        ultimos_7d: fech7,
        ultimos_30d: fechados.length,
        por_fonte: contaPor(fechados, (f) => f.source || '(sem origem)').slice(0, 15),
        por_board: contaPor(fechados, (f) => nomeBoard[f.board_id] || null).slice(0, 15),
      },
      serie: serieDias.map((d) => ({
        dia: d,
        leads: leadsPorDia[d] || 0,
        fechamentos: fechPorDia[d] || 0,
        investido: gasto.serie?.find((s: any) => s.dia === d)?.valor ?? 0,
      })),
      capi: Object.fromEntries(filaCapi),
      // Custo só existe se houve gasto: dividir por zero e mostrar "R$ 0,00 por
      // lead" mentiria tanto quanto esconder o número.
      custo: {
        por_lead_30d: gasto.total_30d > 0 && leads.length ? Number((gasto.total_30d / leads.length).toFixed(2)) : null,
        por_fechamento_30d:
          gasto.total_30d > 0 && fechados.length ? Number((gasto.total_30d / fechados.length).toFixed(2)) : null,
      },
    });
  } catch (err) {
    console.error('[metricas-painel]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};
