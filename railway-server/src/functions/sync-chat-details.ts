// sync-chat-details
// ============================================================
// Sincroniza contatos com o POST /chat/details da UazAPI.
//
// Três modos, um só handler:
//
//   mode: 'single'  { phone, instance_name, refresh?, apply_to_contact? }
//       Um número. É o que a tela de contato chama ao abrir/atualizar.
//
//   mode: 'batch'   { phones: string[], instance_name, refresh?, apply_to_contact? }
//       Lista explícita. Usado pelo modal de membros de grupo.
//
//   mode: 'stale'   { instance_name?, limit?, max_age_hours?, apply_to_contact? }
//       Varre o que está velho no cache e renova. É o modo do cron: pega os
//       mais antigos primeiro e respeita um teto por rodada, porque cada
//       telefone é uma chamada à UazAPI e a base tem ~31k contatos — varrer
//       tudo de uma vez custaria 31k chamadas.
//
// Retorno sempre HTTP 200 com { success, ... } — o padrão dos outros handlers
// deste servidor, para o chamador tratar erro pelo corpo e não pelo status.
// ============================================================
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_TTL_MS,
  MAX_SYNC_ATTEMPTS,
  applyDetailsToContact,
  getChatDetails,
  getChatDetailsBatch,
  loadInstances,
  pickBestName,
  type ChatDetails,
  type GetChatDetailsResult,
} from '../lib/uazapi-chat-details';

/** Teto por rodada do modo stale. Acima disso a rodada estoura o timeout HTTP. */
const STALE_DEFAULT_LIMIT = 100;
const STALE_MAX_LIMIT = 500;

function digits(v: unknown): string {
  return String(v || '').replace(/\D/g, '');
}

/** Resumo por telefone, sem despejar o payload inteiro na resposta. */
function summarize(phone: string, r: GetChatDetailsResult) {
  const d: ChatDetails | null = r.details;
  return {
    phone,
    ok: !!d,
    from_cache: r.from_cache,
    source_instance: r.source_instance,
    name: d ? pickBestName(d) : null,
    has_image: !!(d?.image || d?.image_preview),
    is_group: d?.is_group ?? null,
    common_groups: d?.common_groups.length ?? 0,
    labels: d?.wa_labels.length ?? 0,
    error: r.error,
  };
}

async function resolveInstanceName(requested?: string): Promise<string | null> {
  if (requested) return requested;
  // Sem instância declarada: usa a primeira ativa só como âncora do cache
  // (a busca em si atravessa todas as instâncias mesmo).
  const { data } = await ext
    .from('whatsapp_instances')
    .select('instance_name')
    .eq('is_active', true)
    .order('instance_name')
    .limit(1)
    .maybeSingle();
  return (data as any)?.instance_name || null;
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const mode: string = body.mode || (body.phones ? 'batch' : body.phone ? 'single' : 'stale');
    const applyToContact = body.apply_to_contact !== false; // default: aplica
    const refresh = !!body.refresh;
    const preview = body.preview === true;

    const instanceName = await resolveInstanceName(body.instance_name);
    if (!instanceName) {
      return res.json({ success: false, error: 'nenhuma instância ativa encontrada' });
    }

    const instances = await loadInstances();
    if (instances.length === 0) {
      return res.json({ success: false, error: 'nenhuma instância com token disponível' });
    }

    const maxAgeMs = body.max_age_hours
      ? Number(body.max_age_hours) * 60 * 60 * 1000
      : DEFAULT_TTL_MS;

    // ---------- single ----------
    if (mode === 'single') {
      const phone = digits(body.phone);
      if (!phone) return res.json({ success: false, error: 'phone é obrigatório' });

      const result = await getChatDetails({ phone, instanceName, instances, refresh, preview, maxAgeMs });
      let applied = null;
      if (applyToContact && result.details) {
        applied = await applyDetailsToContact(phone, result.details);
      }
      return res.json({
        success: !!result.details,
        mode,
        instance_name: instanceName,
        result: summarize(phone, result),
        // O payload completo só vai no modo single — é o único em que alguém
        // vai realmente olhar campo a campo.
        details: result.details,
        contact: applied,
        error: result.error,
      });
    }

    // ---------- batch ----------
    if (mode === 'batch') {
      const phones: string[] = Array.isArray(body.phones) ? body.phones.map(digits).filter(Boolean) : [];
      if (phones.length === 0) return res.json({ success: false, error: 'phones (array) é obrigatório' });
      if (phones.length > STALE_MAX_LIMIT) {
        return res.json({ success: false, error: `máximo ${STALE_MAX_LIMIT} telefones por chamada` });
      }

      const map = await getChatDetailsBatch(phones, {
        instanceName,
        instances,
        refresh,
        preview,
        maxAgeMs,
        concurrency: DEFAULT_CONCURRENCY,
      });

      const results: any[] = [];
      let contactsUpdated = 0;
      for (const [phone, r] of map.entries()) {
        if (applyToContact && r.details) {
          const applied = await applyDetailsToContact(phone, r.details);
          if (applied.updated) contactsUpdated++;
        }
        results.push(summarize(phone, r));
      }

      return res.json({
        success: true,
        mode,
        instance_name: instanceName,
        requested: phones.length,
        resolved: results.filter((r) => r.ok).length,
        from_cache: results.filter((r) => r.from_cache).length,
        contacts_updated: contactsUpdated,
        results,
      });
    }

    // ---------- stale ----------
    if (mode === 'stale') {
      const limit = Math.min(Number(body.limit) || STALE_DEFAULT_LIMIT, STALE_MAX_LIMIT);
      const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

      let query = ext
        .from('whatsapp_chat_details_cache')
        .select('instance_name, phone, fetched_at, sync_attempts')
        .lt('fetched_at', cutoff)
        // Número que já falhou MAX_SYNC_ATTEMPTS vezes sai da fila: sem isso
        // um número inválido é retentado a cada rodada, para sempre, e ocupa
        // as vagas de quem ainda dá para resolver.
        .lt('sync_attempts', MAX_SYNC_ATTEMPTS)
        .order('fetched_at', { ascending: true })
        .limit(limit);

      if (body.instance_name) query = query.ilike('instance_name', body.instance_name);

      const { data: staleRows, error: staleErr } = await query;
      if (staleErr) return res.json({ success: false, error: `leitura do cache falhou: ${staleErr.message}` });

      const rows = (staleRows as any[]) || [];
      if (rows.length === 0) {
        return res.json({ success: true, mode, scanned: 0, refreshed: 0, message: 'nada vencido no cache' });
      }

      const results: any[] = [];
      let contactsUpdated = 0;
      let refreshed = 0;

      // Agrupa por instância dona da linha: renovar com a instância que já
      // resolveu o número antes acerta de primeira na maioria dos casos.
      const byInstance = new Map<string, string[]>();
      for (const r of rows) {
        const list = byInstance.get(r.instance_name) || [];
        list.push(r.phone);
        byInstance.set(r.instance_name, list);
      }

      for (const [inst, phones] of byInstance.entries()) {
        const map = await getChatDetailsBatch(phones, {
          instanceName: inst,
          instances,
          refresh: true, // já sabemos que está vencido
          preview,
          concurrency: DEFAULT_CONCURRENCY,
        });
        for (const [phone, r] of map.entries()) {
          if (r.details) refreshed++;
          if (applyToContact && r.details) {
            const applied = await applyDetailsToContact(phone, r.details);
            if (applied.updated) contactsUpdated++;
          }
          results.push(summarize(phone, r));
        }
      }

      return res.json({
        success: true,
        mode,
        scanned: rows.length,
        refreshed,
        failed: rows.length - refreshed,
        contacts_updated: contactsUpdated,
        oldest_seen: rows[0]?.fetched_at || null,
        // Só os que falharam: a lista inteira polui o log do cron sem ajudar.
        failures: results.filter((r) => !r.ok).slice(0, 20),
      });
    }

    return res.json({ success: false, error: `mode inválido: ${mode} (use single | batch | stale)` });
  } catch (e) {
    console.error('[sync-chat-details] erro:', e);
    return res.json({ success: false, error: String((e as Error)?.message || e) });
  }
};
