import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://adscore-keeper.lovable.app";

// ── helpers ──────────────────────────────────────────────────────────
const buildPhoneVariants = (rawPhone: string) => {
  const digits = (rawPhone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return [] as string[];
  const variants = new Set<string>();
  const add = (v?: string) => { if (v) variants.add(v); };
  add(digits);
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  add(local);
  if (local.length === 10) {
    const withNine = `${local.slice(0, 2)}9${local.slice(2)}`;
    add(withNine); add(`55${withNine}`);
  }
  if (local.length === 11 && local[2] === "9") {
    const withoutNine = `${local.slice(0, 2)}${local.slice(3)}`;
    add(withoutNine); add(`55${withoutNine}`);
  }
  return Array.from(variants);
};

async function sendWhatsAppText(baseUrl: string, token: string, number: string, text: string) {
  await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number, text }),
  });
}

async function sendWhatsAppAudio(baseUrl: string, token: string, number: string, audioUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/send/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number, file: audioUrl, type: "audio" }),
    });
    if (!res.ok) {
      console.warn("sendAudio failed:", await res.text());
    }
  } catch (e) {
    console.error("sendAudio error:", e);
  }
}

// Removed: transcribeWithElevenLabs — now uses shared _shared/stt.ts

async function generateTTSAudio(text: string, voiceId?: string): Promise<string | null> {
  const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  
  if (!ELEVENLABS_API_KEY) {
    console.warn("ELEVENLABS_API_KEY not configured, skipping TTS");
    return null;
  }

  try {
    // Clean text for TTS (remove emojis, markdown formatting)
    const cleanText = text
      .replace(/\*([^*]+)\*/g, "$1") // remove bold markdown
      .replace(/_([^_]+)_/g, "$1") // remove italic markdown
      .replace(/✅|📋|📅|🔔|👤|✏️|🤖|⚠️|📊|📌|📞|💬|👥|🔄|📈|🏆|☑️|🕐|📍|🎯|💡|🔴|🟠|🟡|🟢|🌟|⏳|🔍|📥|1️⃣|2️⃣|3️⃣/g, "")
      .replace(/https?:\/\/\S+/g, "") // remove URLs
      .replace(/\n{3,}/g, "\n\n") // collapse multiple newlines
      .trim();

    if (!cleanText || cleanText.length < 10) return null;

    // Truncate to avoid excessive TTS costs (max ~500 chars)
    const truncated = cleanText.length > 500 ? cleanText.substring(0, 500) + "..." : cleanText;

    // Use Laura voice (Portuguese-friendly) with multilingual model
    const finalVoiceId = voiceId || "FGY2WhTYpPnrIDTdsKH5"; // Laura default
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: truncated,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.6,
            similarity_boost: 0.75,
            style: 0.3,
            speed: 1.1,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error("ElevenLabs TTS error:", response.status, await response.text());
      return null;
    }

    const audioBuffer = await response.arrayBuffer();
    
    // Upload to Supabase storage
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const fileName = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
    const filePath = `tts/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from("whatsapp-media")
      .upload(filePath, new Uint8Array(audioBuffer), {
        contentType: "audio/mpeg",
        upsert: false,
      });

    if (uploadErr) {
      console.error("Upload TTS audio error:", uploadErr);
      return null;
    }

    const { data: urlData } = supabase.storage.from("whatsapp-media").getPublicUrl(filePath);
    return urlData?.publicUrl || null;
  } catch (e) {
    console.error("TTS generation error:", e);
    return null;
  }
}

async function sendWhatsAppButtons(baseUrl: string, token: string, number: string, text: string, buttons: { id: string; text: string }[]) {
  // uazapi send/quickReply – up to 3 buttons
  try {
    const res = await fetch(`${baseUrl}/send/quickReply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({
        number,
        message: text,
        buttons: buttons.slice(0, 3).map(b => ({ buttonId: b.id, buttonText: b.text })),
      }),
    });
    if (res.ok) return true;
    console.warn("quickReply failed, falling back to text", await res.text());
  } catch (e) {
    console.warn("quickReply error, falling back to text:", e);
  }
  // Fallback: send as numbered text
  const fallbackText = text + "\n\n" + buttons.map((b, i) => `${i + 1}️⃣ ${b.text}`).join("\n") + "\n\n_Responda com o número da opção_";
  await sendWhatsAppText(baseUrl, token, number, fallbackText);
  return false;
}

async function sendWhatsAppList(baseUrl: string, token: string, number: string, text: string, items: { id: string; title: string; description?: string }[]) {
  // uazapi send/list – up to 10 items
  try {
    const res = await fetch(`${baseUrl}/send/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({
        number,
        message: text,
        buttonText: "Ver opções",
        listItems: items.slice(0, 10).map(i => ({ title: i.title, description: i.description || "", id: i.id })),
      }),
    });
    if (res.ok) return true;
    console.warn("sendList failed, falling back to text", await res.text());
  } catch (e) {
    console.warn("sendList error, falling back to text:", e);
  }
  // Fallback: send as numbered text
  const fallbackText = text + "\n\n" + items.map((item, i) => `${i + 1}️⃣ *${item.title}*${item.description ? ` – ${item.description}` : ""}`).join("\n") + "\n\n_Responda com o número da opção_";
  await sendWhatsAppText(baseUrl, token, number, fallbackText);
  return false;
}

// ── Batch collection markers ──
const COLLECTING_MARKER = "__COLLECTING__";
const FINISH_KEYWORDS = ["pronto", "executar", "só isso", "somente isso", "pode executar", "finalizar", "é isso", "isso é tudo", "pode fazer", "manda", "envia", "go", "ok pronto", "feito"];
const AUDIO_YES_KEYWORDS = ["sim", "s", "yes", "quero", "manda", "envia", "gera", "pode", "ok", "1"];
const AUDIO_NO_KEYWORDS = ["nao", "não", "n", "no", "nope", "sem audio", "sem áudio", "2"];

function isFinishMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?,]/g, "");
  return FINISH_KEYWORDS.some(k => normalized === k || normalized.startsWith(k + " ") || normalized.endsWith(" " + k));
}

function isAudioYes(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?,]/g, "");
  return AUDIO_YES_KEYWORDS.some(k => normalized === k);
}

function isAudioNo(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?,]/g, "");
  return AUDIO_NO_KEYWORDS.some(k => normalized === k);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { phone, instance_name, media_url, message_type, is_group, group_id, is_internal_command } = body;
    let message_text = body.message_text;

    if (!phone || !instance_name) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Audio transcription: shared STT (ElevenLabs + Gemini fallback) ──
    const isAudio = message_type === 'audio' || message_type === 'ptt';
    if (isAudio && media_url && !message_text) {
      console.log('Transcribing audio via shared STT:', media_url);
      try {
        const { transcribeFromUrl } = await import("../_shared/stt.ts");
        const transcript = await transcribeFromUrl(media_url);
        if (transcript) {
          console.log('Audio transcribed:', transcript.substring(0, 100));
          message_text = transcript;
        }
      } catch (e) {
        console.error('Shared STT error:', e);
      }
    }

    // Build the content to save (text + media reference)
    const hasMedia = media_url && message_type !== 'text';
    const contentToSave = [
      message_text || '',
      hasMedia ? `[MÍDIA: ${message_type} - ${media_url}]` : '',
    ].filter(Boolean).join('\n');

    if (!contentToSave) {
      return new Response(JSON.stringify({ error: "No content to process" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!GOOGLE_AI_API_KEY && !LOVABLE_API_KEY) {
      throw new Error("No AI provider configured (GOOGLE_AI_API_KEY or LOVABLE_API_KEY)");
    }

    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");
    const phoneVariants = buildPhoneVariants(normalizedPhone);

    // 1) Authorize
    let config: any = null;
    for (const variant of phoneVariants) {
      const { data } = await supabase
        .from("whatsapp_command_config")
        .select("*")
        .eq("authorized_phone", variant)
        .eq("instance_name", instance_name)
        .eq("is_active", true)
        .maybeSingle();
      if (data) { config = data; break; }
    }

    // Fallback for ## internal commands: allow the active instance owner on first use
    if (!config && is_internal_command === true) {
      try {
        const { data: activeInstance } = await supabase
          .from("whatsapp_instances")
          .select("owner_phone")
          .eq("instance_name", instance_name)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        const ownerVariants = buildPhoneVariants(activeInstance?.owner_phone || "");
        const isOwnerPhone = ownerVariants.some((v) => phoneVariants.includes(v));

        if (isOwnerPhone) {
          const phoneSuffix = normalizedPhone.slice(-8);
          const { data: ownerProfile } = await supabase
            .from("profiles")
            .select("user_id, full_name")
            .ilike("phone", `%${phoneSuffix}%`)
            .limit(1)
            .maybeSingle();

          if (ownerProfile?.user_id) {
            const autoUserName = ownerProfile.full_name || "Membro da equipe";

            await supabase
              .from("whatsapp_command_config")
              .upsert(
                {
                  instance_name,
                  authorized_phone: normalizedPhone,
                  user_id: ownerProfile.user_id,
                  user_name: autoUserName,
                  is_active: true,
                },
                { onConflict: "instance_name,authorized_phone" }
              );

            config = {
              instance_name,
              authorized_phone: normalizedPhone,
              user_id: ownerProfile.user_id,
              user_name: autoUserName,
              is_active: true,
            };

            console.log(`Auto-authorized internal command owner: ${normalizedPhone} on ${instance_name}`);
          } else {
            console.log(`Owner phone matched but no profile found for ${normalizedPhone}`);
          }
        }
      } catch (e) {
        console.error("Auto-authorize internal command owner failed:", e);
      }
    }

    if (!config) {
      console.log(`Phone ${normalizedPhone} not authorized for commands on ${instance_name}`);
      return new Response(JSON.stringify({ skipped: true, reason: "not_authorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Command from authorized user: ${config.user_name} (${normalizedPhone})`);

    // 2) Check if we're in batch collection mode
    const { data: recentHistory } = await supabase
      .from("whatsapp_command_history")
      .select("role, content, tool_data, created_at")
      .eq("phone", normalizedPhone)
      .eq("instance_name", instance_name)
      .order("created_at", { ascending: false })
      .limit(30);

    const lastAssistantMsg = (recentHistory || []).find((m: any) => m.role === "assistant");
    const isInCollectingMode = lastAssistantMsg?.tool_data?.collecting === true;
    const isAwaitingAudioConfirm = lastAssistantMsg?.tool_data?.awaiting_audio_confirm === true;
    const isFinish = message_text ? isFinishMessage(message_text) : false;

    // Get WhatsApp instance for sending messages
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_token, base_url")
      .eq("instance_name", instance_name)
      .maybeSingle();
    const baseUrl = inst?.base_url || "https://abraci.uazapi.com";
    const instToken = inst?.instance_token || "";

    // ── CASE 0: Awaiting audio confirmation (SIM/NÃO) ──
    if (isAwaitingAudioConfirm && message_text) {
      const wantsAudio = isAudioYes(message_text);
      const declinesAudio = isAudioNo(message_text);

      if (wantsAudio) {
        // Generate and send TTS audio of the last response
        const lastResponseText = lastAssistantMsg?.content || "";
        await supabase.from("whatsapp_command_history").insert({
          phone: normalizedPhone, instance_name, role: "user", content: message_text,
        });

        if (instToken) {
          await sendWhatsAppText(baseUrl, instToken, normalizedPhone, "🤖 *WhatsJUD IA*\n\n🔊 Gerando áudio...").catch(() => {});
        }

        // Get user's voice preference
        const { data: voicePref } = await supabase
          .from("voice_preferences")
          .select("voice_id")
          .eq("user_id", config.user_id)
          .maybeSingle();

        const audioUrl = await generateTTSAudio(lastResponseText, voicePref?.voice_id);
        
        let ackMsg = "";
        if (audioUrl && instToken) {
          await sendWhatsAppAudio(baseUrl, instToken, normalizedPhone, audioUrl);
          ackMsg = "✅ Áudio enviado!";
        } else {
          ackMsg = "⚠️ Não foi possível gerar o áudio.";
        }

        await supabase.from("whatsapp_command_history").insert({
          phone: normalizedPhone, instance_name, role: "assistant", content: ackMsg, tool_data: {},
        });

        return new Response(JSON.stringify({ success: true, status: "audio_sent" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (declinesAudio) {
        await supabase.from("whatsapp_command_history").insert([
          { phone: normalizedPhone, instance_name, role: "user", content: message_text },
          { phone: normalizedPhone, instance_name, role: "assistant", content: "👍 Ok!", tool_data: {} },
        ]);
        if (instToken) {
          await sendWhatsAppText(baseUrl, instToken, normalizedPhone, "🤖 *WhatsJUD IA*\n\n👍 Ok!").catch(() => {});
        }
        return new Response(JSON.stringify({ success: true, status: "audio_declined" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // If neither yes nor no, treat as a new command (fall through)
    }

    // Instance already fetched above


    // ── CASE 1: First message (not in collecting mode) → Start collecting ──
    if (!isInCollectingMode && !isFinish) {
      // Save the message
      await supabase.from("whatsapp_command_history").insert({
        phone: normalizedPhone, instance_name, role: "user", content: contentToSave,
        tool_data: hasMedia ? { media_url, message_type } : null,
      });

      // If it's an image/document with no text, ask if it's to attach to an activity
      const isImageOnly = (message_type === 'image' || message_type === 'document') && !message_text?.trim();
      const collectMsg = isImageOnly
        ? `📥 *Imagem recebida!*\n\n📎 Quer *anexar essa imagem a uma atividade existente*? Se sim, me diga qual atividade ou o nome do lead.\n\nOu envie mais informações para criar um novo comando.\n\n_Quando terminar, responda *PRONTO*_ ✅`
        : `📥 *Recebido!*\n\nTem mais alguma coisa pra enviar? (áudio, documento, link, foto, ou mais informações)\n\n_Quando terminar, responda *PRONTO* que eu processo tudo de uma vez_ ✅`;
      
      await supabase.from("whatsapp_command_history").insert({
        phone: normalizedPhone, instance_name, role: "assistant", content: collectMsg,
        tool_data: { collecting: true },
      });

      if (instToken) {
        await sendWhatsAppText(baseUrl, instToken, normalizedPhone, `🤖 *WhatsJUD IA*\n\n${collectMsg}`).catch(e => console.error("Send error:", e));
      }

      return new Response(JSON.stringify({ success: true, status: "collecting", message: "Waiting for more content" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CASE 2: In collecting mode, user sends more content (not "pronto") ──
    if (isInCollectingMode && !isFinish) {
      // Save additional content
      await supabase.from("whatsapp_command_history").insert({
        phone: normalizedPhone, instance_name, role: "user", content: contentToSave,
        tool_data: hasMedia ? { media_url, message_type } : null,
      });

      // Acknowledge and keep collecting
      const ackMsg = `📥 *Anotado!* Mais alguma coisa?\n\n_Responda *PRONTO* quando terminar_ ✅`;
      
      await supabase.from("whatsapp_command_history").insert({
        phone: normalizedPhone, instance_name, role: "assistant", content: ackMsg,
        tool_data: { collecting: true },
      });

      if (instToken) {
        await sendWhatsAppText(baseUrl, instToken, normalizedPhone, `🤖 *WhatsJUD IA*\n\n${ackMsg}`).catch(e => console.error("Send error:", e));
      }

      return new Response(JSON.stringify({ success: true, status: "collecting_more", message: "More content added" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CASE 3: User says "pronto" → Consolidate all buffered content and process ──
    // Gather all user messages since the first collecting prompt
    const allHistory = (recentHistory || []).reverse(); // chronological
    
    // Find the first "collecting" assistant message
    let collectStartIdx = -1;
    for (let i = 0; i < allHistory.length; i++) {
      if (allHistory[i].role === "assistant" && allHistory[i].tool_data?.collecting === true) {
        // Find the user message just before this
        collectStartIdx = Math.max(0, i - 1);
        break;
      }
    }

    // Consolidate all user messages from the collection period
    const bufferedMessages: string[] = [];
    const bufferedMedia: { url: string; type: string }[] = [];
    
    for (let i = collectStartIdx >= 0 ? collectStartIdx : 0; i < allHistory.length; i++) {
      const msg = allHistory[i];
      if (msg.role !== "user") continue;
      if (msg.content) bufferedMessages.push(msg.content);
      if (msg.tool_data?.media_url) {
        bufferedMedia.push({ url: msg.tool_data.media_url, type: msg.tool_data.message_type || 'document' });
      }
    }

    // Build consolidated message for AI
    const consolidatedText = bufferedMessages.join("\n\n---\n\n");
    const mediaContext = bufferedMedia.length > 0
      ? `\n\n[MÍDIAS ANEXADAS: ${bufferedMedia.map(m => `${m.type}: ${m.url}`).join(", ")}]`
      : "";
    
    const finalMessage = consolidatedText + mediaContext;
    console.log(`Processing consolidated command (${bufferedMessages.length} messages, ${bufferedMedia.length} media):`, finalMessage.substring(0, 200));

    // Save the "pronto" message
    await supabase.from("whatsapp_command_history").insert({
      phone: normalizedPhone, instance_name, role: "user", content: "[EXECUTAR COMANDO]",
    });

    // Now replace message_text with consolidated content for AI processing
    // and continue with the normal flow below
    const message_text_final = finalMessage;

    // Clear collecting state by saving a non-collecting assistant placeholder
    // (will be replaced by the actual response below)

    // 3) Rebuild history WITHOUT the collecting messages for clean AI context
    const chatHistory: any[] = [];
    for (const msg of allHistory) {
      if (msg.role === "assistant" && msg.tool_data?.collecting === true) continue; // skip collecting prompts
      if (msg.content === "[EXECUTAR COMANDO]") continue; // skip execute marker
      if (msg.role === "user" || msg.role === "assistant") {
        chatHistory.push(msg);
      }
    }

    // 4) Fetch system context
    const [profilesRes, typesRes, boardsRes, timeBlockRes, nucleiRes] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name").order("full_name"),
      supabase.from("activity_types").select("key, label, color").eq("is_active", true).order("display_order"),
      supabase.from("kanban_boards").select("id, name, is_default, stages:kanban_stages(id, display_order)").eq("is_active", true).order("display_order"),
      supabase.from("user_timeblock_settings").select("activity_type, days, start_hour, start_minute, end_hour, end_minute").eq("user_id", config.user_id),
      supabase.from("specialized_nuclei").select("id, name, prefix, color").eq("is_active", true).order("display_order"),
    ]);

    const assessors = (profilesRes.data || []).filter((p: any) => p.full_name);
    const actTypes = typesRes.data || [];
    const boards = boardsRes.data || [];
    const nuclei = nucleiRes.data || [];
    const assessorsList = assessors.map((a: any) => `- "${a.full_name}" (id: ${a.user_id})`).join("\n");
    const actTypesList = actTypes.map((t: any) => `"${t.key}" (${t.label})`).join(", ");
    const actTypeKeys = actTypes.map((t: any) => t.key);
    const boardsList = boards.map((b: any) => `- "${b.name}" (id: ${b.id})${b.is_default ? ' [PADRÃO]' : ''}`).join("\n");
    const nucleiList = nuclei.map((n: any) => `- "${n.name}" (prefix: ${n.prefix}, id: ${n.id})`).join("\n");

    // Fetch group conversation if is_group and group_id
    let groupConversationContext = "";
    if (is_group && group_id) {
      const { data: groupMsgs } = await supabase
        .from("whatsapp_messages")
        .select("direction, message_text, sender_name, created_at")
        .eq("phone", group_id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (groupMsgs && groupMsgs.length > 0) {
        const lines = groupMsgs.reverse().map((m: any) => {
          const sender = m.sender_name || (m.direction === 'outbound' ? 'Atendente' : 'Participante');
          return `[${sender}]: ${m.message_text || ''}`;
        });
        groupConversationContext = `\n\nCONTEXTO DA CONVERSA DO GRUPO (últimas ${groupMsgs.length} mensagens):\n${lines.join("\n")}`;
      }
    }

    // Build user routine context from timeblock settings
    const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const timeBlocks = timeBlockRes.data || [];
    let routineContext = "";
    if (timeBlocks.length > 0) {
      const routineLines = timeBlocks
        .sort((a: any, b: any) => (a.start_hour + (a.start_minute || 0) / 60) - (b.start_hour + (b.start_minute || 0) / 60))
        .map((tb: any) => {
          const typeLabel = actTypes.find((t: any) => t.key === tb.activity_type)?.label || tb.activity_type;
          const days = (tb.days || []).map((d: number) => dayNames[d] || d).join(", ");
          const start = `${String(tb.start_hour).padStart(2, "0")}:${String(tb.start_minute || 0).padStart(2, "0")}`;
          const end = `${String(tb.end_hour).padStart(2, "0")}:${String(tb.end_minute || 0).padStart(2, "0")}`;
          return `  - ${typeLabel} (${tb.activity_type}): ${days} das ${start} às ${end}`;
        });
      routineContext = `\nROTINA DO ASSESSOR "${config.user_name}":\n${routineLines.join("\n")}\n`;
      routineContext += `\n⚠️ USE A ROTINA PARA:\n`;
      routineContext += `  1. ESCOLHER O TIPO DE ATIVIDADE: Priorize os tipos que o assessor já usa na sua rotina. Se o comando combina com um tipo da rotina, prefira ele.\n`;
      routineContext += `  2. SUGERIR HORÁRIOS: Agende o deadline e notification_date dentro dos horários que o assessor já dedica àquele tipo de atividade. Ex: se ele faz "audiência" das 13:00-17:00, agende audiências nesse horário.\n`;
      routineContext += `  3. ESCOLHER O DIA: Se possível, agende nos dias em que o assessor tem aquele bloco configurado.\n`;
    }

    // ── System Prompt ──
    const systemPrompt = `Você é o assistente IA do CRM WhatsJUD, recebendo comandos via WhatsApp do assessor "${config.user_name}".

VOCÊ PODE:
1. Criar atividades/tarefas (new_activity)
2. Criar leads (new_lead)
3. Criar casos jurídicos completos (new_case) - com lead, processos, partes e link de grupo
4. Buscar informações sobre leads, atividades e contatos (search_info)
5. Atualizar status de atividades (update_activity)
6. Gerar relatórios de produtividade (productivity_report)
7. Consultar metas e progresso de cada trabalhador
8. Dar feedback sobre desempenho individual ou da equipe
9. Informar tarefas atrasadas, tempo no sistema, pontos de melhoria
10. Responder perguntas sobre o sistema

ASSESSORES CADASTRADOS:
${assessorsList}

TIPOS DE ATIVIDADE DISPONÍVEIS (USE A KEY EXATA):
${actTypes.map((t: any) => `  - key: "${t.key}" → ${t.label}`).join("\n")}
⚠️ OBRIGATÓRIO: Use APENAS as keys listadas acima. Ex: se o assessor diz "gerenciamento de processo" ou "gerenciar caso", use a key que melhor corresponde na lista (como "gerenciamento_processual" ou "tarefa"). NUNCA invente keys novas.

QUADROS KANBAN:
${boardsList}

NÚCLEOS ESPECIALIZADOS (para casos jurídicos):
${nucleiList || "Nenhum núcleo cadastrado"}
${routineContext}${groupConversationContext}
DATA ATUAL: ${new Date().toISOString().split("T")[0]} (ANO: ${new Date().getFullYear()})

REGRAS CRÍTICAS DE COMPORTAMENTO:
1. DECIDA VOCÊ MESMO todos os campos com base no contexto. NUNCA liste todas as opções pedindo para o usuário escolher.
2. Para "activity_type": analise o conteúdo do comando e escolha o tipo mais adequado da lista acima. Se o comando menciona audiência → use a key de audiência. Se menciona reunião → use a key de reunião. Se não houver tipo claro, use "tarefa". NUNCA use um valor que não esteja na lista de keys.
3. Para "priority": infira do contexto (palavras como "urgente", "importante", "quando puder"). Default: "normal".
4. Para "matrix_quadrant": infira automaticamente (urgente+importante=do_now, importante+não urgente=schedule, etc). Default: "schedule".
5. Para "assigned_to": se não mencionado, use o próprio assessor que enviou o comando.
6. Execute comandos IMEDIATAMENTE sem pedir confirmação.
7. Responda de forma CONCISA (mensagens curtas para WhatsApp).
8. Use emojis para tornar a leitura mais fácil.
9. SEMPRE inclua deadline e notification_date ao criar atividades.
10. NUNCA sugira datas em fins de semana ou feriados.
11. Após criar atividade ou lead, inclua na response_text um resumo do que foi criado com os campos preenchidos.
12. O assessor que enviou o comando é: "${config.user_name}" (id: ${config.user_id})
13. Responda em português do Brasil
14. NUNCA escreva frases genéricas como "Ela já pode acompanhar no sistema" - o sistema adiciona o link automaticamente.

REGRA CRÍTICA - SEMPRE USE OS CAMPOS DE FERRAMENTA:
- Quando o assessor pedir para CRIAR algo, você DEVE preencher o campo correspondente na ferramenta:
  - Criar atividade → OBRIGATÓRIO preencher "new_activity" com todos os campos
  - Criar lead → OBRIGATÓRIO preencher "new_lead" com todos os campos
  - Criar caso → OBRIGATÓRIO preencher "new_case" com todos os campos
- NUNCA apenas escreva "criei a atividade" no response_text sem preencher new_activity - isso NÃO cria nada!
- O sistema automaticamente adiciona links clicáveis na resposta. NÃO inclua {link} ou URLs no response_text.
- O response_text deve conter apenas o resumo textual. O link será adicionado automaticamente pelo sistema.
- NUNCA inclua IDs, UUIDs, "Task ID", "ID:" ou qualquer identificador técnico no response_text. O usuário não precisa ver IDs.

ANEXAR IMAGENS A ATIVIDADES:
- Se o assessor enviou uma imagem e pede para "anexar" a uma atividade existente, use "attach_to_activity" com o título ou nome do lead para buscar a atividade.
- Se imagens foram enviadas junto com um comando de criação de atividade, elas serão anexadas automaticamente.

CRIAR CASO JURÍDICO (new_case):
- Quando o assessor pedir para "criar caso", "criar processo", "caso jurídico", use new_case
- Extraia TODOS os dados da conversa do grupo (se disponível no CONTEXTO DA CONVERSA DO GRUPO)
- Identifique TODOS os números de processo mencionados (formato: 0001234-56.2024.8.26.0100 ou similar)
- Identifique TODAS as partes mencionadas (nomes de pessoas como autor, réu, advogado, testemunha, etc.)
- Se a conversa é de um grupo de WhatsApp, o link do grupo será vinculado automaticamente
- Escolha o núcleo especializado mais adequado baseado no tipo do caso
- Preencha a descrição com TODOS os dados relevantes encontrados (vítima, empresa, dano, data, local, etc.)
- O lead será criado automaticamente como "fechado"


- Quando pedirem relatório, feedback, desempenho ou produtividade: use productivity_report
- Você pode consultar: tarefas atrasadas, metas definidas vs atingidas, tempo online, ranking da equipe
- Se perguntarem sobre "mim" ou "eu", use o user_id do assessor atual
- Se perguntarem sobre outra pessoa, identifique pelo nome na lista de assessores
- Formate o relatório de forma clara com seções e emojis
- Inclua pontos de melhoria e sugestões quando relevante
- Compare metas definidas com progresso atual

EXEMPLO DE RESPOSTA BOA:
Usuário: "criar tarefa teste para amanhã"
→ Preencha new_activity com: title="teste", activity_type="tarefa", priority="normal", deadline=amanhã 09:00, notification_date=amanhã 08:00
→ response_text: "✅ Atividade criada!\\n📋 *teste*\\n📅 Prazo: 14/03/2026 09:00\\n🔔 Notificação: 14/03/2026 08:00\\n👤 ${config.user_name}"

EXEMPLO DE RESPOSTA RUIM (NUNCA faça isso):
- "Qual o tipo de atividade? Escolha entre: tarefa, audiência, prazo..." ← PROIBIDO listar opções
- Preencher apenas response_text dizendo "criei" sem preencher new_activity ← NÃO CRIA NADA

IMPORTANTE: O assessor pode enviar múltiplas mensagens (áudios, documentos, links, textos) de uma vez. Todas as informações foram consolidadas antes de chegar até você. Considere TODO o conteúdo junto. Se houver referências a mídias ([MÍDIA: ...]), considere como anexos relevantes ao contexto do comando.`;

    // Build AI messages
    const aiMessages: any[] = [{ role: "system", content: systemPrompt }];
    for (const msg of chatHistory) {
      if (msg.role === "user") aiMessages.push({ role: "user", content: msg.content });
      else if (msg.role === "assistant") aiMessages.push({ role: "assistant", content: msg.content });
    }

    const tools = [
      {
        type: "function",
        function: {
          name: "execute_command",
          description: "Executa um comando do assessor: cria atividades, leads, busca informações ou atualiza dados. SEMPRE decida os campos automaticamente baseado no contexto.",
          parameters: {
            type: "object",
            properties: {
              response_text: { type: "string", description: "Resposta concisa para enviar ao assessor via WhatsApp. Inclua resumo do que foi feito." },
              new_activity: {
                type: "object",
                description: "Criar nova atividade. Preencha TODOS os campos automaticamente baseado no contexto.",
                properties: {
                  title: { type: "string" },
                  activity_type: { type: "string", enum: actTypeKeys.length > 0 ? actTypeKeys : ["tarefa", "audiencia", "prazo", "acompanhamento", "reuniao", "diligencia"], description: "Escolha automaticamente o tipo mais adequado ao contexto do comando" },
                  priority: { type: "string", enum: ["baixa", "normal", "alta", "urgente"], description: "Infira do contexto. Default: normal" },
                  assigned_to: { type: "string", description: "user_id do responsável. Default: assessor atual" },
                  assigned_to_name: { type: "string" },
                  notes: { type: "string" },
                  what_was_done: { type: "string" },
                  next_steps: { type: "string" },
                  deadline: { type: "string", description: "YYYY-MM-DDTHH:mm" },
                  notification_date: { type: "string", description: "YYYY-MM-DDTHH:mm" },
                  matrix_quadrant: { type: "string", enum: ["do_now", "schedule", "delegate", "eliminate"], description: "Infira automaticamente. Default: schedule" },
                  lead_name: { type: "string", description: "Nome do lead para vincular" },
                },
                required: ["title", "activity_type", "deadline", "notification_date"],
              },
              new_lead: {
                type: "object",
                description: "Criar novo lead",
                properties: {
                  lead_name: { type: "string" },
                  lead_phone: { type: "string" },
                  victim_name: { type: "string" },
                  city: { type: "string" },
                  state: { type: "string" },
                  board_id: { type: "string", description: "ID do quadro Kanban. Escolha o mais adequado automaticamente." },
                  notes: { type: "string" },
                },
                required: ["lead_name"],
               },
              new_case: {
                type: "object",
                description: "Criar caso jurídico completo. Cria automaticamente: lead (como fechado), caso jurídico, processos e partes. Use quando o assessor pedir para criar caso, processo jurídico, etc. Extraia TODOS os dados da conversa do grupo se disponível.",
                properties: {
                  title: { type: "string", description: "Título do caso (ex: Acidente de trabalho - João Silva)" },
                  nucleus_id: { type: "string", description: "ID do núcleo especializado. Escolha o mais adequado baseado no tipo do caso." },
                  description: { type: "string", description: "Descrição do caso com dados extraídos: vítima, empresa, dano, data do acidente, endereço, etc." },
                  notes: { type: "string", description: "Observações adicionais" },
                  board_id: { type: "string", description: "ID do quadro Kanban para o lead. Use o padrão se não especificado." },
                  victim_name: { type: "string", description: "Nome da vítima" },
                  lead_phone: { type: "string", description: "Telefone do lead" },
                  city: { type: "string" },
                  state: { type: "string" },
                  processes: {
                    type: "array",
                    description: "Processos judiciais encontrados na conversa. Extraia TODOS os números de processo mencionados.",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        process_number: { type: "string", description: "Número do processo (ex: 0001234-56.2024.8.26.0100)" },
                        process_type: { type: "string", enum: ["judicial", "administrativo"] },
                        description: { type: "string" },
                      },
                      required: ["title"],
                    },
                  },
                  parties: {
                    type: "array",
                    description: "Partes envolvidas identificadas na conversa (nomes de pessoas mencionadas como autor, réu, testemunha, advogado, etc.)",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Nome completo da parte" },
                        role: { type: "string", enum: ["autor", "reu", "testemunha", "advogado", "dependente", "perito", "outro"] },
                        phone: { type: "string", description: "Telefone se mencionado" },
                      },
                      required: ["name", "role"],
                    },
                  },
                  whatsapp_group_link: { type: "string", description: "Link do grupo de WhatsApp se identificado como conversa de grupo (formato chat.whatsapp.com/...)" },
                },
                required: ["title"],
              },
              attach_to_activity: {
                type: "object",
                description: "Anexar imagens/mídias enviadas a uma atividade existente. Use quando o assessor enviar uma imagem e pedir para anexar a uma atividade.",
                properties: {
                  activity_title_search: { type: "string", description: "Título ou parte do título da atividade para buscar" },
                  lead_name_search: { type: "string", description: "Nome do lead para filtrar a busca" },
                },
                required: ["activity_title_search"],
              },
              search_query: {
                type: "object",
                description: "Buscar informações no sistema",
                properties: {
                  search_type: { type: "string", enum: ["lead", "activity", "contact"] },
                  query: { type: "string" },
                },
                required: ["search_type", "query"],
              },
              productivity_report: {
                type: "object",
                description: "Consultar produtividade, metas, tarefas atrasadas, tempo online, ranking e gerar feedback. Use quando pedirem relatório, desempenho, feedback ou informações sobre metas.",
                properties: {
                  user_id: { type: "string", description: "user_id do assessor a consultar. Se sobre si mesmo, use o id do assessor atual." },
                  user_name: { type: "string", description: "Nome do assessor consultado" },
                  report_type: { type: "string", enum: ["full", "overdue_tasks", "goals", "session_time", "ranking", "feedback"], description: "Tipo do relatório: full=completo, overdue_tasks=só atrasadas, goals=metas, session_time=tempo online, ranking=posição, feedback=pontos de melhoria" },
                },
                required: ["user_id", "report_type"],
              },
            },
            required: ["response_text"],
          },
        },
      },
    ];

    // ── Call AI ──
    let aiData: any;
    try {
      aiData = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: aiMessages,
        tools,
        tool_choice: { type: "function", function: { name: "execute_command" } },
        temperature: 0.2,
      });
    } catch (e: any) {
      console.error("AI error:", e);
      const fallbackText = "⚠️ Erro temporário. Tente novamente em minutos.";

      await supabase.from("whatsapp_command_history").insert({
        phone: normalizedPhone, instance_name, role: "assistant", content: fallbackText, tool_data: { error: e.message },
      });

      if (instToken) {
        await sendWhatsAppText(baseUrl, instToken, normalizedPhone, `🤖 *WhatsJUD IA*\n\n${fallbackText}`).catch(e => console.error("Send error:", e));
      }
      return new Response(JSON.stringify({ success: false, error: fallbackText }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Parse AI response ──
    let responseText = "Comando processado.";
    let toolData: any = null;
    let parsed: any = null;

    const choice = aiData.choices?.[0]?.message;
    const toolCall = choice?.tool_calls?.[0];
    responseText = choice?.content || responseText;
    if (toolCall?.function?.name === "execute_command") {
      try { parsed = typeof toolCall.function.arguments === "string" ? JSON.parse(toolCall.function.arguments) : toolCall.function.arguments; } catch (e) { console.error("Parse error:", e); }
    }

    if (parsed) {
      responseText = parsed.response_text || responseText;
      toolData = {};

      // ── Create activity ──
      if (parsed.new_activity) {
        const act = parsed.new_activity;
        let leadId = null;
        if (act.lead_name) {
          const { data: leads } = await supabase.from("leads").select("id").ilike("lead_name", `%${act.lead_name}%`).limit(1);
          if (leads?.[0]) leadId = leads[0].id;
        }

        // Validate activity_type against known keys (case-insensitive + partial match)
        let validatedType = "tarefa";
        if (act.activity_type) {
          const inputType = act.activity_type.toLowerCase().replace(/[_\s-]/g, '');
          // Exact match first
          const exactMatch = actTypeKeys.find((k: string) => k.toLowerCase() === act.activity_type.toLowerCase());
          if (exactMatch) {
            validatedType = exactMatch;
          } else {
            // Partial/fuzzy match - check if input contains or is contained in any key
            const partialMatch = actTypeKeys.find((k: string) => {
              const normalizedKey = k.toLowerCase().replace(/[_\s-]/g, '');
              return normalizedKey.includes(inputType) || inputType.includes(normalizedKey);
            });
            // Also try matching against labels
            const labelMatch = !partialMatch ? actTypes.find((t: any) => {
              const normalizedLabel = t.label.toLowerCase().replace(/[_\s-]/g, '');
              return normalizedLabel.includes(inputType) || inputType.includes(normalizedLabel);
            }) : null;
            validatedType = partialMatch || labelMatch?.key || "tarefa";
          }
        }

        const { data: newAct, error: actErr } = await supabase
          .from("lead_activities")
          .insert({
            title: act.title,
            activity_type: validatedType,
            priority: act.priority || "normal",
            status: "pendente",
            assigned_to: act.assigned_to || config.user_id,
            assigned_to_name: act.assigned_to_name || config.user_name,
            created_by: config.user_id,
            deadline: act.deadline,
            notification_date: act.notification_date,
            notes: act.notes || null,
            what_was_done: act.what_was_done || null,
            next_steps: act.next_steps || null,
            matrix_quadrant: act.matrix_quadrant || "schedule",
            lead_id: leadId,
            lead_name: act.lead_name || null,
          })
          .select("id, title")
          .single();

        if (actErr) {
          console.error("Error creating activity:", actErr);
          responseText += "\n\n⚠️ Erro ao criar atividade: " + actErr.message;
        } else {
          toolData.activity_created = newAct;
          responseText += `\n\n🔗 *Acessar atividade:*\n${APP_URL}/?openActivity=${newAct?.id}`;
          console.log("Activity created via WhatsApp:", newAct?.id);

          // Auto-attach images/documents from buffered media
          if (newAct?.id && bufferedMedia.length > 0) {
            const imageMedia = bufferedMedia.filter(m => m.type === 'image' || m.type === 'document');
            for (const media of imageMedia) {
              const fileName = media.type === 'image' ? `whatsapp_image_${Date.now()}.jpg` : `whatsapp_doc_${Date.now()}`;
              await supabase.from("activity_attachments").insert({
                activity_id: newAct.id,
                file_name: fileName,
                file_url: media.url,
                file_type: media.type === 'image' ? 'image/jpeg' : 'application/octet-stream',
                attachment_type: 'file',
                created_by: config.user_id,
              });
            }
            if (imageMedia.length > 0) {
              responseText += `\n📎 ${imageMedia.length} anexo(s) vinculado(s) à atividade`;
            }

            // AI Vision: extract info from images and update activity
            const imageUrls = imageMedia.filter(m => m.type === 'image').map(m => m.url);
            if (imageUrls.length > 0) {
              try {
                const visionParts: any[] = [
                  { type: "text", text: `Analise as imagens a seguir e extraia TODAS as informações relevantes para organizar na atividade "${newAct.title}".
Retorne um JSON com:
- "description": texto descritivo completo do que aparece na(s) imagem(ns) (documentos, textos, informações visíveis)
- "extracted_notes": resumo das informações-chave extraídas (nomes, números, datas, valores, etc)
- "next_steps": próximos passos sugeridos baseado no conteúdo

Se for um documento jurídico, extraia: número do processo, partes, datas, valores, decisões.
Se for uma foto/print, descreva o conteúdo relevante.
Retorne APENAS o JSON, sem markdown.` },
                ];
                for (const url of imageUrls) {
                  visionParts.push({ type: "image_url", image_url: { url } });
                }

                const visionResult = await geminiChat({
                  model: "google/gemini-2.5-flash",
                  messages: [{ role: "user", content: visionParts }],
                  temperature: 0.1,
                });

                const visionText = visionResult.choices?.[0]?.message?.content || "";
                let extracted: any = null;
                try {
                  const cleaned = visionText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
                  extracted = JSON.parse(cleaned);
                } catch { /* ignore parse errors */ }

                if (extracted) {
                  const updateFields: any = {};
                  if (extracted.description) {
                    updateFields.description = (act.notes ? act.notes + "\n\n" : "") + "📷 *Informações extraídas da mídia:*\n" + extracted.description;
                  }
                  if (extracted.extracted_notes) {
                    updateFields.current_status_notes = extracted.extracted_notes;
                  }
                  if (extracted.next_steps && !act.next_steps) {
                    updateFields.next_steps = extracted.next_steps;
                  }

                  if (Object.keys(updateFields).length > 0) {
                    await supabase.from("lead_activities").update(updateFields).eq("id", newAct.id);
                    responseText += `\n🔍 Informações extraídas da imagem e salvas na atividade`;
                  }
                }
              } catch (visionErr) {
                console.error("Vision extraction error:", visionErr);
              }
            }
          }
        }
      }

      // ── Attach to existing activity ──
      if (parsed.attach_to_activity) {
        const att = parsed.attach_to_activity;
        let query = supabase.from("lead_activities").select("id, title").order("created_at", { ascending: false }).limit(5);
        if (att.activity_title_search) {
          query = query.ilike("title", `%${att.activity_title_search}%`);
        }
        if (att.lead_name_search) {
          query = query.ilike("lead_name", `%${att.lead_name_search}%`);
        }
        const { data: matchedActs } = await query;

        if (matchedActs && matchedActs.length > 0) {
          const targetAct = matchedActs[0];
          const imageMedia = bufferedMedia.filter(m => m.type === 'image' || m.type === 'document');
          let attachedCount = 0;
          for (const media of imageMedia) {
            const fileName = media.type === 'image' ? `whatsapp_image_${Date.now()}.jpg` : `whatsapp_doc_${Date.now()}`;
            const { error: attErr } = await supabase.from("activity_attachments").insert({
              activity_id: targetAct.id,
              file_name: fileName,
              file_url: media.url,
              file_type: media.type === 'image' ? 'image/jpeg' : 'application/octet-stream',
              attachment_type: 'file',
              created_by: config.user_id,
            });
            if (!attErr) attachedCount++;
          }
          if (attachedCount > 0) {
            responseText += `\n\n📎 ${attachedCount} anexo(s) vinculado(s) à atividade *${targetAct.title}*`;
            responseText += `\n✏️ Ver: ${APP_URL}/?openActivity=${targetAct.id}`;
          } else {
            responseText += "\n\n⚠️ Nenhuma imagem/documento encontrado para anexar.";
          }
          toolData.attached_to = targetAct;
        } else {
          responseText += "\n\n🔍 Nenhuma atividade encontrada com esse nome.";
        }
      }

      // ── Create lead ──
      if (parsed.new_lead) {
        const lead = parsed.new_lead;
        const { data: stages } = await supabase
          .from("kanban_stages").select("id")
          .eq("board_id", lead.board_id || boards[0]?.id)
          .order("display_order").limit(1);

        const { data: newLead, error: leadErr } = await supabase
          .from("leads")
          .insert({
            lead_name: lead.lead_name,
            lead_phone: lead.lead_phone || null,
            victim_name: lead.victim_name || null,
            city: lead.city || null,
            state: lead.state || null,
            board_id: lead.board_id || boards[0]?.id || null,
            stage_id: stages?.[0]?.id || null,
            notes: lead.notes || null,
            created_by: config.user_id,
            status: "novo",
          })
          .select("id, lead_name")
          .single();

        if (leadErr) {
          console.error("Error creating lead:", leadErr);
          responseText += "\n\n⚠️ Erro ao criar lead: " + leadErr.message;
        } else {
          toolData.lead_created = newLead;
          const boardId = lead.board_id || boards[0]?.id;
          responseText += `\n\n✏️ Editar: ${APP_URL}/leads?board=${boardId}&openLead=${newLead?.id}`;
          console.log("Lead created via WhatsApp:", newLead?.id);
        }
      }

      // ── Create Case (Caso Jurídico) ──
      if (parsed.new_case) {
        const cs = parsed.new_case;
        try {
          // 1) Determine board and closed stage
          const targetBoardId = cs.board_id || boards.find((b: any) => b.is_default)?.id || boards[0]?.id;
          const board = boards.find((b: any) => b.id === targetBoardId);
          const sortedStages = (board?.stages || []).sort((a: any, b: any) => a.display_order - b.display_order);
          const CLOSED_IDS = ['closed', 'fechado', 'done'];
          const closedStageId = sortedStages.find((s: any) => CLOSED_IDS.includes(s.id))?.id || 'closed';

          // 2) Create lead as "fechado"
          const closingDate = new Date().toISOString().split("T")[0];
          const { data: newLead, error: leadErr } = await supabase
            .from("leads")
            .insert({
              lead_name: cs.title,
              lead_phone: cs.lead_phone || null,
              victim_name: cs.victim_name || null,
              city: cs.city || null,
              state: cs.state || null,
              board_id: targetBoardId,
              status: closedStageId,
              became_client_date: closingDate,
              whatsapp_group_id: is_group ? (group_id || null) : null,
              notes: cs.notes || null,
              created_by: config.user_id,
              source: "whatsapp",
            })
            .select("id, lead_name")
            .single();
          if (leadErr) throw leadErr;

          // 3) Generate case number and create case
          const { data: caseNumber } = await supabase.rpc("generate_case_number", { p_nucleus_id: cs.nucleus_id || null });
          const { data: newCase, error: caseErr } = await supabase
            .from("legal_cases")
            .insert({
              lead_id: newLead.id,
              nucleus_id: cs.nucleus_id || null,
              case_number: caseNumber || `CASO-${Date.now()}`,
              title: cs.title,
              description: cs.description || null,
              notes: cs.notes || null,
              created_by: config.user_id,
            })
            .select("id, case_number, title")
            .single();
          if (caseErr) throw caseErr;

          let summaryParts: string[] = [];
          summaryParts.push(`⚖️ Caso *${newCase.case_number}* criado!`);
          summaryParts.push(`📋 ${cs.title}`);

          // 4) Create processes
          if (cs.processes && Array.isArray(cs.processes) && cs.processes.length > 0) {
            let procCount = 0;
            for (const proc of cs.processes) {
              const { error: procErr } = await supabase.from("lead_processes").insert({
                case_id: newCase.id,
                lead_id: newLead.id,
                title: proc.title || `Processo ${procCount + 1}`,
                process_number: proc.process_number || null,
                process_type: proc.process_type || "judicial",
                description: proc.description || null,
                status: "em_andamento",
                created_by: config.user_id,
              });
              if (!procErr) procCount++;
            }
            if (procCount > 0) summaryParts.push(`📑 ${procCount} processo(s) vinculado(s)`);
          }

          // 5) Create parties (contacts + process_parties)
          if (cs.parties && Array.isArray(cs.parties) && cs.parties.length > 0) {
            let partyCount = 0;
            for (const party of cs.parties) {
              if (!party.name) continue;
              // Find or create contact
              let contactId: string | null = null;
              const { data: existingContact } = await supabase
                .from("contacts")
                .select("id")
                .ilike("full_name", party.name)
                .limit(1)
                .maybeSingle();
              if (existingContact) {
                contactId = existingContact.id;
              } else {
                const { data: newContact } = await supabase
                  .from("contacts")
                  .insert({
                    full_name: party.name,
                    phone: party.phone || null,
                    source: "whatsapp",
                    created_by: config.user_id,
                  })
                  .select("id")
                  .single();
                contactId = newContact?.id || null;
              }

              // Link contact to lead
              if (contactId) {
                await supabase.from("contact_leads").insert({
                  contact_id: contactId,
                  lead_id: newLead.id,
                  relationship_to_victim: party.role === "autor" ? "Vítima" : party.role,
                }).select().maybeSingle();

                // Link to first process if exists
                if (cs.processes?.length > 0) {
                  const { data: firstProc } = await supabase
                    .from("lead_processes")
                    .select("id")
                    .eq("case_id", newCase.id)
                    .order("created_at")
                    .limit(1)
                    .maybeSingle();
                  if (firstProc) {
                    await supabase.from("process_parties").insert({
                      process_id: firstProc.id,
                      contact_id: contactId,
                      role: party.role || "outro",
                    }).select().maybeSingle();
                  }
                }
                partyCount++;
              }
            }
            if (partyCount > 0) summaryParts.push(`👥 ${partyCount} parte(s) cadastrada(s)`);
          }

          // 6) Group link info
          if (is_group && group_id) {
            summaryParts.push(`💬 Grupo de WhatsApp vinculado ao lead`);
          }

          if (cs.whatsapp_group_link) {
            summaryParts.push(`🔗 Link do grupo: ${cs.whatsapp_group_link}`);
          }

          toolData.case_created = newCase;
          toolData.lead_created = newLead;
          responseText = summaryParts.join("\n");
          responseText += `\n\n✏️ Ver caso: ${APP_URL}/leads?openLead=${newLead.id}`;
          console.log("Case created via WhatsApp:", newCase.id, "Lead:", newLead.id);
        } catch (caseError: any) {
          console.error("Error creating case:", caseError);
          responseText += `\n\n⚠️ Erro ao criar caso: ${caseError.message}`;
        }
      }

      if (parsed.search_query) {
        const sq = parsed.search_query;
        let results: any[] = [];

        if (sq.search_type === "lead") {
          const { data } = await supabase.from("leads").select("id, lead_name, status, stage_id, lead_phone, victim_name").ilike("lead_name", `%${sq.query}%`).limit(5);
          results = data || [];
        } else if (sq.search_type === "activity") {
          const { data } = await supabase.from("lead_activities").select("id, title, status, priority, deadline, assigned_to_name").or(`title.ilike.%${sq.query}%,notes.ilike.%${sq.query}%`).order("created_at", { ascending: false }).limit(5);
          results = data || [];
        } else if (sq.search_type === "contact") {
          const { data } = await supabase.from("contacts").select("id, full_name, phone, email").ilike("full_name", `%${sq.query}%`).limit(5);
          results = data || [];
        }

        toolData.search_results = results;
        if (results.length > 0) {
          const resultTexts = results.map((r: any) => {
            if (sq.search_type === "lead") return `• ${r.lead_name} (${r.status}) - ${r.lead_phone || "sem tel"}\n  🔗 ${APP_URL}/leads?openLead=${r.id}`;
            if (sq.search_type === "activity") return `• ${r.title} (${r.status}/${r.priority}) - ${r.deadline || "sem prazo"} - ${r.assigned_to_name || ""}\n  🔗 ${APP_URL}/?openActivity=${r.id}`;
            return `• ${r.full_name} - ${r.phone || ""} - ${r.email || ""}\n  🔗 ${APP_URL}/leads?tab=contacts&openContact=${r.id}`;
          });
          responseText += "\n\n📋 Resultados:\n" + resultTexts.join("\n");
        } else {
          responseText += "\n\n🔍 Nenhum resultado encontrado.";
        }
      }

      // ── Productivity Report ──
      if (parsed.productivity_report) {
        const pr = parsed.productivity_report;
        const targetUserId = pr.user_id || config.user_id;
        const targetName = pr.user_name || config.user_name;
        const today = new Date().toISOString().split("T")[0];
        const monthStart = `${today.slice(0, 7)}-01`;
        const todayStart = today + "T00:00:00";
        const todayEnd = today + "T23:59:59";

        // Fetch user's evaluated_metrics from team_members
        const { data: memberEntries } = await supabase
          .from("team_members")
          .select("evaluated_metrics")
          .eq("user_id", targetUserId);
        
        // Union of all evaluated_metrics across all teams the user belongs to
        const evaluatedMetrics = new Set<string>();
        (memberEntries || []).forEach((m: any) => {
          ((m.evaluated_metrics as string[]) || []).forEach((k: string) => evaluatedMetrics.add(k));
        });
        // If no metrics configured, show all by default
        const showAll = evaluatedMetrics.size === 0;
        const hasMetric = (key: string) => showAll || evaluatedMetrics.has(key);

        // Fetch ALL data sources in parallel
        const [
          overdueRes, goalsRes, sessionsRes, allActivitiesRes, snapshotsRes,
          contactsRes, dmsRes, repliesRes, stageHistoryRes, followupsRes,
          leadsRes, catContactsRes, completedActsRes, activityLogRes,
        ] = await Promise.all([
          // Overdue tasks
          supabase.from("lead_activities")
            .select("id, title, deadline, priority, lead_name")
            .eq("assigned_to", targetUserId).eq("status", "pendente")
            .lt("deadline", new Date().toISOString())
            .order("deadline", { ascending: true }).limit(10),
          // Goals
          supabase.from("commission_goals")
            .select("id, metric_key, target_value, period, period_start, period_end")
            .eq("is_active", true)
            .or(`user_id.eq.${targetUserId},user_id.is.null`)
            .order("created_at", { ascending: false }),
          // Sessions today
          supabase.from("user_sessions")
            .select("started_at, ended_at, duration_seconds")
            .eq("user_id", targetUserId)
            .gte("started_at", todayStart)
            .order("started_at", { ascending: false }),
          // Activities this month
          supabase.from("lead_activities")
            .select("id, status, activity_type, completed_at")
            .eq("assigned_to", targetUserId)
            .gte("created_at", monthStart + "T00:00:00"),
          // Daily goal snapshots
          supabase.from("daily_goal_snapshots")
            .select("snapshot_date, progress_percent, achieved, metrics_detail")
            .eq("user_id", targetUserId)
            .gte("snapshot_date", monthStart),
          // Contacts created today
          supabase.from("contacts")
            .select("id")
            .eq("created_by", targetUserId)
            .gte("created_at", todayStart).lte("created_at", todayEnd),
          // DMs sent today
          supabase.from("dm_history")
            .select("id, action_type")
            .eq("user_id", targetUserId)
            .gte("created_at", todayStart).lte("created_at", todayEnd),
          // Comment replies today
          supabase.from("instagram_comments")
            .select("id")
            .eq("replied_by", targetUserId)
            .gte("replied_at", todayStart).lte("replied_at", todayEnd),
          // Stage changes today
          supabase.from("lead_stage_history")
            .select("id, lead_id, to_stage")
            .eq("changed_by", targetUserId)
            .gte("changed_at", todayStart).lte("changed_at", todayEnd),
          // Followups today
          supabase.from("lead_followups")
            .select("id")
            .gte("created_at", todayStart).lte("created_at", todayEnd),
          // Leads created today
          supabase.from("leads")
            .select("id, status")
            .eq("created_by", targetUserId)
            .gte("created_at", todayStart).lte("created_at", todayEnd),
          // Calls today (CAT contacts)
          supabase.from("cat_lead_contacts")
            .select("id, contact_channel")
            .eq("contacted_by", targetUserId)
            .gte("created_at", todayStart).lte("created_at", todayEnd),
          // Completed activities today
          supabase.from("lead_activities")
            .select("id")
            .eq("completed_by", targetUserId).eq("status", "concluida")
            .gte("completed_at", todayStart).lte("completed_at", todayEnd),
          // Activity log today (page visits, checklist)
          supabase.from("user_activity_log")
            .select("id, action_type")
            .eq("user_id", targetUserId)
            .gte("created_at", todayStart).lte("created_at", todayEnd),
        ]);

        const overdue = overdueRes.data || [];
        const goals = goalsRes.data || [];
        const sessions = sessionsRes.data || [];
        const allActs = allActivitiesRes.data || [];
        const snapshots = snapshotsRes.data || [];
        const contacts = contactsRes.data || [];
        const dms = dmsRes.data || [];
        const replies = repliesRes.data || [];
        const stageHistory = stageHistoryRes.data || [];
        const followups = followupsRes.data || [];
        const leadsCreated = leadsRes.data || [];
        const catContacts = catContactsRes.data || [];
        const completedToday = completedActsRes.data || [];
        const activityLog = activityLogRes.data || [];

        // Calculate detailed metrics
        const totalSessionMinutes = sessions.reduce((sum: number, s: any) => sum + (s.duration_seconds || 0), 0) / 60;
        const completedMonth = allActs.filter((a: any) => a.status === "concluida").length;
        const pendingMonth = allActs.filter((a: any) => a.status === "pendente").length;
        const daysAchieved = snapshots.filter((s: any) => s.achieved).length;
        const avgProgress = snapshots.length > 0 ? Math.round(snapshots.reduce((sum: number, s: any) => sum + (s.progress_percent || 0), 0) / snapshots.length) : 0;

        const dmsSent = dms.filter((d: any) => d.action_type !== "received").length;
        const dmsReceived = dms.filter((d: any) => d.action_type === "received").length;
        const callsMade = catContacts.filter((c: any) => c.contact_channel === "phone" || c.contact_channel === "ligacao").length;
        const uniqueLeadsProgressed = new Set(stageHistory.map((s: any) => s.lead_id)).size;
        const CLOSED_STAGES = ["closed", "fechado", "done"];
        const leadsClosed = stageHistory.filter((s: any) => CLOSED_STAGES.includes(s.to_stage)).length;
        const checklistChecked = activityLog.filter((a: any) => a.action_type === "checklist_item_checked").length;

        let report = `📊 *Relatório de Produtividade*\n👤 *${targetName}*\n📅 ${today}\n\n`;

        // ── Today's Metrics ──
        // ── Today's Metrics (filtered by evaluated_metrics) ──
        if (pr.report_type === "full" || pr.report_type === "feedback") {
          report += `📌 *Métricas de Hoje*\n`;
          if (hasMetric("calls")) report += `  📞 Ligações: *${callsMade}*\n`;
          if (hasMetric("dms")) report += `  💬 DMs enviadas: *${dmsSent}*\n`;
          if (hasMetric("dms")) report += `  💬 DMs recebidas: *${dmsReceived}*\n`;
          if (hasMetric("replies")) report += `  💬 Respostas (comentários): *${replies.length}*\n`;
          if (hasMetric("contacts")) report += `  👥 Contatos cadastrados: *${contacts.length}*\n`;
          if (hasMetric("leads")) report += `  📋 Leads cadastrados: *${leadsCreated.length}*\n`;
          if (hasMetric("stage_changes")) report += `  🔄 Mudanças de fase: *${stageHistory.length}*\n`;
          if (hasMetric("stage_changes")) report += `  📈 Leads progredidos: *${uniqueLeadsProgressed}*\n`;
          if (hasMetric("leads_closed")) report += `  🏆 Leads fechados: *${leadsClosed}*\n`;
          if (hasMetric("activities")) report += `  ✅ Atividades concluídas: *${completedToday.length}*\n`;
          if (hasMetric("checklist_items")) report += `  ☑️ Checklist marcados: *${checklistChecked}*\n`;
          report += "\n";
        }

        // ── Session Time ──
        if (pr.report_type === "full" || pr.report_type === "session_time") {
          report += `🕐 *Tempo Online Hoje: ${Math.round(totalSessionMinutes)} min*\n`;
          report += `  📍 Sessões: ${sessions.length}\n\n`;
        }

        // ── Overdue Tasks ──
        if (pr.report_type === "full" || pr.report_type === "overdue_tasks") {
          report += `⚠️ *Tarefas Atrasadas: ${overdue.length}*\n`;
          if (overdue.length > 0) {
            overdue.slice(0, 5).forEach((t: any) => {
              const deadline = t.deadline ? new Date(t.deadline).toLocaleDateString("pt-BR") : "sem prazo";
              report += `  • ${t.title} (${deadline}) ${t.priority === "urgente" ? "🔴" : t.priority === "alta" ? "🟠" : ""}\n`;
            });
            if (overdue.length > 5) report += `  ... e mais ${overdue.length - 5}\n`;
          } else {
            report += `  ✅ Nenhuma tarefa atrasada!\n`;
          }
          report += "\n";
        }

        // ── Goals ──
        if (pr.report_type === "full" || pr.report_type === "goals") {
          report += `🎯 *Metas (${snapshots.length} dias com dados)*\n`;
          report += `  📈 Progresso médio: ${avgProgress}%\n`;
          report += `  ✅ Dias batidos: ${daysAchieved}/${snapshots.length}\n`;
          if (goals.length > 0) {
            report += `  📋 Metas ativas:\n`;
            goals.slice(0, 8).forEach((g: any) => {
              report += `    • ${g.metric_key}: alvo *${g.target_value}* (${g.period})\n`;
            });
          }
          report += "\n";
        }

        // ── Monthly Summary & Feedback ──
        if (pr.report_type === "full" || pr.report_type === "feedback") {
          report += `📋 *Atividades do Mês*\n`;
          report += `  ✅ Concluídas: ${completedMonth}\n`;
          report += `  ⏳ Pendentes: ${pendingMonth}\n`;
          report += `  ⚠️ Atrasadas: ${overdue.length}\n\n`;

          report += `💡 *Pontos de Atenção*\n`;
          if (overdue.length > 3) report += `  🔴 Muitas tarefas atrasadas (${overdue.length}). Priorize as mais urgentes.\n`;
          if (overdue.length === 0 && completedToday.length > 0) report += `  🟢 Excelente! Sem atrasos e com entregas hoje.\n`;
          if (hasMetric("session_minutes") && totalSessionMinutes < 120 && sessions.length > 0) report += `  🟡 Tempo online baixo hoje (${Math.round(totalSessionMinutes)} min).\n`;
          if (avgProgress < 50 && snapshots.length > 5) report += `  🟠 Progresso médio abaixo de 50%. Revise prioridades.\n`;
          if (daysAchieved > snapshots.length * 0.7) report += `  🌟 Ótima consistência! Metas batidas em ${daysAchieved}/${snapshots.length} dias.\n`;
          const noProspecting = (!hasMetric("dms") || dmsSent === 0) && (!hasMetric("calls") || callsMade === 0) && (!hasMetric("contacts") || contacts.length === 0);
          if (noProspecting && (hasMetric("dms") || hasMetric("calls") || hasMetric("contacts"))) report += `  🟡 Nenhuma ação de prospecção registrada hoje.\n`;
          if (hasMetric("calls") && callsMade >= 5) report += `  🟢 Bom volume de ligações hoje (${callsMade}).\n`;
          if (hasMetric("dms") && dmsSent >= 10) report += `  🟢 Bom volume de DMs enviadas (${dmsSent}).\n`;
          
          if (!showAll) {
            const metricLabels: Record<string, string> = { replies: "Respostas", dms: "DMs", leads: "Leads", session_minutes: "Tempo de sessão", contacts: "Contatos", calls: "Ligações", activities: "Atividades", stage_changes: "Fases", leads_closed: "Fechados", checklist_items: "Passos" };
            const activeList = Array.from(evaluatedMetrics).map(k => metricLabels[k] || k).join(", ");
            report += `\n📋 _Métricas avaliadas: ${activeList}_\n`;
          }
        }

        toolData.productivity_report = {
          overdue: overdue.length, completed_month: completedMonth, pending: pendingMonth,
          session_minutes: Math.round(totalSessionMinutes), avg_progress: avgProgress,
          today: { calls: callsMade, dms_sent: dmsSent, dms_received: dmsReceived, replies: replies.length,
            contacts: contacts.length, leads_created: leadsCreated.length, stage_changes: stageHistory.length,
            leads_progressed: uniqueLeadsProgressed, leads_closed: leadsClosed,
            activities_completed: completedToday.length, checklist: checklistChecked, followups: followups.length },
        };
        responseText = report;
      }
    }

    // Determine if we should ask about audio (only for activity/lead creation)
    const createdSomething = toolData?.activity_created || toolData?.lead_created || toolData?.case_created;
    const pendingAudioConfirm = createdSomething;

    // 5) Save AI response
    await supabase.from("whatsapp_command_history").insert({
      phone: normalizedPhone, instance_name, role: "assistant", content: responseText,
      tool_data: { ...toolData, ...(pendingAudioConfirm ? { awaiting_audio_confirm: true } : {}) },
    });

    // 6) Send response via WhatsApp
    if (instToken) {
      try {
        let fullMsg = `🤖 *WhatsJUD IA*\n\n${responseText}`;
        if (pendingAudioConfirm) {
          fullMsg += `\n\n🔊 Quer que eu envie um *áudio* explicando essa mensagem?\n_Responda *SIM* ou *NÃO*_`;
        }
        await sendWhatsAppText(baseUrl, instToken, normalizedPhone, fullMsg);
        console.log("Response sent to WhatsApp:", normalizedPhone);
      } catch (e) {
        console.error("Error sending response:", e);
      }
    }

    return new Response(JSON.stringify({ success: true, response: responseText, tool_data: toolData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Command processor error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
