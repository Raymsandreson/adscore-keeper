// whatsapp-optout v1 (projeto externo kmedldlepwiityjsdahz)
//
// Ponto único de registro de "não me mande mais mensagem".
//
// POR QUE ESTA FUNÇÃO EXISTE: medido no Externo em 24/08/2026, os cinco números
// que morreram no último mês tinham 43,7% a 58,0% de conversas abertas por nós
// que nunca receberam resposta; os que seguem vivos ficam entre 13,0% e 38,7%.
// Somado a isso, 461 conversas mudas receberam 2+ mensagens de cobrança. Sem uma
// saída barata, quem não quer só pode ignorar (envenena a instância) ou denunciar
// (mata a instância). Aqui a saída é registrada e passa a valer de verdade: a
// edge send-whatsapp consulta `whatsapp_optouts` antes de todo envio 1:1.
//
// O QUE UM REGISTRO FAZ, em ordem:
//   1. grava a linha em `whatsapp_optouts` (o pedido nunca é apagado — é a nossa
//      defesa se a pessoa reclamar depois; LGPD art. 18);
//   2. fecha os leads ABERTOS daquele número (RPC wa_optout_fecha_leads);
//   3. desliga o agente de IA e o follow-up naquela conversa — sem isso o
//      wjia-followup-processor continua cutucando quem acabou de pedir para sair.
//
// ROLLBACK: apagar esta pasta e redeployar. Quem chama trata falha como não-fatal.
// @ts-ignore
import { createClient } from 'npm:@supabase/supabase-js@2';

const EXT_URL = Deno.env.get('SUPABASE_URL') ?? '';
const EXT_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Status do lead de quem pediu para sair.
//
// 'refused' e NÃO 'closed' de propósito: neste banco `closed` significa VIROU
// CLIENTE — dispara `auto_stamp_became_client_date` (carimba became_client_date)
// e `auto_classify_contacts_on_lead_close` (marca os contatos como 'client').
// Fechar como closed quem pediu para nunca mais ser contatado criaria cliente
// falso. 'refused' tira o card do funil igual, vira etiqueta 'refused' no
// WhatsApp pela trigger notify_lead_result_label_change, e não cria cliente.
// Para trocar: é só esta linha (e o default de p_status na migration).
const OPTOUT_LEAD_STATUS = 'refused';

const OPTOUT_REASON_PADRAO = 'Pediu para não receber mais mensagens (opt-out WhatsApp)';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/**
 * Chave canônica do telefone: 55 + DDD + 8 últimos dígitos.
 *
 * Espelha `public.wa_optout_key(text)` do banco — mudar aqui exige mudar lá.
 * Existe porque o mesmo número aparece nas duas formas em whatsapp_messages:
 * 1.372 números com 12 dígitos (sem o 9º) e 729 com 13 (com o 9º) nos últimos
 * 30 dias. Sem isso, opt-out registrado numa forma não bloqueia a outra.
 */
export function optoutKey(raw: unknown): string | null {
  let v = String(raw ?? '').replace(/@.*$/, '').replace(/\D/g, '');
  if (!v) return null;
  if (v.length >= 10 && v.length <= 11) v = '55' + v;
  if (v.startsWith('55') && v.length === 13 && v[4] === '9') v = v.slice(0, 4) + v.slice(5);
  return v || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const ext = createClient(EXT_URL, EXT_KEY);
    const body = await req.json();
    const action = String(body?.action || 'register').toLowerCase();
    const key = optoutKey(body?.phone);

    if (!key) return jsonResp({ success: false, error: 'phone inválido' }, 400);

    // ---------- CHECK ----------
    if (action === 'check') {
      const { data } = await ext
        .from('whatsapp_optouts')
        .select('id, created_at, source, instance_name')
        .eq('phone_key', key)
        .is('revoked_at', null)
        .maybeSingle();
      return jsonResp({ success: true, opted_out: !!data, optout: data || null });
    }

    // ---------- REVOKE ----------
    // A pessoa voltou a falar conosco e pediu para retomar. A linha original
    // permanece: revogar é carimbar, nunca apagar.
    if (action === 'revoke') {
      const { data, error } = await ext
        .from('whatsapp_optouts')
        .update({
          revoked_at: new Date().toISOString(),
          revoked_reason: body?.reason || 'Retomado a pedido do contato',
        })
        .eq('phone_key', key)
        .is('revoked_at', null)
        .select('id');
      if (error) return jsonResp({ success: false, error: error.message }, 500);
      return jsonResp({ success: true, revoked: data?.length || 0 });
    }

    // ---------- REGISTER ----------
    const instanceName = body?.instance_name || null;

    // Já registrado: não duplica, não refaz o fechamento do lead — só confirma.
    const { data: jaExiste } = await ext
      .from('whatsapp_optouts')
      .select('id, created_at')
      .eq('phone_key', key)
      .is('revoked_at', null)
      .maybeSingle();

    if (jaExiste) {
      return jsonResp({
        success: true,
        already_registered: true,
        optout_id: jaExiste.id,
        leads_fechados: 0,
      });
    }

    const { data: inserido, error: erroInsert } = await ext
      .from('whatsapp_optouts')
      .insert({
        phone_key: key,
        phone_raw: String(body?.phone ?? ''),
        instance_name: instanceName,
        lead_id: body?.lead_id || null,
        source: body?.source || 'whatsapp_text',
        reason: body?.reason || OPTOUT_REASON_PADRAO,
        message_text: body?.message_text || null,
        created_by: body?.created_by || null,
      })
      .select('id')
      .single();

    // 23505 = corrida com outro registro do mesmo número. Não é erro para quem
    // chamou: o resultado desejado (número fora da lista) está valendo.
    if (erroInsert && erroInsert.code !== '23505') {
      console.error('[whatsapp-optout] insert falhou:', erroInsert.code, erroInsert.message);
      return jsonResp({ success: false, error: erroInsert.message }, 500);
    }

    // Fecha os leads abertos desse número.
    let leadsFechados: string[] = [];
    const { data: fechados, error: erroRpc } = await ext.rpc('wa_optout_fecha_leads', {
      p_phone_key: key,
      p_reason: body?.reason || OPTOUT_REASON_PADRAO,
      p_status: body?.lead_status || OPTOUT_LEAD_STATUS,
      // O webhook já sabe o lead da conversa. Passar o id alcança o cadastro
      // que tem vínculo e não tem telefone — 9.824 dos 21.439 leads estão com
      // lead_phone nulo.
      p_lead_id: body?.lead_id || null,
    });
    if (erroRpc) {
      // O opt-out já está gravado e o gate de envio já vale. Não fechar o card
      // é problema de CRM, não de compliance — não derruba a resposta.
      console.error('[whatsapp-optout] rpc wa_optout_fecha_leads falhou:', erroRpc.message);
    } else if (Array.isArray(fechados)) {
      leadsFechados = fechados.map((r: any) => (typeof r === 'string' ? r : r?.id ?? r)).filter(Boolean);
    }

    // Desliga agente de IA e follow-up automático na conversa. Sem isto o
    // wjia-followup-processor volta a cutucar quem acabou de pedir para sair.
    try {
      let q = ext
        .from('whatsapp_conversation_agents')
        .update({ is_active: false, is_blocked: true })
        .eq('phone', String(body?.phone ?? '').replace(/\D/g, ''));
      if (instanceName) q = q.eq('instance_name', instanceName);
      await q;
    } catch (e) {
      console.warn('[whatsapp-optout] não consegui desligar o agente:', (e as any)?.message);
    }

    console.log('[whatsapp-optout] registrado', {
      // telefone mascarado no log: só os 4 últimos dígitos
      phone: `***${key.slice(-4)}`,
      instance_name: instanceName,
      source: body?.source || 'whatsapp_text',
      leads_fechados: leadsFechados.length,
    });

    return jsonResp({
      success: true,
      optout_id: inserido?.id || null,
      leads_fechados: leadsFechados.length,
      lead_ids: leadsFechados,
      lead_status_aplicado: body?.lead_status || OPTOUT_LEAD_STATUS,
    });
  } catch (e) {
    console.error('[whatsapp-optout] erro:', (e as any)?.message);
    return jsonResp({ success: false, error: (e as any)?.message || 'erro' }, 500);
  }
});
