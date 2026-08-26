// ============================================================================
// Envio da mensagem do INSS para o grupo do cliente: resolver grupo, redigir
// e entregar. Vive fora do handler porque o despachante da fila (fora da
// janela de 8h–20h) precisa exatamente das mesmas funções.
// ============================================================================

import { supabase } from './supabase';
import { geminiChat } from './gemini';
import {
  fallbackMensagemCliente,
  promptMensagemCliente,
  mascararDocumentos,
  type EntradaMensagemCliente,
  type TipoMensagemCliente,
} from './inss-mensagem-cliente';

export interface GrupoDestino {
  group_jid: string;
  group_name: string | null;
  instance_name: string | null;
}

/**
 * Grupo do lead, com a MESMA política do front (`src/lib/leadWhatsAppTarget.ts`):
 * um grupo vinculado manda; vários, só se o campo legado `leads.whatsapp_group_id`
 * desempatar; sem desempate, RECUSA.
 *
 * Até 26/08/2026 aqui era `.limit(1)` sem ordenação — 36 leads têm mais de um
 * grupo (35 com dois, 1 com quatro) e a linha que voltasse primeiro decidia.
 * Mensagem no grupo errado é vazamento de dado de cliente para outro cliente,
 * então na dúvida não se manda.
 */
export async function resolverGrupoDoLead(
  leadId: string | null | undefined,
): Promise<{ grupo: GrupoDestino; erro?: undefined } | { grupo?: undefined; erro: string }> {
  if (!leadId) return { erro: 'sem lead' };
  const { data, error } = await supabase
    .from('lead_whatsapp_groups')
    .select('group_jid, group_name, instance_name')
    .eq('lead_id', leadId);
  if (error) return { erro: `falha ao ler grupos: ${error.message}` };
  const grupos = (data || []).filter((g: any) => g.group_jid) as GrupoDestino[];
  if (grupos.length === 0) return { erro: 'lead sem grupo vinculado' };
  if (grupos.length === 1) return { grupo: grupos[0] };

  const { data: lead } = await supabase
    .from('leads')
    .select('whatsapp_group_id')
    .eq('id', leadId)
    .maybeSingle();
  const legado = (lead as any)?.whatsapp_group_id as string | undefined;
  const escolhido = legado ? grupos.find((g) => g.group_jid === legado) : undefined;
  if (escolhido) return { grupo: escolhido };
  return { erro: `lead com ${grupos.length} grupos e sem desempate` };
}

/** Manda o texto pela UazAPI, preferindo a instância anotada no grupo. */
export async function enviarTextoUazapi(args: {
  group_jid: string;
  text: string;
  instance_name?: string | null;
}): Promise<{ ok: boolean; status: number; body?: any }> {
  let q = supabase
    .from('whatsapp_instances')
    .select('id, instance_name, instance_token, base_url')
    .eq('is_active', true);
  if (args.instance_name) q = q.eq('instance_name', args.instance_name);
  const { data: instances } = await q.limit(1);
  const inst = instances?.[0];
  if (!inst) return { ok: false, status: 0, body: 'no active instance' };
  const base = (inst.base_url || 'https://abraci.uazapi.com').replace(/\/$/, '');
  const resp = await fetch(`${base}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: inst.instance_token },
    body: JSON.stringify({ number: args.group_jid, text: args.text }),
  });
  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    body = await resp.text().catch(() => null);
  }
  return { ok: resp.ok, status: resp.status, body };
}

/**
 * Texto final da mensagem. A IA reescreve o despacho do INSS em linguagem
 * simples; qualquer falha (sem chave, timeout, resposta vazia) cai no texto
 * determinístico, que já é uma mensagem correta — cliente nunca fica sem aviso
 * por causa de API de terceiro. A máscara de documento roda nos dois caminhos.
 */
export async function montarTextoMensagemCliente(
  tipo: TipoMensagemCliente,
  entrada: EntradaMensagemCliente,
): Promise<{ texto: string; via: 'ia' | 'fallback' }> {
  const prompt = promptMensagemCliente(tipo, entrada);
  if (prompt && process.env.GOOGLE_AI_API_KEY) {
    try {
      const j = await geminiChat({
        model: 'google/gemini-3.6-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
      });
      const txt = j?.choices?.[0]?.message?.content?.trim();
      if (txt) return { texto: mascararDocumentos(txt), via: 'ia' };
    } catch (e) {
      console.warn('[inss-zap] IA falhou, usando texto fixo:', e instanceof Error ? e.message : e);
    }
  }
  return { texto: mascararDocumentos(fallbackMensagemCliente(tipo, entrada)), via: 'fallback' };
}

/**
 * Já avisamos esse cliente sobre esse mesmo desfecho? 108 pares
 * (processo, status) se repetem no histórico — um deles 7 vezes — e 164 eventos
 * repetem status já visto. Sem esta trava o grupo recebe a mesma notícia de novo.
 */
export async function jaAvisouEsseTipo(processId: string, tipo: TipoMensagemCliente): Promise<boolean> {
  const { data } = await supabase
    .from('inss_status_history')
    .select('id')
    .eq('process_id', processId)
    .eq('zap_tipo', tipo)
    .in('zap_status', ['enviado', 'agendado'])
    .limit(1);
  return (data?.length || 0) > 0;
}
