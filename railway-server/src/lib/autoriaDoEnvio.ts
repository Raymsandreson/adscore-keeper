// Autoria do envio — quem da equipe mandou a mensagem que saiu pelo Railway.
//
// Espelha o que a edge `send-whatsapp` v28 faz no canal UazAPI: grava em
// `whatsapp_message_authors` (Externo) o autor do envio, chaveado pelo id da
// mensagem no WhatsApp. Existe porque `whatsapp_messages` não tem coluna de
// autor e a assinatura `*Nome:*` só cabe em texto — áudio e mídia saíam sem
// nenhuma pista de quem falou com o cliente.
//
// O autor vem do JWT do usuário (validado no Cloud por `verifyCloudJwt`), NUNCA
// do body: ninguém assina no lugar de outro. Chamada de robô/cron (que usa
// x-api-key, sem JWT) fica corretamente sem autor.
//
// Best-effort: qualquer falha vira log. A mensagem já foi entregue ao cliente
// quando isto roda; não existe cenário em que valha a pena estourar aqui.
import type { Request } from 'express';
import { supabase } from './supabase';
import { verifyCloudJwt } from './functionAuth';

const CLOUD_URL =
  process.env.CLOUD_FUNCTIONS_URL || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

/** user_id -> nome de exibição. Vive enquanto o processo viver. */
const nomePorUsuario = new Map<string, string | null>();

/**
 * Nome de quem enviou. Lê `profiles` do Cloud com o token do PRÓPRIO usuário
 * (RLS deixa ler o próprio perfil) — o Railway não tem service role do Cloud.
 * Sem nome, devolve null e a linha fica só com o user_id.
 */
async function nomeDoUsuario(userId: string, token: string): Promise<string | null> {
  if (nomePorUsuario.has(userId)) return nomePorUsuario.get(userId) ?? null;
  try {
    const r = await fetch(
      `${CLOUD_URL}/rest/v1/profiles?select=full_name&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      { headers: { Authorization: `Bearer ${token}`, apikey: CLOUD_ANON_KEY } },
    );
    if (!r.ok) return null;
    const rows: any = await r.json().catch(() => null);
    const nome = Array.isArray(rows) && rows[0]?.full_name ? String(rows[0].full_name) : null;
    nomePorUsuario.set(userId, nome);
    return nome;
  } catch {
    return null;
  }
}

export interface AutoriaDoEnvio {
  externalMessageId: string | null | undefined;
  phone?: string | null;
  instanceName?: string | null;
}

/**
 * Registra quem mandou. Sem id externo não há como amarrar a mensagem, e sem
 * JWT de usuário não há autor — os dois casos saem em silêncio.
 */
export async function registrarAutoriaDoEnvio(req: Request, dados: AutoriaDoEnvio): Promise<void> {
  const eid = dados.externalMessageId;
  if (!eid) return;
  try {
    const authHeader = req.headers.authorization;
    const verdict = await verifyCloudJwt(authHeader);
    if (!verdict.ok || !verdict.userId) return;

    const token = (authHeader || '').slice(7).trim();
    const nome = await nomeDoUsuario(verdict.userId, token);

    const { error } = await supabase
      .from('whatsapp_message_authors')
      .upsert(
        {
          external_message_id: eid,
          phone: dados.phone || null,
          instance_name: dados.instanceName || null,
          sent_by_user_id: verdict.userId,
          sent_by_name: nome,
        } as any,
        { onConflict: 'external_message_id', ignoreDuplicates: true },
      );
    if (error) console.warn('[autoria] não gravada:', error.code, error.message);
  } catch (e: any) {
    console.warn('[autoria] não gravada:', e?.message);
  }
}
