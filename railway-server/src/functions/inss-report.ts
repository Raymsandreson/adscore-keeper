import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { stageOf, STAGE_LABELS, STAGE_ORDER, type StageKey } from '../lib/inss-despacho';

/**
 * Relatório de benefícios INSS por marco previdenciário, enviado por e-mail
 * para a diretoria.
 *
 * POST /functions/inss-report  { send?: boolean, to?: string|string[] }
 * - send=false (padrão): retorna o HTML para revisão, NÃO envia.
 * - send=true: envia via /functions/send-email (caixa administrativa = adm@).
 *
 * O cron diário (index.ts) chama com send=true de manhã em dia útil.
 */

const REPORT_TO_DEFAULT = 'adm@rprudencioadv.com';

const STAGE_COLORS: Record<StageKey, string> = {
  protocolo_analise: '#1d4ed8', exig_aberta: '#c2410c', exig_cumprida: '#b45309',
  deferido: '#15803d', indeferido: '#b91c1c', cancelada: '#4b5563', sem_veredito: '#0f766e',
};

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const handler: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as any;
  const send: boolean = Boolean(body.send);
  const to = body.to || REPORT_TO_DEFAULT;

  try {
    // Todos os processos ativos — leve (centenas de linhas).
    const { data: procs, error } = await supabase
      .from('inss_admin_processes')
      .select('id, current_status, resultado, case_id, last_email_at')
      .is('deleted_at', null);
    if (error) return res.status(200).json({ success: false, error: error.message });

    const rows = (procs || []) as Array<{ id: string; current_status: string | null; resultado: string | null; case_id: string | null; last_email_at: string | null }>;
    const total = rows.length;

    // Quem já passou por exigência (para isolar "exigência cumprida").
    const { data: exigRows } = await supabase
      .from('inss_status_history')
      .select('process_id')
      .ilike('to_status', 'exig%')
      .limit(20000);
    const passouExig = new Set((exigRows || []).map((r: any) => r.process_id).filter(Boolean));

    const counts = Object.fromEntries(STAGE_ORDER.map((k) => [k, 0])) as Record<StageKey, number>;
    let orfaos = 0;
    for (const p of rows) {
      counts[stageOf(p, passouExig)]++;
      if (!p.case_id) orfaos++;
    }

    // Movimentações nas últimas 24h (por last_email_at).
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const mov24h = rows.filter((p) => p.last_email_at && new Date(p.last_email_at).getTime() >= dayAgo).length;

    const hoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

    const rowsHtml = STAGE_ORDER.filter((k) => counts[k] > 0).map((k) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${STAGE_COLORS[k]};margin-right:8px;"></span>
          ${esc(STAGE_LABELS[k])}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${counts[k]}</td>
      </tr>`).join('');

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#111;">
        <h2 style="margin:0 0 4px;">Relatório de Benefícios — INSS Administrativo</h2>
        <p style="margin:0 0 16px;color:#666;font-size:13px;">${esc(hoje)} · ${total} requerimentos ativos · ${mov24h} com movimentação nas últimas 24h</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <thead>
            <tr><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #111;">Marco</th>
                <th style="text-align:right;padding:8px 12px;border-bottom:2px solid #111;">Qtd.</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr><td style="padding:8px 12px;font-weight:700;">Total</td>
                <td style="padding:8px 12px;text-align:right;font-weight:700;">${total}</td></tr>
          </tfoot>
        </table>
        <p style="margin:16px 0 0;font-size:13px;color:#444;">
          <b>${orfaos}</b> ainda sem caso vinculado (órfãos).
        </p>
        <p style="margin:12px 0 0;font-size:11px;color:#999;">
          "Deferido/Indeferido" vêm do Despacho do e-mail de conclusão (prorrogação concedida
          conta como deferido; não prorrogado, como indeferido). "Concluída (sem veredito)" =
          conclusões que não são concessão/indeferimento (desistência, duplicidade, desbloqueio
          de consignado, etc.). Relatório automático — não responder.
        </p>
      </div>`;

    const payload = { total, orfaos, mov_24h: mov24h, por_marco: counts };

    if (!send) {
      return res.status(200).json({ success: true, sent: false, ...payload, html });
    }

    // Envia pela caixa administrativa (adm@).
    const base = process.env.RAILWAY_PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
    const r = await fetch(`${base}/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.RAILWAY_API_KEY || '' },
      body: JSON.stringify({
        to,
        subject: `Relatório de Benefícios INSS — ${hoje}`,
        html,
        process_type: 'administrativo',
      }),
    });
    const sendRes: any = await r.json().catch(() => ({}));
    return res.status(200).json({ success: Boolean(sendRes?.success), sent: Boolean(sendRes?.success), send_result: sendRes, ...payload });
  } catch (err: any) {
    return res.status(200).json({ success: false, error: err?.message || String(err) });
  }
};
