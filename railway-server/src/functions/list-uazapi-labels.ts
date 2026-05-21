// Lista etiquetas (labels) de uma instância UazAPI.
// Usado pela tela "Etiquetas-Gatilho" no painel de Configurações.
//
// Body: { instance_name: string, refresh?: boolean }
// Retorno HTTP 200: { success, labels?: Array<{id, name, color, predefinedId}>, error? }
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

export const handler: RequestHandler = async (req, res) => {
  try {
    const { instance_name, refresh } = req.body || {};
    if (!instance_name || typeof instance_name !== 'string') {
      return res.json({ success: false, error: 'instance_name é obrigatório' });
    }

    const { data: inst, error: instErr } = await ext
      .from('whatsapp_instances')
      .select('instance_token, base_url')
      .eq('instance_name', instance_name)
      .limit(1)
      .maybeSingle();

    if (instErr || !inst) {
      return res.json({ success: false, error: `Instância ${instance_name} não encontrada` });
    }

    const baseUrl = (inst.base_url || 'https://abraci.uazapi.com').replace(/\/$/, '');
    const token = inst.instance_token;
    if (!token) {
      return res.json({ success: false, error: 'instance_token ausente' });
    }

    // Opcional: forçar refresh server-side antes de listar
    if (refresh) {
      try {
        await fetch(`${baseUrl}/labels/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token },
        });
      } catch (e) {
        console.warn('[list-uazapi-labels] refresh falhou (não-fatal):', e);
      }
    }

    const r = await fetch(`${baseUrl}/labels`, {
      method: 'GET',
      headers: { token },
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.json({ success: false, error: `UazAPI ${r.status}: ${txt.slice(0, 200)}` });
    }

    const data: any = await r.json();
    // UazAPI retorna array direto OU objeto { labels: [...] } dependendo da versão
    const labels: any[] = Array.isArray(data) ? data : (data?.labels || []);

    const normalized = labels.map((l: any) => ({
      id: String(l.id ?? l.labelId ?? l.labelid ?? ''),
      name: String(l.name ?? l.label ?? ''),
      color: l.color ?? null,
      predefinedId: l.predefinedId ?? null,
    })).filter((l: any) => l.id && l.name);

    return res.json({ success: true, labels: normalized });
  } catch (err: any) {
    console.error('[list-uazapi-labels] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};
