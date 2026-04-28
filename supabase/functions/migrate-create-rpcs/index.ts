// Replica funções RPC do team chat (start_team_direct_conversation,
// ensure_team_general_conversation, is_team_conversation_member) no Externo.
// Idempotente: usa CREATE OR REPLACE.
//
// POST {} -> aplica no Externo
// POST { dry_run: true } -> só retorna o SQL

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTERNAL_DB_URL = Deno.env.get("EXTERNAL_DB_URL")!;

const RPC_SQL: { name: string; sql: string }[] = [
  {
    name: "is_team_conversation_member",
    sql: `
CREATE OR REPLACE FUNCTION public.is_team_conversation_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_conversation_members
    WHERE conversation_id = _conversation_id
      AND user_id = _user_id
  )
$$;`,
  },
  {
    name: "start_team_direct_conversation",
    // No Externo NÃO usamos auth.uid() (sessão é anônima). Recebemos o caller user_id como segundo arg.
    // Mantemos compatibilidade: assinatura padrão (_other_user_id uuid) e versão estendida com (_other_user_id, _self_user_id).
    sql: `
CREATE OR REPLACE FUNCTION public.start_team_direct_conversation(_other_user_id uuid, _self_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _conversation_id uuid;
BEGIN
  SELECT tc.id
    INTO _conversation_id
  FROM public.team_conversations tc
  JOIN public.team_conversation_members me
    ON me.conversation_id = tc.id AND me.user_id = _self_user_id
  JOIN public.team_conversation_members other_member
    ON other_member.conversation_id = tc.id AND other_member.user_id = _other_user_id
  WHERE tc.type = 'direct'
  LIMIT 1;

  IF _conversation_id IS NOT NULL THEN
    RETURN _conversation_id;
  END IF;

  INSERT INTO public.team_conversations (type, created_by)
  VALUES ('direct', _self_user_id)
  RETURNING id INTO _conversation_id;

  INSERT INTO public.team_conversation_members (conversation_id, user_id)
  VALUES (_conversation_id, _self_user_id), (_conversation_id, _other_user_id)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN _conversation_id;
END;
$$;`,
  },
  {
    name: "ensure_team_general_conversation",
    sql: `
CREATE OR REPLACE FUNCTION public.ensure_team_general_conversation(_self_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _conversation_id uuid;
BEGIN
  SELECT id
    INTO _conversation_id
  FROM public.team_conversations
  WHERE type = 'group'
    AND name = '💬 Chat Geral da Equipe'
  ORDER BY created_at ASC
  LIMIT 1;

  IF _conversation_id IS NULL THEN
    INSERT INTO public.team_conversations (type, name, created_by)
    VALUES ('group', '💬 Chat Geral da Equipe', _self_user_id)
    RETURNING id INTO _conversation_id;
  END IF;

  INSERT INTO public.team_conversation_members (conversation_id, user_id)
  VALUES (_conversation_id, _self_user_id)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN _conversation_id;
END;
$$;`,
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = !!body.dry_run;

    if (dryRun) {
      return new Response(
        JSON.stringify({ success: true, dry_run: true, rpcs: RPC_SQL }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sql = postgres(EXTERNAL_DB_URL, { max: 1, idle_timeout: 20, prepare: false });
    const results: any[] = [];

    try {
      for (const r of RPC_SQL) {
        try {
          await sql.unsafe(r.sql);
          // Permission to authenticated/anon
          await sql.unsafe(`GRANT EXECUTE ON FUNCTION public.${r.name} TO authenticated, anon;`);
          results.push({ name: r.name, applied: true });
        } catch (e: any) {
          results.push({ name: r.name, applied: false, error: String(e?.message || e).slice(0, 300) });
        }
      }
    } finally {
      await sql.end();
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: String(e?.message || e) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
