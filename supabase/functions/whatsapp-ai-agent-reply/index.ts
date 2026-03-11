import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, instance_name, message_text, lead_id, campaign_id } = await req.json();
    if (!phone || !instance_name) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1) Check if there's an active agent for this conversation
    let assignment = null;
    const { data: existingAssignment } = await supabase
      .from("whatsapp_conversation_agents")
      .select("agent_id, is_active")
      .eq("phone", phone)
      .eq("instance_name", instance_name)
      .eq("is_active", true)
      .maybeSingle();

    assignment = existingAssignment;

    // 2) If no assignment and we have a campaign_id, try auto-assign by campaign
    if (!assignment && campaign_id) {
      const { data: campaignLink } = await supabase
        .from("whatsapp_agent_campaign_links")
        .select("agent_id")
        .eq("campaign_id", campaign_id)
        .maybeSingle();

      if (campaignLink) {
        // Auto-assign this agent to the conversation
        await supabase.from("whatsapp_conversation_agents").upsert({
          phone,
          instance_name,
          agent_id: campaignLink.agent_id,
          is_active: true,
          activated_by: "campaign_auto",
        }, { onConflict: "phone,instance_name" });
        assignment = { agent_id: campaignLink.agent_id, is_active: true };
        console.log(`Auto-assigned agent ${campaignLink.agent_id} via campaign ${campaign_id}`);
      }
    }

    // 3) If no assignment, also check if the lead has a campaign_id
    if (!assignment && lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("campaign_id")
        .eq("id", lead_id)
        .maybeSingle();

      if (lead?.campaign_id) {
        const { data: campaignLink } = await supabase
          .from("whatsapp_agent_campaign_links")
          .select("agent_id")
          .eq("campaign_id", lead.campaign_id)
          .maybeSingle();

        if (campaignLink) {
          await supabase.from("whatsapp_conversation_agents").upsert({
            phone,
            instance_name,
            agent_id: campaignLink.agent_id,
            is_active: true,
            activated_by: "campaign_auto",
          }, { onConflict: "phone,instance_name" });
          assignment = { agent_id: campaignLink.agent_id, is_active: true };
          console.log(`Auto-assigned agent ${campaignLink.agent_id} via lead campaign ${lead.campaign_id}`);
        }
      }
    }

    // 4) If no assignment, check broadcast list agents
    if (!assignment) {
      // Find if this phone belongs to any broadcast list with an active agent
      const normalizedPhone = phone.replace(/\D/g, '');
      const phoneSuffix = normalizedPhone.slice(-8);
      
      const { data: contactsInLists } = await supabase
        .from("broadcast_list_members")
        .select("broadcast_list_id, contact_id, contacts!inner(phone)")
        .filter("contacts.phone", "ilike", `%${phoneSuffix}%`)
        .limit(50);

      if (contactsInLists && contactsInLists.length > 0) {
        const listIds = [...new Set(contactsInLists.map((c: any) => c.broadcast_list_id))];
        
        const { data: listAgent } = await supabase
          .from("broadcast_list_agents")
          .select("agent_id, broadcast_list_id")
          .in("broadcast_list_id", listIds)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (listAgent) {
          // Auto-assign this agent to the conversation
          await supabase.from("whatsapp_conversation_agents").upsert({
            phone,
            instance_name,
            agent_id: listAgent.agent_id,
            is_active: true,
            activated_by: "broadcast_list_auto",
          }, { onConflict: "phone,instance_name" });
          assignment = { agent_id: listAgent.agent_id, is_active: true };
          console.log(`Auto-assigned agent ${listAgent.agent_id} via broadcast list ${listAgent.broadcast_list_id}`);
        }
      }
    }

    if (!assignment) {
      return new Response(JSON.stringify({ skipped: true, reason: "No active agent" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check human pause
    const { data: pauseCheck } = await supabase
      .from("whatsapp_conversation_agents")
      .select("human_paused_until")
      .eq("phone", phone)
      .eq("instance_name", instance_name)
      .maybeSingle();

    if ((pauseCheck as any)?.human_paused_until) {
      const pausedUntil = new Date((pauseCheck as any).human_paused_until);
      if (pausedUntil > new Date()) {
        console.log(`Agent paused until ${pausedUntil.toISOString()} due to human intervention`);
        return new Response(JSON.stringify({ skipped: true, reason: "Human pause active", paused_until: pausedUntil.toISOString() }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Pause expired, clear it
      await supabase
        .from("whatsapp_conversation_agents")
        .update({ human_paused_until: null } as any)
        .eq("phone", phone)
        .eq("instance_name", instance_name);
    }

    // Get agent config
    const { data: agent } = await supabase
      .from("whatsapp_ai_agents")
      .select("*")
      .eq("id", assignment.agent_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!agent) {
      return new Response(JSON.stringify({ skipped: true, reason: "Agent inactive" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== RESPONSE DELAY ==========
    if ((agent as any).response_delay_seconds > 0) {
      await new Promise(resolve => setTimeout(resolve, (agent as any).response_delay_seconds * 1000));
    }

    // ========== GENERATE AI RESPONSE ==========
    if ((agent as any).provider === "lovable_ai") {
      // Use Google AI API directly for cost savings
      const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
      // Fallback to Lovable AI if Google key not available
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      const useGoogleDirect = !!GOOGLE_AI_API_KEY;
      
      if (!GOOGLE_AI_API_KEY && !LOVABLE_API_KEY) {
        return new Response(JSON.stringify({ error: "AI not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get knowledge base documents for this agent
      const { data: knowledgeDocs } = await supabase
        .from("agent_knowledge_documents")
        .select("file_name, extracted_text")
        .eq("agent_id", (agent as any).id)
        .eq("status", "ready");

      let knowledgeContext = "";
      if (knowledgeDocs && knowledgeDocs.length > 0) {
        const docTexts = (knowledgeDocs as any[])
          .filter((d: any) => d.extracted_text?.trim())
          .map((d: any) => `--- Documento: ${d.file_name} ---\n${d.extracted_text}`)
          .join("\n\n");
        
        if (docTexts) {
          // Limit total knowledge context to ~30k chars to stay within token limits
          const maxKnowledgeChars = 30000;
          knowledgeContext = docTexts.length > maxKnowledgeChars 
            ? docTexts.substring(0, maxKnowledgeChars) + "\n[... base de conhecimento truncada]"
            : docTexts;
        }
      }

      // Build system prompt with knowledge base
      let systemPrompt = (agent as any).base_prompt;
      if (knowledgeContext) {
        systemPrompt += "\n\n=== BASE DE CONHECIMENTO ===\nUse as informações abaixo como referência para responder perguntas. Baseie suas respostas nestes documentos quando relevante:\n\n" + knowledgeContext + "\n\n=== FIM DA BASE DE CONHECIMENTO ===";
      }

      // Get recent context (include media info)
      const { data: recentMessages } = await supabase
        .from("whatsapp_messages")
        .select("direction, message_text, message_type, media_url, created_at")
        .eq("phone", phone)
        .eq("instance_name", instance_name)
        .order("created_at", { ascending: false })
        .limit(20);

      // Process messages handling different types (audio, image, document, etc.)
      const contextMessages: any[] = [];
      const audioTranscriptions: { url: string; transcription: string }[] = [];

      for (const m of (recentMessages || []).reverse()) {
        const role = (m as any).direction === "inbound" ? "user" : "assistant";
        const msgType = (m as any).message_type || "text";
        const mediaUrl = (m as any).media_url;
        const msgText = (m as any).message_text;

        if (msgType === "audio" && mediaUrl) {
          // Transcribe audio using Lovable AI
          try {
            const transcribeRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  { role: "user", content: [
                    { type: "text", text: "Transcreva esta mensagem de voz fielmente em português. Retorne APENAS o texto falado, sem explicações, marcações ou formatação. Se não conseguir transcrever, retorne '[áudio inaudível]'." },
                    { type: "image_url", image_url: { url: mediaUrl } }
                  ]}
                ],
                max_tokens: 500,
                temperature: 0.1,
              }),
            });

            if (transcribeRes.ok) {
              const transcribeData = await transcribeRes.json();
              const transcription = transcribeData.choices?.[0]?.message?.content?.trim();
              if (transcription && transcription !== "[áudio inaudível]") {
                contextMessages.push({ role, content: `[Mensagem de voz]: ${transcription}` });
                console.log(`Transcribed audio: ${transcription.substring(0, 50)}...`);
              } else {
                contextMessages.push({ role, content: msgText || "[Mensagem de voz não transcrita]" });
              }
            } else {
              console.error("Audio transcription failed:", transcribeRes.status);
              contextMessages.push({ role, content: msgText || "[Mensagem de voz]" });
            }
          } catch (e) {
            console.error("Audio transcription error:", e);
            contextMessages.push({ role, content: msgText || "[Mensagem de voz]" });
          }
        } else if (msgType === "image" && mediaUrl) {
          // Use multimodal content for images
          const textPart = msgText ? `${msgText} [com imagem anexada]` : "Olhe esta imagem:";
          contextMessages.push({
            role,
            content: [
              { type: "text", text: textPart },
              { type: "image_url", image_url: { url: mediaUrl } }
            ]
          });
        } else if (msgType === "document" && mediaUrl) {
          // Note document was sent
          const fileName = mediaUrl.split("/").pop() || "documento";
          const docNote = msgText || `[Documento enviado: ${decodeURIComponent(fileName)}]`;
          contextMessages.push({ role, content: docNote });
        } else if (msgType === "video" && mediaUrl) {
          contextMessages.push({ role, content: msgText || "[Vídeo enviado]" });
        } else if (msgType === "sticker") {
          contextMessages.push({ role, content: "[Figurinha/Sticker enviado]" });
        } else if (msgText?.trim()) {
          contextMessages.push({ role, content: msgText });
        }
      }

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: (agent as any).model,
          messages: [
            { role: "system", content: systemPrompt },
            ...contextMessages,
          ],
          max_tokens: (agent as any).max_tokens,
          temperature: (agent as any).temperature / 100,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI error:", aiResponse.status, errText);
        return new Response(JSON.stringify({ error: "AI failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await aiResponse.json();
      let reply = aiData.choices?.[0]?.message?.content || "";
      if (!reply.trim()) {
        return new Response(JSON.stringify({ skipped: true, reason: "Empty response" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Split message into parts if enabled, then add signature to last part
      const splitMessages = (agent as any).split_messages === true;
      let messageParts: string[] = [];

      if (splitMessages) {
        const paragraphs = reply.split(/\n\n+/).filter((p: string) => p.trim());
        if (paragraphs.length > 1) {
          let current = "";
          for (const p of paragraphs) {
            if (current && (current.length + p.length > 300)) {
              messageParts.push(current.trim());
              current = p;
            } else {
              current = current ? current + "\n\n" + p : p;
            }
          }
          if (current.trim()) messageParts.push(current.trim());
        } else {
          messageParts = [reply];
        }
      } else {
        messageParts = [reply];
      }

      // Add signature to last part only
      if ((agent as any).sign_messages) {
        const lastIdx = messageParts.length - 1;
        messageParts[lastIdx] = `${messageParts[lastIdx]}\n\n_🤖 ${(agent as any).name}_`;
        // Also update full reply for DB storage
        reply = messageParts.join("\n\n");
      }

      // Send via UazAPI v2
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("base_url, instance_token, instance_name")
        .eq("instance_name", instance_name)
        .maybeSingle();

      if (instance) {
        const baseUrl = (instance as any).base_url || "https://abraci.uazapi.com";
        const token = (instance as any).instance_token;
        const delayBetween = ((agent as any).split_delay_seconds || 2) * 1000;

        for (let i = 0; i < messageParts.length; i++) {
          const part = messageParts[i];
          const sendRes = await fetch(`${baseUrl}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "token": token },
            body: JSON.stringify({ number: phone, text: part }),
          });
          if (!sendRes.ok) {
            const errText = await sendRes.text();
            console.error("UazAPI send error:", sendRes.status, errText);
          } else {
            console.log(`UazAPI send success part ${i + 1}/${messageParts.length} to ${phone}`);
          }
          // Wait between parts (except last)
          if (i < messageParts.length - 1) {
            await new Promise(r => setTimeout(r, delayBetween));
          }
        }
      } else {
        console.error("No instance found for", instance_name);
      }

      // Save outbound message (full reply)
      await supabase.from("whatsapp_messages").insert({
        phone, instance_name, direction: "outbound",
        message_text: reply, metadata: { ai_agent: (agent as any).name, ai_agent_id: (agent as any).id, split_count: messageParts.length },
      });

      // ========== SCHEDULE FOLLOW-UP ==========
      if ((agent as any).followup_enabled) {
        const scheduledAt = new Date(Date.now() + (agent as any).followup_interval_minutes * 60 * 1000).toISOString();
        // Check if there's already a pending followup
        const { data: existingFollowup } = await supabase
          .from("whatsapp_agent_followups")
          .select("id")
          .eq("phone", phone)
          .eq("instance_name", instance_name)
          .eq("status", "pending")
          .maybeSingle();

        if (!existingFollowup) {
          await supabase.from("whatsapp_agent_followups").insert({
            phone, instance_name, agent_id: (agent as any).id,
            attempt_number: 1, scheduled_at: scheduledAt, status: "pending",
          });
          console.log(`Scheduled followup at ${scheduledAt}`);
        }
      }

      // ========== SCHEDULE AUTO-CALL (creates activity for assigned user) ==========
      if ((agent as any).auto_call_enabled) {
        const callInstanceName = (agent as any).auto_call_instance_name || instance_name;
        let scheduledAt: string;
        
        if ((agent as any).auto_call_mode === "immediate") {
          scheduledAt = new Date().toISOString();
        } else if ((agent as any).auto_call_mode === "delayed") {
          scheduledAt = new Date(Date.now() + (agent as any).auto_call_delay_seconds * 1000).toISOString();
        } else {
          // on_no_response
          scheduledAt = new Date(Date.now() + (agent as any).auto_call_no_response_minutes * 60 * 1000).toISOString();
        }

        // Check if already queued
        const { data: existingCall } = await supabase
          .from("whatsapp_call_queue")
          .select("id")
          .eq("phone", phone)
          .in("status", ["pending", "calling"])
          .maybeSingle();

        if (!existingCall) {
          // Get lead info for the queue record
          let leadName = null;
          if (lead_id) {
            const { data: leadData } = await supabase.from("leads").select("lead_name").eq("id", lead_id).maybeSingle();
            leadName = leadData?.lead_name;
          }

          await supabase.from("whatsapp_call_queue").insert({
            phone,
            instance_name: callInstanceName,
            agent_id: (agent as any).id,
            lead_id: lead_id || null,
            lead_name: leadName,
            contact_name: null,
            status: "pending",
            priority: (agent as any).auto_call_mode === "immediate" ? 10 : 0,
            scheduled_at: scheduledAt,
            max_attempts: 3,
          });
          console.log(`Queued auto-call for ${phone} at ${scheduledAt} (mode: ${(agent as any).auto_call_mode})`);

          // Create activity for assigned user if configured
          const callAssignedTo = (agent as any).call_assigned_to;
          if (callAssignedTo) {
            // Get assigned user name
            const { data: profileData } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("user_id", callAssignedTo)
              .maybeSingle();

            const assignedName = profileData?.full_name || "Responsável";
            const contactLabel = leadName || phone;

            await supabase.from("lead_activities").insert({
              title: `Ligar para ${contactLabel}`,
              description: `A IA identificou a necessidade de ligar para ${contactLabel} (${phone}). Motivo: interação via WhatsApp requer contato telefônico.`,
              activity_type: "ligacao",
              status: "pendente",
              priority: (agent as any).auto_call_mode === "immediate" ? "urgente" : "normal",
              assigned_to: callAssignedTo,
              assigned_to_name: assignedName,
              created_by: callAssignedTo,
              lead_id: lead_id || null,
              lead_name: leadName,
              deadline: new Date(scheduledAt).toISOString().split("T")[0],
            });
            console.log(`Created call activity for user ${assignedName} (${callAssignedTo})`);
          }
        }
      }

      return new Response(JSON.stringify({ success: true, reply: reply.substring(0, 100) }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // UazAPI-managed agents
    return new Response(JSON.stringify({ skipped: true, reason: "UazAPI agents managed externally" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Agent reply error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
