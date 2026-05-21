// Gerencia etiquetas (labels) de uma instância UazAPI: criar, editar, excluir.
//
// Body: {
//   instance_name: string,
//   action: 'create' | 'update' | 'delete',
//   id?: string,        // obrigatório em update/delete
//   name?: string,      // obrigatório em create/update
//   color?: string,     // opcional (hex ou nome)
// }
// Retorno HTTP 200: { success, label?, error?, code? }
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

export const handler: RequestHandler = async (req, res) => {
  try {
    const { instance_name, action, id, name, color } = req.body || {};
    if (!instance_name || typeof instance_name !== 'string') {
      return res.json({ success: false, error: 'instance_name é obrigatório' });
    }
    if (!['create', 'update', 'delete'].includes(action)) {
      return res.json({ success: false, error: "action deve ser 'create' | 'update' | 'delete'" });
    }
    if ((action === 'update' || action === 'delete') && !id) {
      return res.json({ success: false, error: 'id é obrigatório para update/delete' });
    }
    if ((action === 'create' || action === 'update') && !name) {
      return res.json({ success: false, error: 'name é obrigatório para create/update' });
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
    if (!token) return res.json({ success: false, error: 'instance_token ausente' });

    let path = '';
    let body: any = {};
    if (action === 'delete') {
      path = '/labels/delete';
      body = { id };
    } else {
      // UazAPI: /labels/edit faz create (sem id) e update (com id)
      path = '/labels/edit';
      body = { name, color: color || null };
      if (action === 'update') body.id = id;
    }

    const r = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify(body),
    });
    const txt = await r.text();

    if (!r.ok) {
      if (/no session/i.test(txt) || r.status === 401) {
        return res.json({
          success: false,
          error: `A instância "${instance_name}" está desconectada do WhatsApp. Reconecte escaneando o QR code e tente de novo.`,
          code: 'INSTANCE_DISCONNECTED',
        });
      }
      return res.json({ success: false, error: `UazAPI ${r.status}: ${txt.slice(0, 200)}` });
    }

    let data: any = null;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    return res.json({ success: true, label: data?.label || data });
  } catch (err: any) {
    console.error('[manage-uazapi-label] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};
