// =============================================================================
// jm-doc-url — assina a URL de uma peça dos autos, e só para usuário logado.
// Roda no projeto EXTERNO (kmedldlepwiityjsdahz), onde vive o bucket jm-autos.
//
// POR QUE NÃO UMA POLICY NO BUCKET: `jm-autos` é privado, e a primeira versão
// desta feature liberou `select` em storage.objects para o role `authenticated`.
// Só que o app entra no Externo com signInAnonymously e a chave anônima está no
// bundle — na prática "authenticated" ali é qualquer um que abra o JS. Isso já
// vale para o resto da base, mas passar a valer para PDF de autos, com peça
// RESTRITA entrando agora pelo certificado, é outra conversa. A policy foi
// removida junto com o deploy desta função.
//
// QUEM É O USUÁRIO: o login de verdade da equipe é no projeto CLOUD
// (gliigkupoebmlbwyvijp). Esta função valida o token do chamador contra o
// /auth/v1/user DE LÁ — a URL e a publishable key do cloud são públicas (estão
// no bundle), então não é segredo que precise de secret. Sessão anônima é
// recusada: é exatamente a que qualquer um consegue sozinho.
//
// verify_jwt = false de propósito: o token que chega é do CLOUD e o gateway do
// Externo não sabe validá-lo. A checagem é a daqui, não a do gateway.
//
// A URL assinada vale 1 hora.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const CLOUD_URL = "https://gliigkupoebmlbwyvijp.supabase.co";
const CLOUD_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38";

const BUCKET = "jm-autos";
const VALIDADE_S = 3600;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, motivo: "SEM_AUTORIZACAO" }, 401);

    // 1. o token é de um usuário real do cloud?
    const quem = await fetch(`${CLOUD_URL}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: CLOUD_ANON },
    });
    if (!quem.ok) return json({ ok: false, motivo: "NAO_AUTENTICADO" }, 401);
    const user = await quem.json();
    if (!user?.id || user?.is_anonymous) return json({ ok: false, motivo: "SESSAO_ANONIMA" }, 401);

    const { documento_id } = await req.json();
    const id = Number(documento_id);
    if (!Number.isFinite(id)) return json({ ok: false, motivo: "DOCUMENTO_INVALIDO" }, 400);

    // 2. a peça, pelo service role deste projeto
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: doc, error: docErr } = await sb
      .from("jm_documentos")
      .select("id, processo_cnj, titulo, tipo, storage_path")
      .eq("id", id)
      .maybeSingle();

    if (docErr) return json({ ok: false, motivo: "CONSULTA_FALHOU", erro: docErr.message }, 500);
    if (!doc) return json({ ok: false, motivo: "DOCUMENTO_NAO_ENCONTRADO" }, 404);
    if (!doc.storage_path) return json({ ok: false, motivo: "NAO_ARQUIVADA" }, 409);

    const { data: assinado, error: signErr } = await sb
      .storage.from(BUCKET).createSignedUrl(doc.storage_path, VALIDADE_S);
    if (signErr || !assinado?.signedUrl) {
      return json({ ok: false, motivo: "ASSINATURA_FALHOU", erro: signErr?.message }, 500);
    }

    return json({
      ok: true,
      url: assinado.signedUrl,
      expira_em_s: VALIDADE_S,
      documento: { id: doc.id, titulo: doc.titulo, tipo: doc.tipo, processo_cnj: doc.processo_cnj },
    });
  } catch (e) {
    return json({ ok: false, motivo: "ERRO", erro: String((e as Error)?.message ?? e) }, 500);
  }
});
