// update-profile-avatar — troca (ou remove) a foto de perfil do usuário logado.
//
// Por que no Railway e não no navegador: a policy de UPDATE de public.profiles no
// Externo é `auth.uid() = user_id OR is_admin(auth.uid())`, e a sessão do app no
// Externo é ANÔNIMA (external-client.ts → signInAnonymously). O uuid anônimo não
// bate com profiles.user_id nem tem role admin, então o front simplesmente não
// consegue gravar. Aqui a gravação usa service role, e a identidade vem do JWT do
// Cloud — nunca de campo do body (senão qualquer um trocaria a foto de qualquer um).
//
// Fluxo: JWT do Cloud → /auth/v1/user → cloud_uuid → auth_uuid_mapping → ext_uuid
//        → sharp (512px webp) → storage bucket `avatars` → profiles.avatar_url.
//
// POST { image_base64: "data:image/jpeg;base64,..." | "<base64>" }  → troca a foto
// POST { remove: true }                                            → volta pras iniciais
import type { RequestHandler } from 'express';
import sharp from 'sharp';
import { supabase as ext } from '../lib/supabase';

const CLOUD_FUNCTIONS_URL =
  process.env.CLOUD_FUNCTIONS_URL ||
  process.env.SUPABASE_URL ||
  'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const BUCKET = 'avatars';
const AVATAR_PX = 512;
// Teto do payload já decodificado. O front reduz pra ~1024px antes de enviar,
// então 8MB é folga pra foto de celular que escape do resize.
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

/** Só pro log: e-mail nunca inteiro (dado pessoal em log é vazamento). */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 3)}***@${domain}`;
}

/**
 * Identidade real do usuário. O token é do projeto Cloud (é lá que o app
 * autentica), então a validação é contra o /auth/v1/user do Cloud.
 */
async function verifyCloudJwt(authHeader: string | undefined): Promise<{ id: string; email: string } | null> {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  // A anon key é um JWT válido, mas não identifica ninguém.
  if (!token || token === CLOUD_ANON_KEY) return null;
  try {
    const r = await fetch(`${CLOUD_FUNCTIONS_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: CLOUD_ANON_KEY },
    });
    if (!r.ok) return null;
    const u: any = await r.json().catch(() => null);
    if (!u?.id) return null;
    return { id: u.id, email: (u.email || '').toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Acha a linha de profiles do usuário. O uuid do Cloud e o do Externo divergem
 * em 26 dos 52 membros, e profiles.user_id é sempre o do Externo — daí o mapping.
 * O fallback por e-mail cobre quem ainda não tem linha em auth_uuid_mapping.
 */
async function resolveProfile(cloudUserId: string, email: string): Promise<{ id: string; user_id: string; avatar_url: string | null } | null> {
  const { data: mapping } = await ext
    .from('auth_uuid_mapping')
    .select('ext_uuid')
    .eq('cloud_uuid', cloudUserId)
    .maybeSingle();

  const extUuid = (mapping as any)?.ext_uuid || cloudUserId;

  const { data: byUuid } = await ext
    .from('profiles')
    .select('id, user_id, avatar_url')
    .eq('user_id', extUuid)
    .maybeSingle();
  if (byUuid) return byUuid as any;

  if (!email) return null;
  const { data: byEmail } = await ext
    .from('profiles')
    .select('id, user_id, avatar_url')
    .eq('email', email);
  // Só aceita e-mail quando ele identifica uma pessoa só — há homônimos com
  // contas duplicadas na base, e trocar a foto da conta errada é pior que falhar.
  if (byEmail && byEmail.length === 1) return byEmail[0] as any;
  return null;
}

/** Apaga as fotos anteriores da pasta do usuário — evita lixo acumulado no bucket. */
async function removeOldAvatars(folder: string, keep?: string): Promise<void> {
  try {
    const { data: files } = await ext.storage.from(BUCKET).list(folder);
    const stale = (files || [])
      .map((f) => `${folder}/${f.name}`)
      .filter((p) => p !== keep);
    if (stale.length) await ext.storage.from(BUCKET).remove(stale);
  } catch (err) {
    // Limpeza é best-effort: falhar aqui não pode desfazer a troca de foto.
    console.warn('[update-profile-avatar] limpeza do bucket falhou:', err instanceof Error ? err.message : err);
  }
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const auth = await verifyCloudJwt(req.headers.authorization);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Não autenticado' });
      return;
    }

    const profile = await resolveProfile(auth.id, auth.email);
    if (!profile) {
      console.warn(`[update-profile-avatar] perfil não encontrado para ${maskEmail(auth.email)}`);
      res.status(404).json({ success: false, error: 'Perfil não encontrado no banco' });
      return;
    }

    const body = req.body || {};
    const folder = profile.user_id;

    // --- Remover foto ---
    if (body.remove === true) {
      const { error: updErr } = await ext
        .from('profiles')
        .update({ avatar_url: null, updated_at: new Date().toISOString() })
        .eq('id', profile.id);
      if (updErr) {
        res.status(500).json({ success: false, error: `Falha ao remover: ${updErr.message}` });
        return;
      }
      await removeOldAvatars(folder);
      console.log(`[update-profile-avatar] foto removida de ${maskEmail(auth.email)}`);
      res.json({ success: true, avatar_url: null });
      return;
    }

    // --- Trocar foto ---
    const raw = String(body.image_base64 || '').trim();
    if (!raw) {
      res.status(400).json({ success: false, error: 'image_base64 é obrigatório' });
      return;
    }

    const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
    let input: Buffer;
    try {
      input = Buffer.from(base64, 'base64');
    } catch {
      res.status(400).json({ success: false, error: 'Imagem inválida' });
      return;
    }
    if (!input.length) {
      res.status(400).json({ success: false, error: 'Imagem vazia' });
      return;
    }
    if (input.length > MAX_INPUT_BYTES) {
      res.status(413).json({ success: false, error: 'Imagem muito grande (máx. 8MB)' });
      return;
    }

    // O sharp também é a validação de formato: se não for imagem que ele decodifica,
    // lança aqui e nada chega ao bucket.
    let webp: Buffer;
    try {
      webp = await sharp(input)
        .rotate() // respeita o EXIF do celular, senão a foto sobe deitada
        .resize(AVATAR_PX, AVATAR_PX, { fit: 'cover', position: 'attention' })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (err) {
      res.status(400).json({ success: false, error: 'Arquivo não é uma imagem válida' });
      return;
    }

    // Timestamp no nome: a URL muda a cada troca, então o CDN/navegador não
    // devolve a foto antiga em cache.
    const path = `${folder}/${Date.now()}.webp`;
    const { error: upErr } = await ext.storage.from(BUCKET).upload(path, webp, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: true,
    });
    if (upErr) {
      res.status(500).json({ success: false, error: `Falha no upload: ${upErr.message}` });
      return;
    }

    const { data: pub } = ext.storage.from(BUCKET).getPublicUrl(path);
    const avatarUrl = pub?.publicUrl || null;
    if (!avatarUrl) {
      res.status(500).json({ success: false, error: 'Não foi possível gerar a URL pública' });
      return;
    }

    const { error: updErr } = await ext
      .from('profiles')
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('id', profile.id);
    if (updErr) {
      // Grava a foto mas não referencia: apaga o arquivo pra não deixar órfão.
      await ext.storage.from(BUCKET).remove([path]).catch(() => {});
      res.status(500).json({ success: false, error: `Falha ao salvar no perfil: ${updErr.message}` });
      return;
    }

    await removeOldAvatars(folder, path);

    console.log(`[update-profile-avatar] foto atualizada de ${maskEmail(auth.email)} (${Math.round(webp.length / 1024)}KB)`);
    res.json({ success: true, avatar_url: avatarUrl });
  } catch (err) {
    console.error('[update-profile-avatar] erro:', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro interno' });
  }
};
