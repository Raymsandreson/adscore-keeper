// =============================================================================
// external-session — sessão DE VERDADE no Supabase Externo para quem está
// logado no Cloud (10/09/2026).
//
// POR QUE. O front autentica no Cloud (gliigkupoebmlbwyvijp), mas as tabelas
// de negócio vivem no Externo (kmedldlepwiityjsdahz). Até hoje o
// `ensureExternalSession` do front fazia `signInAnonymously()` no Externo, e
// qualquer pessoa com a chave anon (que vai no bundle) podia fazer o mesmo e
// virar `authenticated` — 6.277 usuários anônimos contra 55 reais. Toda policy
// que libera `authenticated` liberava qualquer um, e `auth.uid()` não era
// ninguém (por isso existe `auth_uuid_mapping` e o carimbo manual de autoria).
//
// O QUE FAZ. Recebe o JWT do Cloud, confere no /auth/v1/user, acha (ou cria)
// o usuário espelho no Externo — pelo `auth_uuid_mapping` (53 pares, feitos
// quando o Externo ainda tinha login), senão pelo e-mail, senão cria — e
// devolve uma sessão desse usuário: `generateLink(magiclink)` +
// `verifyOtp(token_hash)`, o caminho documentado para emitir sessão do lado
// do servidor. O front aplica com `setSession`; o refresh_token mantém a
// sessão viva sozinho. `auth.uid()` no Externo passa a ser o ext_uuid da
// pessoa, e as policies `is_admin(auth.uid())` (6.339 user_roles) voltam a
// significar alguma coisa.
//
// O QUE NÃO FAZ. Não mexe em senha de ninguém. Não desliga o sign-in anônimo —
// isso é no painel do Auth do Externo, depois de ver esta rota em uso.
//
// CLIENTE DESCARTÁVEL. `verifyOtp` grava a sessão no cliente que a chamou.
// No cliente compartilhado (service role) isso trocaria o Authorization de
// TODA chamada seguinte pelo JWT da pessoa. Por isso um createClient por
// pedido, que morre com a resposta.
// =============================================================================
import type { RequestHandler } from 'express';
import { createClient } from '@supabase/supabase-js';
import { supabase as ext, SUPABASE_URL as EXT_URL, SUPABASE_SERVICE_ROLE_KEY as EXT_SERVICE_KEY } from '../lib/supabase';

const CLOUD_URL =
  process.env.CLOUD_FUNCTIONS_URL || process.env.SUPABASE_URL || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

interface UsuarioCloud { id: string; email: string | null }

/** Quem está logado no Cloud, pelo JWT do header. A anon key não vale como identidade. */
async function usuarioDoCloud(authHeader: string | undefined): Promise<UsuarioCloud | null> {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token || (CLOUD_ANON_KEY && token === CLOUD_ANON_KEY)) return null;
  const r = await fetch(`${CLOUD_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: CLOUD_ANON_KEY },
  });
  if (!r.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u: any = await r.json().catch(() => null);
  if (!u?.id) return null;
  return { id: String(u.id), email: u.email ? String(u.email) : null };
}

/** O usuário espelho no Externo: mapping → e-mail → cria. Sempre grava o mapping. */
async function usuarioExterno(cloud: UsuarioCloud): Promise<{ id: string; email: string; origem: string }> {
  const { data: m } = await ext
    .from('auth_uuid_mapping')
    .select('ext_uuid')
    .eq('cloud_uuid', cloud.id)
    .maybeSingle();
  if (m?.ext_uuid) {
    const { data: u } = await ext.auth.admin.getUserById(m.ext_uuid as string);
    if (u?.user?.email) return { id: u.user.id, email: u.user.email, origem: 'mapping' };
  }

  if (!cloud.email) throw new Error('usuário do Cloud sem e-mail — não dá para achar nem criar o espelho no Externo');

  let extId: string | null = null;
  let origem = 'email';
  const { data: porEmail } = await ext.rpc('ext_user_id_por_email', { p_email: cloud.email });
  if (porEmail) extId = String(porEmail);

  if (!extId) {
    const { data: criado, error } = await ext.auth.admin.createUser({
      email: cloud.email,
      email_confirm: true,
      user_metadata: { cloud_uuid: cloud.id, origem: 'external-session' },
    });
    if (error || !criado?.user) throw new Error(`não consegui criar o usuário espelho: ${error?.message || 'sem retorno'}`);
    extId = criado.user.id;
    origem = 'criado';
  }

  const { data: jaMapeado } = await ext
    .from('auth_uuid_mapping')
    .select('cloud_uuid')
    .eq('cloud_uuid', cloud.id)
    .maybeSingle();
  if (!jaMapeado) {
    const { error: mErr } = await ext
      .from('auth_uuid_mapping')
      .insert({ cloud_uuid: cloud.id, ext_uuid: extId, email: cloud.email });
    if (mErr) console.warn('[external-session] não gravei o mapping:', mErr.message);
  }
  return { id: extId, email: cloud.email, origem };
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const cloud = await usuarioDoCloud(req.headers.authorization);
    if (!cloud) {
      return res.status(401).json({ success: false, error: 'Precisa do login do Cloud (Authorization: Bearer <jwt do usuário>).' });
    }

    const u = await usuarioExterno(cloud);

    const descartavel = createClient(EXT_URL, EXT_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: link, error: linkErr } = await descartavel.auth.admin.generateLink({ type: 'magiclink', email: u.email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      return res.status(502).json({ success: false, error: `Externo não emitiu o link: ${linkErr?.message || 'sem hashed_token'}` });
    }
    const { data: sess, error: otpErr } = await descartavel.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
    if (otpErr || !sess?.session) {
      return res.status(502).json({ success: false, error: `Externo não abriu a sessão: ${otpErr?.message || 'sem sessão'}` });
    }

    console.log(JSON.stringify({ event: 'external_session.emitida', ext_user: u.id, origem: u.origem }));
    return res.json({
      success: true,
      ext_user_id: u.id,
      access_token: sess.session.access_token,
      refresh_token: sess.session.refresh_token,
      expires_at: sess.session.expires_at ?? null,
      expires_in: sess.session.expires_in ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[external-session]', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};
