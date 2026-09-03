// Enfileira uma conversão para a Meta CAPI.
//
// Os chamadores mandam só `lead_id` + `event_name`: e-mail, telefone e valor
// são resolvidos aqui, com service role, e gravados já hasheados. Nada é
// enviado à rede neste caminho — quem despacha é `meta-capi-dispatch`. Assim
// fechar um lead nunca fica preso a uma chamada da Meta, e uma falha da Meta
// nunca some: fica na fila com o erro.
//
// Idempotente por `event_id` (UNIQUE): enfileirar o mesmo fechamento pelos dois
// funis (Kanban `closed` e Pipeline `converted`) grava uma linha só.
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import {
  montaCorrespondencia,
  temCorrespondenciaUtil,
  resolveValor,
  type Origem,
} from '../lib/metaCapi';

const EVENTOS_VALIDOS = new Set(['Purchase', 'Lead', 'CompleteRegistration']);
const ORIGENS_VALIDAS = new Set<Origem>([
  'kanban', 'pipeline', 'planilha', 'auto_enrich', 'manual', 'backfill',
]);

interface Pedido {
  lead_id: string;
  event_name?: string;
  origem?: Origem;
  /** Sobrepõe o valor resolvido do lead. Usado quando a tela captura o valor na hora. */
  valor?: number;
  event_time?: string;
}

export interface ResultadoEnfileiramento {
  lead_id: string;
  event_id?: string;
  situacao: 'enfileirado' | 'ja_existia' | 'ignorado' | 'erro';
  motivo?: string;
}

async function enfileiraUm(p: Pedido): Promise<ResultadoEnfileiramento> {
  const eventName = p.event_name || 'Purchase';
  if (!EVENTOS_VALIDOS.has(eventName)) {
    return { lead_id: p.lead_id, situacao: 'erro', motivo: `event_name inválido: ${eventName}` };
  }
  const origem: Origem = ORIGENS_VALIDAS.has(p.origem as Origem) ? (p.origem as Origem) : 'manual';

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, lead_name, lead_email, lead_phone, conversion_value, product_service_id, became_client_date')
    .eq('id', p.lead_id)
    .maybeSingle();

  if (error) return { lead_id: p.lead_id, situacao: 'erro', motivo: error.message };
  if (!lead) return { lead_id: p.lead_id, situacao: 'erro', motivo: 'lead não encontrado' };

  const l = lead as any;
  const event_id = `${l.id}:${eventName}`;
  const { user_data_hash, match_keys } = montaCorrespondencia(l);

  // Sem e-mail nem telefone a Meta descarta o evento. Registrar como `skipped`
  // em vez de mandar assim mesmo é o que transforma "não converteu" em número:
  // nos últimos 30 dias só 35 de 206 fechados tinham algum contato.
  const utilizavel = temCorrespondenciaUtil(match_keys);
  const { valor, valor_origem } = utilizavel
    ? await resolveValor(l)
    : { valor: null, valor_origem: 'ausente' as const };

  const valorFinal = typeof p.valor === 'number' && p.valor > 0 ? p.valor : valor;
  const origemValor = typeof p.valor === 'number' && p.valor > 0 ? 'informado' : valor_origem;

  // `Purchase` sem `value` a Meta RECUSA -- 400, subcode 2804009, "Missing Value
  // for Purchase Event". Medido contra a Meta em 03/09/2026: nao e otimizacao
  // degradada, o evento nao entra. Barrar aqui em vez de deixar falhar na rede
  // faz a linha dizer o que consertar (produto no lead, ou preco no cadastro do
  // produto) em vez de virar `failed` com erro cru. Eram 536 fechados com
  // contato e sem valor nenhum.
  let status = 'pending';
  let motivo: string | null = null;
  if (!utilizavel) {
    status = 'skipped';
    motivo = 'lead sem e-mail nem telefone — a Meta descartaria o evento';
  } else if (eventName === 'Purchase' && !valorFinal) {
    status = 'skipped';
    motivo =
      'Purchase exige value: lead sem produto e sem valor apurado — preencher o produto no lead, ou o preço no cadastro do produto';
  }

  const linha = {
    event_id,
    event_name: eventName,
    lead_id: l.id,
    origem,
    status,
    motivo_skip: motivo,
    user_data_hash,
    match_keys,
    // Sem `lead_id` em claro: `external_id` no user_data ja e o hash desse mesmo
    // id, e a coluna `lead_id` da fila guarda o vinculo aqui dentro. Mandar o
    // identificador interno tambem em claro nao serve a Meta e contraria a
    // minimizacao de dado.
    custom_data: {
      currency: 'BRL',
      ...(valorFinal ? { value: valorFinal } : {}),
    },
    action_source: 'system_generated',
    event_time: p.event_time || l.became_client_date || new Date().toISOString(),
    valor: valorFinal,
    valor_origem: origemValor,
  };

  // ignoreDuplicates: quem chegou primeiro manda. Reenvio deliberado é ação do
  // painel (zera status), não efeito colateral de salvar o lead de novo.
  const { data: inserido, error: errIns } = await supabase
    .from('meta_capi_events')
    .upsert(linha as any, { onConflict: 'event_id', ignoreDuplicates: true })
    .select('id');

  if (errIns) return { lead_id: l.id, event_id, situacao: 'erro', motivo: errIns.message };

  if (!inserido || inserido.length === 0) {
    return { lead_id: l.id, event_id, situacao: 'ja_existia' };
  }
  return {
    lead_id: l.id,
    event_id,
    situacao: status === 'pending' ? 'enfileirado' : 'ignorado',
    motivo: motivo ?? undefined,
  };
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const body = (req.body || {}) as { lead_id?: string; eventos?: Pedido[] } & Pedido;
    const pedidos: Pedido[] = Array.isArray(body.eventos)
      ? body.eventos
      : body.lead_id
        ? [{ lead_id: body.lead_id, event_name: body.event_name, origem: body.origem, valor: body.valor, event_time: body.event_time }]
        : [];

    if (pedidos.length === 0) {
      return res.status(400).json({ error: 'informe lead_id ou eventos[]' });
    }
    if (pedidos.length > 500) {
      return res.status(400).json({ error: 'máximo de 500 eventos por chamada' });
    }

    const resultados: ResultadoEnfileiramento[] = [];
    for (const p of pedidos) resultados.push(await enfileiraUm(p));

    const conta = (s: string) => resultados.filter((r) => r.situacao === s).length;
    return res.status(200).json({
      total: resultados.length,
      enfileirados: conta('enfileirado'),
      ja_existiam: conta('ja_existia'),
      ignorados: conta('ignorado'),
      erros: conta('erro'),
      resultados,
    });
  } catch (err) {
    console.error('[meta-capi-enqueue]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};
