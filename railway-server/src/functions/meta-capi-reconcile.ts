// Reconciliador da fila da Meta CAPI.
//
// POR QUE EXISTE (medido em 04/09/2026): o gatilho de conversão foi ligado nos
// caminhos da INTERFACE (kanban, ficha do lead, `updateLead`), e o volume real
// de fechamento não passa por lá. Quem fecha lead de verdade é o backend:
//
//   whatsapp-webhook.ts          etiqueta do WhatsApp vira lead_status=closed
//   zapsign-webhook.ts           assinatura da procuração fecha o lead
//   onboarding-checkpoint-execute.ts
//   sync-funnel-status-from-sheet.ts
//
// Resultado: 69 leads fechados em 7 dias, ZERO eventos na fila. Sair ligando a
// conversão em cada um desses arquivos é band-aid — aparece um quinto caminho e
// o funil volta a vazar calado, do mesmo jeito.
//
// Aqui a pergunta é outra e não depende de quem fechou: "existe lead fechado
// dentro da janela da Meta sem evento de Purchase?" Se existe, enfileira. Vale
// para caminho que já existe, para caminho que alguém criar depois e até para
// fechamento feito por SQL na mão.
//
// Seguro por construção: `meta-capi-enqueue` faz upsert com
// `onConflict: event_id, ignoreDuplicates`, então reenfileirar não duplica —
// quem já foi enfileirado pela tela volta como `ja_existia`.
//
// JANELA: a Meta descarta evento com mais de 7 dias, e o `event_time` do evento
// é o `became_client_date` do lead. Por isso a janela padrão é 7 dias: passar
// disso é gastar chamada para receber recusa.
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { enfileiraUm, type ResultadoEnfileiramento } from './meta-capi-enqueue';

const DIAS_PADRAO = 7;
const TETO_LEADS = 300;
const LOTE_IN = 100;

export interface ResumoReconcile {
  ok: boolean;
  dry_run: boolean;
  dias: number;
  fechados_na_janela: number;
  ja_tinham_evento: number;
  sem_evento: number;
  enfileirados: number;
  ignorados: number;
  erros: number;
  motivos: Record<string, number>;
  amostra_erros: string[];
}

export async function reconcilia(dias: number, dryRun: boolean): Promise<ResumoReconcile> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);

  const { data: fechados, error } = await supabase
    .from('leads')
    .select('id')
    .eq('lead_status', 'closed')
    .is('deleted_at', null)
    .gte('became_client_date', desde)
    .order('became_client_date', { ascending: false })
    .limit(TETO_LEADS);
  if (error) throw new Error(`busca de fechados: ${error.message}`);

  const ids = (fechados || []).map((l: any) => String(l.id));
  const base: ResumoReconcile = {
    ok: true,
    dry_run: dryRun,
    dias,
    fechados_na_janela: ids.length,
    ja_tinham_evento: 0,
    sem_evento: 0,
    enfileirados: 0,
    ignorados: 0,
    erros: 0,
    motivos: {},
    amostra_erros: [],
  };
  if (!ids.length) return base;

  // `.in` em lote: 300 uuids numa querystring só estoura o limite de URL.
  const conhecidos = new Set<string>();
  for (let i = 0; i < ids.length; i += LOTE_IN) {
    const fatia = ids.slice(i, i + LOTE_IN);
    const { data: jaTem, error: errEv } = await supabase
      .from('meta_capi_events')
      .select('lead_id')
      .eq('event_name', 'Purchase')
      .in('lead_id', fatia);
    if (errEv) throw new Error(`busca de eventos: ${errEv.message}`);
    for (const e of jaTem || []) conhecidos.add(String((e as any).lead_id));
  }

  const faltando = ids.filter((id) => !conhecidos.has(id));
  base.ja_tinham_evento = conhecidos.size;
  base.sem_evento = faltando.length;
  if (dryRun || !faltando.length) return base;

  const resultados: ResultadoEnfileiramento[] = [];
  for (const id of faltando) {
    resultados.push(await enfileiraUm({ lead_id: id, event_name: 'Purchase', origem: 'reconcile' }));
  }
  for (const r of resultados) {
    if (r.situacao === 'enfileirado') base.enfileirados += 1;
    else if (r.situacao === 'ignorado') base.ignorados += 1;
    else if (r.situacao === 'erro') {
      base.erros += 1;
      if (base.amostra_erros.length < 5) base.amostra_erros.push(r.motivo || 'sem motivo');
    }
    // `motivo` do ignorado e o que diz por que a Meta nao aceitaria: sem
    // telefone/e-mail, ou Purchase sem valor. E o que vira lista de conserto.
    if (r.motivo) base.motivos[r.motivo] = (base.motivos[r.motivo] || 0) + 1;
  }
  return base;
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const body = (req.body || {}) as { dias?: number; dry_run?: boolean };
    const dias = Math.min(Math.max(Number(body.dias) || DIAS_PADRAO, 1), 7);
    // Seco por padrao: enfileirar dispara envio real a Meta pelo dispatcher.
    // Quem quer valer manda `dry_run: false` explicito.
    const dryRun = body.dry_run !== false;
    const resumo = await reconcilia(dias, dryRun);
    return res.status(200).json(resumo);
  } catch (err) {
    console.error('[meta-capi-reconcile]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};
