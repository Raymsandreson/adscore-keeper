/**
 * UNIFIED WJIA AGENT — Router
 *
 * Slim entry point that delegates to specialized handlers:
 * - handlers/regenerate.ts  → MODE 0: Regenerate/force-generate session
 * - handlers/new-command.ts → MODE 1: New #command processing
 * - handlers/follow-up.ts   → MODE 2: Follow-up messages during active sessions
 *
 * All business logic lives in the handlers.
 */

import { corsHeaders, createSupabaseClient, errorResponse } from "./handlers/shared.ts";
import { handleRegenerate } from "./handlers/regenerate.ts";
import { handleNewCommand } from "./handlers/new-command.ts";
import { handleFollowUp } from "./handlers/follow-up.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const {
      phone,
      instance_name,
      command,
      contact_id,
      lead_id,
      reset_memory = false,
      message_text: rawMessageText,
      media_url,
      media_type,
      message_type,
      action,
      session_id,
    } = payload;

    // ── MODE 0: REGENERATE SESSION ──
    if ((action === "regenerate_session" || action === "force_generate") && session_id) {
      return await handleRegenerate({ session_id, phone });
    }

    if (!phone) {
      return errorResponse("phone is required", 400);
    }

    const supabase = createSupabaseClient();
    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");
    const zapsignToken = Deno.env.get("ZAPSIGN_API_TOKEN");

    // ── MODE 1: NEW COMMAND (#shortcut) ──
    if (command) {
      return await handleNewCommand({
        supabase, zapsignToken, normalizedPhone, phone,
        instance_name, command, contact_id, lead_id, reset_memory,
      });
    }

    // ── MODE 2: FOLLOW-UP MESSAGE ──
    let message_text = rawMessageText;

    // Transcribe audio if needed
    const isAudio = message_type === "audio" || message_type === "ptt" ||
      (media_type?.startsWith("audio/"));
    if (isAudio && media_url && !message_text) {
      try {
        const { transcribeFromUrl } = await import("../_shared/stt.ts");
        const t = await transcribeFromUrl(media_url);
        if (t?.trim()) message_text = t.trim();
      } catch (e) {
        console.error("Audio transcription error:", e);
      }
    }

    if (!instance_name) {
      return errorResponse("instance_name is required for follow-up", 400);
    }

    return await handleFollowUp({
      supabase, zapsignToken, normalizedPhone, instance_name,
      message_text, media_url, media_type, message_type,
    });
  } catch (error: any) {
    console.error("WJIA Agent error:", error);
    return errorResponse(error.message || "Unknown error", 500);
  }
});
