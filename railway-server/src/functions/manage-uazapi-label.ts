// Gerencia etiquetas (labels) de uma instância UazAPI: criar, editar, excluir.
//
// IMPORTANTE — endpoints reais da UazAPI (descobertos via sondagem em 2026-05):
//   - LISTAR: GET  /labels                       → header `token`
//   - CRIAR : POST /label/edit  body { labelid: "new", name, color }
//   - EDITAR: POST /label/edit  body { labelid, name, color }
//   - DELETE: POST /label/edit  body { labelid, delete: true }
// Não existe /labels/edit nem /labels/delete (devolvem 405). O endpoint é
// singular `/label/edit` e a exclusão é "soft" via flag `delete:true`.
//
// `color` é INTEIRO (0..19+ — paleta da Meta), não hex.
//
// Body aceito por esta função:
// {
//   instance_name: string,
//   action: 'create' | 'update' | 'delete',
//   id?: string,        // obrigatório em update/delete
//   name?: string,      // obrigatório em create/update
//   color?: number,     // opcional (int). Default: 0
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

    // Sempre /label/edit (singular). labelid="new" cria; labelid=ID edita; delete:true remove.
    const body: Record<string, unknown> = {};
    if (action === 'create') {
      body.labelid = 'new';
      body.name = name;
      body.color = typeof color === 'number' ? color : 0;
    } else if (action === 'update') {
      body.labelid = String(id);
      body.name = name;
      body.color = typeof color === 'number' ? color : 0;
    } else {
      body.labelid = String(id);
      body.delete = true;
    }

    const r = await fetch(`${baseUrl}/label/edit`, {
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
