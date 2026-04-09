import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "../_shared/supabase-url-resolver.ts";

// External DB for data (messages, etc.)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();

// Internal (Cloud) DB for metadata (instances, permissions)
const INTERNAL_SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const INTERNAL_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function isWhatsAppInviteLink(raw?: string): boolean {
  return typeof raw === "string" && /chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(raw);
}

function isWhatsAppJid(raw?: string): boolean {
  return typeof raw === "string" && /@(g\.us|s\.whatsapp\.net|c\.us|lid)$/i.test(raw.trim());
}

function extractInviteCode(groupLink: string): string | null {
  return groupLink.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i)?.[1] || null;
}

/** Normalize Brazilian phone without corrupting WhatsApp group links/JIDs */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || isWhatsAppInviteLink(trimmed) || isWhatsAppJid(trimmed)) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length >= 10 && digits.length <= 11) return "55" + digits;
  return digits;
}

function getRequestedTarget(phone?: string, chatId?: string): string {
  if (typeof chatId === "string" && chatId.trim()) return chatId.trim();
  if (typeof phone === "string" && phone.trim()) return phone.trim();
  return "";
}

function buildJsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function readResponseTextSafe(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function fetchGroupInviteInfo(instance: any, groupLink: string) {
  const inviteCode = extractInviteCode(groupLink);
  if (!inviteCode) {
    throw new Error(
      "Link de grupo inválido. Use o formato https://chat.whatsapp.com/...",
    );
  }

  const baseUrl = instance.base_url || "https://abraci.uazapi.com";
  const res = await fetch(`${baseUrl}/group/inviteInfo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: instance.instance_token,
    },
    body: JSON.stringify({ code: inviteCode }),
  });

  if (!res.ok) {
    const errText = await readResponseTextSafe(res);
    console.error("Group inviteInfo error:", res.status, errText);
    throw new Error(`Erro ao resolver link: ${res.status}`);
  }

  const groupData = await res.json();
  console.log(
    "Group inviteInfo response:",
    JSON.stringify(groupData).substring(0, 500),
  );

  const groupId = groupData?.id || groupData?.jid || groupData?.data?.id || null;
  const groupName = groupData?.subject || groupData?.name ||
    groupData?.data?.subject || "";

  if (!groupId) {
    throw new Error("Não foi possível extrair o ID do grupo");
  }

  return { groupId, groupName };
}

function isWhatsAppDisconnected(status: number, errorText: string) {
  return status === 503 &&
    /whatsapp disconnected|websocket disconnected/i.test(errorText);
}

function buildDisconnectedPayload(instanceName?: string, details?: string) {
  return {
    success: false,
    error:
      "WhatsApp instance is disconnected. Reconnect the instance and try again.",
    error_code: "INSTANCE_DISCONNECTED",
    instance_name: instanceName || null,
    retryable: true,
    details: details || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);
    // Internal client for instance lookups (Cloud DB)
    const internalClient = createClient(
      INTERNAL_SUPABASE_URL,
      INTERNAL_SERVICE_ROLE_KEY,
    );

    const body = await req.json();
    // Normalize phone in body if present
    if (body.phone && typeof body.phone === "string") {
      body.phone = normalizePhone(body.phone);
    }
    if (body.chat_id && typeof body.chat_id === "string") {
      body.chat_id = body.chat_id.trim();
    }
    const { action } = body;

    const actionUsesTarget = action === undefined || action === "send_media" ||
      action === "send_location" || action === "send_text";
    const requestedTarget = getRequestedTarget(body.phone, body.chat_id);

    if (actionUsesTarget && isWhatsAppInviteLink(requestedTarget)) {
      const instance = await getInstance(internalClient, body.instance_id);
      if (!instance) {
        return buildJsonResponse({
          success: false,
          error: "No active WhatsApp instance found",
        });
      }

      try {
        const { groupId } = await fetchGroupInviteInfo(instance, requestedTarget);
        body.phone = groupId;
        body.chat_id = groupId;
        body.group_link = requestedTarget;
        console.log("Resolved group invite link to group ID:", groupId);
      } catch (e) {
        return buildJsonResponse({
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }

    // ========================
    // RESOLVE GROUP INVITE LINK
    // ========================
    if (action === "resolve_group_link") {
      const { group_link, instance_id } = body;

      if (!group_link) {
        return buildJsonResponse({
          success: false,
          error: "group_link is required",
        });
      }

      const instance = await getInstance(internalClient, instance_id);
      if (!instance) {
        return buildJsonResponse({
          success: false,
          error: "No active WhatsApp instance found",
        });
      }

      try {
        const { groupId, groupName } = await fetchGroupInviteInfo(
          instance,
          group_link,
        );

        return new Response(
          JSON.stringify({
            success: true,
            group_id: groupId,
            group_name: groupName,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (e) {
        console.error("Error resolving group link:", e);
        return buildJsonResponse({
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }

    // ========================
    // DELETE MESSAGE
    // ========================
    // ========================
    // FETCH GROUP PARTICIPANTS
    // ========================
    if (action === "fetch_group_participants") {
      const { group_id, instance_id } = body;

      if (!group_id) {
        return buildJsonResponse({
          success: false,
          error: "group_id is required",
        });
      }

      const instance = await getInstance(internalClient, instance_id);
      if (!instance) {
        return buildJsonResponse({
          success: false,
          error: "No active WhatsApp instance found",
        });
      }

      const baseUrl = instance.base_url || "https://abraci.uazapi.com";
      // UazAPI v2: group info endpoint
      const groupJid = group_id.includes("@g.us")
        ? group_id
        : `${group_id}@g.us`;

      try {
        const infoRes = await fetch(`${baseUrl}/group/info`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "token": instance.instance_token,
          },
          body: JSON.stringify({ id: groupJid }),
        });

        if (!infoRes.ok) {
          const errText = await infoRes.text();
          console.error("Group info error:", infoRes.status, errText);
          return new Response(
            JSON.stringify({
              success: false,
              error: `API error: ${infoRes.status}`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const groupData = await infoRes.json();
        console.log("Group info response keys:", Object.keys(groupData || {}));
        // UazAPI returns participants as an array with id, admin, etc.
        const participants = groupData?.participants ||
          groupData?.data?.participants || [];
        const groupName = groupData?.subject || groupData?.name ||
          groupData?.data?.subject || "";
        console.log(
          "Participants count:",
          participants.length,
          "sample:",
          JSON.stringify(participants.slice(0, 2)),
        );

        return new Response(
          JSON.stringify({
            success: true,
            participants,
            group_name: groupName,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (e) {
        console.error("Error fetching group info:", e);
        return buildJsonResponse({
          success: false,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }

    if (action === "delete_message") {
      const { message_id, instance_id, external_message_id } = body;

      if (!message_id) {
        return buildJsonResponse({
          success: false,
          error: "message_id is required",
        });
      }

      // Try to delete from WhatsApp via UazAPI if we have the external ID
      if (external_message_id && instance_id) {
        try {
          const { data: instance } = await internalClient
            .from("whatsapp_instances")
            .select("*")
            .eq("id", instance_id)
            .single();

          if (instance) {
            const baseUrl = instance.base_url || "https://abraci.uazapi.com";
            await fetch(`${baseUrl}/message/delete`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "token": instance.instance_token,
              },
              body: JSON.stringify({ id: external_message_id }),
            });
          }
        } catch (e) {
          console.error("Error deleting from WhatsApp:", e);
        }
      }

      // Delete from database
      const { error } = await supabase
        .from("whatsapp_messages")
        .delete()
        .eq("id", message_id);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ========================
    // CLEAR CONVERSATION (delete all messages for a phone+instance)
    // ========================
    if (action === "clear_conversation") {
      const { phone: clearPhone, instance_name } = body;

      if (!clearPhone) {
        return buildJsonResponse({
          success: false,
          error: "phone is required",
        });
      }

      let query = supabase.from("whatsapp_messages").delete().eq(
        "phone",
        clearPhone,
      );
      if (instance_name) {
        query = query.eq("instance_name", instance_name);
      }

      const { error, count } = await query;

      if (error) throw error;

      console.log(
        `Cleared conversation for phone ${clearPhone} instance ${
          instance_name || "all"
        }: ${count} messages deleted`,
      );

      return new Response(
        JSON.stringify({ success: true, deleted: count }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ========================
    // SEND MEDIA (image, audio, document, video)
    // ========================
    if (action === "send_media") {
      const {
        phone,
        chat_id,
        media_url,
        media_type,
        caption,
        contact_id,
        lead_id,
        instance_id,
      } = body;

      const targetNumber = getRequestedTarget(phone, chat_id);

      if (!targetNumber || !media_url) {
        return buildJsonResponse({
          success: false,
          error: "phone/chat_id and media_url are required",
        });
      }

      const instance = await getInstance(internalClient, instance_id);
      if (!instance) {
        return buildJsonResponse({
          success: false,
          error: "No active WhatsApp instance found",
        });
      }

      const baseUrl = instance.base_url || "https://abraci.uazapi.com";

      // UazAPI v2: unified /send/media endpoint
      const endpoint = "/send/media";
      let messageType = "image";
      const sendBody: any = { number: targetNumber, file: media_url };

      if (media_type?.startsWith("audio")) {
        sendBody.type = "audio";
        messageType = "audio";
      } else if (media_type?.startsWith("video")) {
        sendBody.type = "video";
        messageType = "video";
      } else if (media_type?.startsWith("image")) {
        sendBody.type = "image";
      } else {
        sendBody.type = "document";
        messageType = "document";
      }

      // caption field for text, only for non-audio
      if (caption && sendBody.type !== "audio") {
        sendBody.caption = caption;
      }

      console.log(
        `Sending ${messageType} via UazAPI:`,
        endpoint,
        "to:",
        phone,
        "body keys:",
        Object.keys(sendBody),
      );

      const uazResponse = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "token": instance.instance_token,
        },
        body: JSON.stringify(sendBody),
      });

      if (!uazResponse.ok) {
        const errorText = await readResponseTextSafe(uazResponse);
        if (isWhatsAppDisconnected(uazResponse.status, errorText)) {
          return buildJsonResponse(
            buildDisconnectedPayload(instance.instance_name, errorText),
          );
        }
        throw new Error(`UazAPI error: ${uazResponse.status} - ${errorText}`);
      }

      const uazData = await uazResponse.json().catch(() => ({}));
      const externalId = uazData?.key?.id || uazData?.id || null;

      // Save to database
      const { data: savedMessage, error } = await supabase
        .from("whatsapp_messages")
        .insert({
          phone: targetNumber,
          message_text: caption || null,
          message_type: messageType,
          media_url,
          media_type: media_type || null,
          direction: "outbound",
          status: "sent",
          contact_id: contact_id || null,
          lead_id: lead_id || null,
          instance_name: instance.instance_name,
          instance_token: instance.instance_token,
          external_message_id: externalId,
        })
        .select()
        .single();

      if (error) console.error("Error saving media message:", error);

      return new Response(
        JSON.stringify({
          success: true,
          message_id: savedMessage?.id,
          instance_name: instance.instance_name,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ========================
    // SEND LOCATION
    // ========================
    if (action === "send_location") {
      const {
        phone,
        chat_id,
        latitude,
        longitude,
        name,
        address,
        contact_id,
        lead_id,
        instance_id,
      } = body;

      const targetNumber = getRequestedTarget(phone, chat_id);

      if (!targetNumber || latitude === undefined || longitude === undefined) {
        return buildJsonResponse({
          success: false,
          error: "phone/chat_id, latitude and longitude are required",
        });
      }

      const instance = await getInstance(internalClient, instance_id);
      if (!instance) {
        return buildJsonResponse({
          success: false,
          error: "No active WhatsApp instance found",
        });
      }

      const baseUrl = instance.base_url || "https://abraci.uazapi.com";

      const uazResponse = await fetch(`${baseUrl}/send/location`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "token": instance.instance_token,
        },
        body: JSON.stringify({
          number: targetNumber,
          lat: latitude,
          lng: longitude,
          title: name || "",
          address: address || "",
        }),
      });

      if (!uazResponse.ok) {
        const errorText = await readResponseTextSafe(uazResponse);
        if (isWhatsAppDisconnected(uazResponse.status, errorText)) {
          return buildJsonResponse(
            buildDisconnectedPayload(instance.instance_name, errorText),
          );
        }
        throw new Error(
          `UazAPI location error: ${uazResponse.status} - ${errorText}`,
        );
      }

      const locationText = `📍 ${name || "Localização"}${
        address ? `\n${address}` : ""
      }`;

      const { data: savedMessage, error } = await supabase
        .from("whatsapp_messages")
        .insert({
          phone: targetNumber,
          message_text: locationText,
          message_type: "location",
          direction: "outbound",
          status: "sent",
          contact_id: contact_id || null,
          lead_id: lead_id || null,
          instance_name: instance.instance_name,
          instance_token: instance.instance_token,
          metadata: { latitude, longitude, name, address },
        })
        .select()
        .single();

      if (error) console.error("Error saving location message:", error);

      return new Response(
        JSON.stringify({
          success: true,
          message_id: savedMessage?.id,
          instance_name: instance.instance_name,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ========================
    // SEND TEXT (default / legacy)
    // ========================
    const { phone, chat_id, message, contact_id, lead_id, instance_id } = body;

    const targetNumber = getRequestedTarget(phone, chat_id);

    if (!targetNumber || !message) {
      return buildJsonResponse({
        success: false,
        error: "phone/chat_id and message are required",
      });
    }

    const instance = await getInstance(internalClient, instance_id);
    if (!instance) {
      return buildJsonResponse({
        success: false,
        error: "No active WhatsApp instance found",
      });
    }

    const baseUrl = instance.base_url || "https://abraci.uazapi.com";
    const sendUrl = `${baseUrl}/send/text`;

    console.log(
      "Sending via UazAPI:",
      sendUrl,
      "instance:",
      instance.instance_name,
      "to target:",
      targetNumber,
    );

    const uazResponse = await fetch(sendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "token": instance.instance_token,
      },
      body: JSON.stringify({ number: targetNumber, text: message }),
    });

    if (!uazResponse.ok) {
      const errorText = await readResponseTextSafe(uazResponse);
      if (isWhatsAppDisconnected(uazResponse.status, errorText)) {
        return buildJsonResponse(
          buildDisconnectedPayload(instance.instance_name, errorText),
        );
      }
      throw new Error(`UazAPI error: ${uazResponse.status} - ${errorText}`);
    }

    const uazData = await uazResponse.json().catch(() => ({}));
    const externalId = uazData?.key?.id || uazData?.id || null;
    console.log(
      "UazAPI response status:",
      uazResponse.status,
      "externalId:",
      externalId,
    );

    const { data: savedMessage, error } = await supabase
      .from("whatsapp_messages")
      .insert({
        phone: targetNumber,
        message_text: message,
        message_type: "text",
        direction: "outbound",
        status: "sent",
        contact_id: contact_id || null,
        lead_id: lead_id || null,
        instance_name: instance.instance_name,
        instance_token: instance.instance_token,
        external_message_id: externalId,
      })
      .select()
      .single();

    if (error) {
      console.error("Error saving outbound message:", error);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message_id: savedMessage?.id,
        instance_name: instance.instance_name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Send WhatsApp error:", error);
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    const status =
      /INSTANCE_DISCONNECTED|WhatsApp instance is disconnected|UazAPI error: 503/i
          .test(errorMessage)
        ? 200
        : 500;
    return buildJsonResponse({ success: false, error: errorMessage }, status);
  }
});

async function getInstance(supabase: any, instance_id?: string) {
  if (instance_id) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("id", instance_id)
      .eq("is_active", true)
      .single();

    if (data) return data;
  }

  // Fallback: pick the first active instance
  const { data: fallback } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  return fallback || null;
}
