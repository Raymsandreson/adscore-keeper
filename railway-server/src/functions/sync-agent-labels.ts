// Sincroniza um agente IA com etiquetas UazAPI em TODAS as instâncias ativas.
//
// Usa EXATAMENTE o mesmo helper que o dialog "Nova etiqueta" da tela
// Etiquetas-Gatilho usa (manage-uazapi-label). Se uma cria, a outra cria.
//
// Body: { agent_id: string, operation: 'upsert' | 'delete' }
// Retorno HTTP 200: { success, results: Array<{instance_name, ok, action, error?}> }
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import {
  uazapiCreateLabel,
  uazapiUpdateLabel,
  uazapiDeleteLabel,
  uazapiFindLabelByName,
} from '../lib/uazapi-labels';

// COLOR_ACTIVE=5 já vem renderizando como verde no WhatsApp (mesmo
// índice do swatch "Verde" no dialog). COLOR_INACTIVE=10 estava virando
// azul porque a paleta da UazAPI só vai até 9 — 10 dá overflow.
// Cinza = 9 (último item do dropdown "Nova etiqueta").
const COLOR_ACTIVE = 5;   // verde
const COLOR_INACTIVE = 9; // cinza

export const handler: RequestHandler = async (req, res) => {
  try {
    const { agent_id, operation } = (req.body || {}) as { agent_id?: string; operation?: 'upsert' | 'delete' };
    if (!agent_id || typeof agent_id !== 'string') {
      return res.json({ success: false, error: 'agent_id é obrigatório' });
    }
    if (operation !== 'upsert' && operation !== 'delete') {
      return res.json({ success: false, error: "operation deve ser 'upsert' ou 'delete'" });
    }

    const { data: agent, error: agentErr } = await ext
      .from('wjia_command_shortcuts')
      .select('id, shortcut_name, is_active')
      .eq('id', agent_id)
      .maybeSingle();
    if (agentErr) return res.json({ success: false, error: `agent lookup: ${agentErr.message}` });
    if (!agent) return res.json({ success: false, error: `agent ${agent_id} not found` });

    const agentName: string = (agent as any).shortcut_name || '';
    // Prefixo 🤖 identifica visualmente que é etiqueta de AGENTE IA
    // (diferencia das etiquetas de RESULTADO do lead).
    const labelName = `🤖 ${agentName}`;
    const isActive: boolean = !!(agent as any).is_active;
    const color = isActive ? COLOR_ACTIVE : COLOR_INACTIVE;
    const effectiveOp = operation === 'delete' ? 'delete' : 'upsert';

    // Resolve INSTÂNCIAS-ALVO desse agente:
    //  1) Se houver linhas em agent_instance_settings → usar SÓ as habilitadas
    //  2) Senão, fallback: instâncias com default_agent_id = este agente
    //  3) Senão (vazio) → NÃO fanout pra todas. Devolve aviso explícito.
    const { data: scoped, error: scopedErr } = await ext
      .from('agent_instance_settings')
      .select('instance_id, is_enabled')
      .eq('agent_id', agent_id);
    if (scopedErr) return res.json({ success: false, error: `agent_instance_settings: ${scopedErr.message}` });

    let targetQuery = ext
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token, base_url')
      .not('instance_token', 'is', null);

    const scopedEnabledIds = ((scoped || []) as any[]).filter((r) => r.is_enabled).map((r) => r.instance_id);
    if ((scoped || []).length > 0) {
      if (scopedEnabledIds.length === 0) {
        return res.json({ success: true, agent_id, agent_name: agentName, operation: effectiveOp, results: [], note: 'Nenhuma instância habilitada em agent_instance_settings — nada a sincronizar.' });
      }
      targetQuery = targetQuery.in('id', scopedEnabledIds);
    } else {
      targetQuery = targetQuery.eq('default_agent_id', agent_id);
    }

    const { data: instances, error: instErr } = await targetQuery;
    if (instErr) return res.json({ success: false, error: `instances lookup: ${instErr.message}` });
    if (!instances || instances.length === 0) {
      return res.json({ success: true, agent_id, agent_name: agentName, operation: effectiveOp, results: [], note: 'Agente não tem instâncias atribuídas (agent_instance_settings ou default_agent_id). Sync ignorado.' });
    }

    const { data: existingMappings } = await ext
      .from('agent_instance_labels')
      .select('id, instance_name, label_id, label_name, color, deleted_at')
      .eq('agent_id', agent_id);
    const mappingByInstance = new Map<string, any>();
    for (const m of (existingMappings || []) as any[]) {
      mappingByInstance.set(String(m.instance_name).toLowerCase(), m);
    }

    const results: Array<{ instance_name: string; ok: boolean; action: string; error?: string }> = [];

    // DELETE
    if (effectiveOp === 'delete') {
      for (const inst of (instances || []) as any[]) {
        const key = String(inst.instance_name).toLowerCase();
        const mapping = mappingByInstance.get(key);
        if (!mapping || mapping.deleted_at) continue;
        const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
        try {
          const r = await uazapiDeleteLabel(baseUrl, inst.instance_token, mapping.label_id);
          if (!r.ok) {
            const rawErr = `HTTP ${r.status} — ${r.text.slice(0, 300)}`;
            console.warn(`[sync-agent-labels] delete FAIL ${inst.instance_name}: ${rawErr}`);
            results.push({ instance_name: inst.instance_name, ok: false, action: 'delete', error: rawErr });
            continue;
          }
          await ext
            .from('agent_instance_labels')
            .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', mapping.id);
          results.push({ instance_name: inst.instance_name, ok: true, action: 'delete' });
        } catch (e: any) {
          results.push({ instance_name: inst.instance_name, ok: false, action: 'delete', error: e?.message || 'unknown' });
        }
      }
      return res.json({ success: true, agent_id, agent_name: agentName, operation: 'delete', results });
    }

    // UPSERT
    for (const inst of (instances || []) as any[]) {
      const key = String(inst.instance_name).toLowerCase();
      const mapping = mappingByInstance.get(key);
      const baseUrl = inst.base_url || 'https://abraci.uazapi.com';

      try {
        if (mapping && !mapping.deleted_at) {
          if (mapping.label_name === labelName && mapping.color === color) {
            results.push({ instance_name: inst.instance_name, ok: true, action: 'unchanged' });
            continue;
          }
          const r = await uazapiUpdateLabel(baseUrl, inst.instance_token, mapping.label_id, labelName, color);
          if (!r.ok) {
            const rawErr = `HTTP ${r.status} — ${r.text.slice(0, 300)}`;
            console.warn(`[sync-agent-labels] update FAIL ${inst.instance_name}: ${rawErr}`);
            results.push({ instance_name: inst.instance_name, ok: false, action: 'update', error: rawErr });
            continue;
          }
          await ext
            .from('agent_instance_labels')
            .update({ label_name: labelName, color, updated_at: new Date().toISOString(), deleted_at: null })
            .eq('id', mapping.id);
          results.push({ instance_name: inst.instance_name, ok: true, action: 'update' });
        } else {
          // CREATE — exatamente igual ao dialog "Nova etiqueta"
          const r = await uazapiCreateLabel(baseUrl, inst.instance_token, labelName, color);
          if (!r.ok) {
            const rawErr = `HTTP ${r.status} — ${r.text.slice(0, 300)}`;
            console.warn(`[sync-agent-labels] create FAIL ${inst.instance_name}: ${rawErr}`);
            results.push({ instance_name: inst.instance_name, ok: false, action: 'create', error: rawErr });
            continue;
          }
          // UazAPI nem sempre devolve o id na resposta; buscar via /labels se faltar
          const newId = String(
            r.data?.label?.id ?? r.data?.label?.labelid ?? r.data?.id ?? r.data?.labelid ?? '',
          );
          const resolvedId = newId || (await uazapiFindLabelByName(baseUrl, inst.instance_token, labelName))?.id || '';
          if (!resolvedId) {
            results.push({ instance_name: inst.instance_name, ok: false, action: 'create', error: 'created sem label_id retornado' });
            continue;
          }
          await ext
            .from('agent_instance_labels')
            .upsert({
              agent_id,
              instance_name: inst.instance_name,
              label_id: resolvedId,
              label_name: labelName,
              color,
              updated_at: new Date().toISOString(),
              deleted_at: null,
            } as any, { onConflict: 'agent_id,instance_name' });
          results.push({ instance_name: inst.instance_name, ok: true, action: 'create' });
        }
      } catch (e: any) {
        results.push({ instance_name: inst.instance_name, ok: false, action: 'unknown', error: e?.message || 'unknown' });
      }
    }

    return res.json({ success: true, agent_id, agent_name: agentName, operation: 'upsert', color, results });
  } catch (err: any) {
    console.error('[sync-agent-labels] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};
