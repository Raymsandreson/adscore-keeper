// Enviar pela MESMA instância de onde a indicação veio.
//
// Por que não usar `enviarTextoUazapi` do `inss-zap`: lá o casamento da
// instância é `.eq('instance_name', …)` + `is_active`, e a grafia gravada na
// indicação nem sempre bate com a do cadastro — o webhook grava "CRIS" onde o
// cadastro diz "Cris". Conferido no banco em 15/09/2026: das 1.437 indicações,
// 1.424 casam exato e ativas, 7 só casam ignorando a caixa ou estão inativas, e
// 6 não casam de jeito nenhum. Treze envios que falhariam com status 0 e sem
// erro visível.
//
// O `referral-outreach` já resolvia isso com `ilike` desde o começo; esta função
// é aquele caminho, extraído para os dois lados usarem o mesmo.
//
// E não existe fallback para "qualquer instância ativa" de propósito: a pessoa
// conversou com UM número da casa. Mandar de outro é uma mensagem de
// desconhecido dizendo que sabe do caso dela.
import { supabase } from './supabase';

export interface ResultadoDeEnvio {
  ok: boolean;
  status: number;
  externalId: string | null;
  erro?: string;
}

export async function enviarPelaInstanciaDaIndicacao(args: {
  /** Só dígitos, com DDI — como `referrals` guarda. */
  telefone: string;
  texto: string;
  instanceName: string | null;
}): Promise<ResultadoDeEnvio> {
  if (!args.telefone) return { ok: false, status: 0, externalId: null, erro: 'sem telefone de destino' };
  if (!args.instanceName) return { ok: false, status: 0, externalId: null, erro: 'indicação sem instância de origem' };

  const { data: inst } = await supabase
    .from('whatsapp_instances')
    .select('instance_token, base_url')
    .ilike('instance_name', args.instanceName)
    .limit(1)
    .maybeSingle();

  const token = (inst as any)?.instance_token;
  const baseUrl = (inst as any)?.base_url || 'https://abraci.uazapi.com';
  if (!token) return { ok: false, status: 0, externalId: null, erro: 'instância sem token' };

  try {
    const resposta = await fetch(`${String(baseUrl).replace(/\/$/, '')}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number: args.telefone, text: args.texto }),
    });
    const json: any = await resposta.json().catch(() => null);
    const externalId = json?.id || json?.messageId || json?.key?.id || null;
    if (!resposta.ok) {
      return { ok: false, status: resposta.status, externalId: null, erro: `o WhatsApp recusou (${resposta.status})` };
    }
    return { ok: true, status: resposta.status, externalId };
  } catch (e: any) {
    return { ok: false, status: 0, externalId: null, erro: `falha de rede no envio: ${e?.message || 'desconhecida'}` };
  }
}
