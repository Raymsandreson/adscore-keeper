/**
 * whatsapp-cloud-templates — templates aprovados da WABA da linha, para a tela.
 *
 * Existe separado de `whatsapp-cloud-waba-apps` de propósito: aquela função
 * inscreve/desinscreve App, atribui task de System User e cria template. Expor
 * ela ao front daria a qualquer usuário logado o poder de derrubar o webhook da
 * WABA. Esta aqui só LÊ, e nem aceita `waba_id` do chamador — resolve pelo
 * `instance_name` da conversa, então não dá pra sondar WABA de terceiro.
 *
 * Template é por WABA: oferecer a lista da ABRACI numa conversa da Prudêncio
 * faria a Meta recusar no envio ("template não existe"). Por isso a linha manda.
 *
 * Devolve o corpo do template junto: a tela precisa dele pra mostrar ao
 * atendente o texto exato que o cliente vai receber antes de mandar.
 */

import { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';

const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || '';
const API_VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0';
const GRAPH = 'https://graph.facebook.com';

export const handler: RequestHandler = async (req, res) => {
  if (!TOKEN) {
    res.status(200).json({ success: false, error: 'WHATSAPP_CLOUD_TOKEN ausente no Railway', templates: [] });
    return;
  }

  try {
    const linhaPedida = String((req.body as any)?.instance_name || '').trim();
    let q = supabase.from('whatsapp_cloud_config').select('waba_id, instance_name').eq('is_active', true);
    if (linhaPedida) q = (q as any).eq('instance_name', linhaPedida);
    // Sem linha explícita, a primeira ativa: mantém o comportamento de quando
    // só existia uma. maybeSingle() aqui virava erro assim que houvesse duas.
    const { data: cfgs, error: cfgErr } = await (q as any).order('instance_name').limit(1);

    if (cfgErr) {
      res.status(200).json({ success: false, error: 'Falha lendo config Cloud', templates: [] });
      return;
    }
    const cfg = Array.isArray(cfgs) ? cfgs[0] : cfgs;
    const wabaId = (cfg as any)?.waba_id;
    if (!wabaId) {
      res.status(200).json({
        success: false,
        error: linhaPedida
          ? `Linha "${linhaPedida}" não tem WABA ativa configurada`
          : 'Cloud API sem WABA ativa configurada',
        templates: [],
      });
      return;
    }

    const r = await fetch(
      `${GRAPH}/${API_VERSION}/${wabaId}/message_templates?fields=name,status,language,category,components&limit=100`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    const out: any = await r.json();
    if (out?.error) {
      res.status(200).json({ success: false, error: out.error.message, code: out.error.code, templates: [] });
      return;
    }

    const templates = (out?.data || []).map((t: any) => {
      const comps = t.components || [];
      const bodyText = comps.find((c: any) => c.type === 'BODY')?.text || '';
      return {
        name: t.name,
        status: t.status,
        language: t.language,
        category: t.category,
        body_text: bodyText,
        footer_text: comps.find((c: any) => c.type === 'FOOTER')?.text || null,
        // Quantos {{n}} o corpo espera — é o tamanho exato de template_params no envio.
        body_params: (bodyText.match(/\{\{\d+\}\}/g) || []).length,
      };
    });

    // Devolve TODOS com o status: uma lista vazia porque tudo está PENDING é
    // informação, e some se filtrarmos aqui. Quem escolhe o que exibir é a tela.
    res.status(200).json({ success: true, waba_id: wabaId, instance_name: (cfg as any)?.instance_name || null, templates });
  } catch (err) {
    res.status(200).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      templates: [],
    });
  }
};
