import type { RequestHandler } from 'express';
import { selfPost } from '../lib/selfCall';
import { supabase } from '../lib/supabase';
import { findInssOrphanMatch, applyInssMatch } from '../lib/inss-matcher';

/**
 * Varre inss_admin_processes órfãos e tenta vincular usando o matcher
 * compartilhado (mesma lógica do gmail-inss-sync). Roda manualmente ou
 * via cron a cada 15min (ver src/index.ts).
 *
 * Duas passadas, porque "órfão" tem dois sabores:
 *
 *   1. sem lead e sem caso — o matcher tenta as 6 pistas (requerimento, NB,
 *      custom field, título de atividade, CPF, nome).
 *   2. COM lead e sem caso — o lead pode ter ganhado um legal_case depois do
 *      vínculo, e ninguém religava: em 17/08/2026 eram 277 protocolos nesse
 *      estado, 30 deles com caso já aberto esperando. Sem essa passada, esses
 *      30 nunca apareceriam na ficha do caso nem numa contagem por nº de caso.
 *
 * O match dispara notify-inss-update com `sem_mensagem: true`: a atividade
 * nasce (senão o e-mail continuaria sem dono), mas o cliente NÃO recebe zap. O
 * e-mail pode ser de meses atrás e o casamento por nome ainda não passou por
 * olho humano — avisar cliente com base em palpite de robô é o que não pode.
 * Até 31/08/2026 este comentário dizia que nada era disparado, enquanto o
 * código chamava o notify sem ressalva nenhuma.
 */

/**
 * Trava de execução única.
 *
 * A varredura leva ~4s por órfão (cada um passa por 6 pistas, com consultas ao
 * banco) e são 312 — mais de 20 minutos, contra um cron de 15. Sem trava, a
 * rodada seguinte entra por cima da anterior: o mesmo órfão é casado duas vezes
 * e nascem duas atividades para a mesma novidade. Medido em 31/08/2026, no
 * primeiro deploy do matcher por nome completo.
 */
let varreduraEmCurso = false;

export const handler: RequestHandler = async (_req, res) => {
  if (varreduraEmCurso) {
    return res.json({ success: true, skipped: 'varredura anterior ainda rodando' });
  }
  varreduraEmCurso = true;
  const errors: string[] = [];
  let matched = 0;
  let scanned = 0;
  let notify_fired = 0;
  let promoted = 0;

  try {
    const { data: orphans, error: oErr } = await supabase
      .from('inss_admin_processes')
      .select('id, requerimento_number, cpf_segurado, nome_segurado, benefit_number')
      .is('case_id', null)
      .is('lead_id', null)
      .is('deleted_at', null);
    if (oErr) {
      return res.json({ success: false, error: `load orphans: ${oErr.message}` });
    }

    scanned = (orphans || []).length;

    for (const o of orphans || []) {
      try {
        const match = await findInssOrphanMatch({
          requerimento: o.requerimento_number,
          cpf: (o as any).cpf_segurado,
          nome: (o as any).nome_segurado,
          beneficio_num: (o as any).benefit_number,
        });
        if (!match.leadId && !match.caseId) continue;

        const { caseId, leadId } = await applyInssMatch({
          processId: o.id,
          requerimento: o.requerimento_number,
          match,
        });
        matched++;

        // Basta LEAD para notificar. Até 26/08/2026 a condição era só `caseId`,
        // herdada de quando o notify-inss-update exigia caso; desde 25/08 ele
        // cria a atividade com lead apenas, e o órfão casado só com lead ficava
        // sem atividade e sem mensagem — o e-mail do INSS já tinha chegado e
        // ninguém era avisado.
        if (caseId || leadId) {
          selfPost('notify-inss-update', { process_id: o.id, sem_mensagem: true }).catch(() => {});
          notify_fired++;
        }
      } catch (e: any) {
        errors.push(`${o.requerimento_number}: ${e?.message || 'unknown'}`);
      }
    }

    // --- 2ª passada: protocolo com lead, mas ainda sem caso ---
    const { data: semCaso, error: sErr } = await supabase
      .from('inss_admin_processes')
      .select('id, requerimento_number, lead_id')
      .is('case_id', null)
      .not('lead_id', 'is', null)
      .is('deleted_at', null);
    if (sErr) {
      errors.push(`load lead-sem-caso: ${sErr.message}`);
    } else {
      const leadIds = Array.from(new Set((semCaso || []).map((p: any) => p.lead_id).filter(Boolean)));
      // Casos em lote: 235 leads viram 3 consultas, não 235.
      const casoPorLead = new Map<string, string>();
      for (let i = 0; i < leadIds.length; i += 100) {
        const { data: casos } = await supabase
          .from('legal_cases')
          .select('id, lead_id, created_at')
          .in('lead_id', leadIds.slice(i, i + 100))
          .order('created_at', { ascending: false });
        for (const c of (casos || []) as any[]) {
          // Ordenado por created_at desc: o primeiro que chega é o mais recente,
          // mesma escolha que o applyInssMatch faz.
          if (c.lead_id && !casoPorLead.has(c.lead_id)) casoPorLead.set(c.lead_id, c.id);
        }
      }

      for (const p of (semCaso || []) as any[]) {
        const caseId = casoPorLead.get(p.lead_id);
        if (!caseId) continue;
        const { error: uErr } = await supabase
          .from('inss_admin_processes')
          .update({ case_id: caseId, linked_at: new Date().toISOString() })
          .eq('id', p.id);
        if (uErr) errors.push(`${p.requerimento_number}: ${uErr.message}`);
        else promoted++;
      }
    }

    return res.json({ success: true, scanned, matched, promoted, notify_fired, errors });
  } catch (e: any) {
    return res.json({ success: false, error: e?.message || 'unknown' });
  } finally {
    varreduraEmCurso = false;
  }
};
