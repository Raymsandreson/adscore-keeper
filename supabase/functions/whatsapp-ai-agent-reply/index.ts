import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat, callGemini, parseGeminiResponse } from "../_shared/gemini.ts";
import { urlToBase64DataUri } from "../_shared/wjia-utils.ts";

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const cloudFunctionsUrl = Deno.env.get('SUPABASE_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co'
const cloudAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, instance_name, message_text, message_type, lead_id, campaign_id, is_group, contact_name, is_followup } = await req.json();
    console.log(`Agent reply request: phone=${phone}, instance=${instance_name}, is_followup=${!!is_followup}, msg_type=${message_type || 'text'}`);
    if (!phone || !instance_name) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ========== DEDUP LOCK: prevent duplicate replies ==========
    if (!is_followup) {
      const { error: lockErr } = await supabase
        .from("agent_reply_locks")
        .insert({ phone, instance_name, locked_at: new Date().toISOString(), expires_at: new Date(Date.now() + 120000).toISOString() });
      
      if (lockErr) {
        // Lock already exists = another invocation is handling this
        console.log(`Reply lock exists for ${phone}@${instance_name}, skipping duplicate`);
        return new Response(JSON.stringify({ skipped: true, reason: "Duplicate reply prevented by lock" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

    // Helper: groups can't click on ads, so never attribute "campaign_auto" to them
    const isGroup = phone.startsWith('120363') || phone.includes('@g.us');

    // 2) If no assignment and we have a campaign_id, try auto-assign by campaign
    if (!assignment && campaign_id) {
      const { data: campaignLink } = await supabase
        .from("whatsapp_agent_campaign_links")
        .select("agent_id, closed_agent_id, refused_agent_id, inviavel_agent_id")
        .eq("campaign_id", campaign_id)
        .eq("is_active", true)
        .maybeSingle();

      if (campaignLink) {
        // Check lead status to use the appropriate agent
        let resolvedAgentId = campaignLink.agent_id;
        if (lead_id) {
          const { data: leadCheck } = await supabase.from("leads").select("lead_status").eq("id", lead_id).maybeSingle();
          const statusAgentMap: Record<string, string | null> = {
            closed: campaignLink.closed_agent_id,
            refused: campaignLink.refused_agent_id,
            inviavel: campaignLink.inviavel_agent_id,
          };
          const statusAgent = leadCheck?.lead_status ? statusAgentMap[leadCheck.lead_status] : null;
          if (statusAgent) {
            resolvedAgentId = statusAgent;
            console.log(`Using ${leadCheck.lead_status}_agent_id ${resolvedAgentId} for lead status`);
          }
        }
        await supabase.from("whatsapp_conversation_agents").upsert({
          phone,
          instance_name,
          agent_id: resolvedAgentId,
          is_active: true,
          activated_by: isGroup ? "instance_default" : "campaign_auto",
        }, { onConflict: "phone,instance_name" });
        assignment = { agent_id: resolvedAgentId, is_active: true };
        console.log(`Auto-assigned agent ${resolvedAgentId} via campaign ${campaign_id}${isGroup ? ' (group, attributed as instance_default)' : ''}`);
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
          .select("agent_id, closed_agent_id, refused_agent_id, inviavel_agent_id")
          .eq("campaign_id", lead.campaign_id)
          .eq("is_active", true)
          .maybeSingle();

        if (campaignLink) {
          // Check lead_status to decide which agent
          let resolvedAgentId = campaignLink.agent_id;
          const { data: leadStatus } = await supabase.from("leads").select("lead_status").eq("id", lead_id).maybeSingle();
          const statusAgentMap: Record<string, string | null> = {
            closed: campaignLink.closed_agent_id,
            refused: campaignLink.refused_agent_id,
            inviavel: campaignLink.inviavel_agent_id,
          };
          const statusAgent = leadStatus?.lead_status ? statusAgentMap[leadStatus.lead_status] : null;
          if (statusAgent) {
            resolvedAgentId = statusAgent;
            console.log(`Using ${leadStatus.lead_status}_agent_id ${resolvedAgentId} for lead (via lead campaign)`);
          }
          await supabase.from("whatsapp_conversation_agents").upsert({
            phone,
            instance_name,
            agent_id: resolvedAgentId,
            is_active: true,
            activated_by: isGroup ? "instance_default" : "campaign_auto",
          }, { onConflict: "phone,instance_name" });
          assignment = { agent_id: resolvedAgentId, is_active: true };
          console.log(`Auto-assigned agent ${resolvedAgentId} via lead campaign ${lead.campaign_id}${isGroup ? ' (group, attributed as instance_default)' : ''}`);
        }
      }
    }

    // 4) If no assignment, check stage-based agent assignment
    if (!assignment && lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("board_id, status")
        .eq("id", lead_id)
        .maybeSingle();

      if (lead?.board_id && lead?.status) {
        const { data: stageAssignment } = await supabase
          .from("agent_stage_assignments")
          .select("agent_id")
          .eq("board_id", lead.board_id)
          .eq("stage_id", lead.status)
          .maybeSingle();

        if (stageAssignment) {
          await supabase.from("whatsapp_conversation_agents").upsert({
            phone,
            instance_name,
            agent_id: stageAssignment.agent_id,
            is_active: true,
            activated_by: "stage_auto",
          }, { onConflict: "phone,instance_name" });
          assignment = { agent_id: stageAssignment.agent_id, is_active: true };
          console.log(`Auto-assigned agent ${stageAssignment.agent_id} via stage ${lead.status} in board ${lead.board_id}`);
        }
      }
    }

    // 4.5) If no assignment, check lead_status_filter-based agent routing
    if (!assignment) {
      // Find lead linked to this phone (via contact or direct)
      const normalizedPhoneForStatus = phone.replace(/\D/g, '');
      const phoneSuffixForStatus = normalizedPhoneForStatus.slice(-8);
      
      let leadStatusToCheck: string | null = null;
      let foundLeadId: string | null = lead_id || null;
      let foundLeadBoardId: string | null = null;

      if (foundLeadId) {
        const { data: leadData } = await supabase
          .from("leads")
          .select("lead_status, board_id")
          .eq("id", foundLeadId)
          .maybeSingle();
        leadStatusToCheck = leadData?.lead_status || 'active';
        foundLeadBoardId = leadData?.board_id || null;
      } else {
        // Try to find lead via contact phone
        const { data: contactLeads } = await supabase
          .from("contacts")
          .select("id, contact_leads(lead_id, leads(id, lead_status, board_id))")
          .ilike("phone", `%${phoneSuffixForStatus}`)
          .limit(5);

        if (contactLeads) {
          for (const contact of contactLeads) {
            const cls = (contact as any).contact_leads || [];
            for (const cl of cls) {
              const lead = cl.leads;
              if (lead?.lead_status && ['closed', 'refused', 'inviavel'].includes(lead.lead_status)) {
                leadStatusToCheck = lead.lead_status;
                foundLeadId = lead.id;
                foundLeadBoardId = lead.board_id || null;
                break;
              }
            }
            if (leadStatusToCheck) break;
          }
        }
      }

      if (leadStatusToCheck) {
        // Find agents with lead_status_filter matching this status
        const { data: matchingAgents } = await supabase
          .from("wjia_command_shortcuts")
          .select("id, lead_status_filter, lead_status_board_ids")
          .eq("is_active", true)
          .not("lead_status_filter", "is", null);

        if (matchingAgents) {
          const matched = matchingAgents.find((a: any) => {
            if (!Array.isArray(a.lead_status_filter) || !a.lead_status_filter.includes(leadStatusToCheck)) return false;
            // If board filter is set, check if lead's board matches
            if (Array.isArray(a.lead_status_board_ids) && a.lead_status_board_ids.length > 0) {
              return foundLeadBoardId && a.lead_status_board_ids.includes(foundLeadBoardId);
            }
            return true;
          });

          if (matched) {
            await supabase.from("whatsapp_conversation_agents").upsert({
              phone,
              instance_name,
              agent_id: matched.id,
              is_active: true,
              activated_by: "lead_status_auto",
            }, { onConflict: "phone,instance_name" });
            assignment = { agent_id: matched.id, is_active: true };
            console.log(`Auto-assigned agent ${matched.id} via lead_status_filter (status=${leadStatusToCheck}, board=${foundLeadBoardId}, lead=${foundLeadId})`);
          }
        }
      }
    }

    // 5) If no assignment, check broadcast list agents
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

    // 6) Step removed - only campaign_id-based routing is used (steps 2-3)

    // 7) If no assignment, check instance-level default agent
    if (!assignment) {
      const { data: instanceData } = await supabase
        .from("whatsapp_instances")
        .select("default_agent_id")
        .eq("instance_name", instance_name)
        .maybeSingle();

      if (instanceData?.default_agent_id) {
        await supabase.from("whatsapp_conversation_agents").upsert({
          phone,
          instance_name,
          agent_id: instanceData.default_agent_id,
          is_active: true,
          activated_by: "instance_default",
        }, { onConflict: "phone,instance_name" });
        assignment = { agent_id: instanceData.default_agent_id, is_active: true };
        console.log(`Auto-assigned agent ${instanceData.default_agent_id} via instance default for ${instance_name}`);
      }
    }

    // Fetch instance owner_name for agent identity
    let instanceOwnerName: string | null = null;
    {
      const { data: instInfo } = await supabase
        .from("whatsapp_instances")
        .select("owner_name")
        .eq("instance_name", instance_name)
        .maybeSingle();
      instanceOwnerName = (instInfo as any)?.owner_name || null;
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

    if ((pauseCheck as any)?.human_paused_until && !is_followup) {
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

    // Get agent config - check whatsapp_ai_agents first, then wjia_command_shortcuts
    let agent: any = null;
    const { data: aiAgent } = await supabase
      .from("whatsapp_ai_agents")
      .select("*")
      .eq("id", assignment.agent_id)
      .eq("is_active", true)
      .maybeSingle();

    if (aiAgent) {
      agent = aiAgent;
      // Check if this agent also exists as a shortcut with template_token
      const { data: matchingShortcut } = await supabase
        .from("wjia_command_shortcuts")
        .select("template_token, template_name, shortcut_name, request_documents, document_types, custom_document_names, document_type_modes, followup_steps, notify_on_signature, send_signed_pdf")
        .eq("id", assignment.agent_id)
        .eq("is_active", true)
        .maybeSingle();
      if (matchingShortcut && (matchingShortcut as any).template_token) {
        agent.is_shortcut = true;
        agent.template_token = (matchingShortcut as any).template_token;
        agent.template_name = (matchingShortcut as any).template_name;
        agent.shortcut_name = (matchingShortcut as any).shortcut_name;
        console.log(`Enriched agent "${agent.name}" with shortcut template_token: ${agent.template_token}`);
      }
    } else {
      // Fallback: check wjia_command_shortcuts (instance default may reference this table)
      const { data: shortcut } = await supabase
        .from("wjia_command_shortcuts")
        .select("*")
        .eq("id", assignment.agent_id)
        .eq("is_active", true)
        .maybeSingle();
      
      if (shortcut) {
        // Map shortcut fields to agent-compatible format
        agent = {
          id: (shortcut as any).id,
          name: '#' + (shortcut as any).shortcut_name,
          base_prompt: (shortcut as any).prompt_instructions,
          model: (shortcut as any).model || "google/gemini-2.5-flash",
          temperature: (shortcut as any).temperature ?? 70,
          max_tokens: (shortcut as any).max_tokens ?? 1024,
          max_tts_chars: (shortcut as any).max_tts_chars ?? 1000,
          response_delay_seconds: (shortcut as any).response_delay_seconds || 0,
          split_messages: (shortcut as any).split_messages || false,
          split_delay_seconds: (shortcut as any).split_delay_seconds || 2,
          sign_messages: false,
          provider: "lovable",
          respond_in_groups: (shortcut as any).respond_in_groups || false,
          reply_with_audio: (shortcut as any).reply_with_audio || false,
          reply_voice_id: (shortcut as any).reply_voice_id || null,
          human_reply_pause_minutes: (shortcut as any).human_reply_pause_minutes || 10,
          is_shortcut: true,
          template_token: (shortcut as any).template_token || null,
          send_window_start_hour: (shortcut as any).send_window_start_hour ?? 8,
          send_window_end_hour: (shortcut as any).send_window_end_hour ?? 20,
        };
        console.log(`Using command shortcut "${agent.name}" as agent for instance default`);
      }
    }

    if (!agent) {
      return new Response(JSON.stringify({ skipped: true, reason: "Agent inactive" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if agent is allowed to respond in groups
    if (is_group && !(agent as any).respond_in_groups) {
      console.log(`Agent ${(agent as any).name} is not allowed to respond in groups, skipping`);
      return new Response(JSON.stringify({ skipped: true, reason: "Agent not allowed in groups" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== FOLLOW-UP WINDOW CHECK (only applies to follow-ups, not regular responses) ==========
    if (is_followup) {
      const nowBrasilia = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const currentHour = nowBrasilia.getHours();
      const windowStart = (agent as any).send_window_start_hour ?? 8;
      const windowEnd = (agent as any).send_window_end_hour ?? 20;
      if (currentHour < windowStart || currentHour >= windowEnd) {
        console.log(`Follow-up outside window (${windowStart}h-${windowEnd}h, current: ${currentHour}h). Skipping.`);
        return new Response(JSON.stringify({ skipped: true, reason: `Follow-up outside window (${windowStart}h-${windowEnd}h)` }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ========== MESSAGE BATCHING DELAY ==========
    // Skip batching delay for manual followups to avoid timeouts
    const batchDelaySeconds = (agent as any).response_delay_seconds || 0;
    if (batchDelaySeconds > 0 && !is_followup) {
      console.log(`Batching delay: waiting ${batchDelaySeconds}s for more messages from ${phone}`);
      await new Promise(resolve => setTimeout(resolve, batchDelaySeconds * 1000));

      // After sleeping, check if newer inbound messages arrived during the delay
      // If yes, skip this invocation — the latest message's invocation will handle all of them
      const cutoffTime = new Date(Date.now() - batchDelaySeconds * 1000).toISOString();
      const { data: newerMessages } = await supabase
        .from("whatsapp_messages")
        .select("id, created_at")
        .eq("phone", phone)
        .eq("instance_name", instance_name)
        .eq("direction", "inbound")
        .gt("created_at", cutoffTime)
        .order("created_at", { ascending: false })
        .limit(1);

      if (newerMessages && newerMessages.length > 0) {
        const newestMsgTime = new Date((newerMessages[0] as any).created_at).getTime();
        // If a message arrived less than (delay * 0.8) seconds ago, a newer invocation will handle it
        const freshThresholdMs = batchDelaySeconds * 800; // 80% of delay window
        if (Date.now() - newestMsgTime < freshThresholdMs) {
          console.log(`Batching: newer message detected, skipping this invocation (newer msg age: ${Date.now() - newestMsgTime}ms)`);
          return new Response(JSON.stringify({ skipped: true, reason: "Batching: newer message will handle" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      console.log(`Batching delay complete: processing all accumulated messages for ${phone}`);
    } else if (is_followup) {
      console.log(`Manual followup: skipping batching delay for ${phone}`);
    }

    // ========== CONTENT MODERATION: block sexual/disrespectful content ==========
    if (message_text && !is_followup) {
      try {
        const moderationResult = await geminiChat({
          model: "google/gemini-2.5-flash-lite",
          temperature: 0,
          max_tokens: 20,
          messages: [
            {
              role: "system",
              content: "Você é um classificador de conteúdo. Analise a mensagem e responda APENAS 'BLOCK' se contiver conteúdo sexual, assédio, xingamentos graves, ameaças ou linguagem extremamente desrespeitosa. Responda 'OK' para qualquer outro conteúdo, incluindo reclamações normais, negativas educadas ou linguagem informal. Seja rigoroso: só bloqueie conteúdo realmente ofensivo/sexual."
            },
            { role: "user", content: message_text }
          ],
        });
        const verdict = moderationResult?.choices?.[0]?.message?.content?.trim()?.toUpperCase() || "OK";
        if (verdict.includes("BLOCK")) {
          console.log(`Content moderation BLOCKED message from ${phone}: "${message_text.substring(0, 100)}"`);
          // Mark conversation as blocked and deactivate agent
          await supabase
            .from("whatsapp_conversation_agents")
            .update({ is_active: false, is_blocked: true } as any)
            .eq("phone", phone)
            .eq("instance_name", instance_name);

          // Actually block the contact on WhatsApp via UazAPI
          try {
            const { data: inst } = await supabase
              .from("whatsapp_instances")
              .select("base_url, instance_token")
              .eq("instance_name", instance_name)
              .maybeSingle();
            if (inst?.instance_token) {
              const blockBaseUrl = (inst as any).base_url || "https://abraci.uazapi.com";
              const blockRes = await fetch(`${blockBaseUrl}/chat/block`, {
                method: "POST",
                headers: { "Content-Type": "application/json", token: (inst as any).instance_token },
                body: JSON.stringify({ number: phone, block: true }),
              });
              console.log(`UazAPI block contact ${phone}: status=${blockRes.status}`);
            }
          } catch (blockErr) {
            console.error("Failed to block contact via UazAPI:", blockErr);
          }

          // Release lock
          if (!is_followup) {
            await supabase.from("agent_reply_locks").delete().eq("phone", phone).eq("instance_name", instance_name);
          }
          return new Response(JSON.stringify({ blocked: true, reason: "Inappropriate content detected" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (modErr) {
        console.error("Content moderation error (proceeding anyway):", modErr);
        // Don't block on moderation failure — let the message through
      }
    }

    // ========== GENERATE AI RESPONSE ==========
    if ((agent as any).provider === "lovable") {
      const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
      if (!GOOGLE_AI_API_KEY) {
        return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY not configured" }), {
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

      // Build system prompt with humanization layer + knowledge base
      const humanizationPrefix = `REGRA ABSOLUTA DE TOM E ESTILO:
Você é um ser humano real conversando pelo WhatsApp. NUNCA revele ou insinue que é uma IA/robô/assistente virtual.
- Escreva como uma pessoa real digitaria no WhatsApp: frases curtas, naturais, com linguagem do dia a dia
- PROIBIDO usar listas com bullets (•, -, *), numeração ou formatação estruturada — converse normalmente em frases corridas
- PROIBIDO dizer "digite X", "envie X", "selecione X" como comandos — peça as coisas de forma natural (ex: "me manda uma foto do seu RG" ao invés de "• RG / CNH (documento com foto)")
- PROIBIDO usar emojis em excesso — use no máximo 1-2 por mensagem, como uma pessoa normal faria
- Se precisar pedir vários documentos, peça um de cada vez em mensagens separadas, ou mencione de forma conversacional (ex: "vou precisar do seu RG e um comprovante de endereço, pode mandar?")
- Mantenha mensagens curtas, como alguém digitando rápido no celular
- Use "você", "tá", "tô", "pra" — linguagem informal brasileira natural
- Se a pessoa não tiver algo no momento, diga algo como "sem problema, manda quando conseguir" ao invés de "digite pular"
- NUNCA peça pro cliente digitar ou responder por texto — se ele mandou áudio, responda normalmente sobre o que ele falou. O cliente pode se comunicar da forma que preferir (áudio ou texto)
- PROIBIDO ABSOLUTO: NUNCA mencione ligações telefônicas, tentativas de ligação, duração de chamadas ou qualquer ação interna do sistema para o cliente. Você NÃO faz ligações. Você NÃO sabe se alguém ligou para o cliente. NUNCA diga "liguei pra você", "tentei te ligar", "a ligação durou X minutos", "fiz uma chamada" ou qualquer variação. Essas são ações internas que o cliente NÃO deve saber.
- PROIBIDO mencionar qualquer processo interno, automação, sistema, fila de ligações, follow-up automático ou ações do sistema ao cliente

REGRAS DE ENDEREÇO E CEP:
- Se o cliente informar o CEP, NÃO pergunte rua, bairro, cidade ou estado — esses dados são obtidos automaticamente pelo CEP
- Se precisar de endereço, peça o CEP primeiro — é mais rápido e evita erros
- Se o cliente não souber o CEP, ACEITE e peça rua, número, bairro, cidade e estado — NÃO insista no CEP
- Se o cliente disse que não sabe o CEP, NÃO pergunte novamente. Colete o endereço sem CEP.
- ENDEREÇO COMPLETO deve incluir: rua, número, bairro, complemento (se houver), cidade e estado
- DATA DE ASSINATURA de documentos é SEMPRE a data de hoje, nunca pergunte
- LOCAL DE ASSINATURA é SEMPRE a mesma cidade/estado do endereço do cliente, nunca pergunte separadamente

REGRAS DE EXTRAÇÃO DE DOCUMENTOS:
- Se o cliente enviar uma FOTO ou PDF de documento (CNH, RG, comprovante, etc.), você DEVE LER e EXTRAIR automaticamente todos os dados visíveis: nome, CPF, endereço, data de nascimento, etc.
- NUNCA peça ao cliente dados que estão visíveis em um documento que ele já enviou
- Ao extrair dados de um documento, confirme com o cliente: "Encontrei os seguintes dados no seu documento: [dados]. Está tudo certo?"

`;
      // Use followup_prompt when available and this is a followup request
      const effectivePrompt = is_followup && (agent as any).followup_prompt?.trim()
        ? (agent as any).followup_prompt
        : (agent as any).base_prompt || '';
      let systemPrompt = humanizationPrefix + effectivePrompt;
      
      if (is_followup) {
        systemPrompt += `\n\nCONTEXTO DE FOLLOW-UP:
- Esta é uma mensagem de FOLLOW-UP automático. O lead não respondeu recentemente.
- NÃO repita a última mensagem enviada. Gere uma abordagem DIFERENTE e criativa.
- Use o histórico da conversa para contextualizar, mas traga um ângulo novo.
- Seja breve e direto — uma mensagem curta de retomada.`;
      }

      // If this is a shortcut with a ZapSign template, fetch template fields and inject into prompt
      if ((agent as any).is_shortcut && (agent as any).template_token) {
        const zapsignToken = Deno.env.get("ZAPSIGN_API_TOKEN");
        if (zapsignToken) {
          try {
            const tplRes = await fetch(`https://api.zapsign.com.br/api/v1/templates/${(agent as any).template_token}/`, {
              headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
            });
            if (tplRes.ok) {
              const tplDetail = await tplRes.json();
              const tplFields = (tplDetail.inputs || []).map((inp: any) => ({
                variable: inp.variable || "", label: inp.label || "", required: inp.required || false,
              }));
              if (tplFields.length > 0) {
                const fieldsList = tplFields
                  .map((f: any) => `- ${f.variable} (${f.label || 'sem label'})${f.required ? ' [OBRIGATÓRIO]' : ' [opcional]'}`)
                  .join("\n");
                systemPrompt += `\n\n=== CAMPOS DO DOCUMENTO ZAPSIGN ===
Estes são os ÚNICOS campos que você precisa coletar do cliente para preencher o documento "${tplDetail.name || 'Procuração'}":
${fieldsList}

REGRAS IMPORTANTES:
1. EXTRAÇÃO DE DOCUMENTOS: Se o cliente enviou imagens ou PDFs de documentos (CNH, RG, comprovante de endereço, etc.), LEIA E EXTRAIA todos os dados visíveis: nome completo, CPF, data de nascimento, endereço, número do documento, etc. USE esses dados extraídos para preencher os campos acima. NÃO peça ao cliente dados que você consegue ver no documento enviado.
2. ANTES DE PERGUNTAR QUALQUER COISA: Analise TODA a conversa anterior E os documentos enviados, extraia os dados que o cliente JÁ forneceu ou que estão visíveis nos documentos. NÃO peça novamente informações que já foram mencionadas ou que estão nos documentos.
3. Se já tiver dados suficientes (extraídos de documentos + conversa), apresente um RESUMO dos dados extraídos e peça a CONFIRMAÇÃO do cliente antes de gerar o documento.
4. Se faltar algum campo obrigatório que NÃO está visível nos documentos enviados, peça SOMENTE os que faltam.
5. Pergunte SOMENTE os campos listados acima. NÃO peça dados extras como nome da mãe, RG, etc. que não estejam na lista.
6. Campos como DATA_ASSINATURA ou DATA_PROCURACAO são preenchidos automaticamente com a data de hoje — NÃO pergunte.
7. NUNCA invente ou gere links de assinatura. O link será gerado automaticamente pelo sistema após a coleta.
8. Quando tiver todos os dados obrigatórios, confirme com o cliente e diga que vai preparar o documento.
9. Se o cliente já enviou documentos e na conversa só faltam poucos campos de texto (ex: estado civil, profissão), peça esses dados faltantes de forma natural e curta.
10. NÃO é necessário ter TODOS os campos preenchidos para gerar o documento. Se conseguir a maioria dos dados importantes (nome, CPF, etc.), pode gerar o documento — os campos faltantes serão preenchidos pelo próprio cliente no link de assinatura. Informe ao cliente que ele poderá completar os dados restantes diretamente no formulário online.
=== FIM DOS CAMPOS ===`;
              }
            }
          } catch (tplErr) {
            console.error("Error fetching ZapSign template fields:", tplErr);
          }
        }
      }
      
      // Add agent identity based on instance owner name
      if (instanceOwnerName) {
        systemPrompt += `\n\nSUA IDENTIDADE:\nVocê se chama ${instanceOwnerName}. Quando se apresentar ou assinar mensagens, use esse nome. Se perguntarem seu nome, responda "${instanceOwnerName}". Mantenha essa identidade durante toda a conversa.`;
      }
      
      // Add contact identification context to prevent identity confusion
      if (contact_name) {
        systemPrompt += `\n\nIDENTIFICAÇÃO DO CONTATO:\nVocê está conversando com: ${contact_name} (telefone: ${phone}).\nIMPORTANTE: Se durante a conversa aparecer áudios ou mensagens que mencionem outros nomes, NÃO confunda — o cliente com quem você está falando é ${contact_name}. Outros nomes podem ser de terceiros mencionados na conversa.`
      }
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
        .limit(is_followup ? 40 : 20);

      // Process messages handling different types (audio, image, document, etc.)
      const contextMessages: any[] = [];
      const audioTranscriptions: { url: string; transcription: string }[] = [];

      for (const m of (recentMessages || []).reverse()) {
        const role = (m as any).direction === "inbound" ? "user" : "assistant";
        const msgType = (m as any).message_type || "text";
        const mediaUrl = (m as any).media_url;
        const msgText = (m as any).message_text;

        if (msgType === "audio") {
          // Use the already-transcribed text from the webhook (stored in message_text)
          // This avoids re-transcribing and getting different/wrong results
          if (msgText?.trim() && msgText !== "[áudio inaudível]") {
            contextMessages.push({ role, content: `[Mensagem de voz]: ${msgText}` });
          } else {
            contextMessages.push({ role, content: "[Mensagem de voz não transcrita]" });
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
          // Send document as visual content so AI can extract data (CPF, name, etc.)
          const fileName = mediaUrl.split("/").pop() || "documento";
          const isPdf = mediaUrl.toLowerCase().includes(".pdf") || fileName.toLowerCase().endsWith(".pdf");
          if (isPdf) {
            try {
              const docBase64 = await urlToBase64DataUri(mediaUrl);
              const textPart = msgText || `Documento enviado: ${decodeURIComponent(fileName)}. Extraia todos os dados visíveis (nome, CPF, endereço, etc.)`;
              contextMessages.push({
                role,
                content: [
                  { type: "text", text: textPart },
                  { type: "image_url", image_url: { url: docBase64 } }
                ]
              });
            } catch (e) {
              console.error("Failed to convert document to base64:", e);
              const docNote = msgText || `[Documento enviado: ${decodeURIComponent(fileName)}]`;
              contextMessages.push({ role, content: docNote });
            }
          } else {
            const docNote = msgText || `[Documento enviado: ${decodeURIComponent(fileName)}]`;
            contextMessages.push({ role, content: docNote });
          }
        } else if (msgType === "video" && mediaUrl) {
          contextMessages.push({ role, content: msgText || "[Vídeo enviado]" });
        } else if (msgType === "sticker") {
          contextMessages.push({ role, content: "[Figurinha/Sticker enviado]" });
        } else if (msgText?.trim()) {
          contextMessages.push({ role, content: msgText });
        }
      }

      const aiResult = await geminiChat({
        model: (agent as any).model || "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...contextMessages,
        ],
        max_tokens: Math.max((agent as any).max_tokens || 2048, 4096),
        temperature: (agent as any).temperature / 100,
      });

      let reply = aiResult.choices?.[0]?.message?.content || "";
      if (!reply.trim()) {
        return new Response(JSON.stringify({ skipped: true, reason: "Empty response" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ========== SHORTCUT DOCUMENT HANDOFF ==========
      // If this agent is a shortcut with a template_token, detect when data collection
      // is complete and trigger wjia-agent to actually generate the document
      if ((agent as any).is_shortcut && (agent as any).template_token) {
        const templateToken = (agent as any).template_token;
        
        // Check if there's already an active wjia session for this phone+instance
        const { data: existingSession } = await supabase
          .from("wjia_collection_sessions")
          .select("id, status, sign_url")
          .eq("phone", phone.replace(/\D/g, "").replace(/^0+/, ""))
          .eq("instance_name", instance_name)
          .in("status", ["collecting", "collecting_docs", "processing_docs", "ready", "generated"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingSession?.status === "generated" && existingSession?.sign_url) {
          // Session already generated — check if client sent new data that should trigger regeneration
          const lastInbound = message_text?.trim();
          const hasNewData = lastInbound && lastInbound.length > 3 && !/^(ok|sim|não|nao|obrigad|valeu|👍|beleza|blz|pronto|certo|tá|ta)\b/i.test(lastInbound);
          
          if (hasNewData) {
            // Client sent additional data after generation — regenerate with updated data
            const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");
            const shortcutName = (agent as any).name?.replace(/^#/, "") || "";
            
            console.log(`Post-generation data update: regenerating session ${existingSession.id} for ${normalizedPhone}`);
            
            // Trigger wjia-agent to regenerate with new data from conversation
            fetch(`${cloudFunctionsUrl}/functions/v1/wjia-agent`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
              },
              body: JSON.stringify({
                action: "regenerate_session",
                session_id: existingSession.id,
                phone: normalizedPhone,
                instance_name,
              }),
            }).catch(err => console.error("Regeneration handoff error:", err));
            
            reply = "Anotei os novos dados! Vou atualizar o documento e te enviar um novo link em instantes. Se faltar alguma coisa, você pode preencher direto no formulário online. 📄";
          } else {
            // Simple acknowledgment or question — just resend the link
            reply = `Esse é o link para assinatura do documento 👇\n\n${existingSession.sign_url}\n\nSe tiver algum dado faltando, pode preencher direto no formulário. É só clicar e seguir as instruções! 🙏`;
          }
        } else if (existingSession && ["collecting", "collecting_docs", "processing_docs", "ready"].includes(existingSession.status)) {
          // Session exists but not yet generated — check if client wants to generate with incomplete data
          const replyLower = reply.toLowerCase();
          const clientWantsGenerate = replyLower.includes("gerar") || replyLower.includes("link") || replyLower.includes("formulário") || replyLower.includes("formulario") || replyLower.includes("preparar") || replyLower.includes("finaliz");
          const clientMessage = message_text?.toLowerCase() || "";
          const clientAskedGenerate = clientMessage.includes("gerar") || clientMessage.includes("pode gerar") || clientMessage.includes("formulário") || clientMessage.includes("formulario") || clientMessage.includes("completo no") || clientMessage.includes("gera assim");
          
          if (clientWantsGenerate || clientAskedGenerate) {
            const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");
            const shortcutName = (agent as any).name?.replace(/^#/, "") || "";
            
            console.log(`Force-generate: client asked to generate session ${existingSession.id} with status ${existingSession.status}`);
            
            // Trigger wjia-agent to force generate with whatever data we have
            fetch(`${cloudFunctionsUrl}/functions/v1/wjia-agent`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
              },
              body: JSON.stringify({
                action: "force_generate",
                session_id: existingSession.id,
                phone: normalizedPhone,
                instance_name,
              }),
            }).catch(err => console.error("Force-generate handoff error:", err));
            
            // Clean up the AI reply
            reply = reply
              .replace(/https?:\/\/\S+/gi, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
            if (!reply) {
              reply = "Perfeito! Vou gerar o documento agora com os dados que tenho. O que faltar, você pode preencher direto no formulário. Em instantes você recebe o link! 📄";
            }
          }
        } else if (!existingSession) {
          // No active session — check if AI reply indicates data is ready or client confirmed
          const replyLower = reply.toLowerCase();
          const indicatesReady = replyLower.includes("procuração") || replyLower.includes("documento");
          const indicatesWillSend = replyLower.includes("link") || replyLower.includes("preparar") || replyLower.includes("gerar") || replyLower.includes("finaliz");
          
          if (indicatesReady && indicatesWillSend) {
            // The AI thinks it can generate the document — trigger wjia-agent
            const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");
            const shortcutName = (agent as any).name?.replace(/^#/, "") || "";
            
            console.log(`Shortcut handoff: triggering wjia-agent for ${normalizedPhone} with command #${shortcutName}`);
            
            // Get contact_id and lead_id from recent messages
            const { data: recentMsg } = await supabase
              .from("whatsapp_messages")
              .select("contact_id, lead_id")
              .eq("phone", phone)
              .eq("instance_name", instance_name)
              .not("contact_id", "is", null)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            
            const supabaseUrl = RESOLVED_SUPABASE_URL;
            const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
            
            // Fire wjia-agent to create session and start/continue collection
            fetch(`${cloudFunctionsUrl}/functions/v1/wjia-agent`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseAnonKey}`,
              },
              body: JSON.stringify({
                phone: normalizedPhone,
                instance_name,
                command: `#${shortcutName}`,
                contact_id: recentMsg?.contact_id || null,
                lead_id: recentMsg?.lead_id || lead_id || null,
                reset_memory: false,
              }),
            }).catch(err => console.error("WJIA handoff error:", err));

            // Sanitize the AI reply — remove link promises since wjia-agent will handle it
            reply = reply
              .replace(/[Dd]aqui a pouquinho.*?link.*?\./g, "")
              .replace(/[Jj]á te (mando|envio).*?link.*?\./g, "")
              .replace(/[Aa]ssim que.*?link.*?\./g, "")
              .replace(/[Vv]ou.*?mandar.*?link.*?\./g, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
            
            if (!reply) {
              reply = "Perfeito! Vou preparar o documento agora. Em instantes você recebe o link para assinar. 📄";
            }
          }
        }
        
        // Always sanitize any hallucinated URLs from shortcut agent replies
        reply = reply
          .replace(/https?:\/\/\S+/gi, "")
          .replace(/www\.\S+/gi, "")
          .replace(/[a-z0-9-]+\.(?:com|org|net|br|io|app|dev|link|me|co)[^\s]*/gi, "")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/\(\s*\)/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
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

      let sendSucceeded = false;
      if (instance) {
        const baseUrl = (instance as any).base_url || "https://abraci.uazapi.com";
        const token = (instance as any).instance_token;
        const delayBetween = ((agent as any).split_delay_seconds || 2) * 1000;

        // Check if we should reply with audio:
        // 1. Agent setting enabled + incoming was audio (mirror format)
        // 2. Agent setting enabled + client explicitly asked for audio in text
        const audioRequestPatterns = /\b(mand[ae]?\s+(um\s+)?[aá]udio|fal[ae]?\s+(pra\s+mim|comigo)|grav[ae]?\s+(um\s+)?[aá]udio|respond[ae]?\s+(em\s+|com\s+)?[aá]udio|quero\s+(um\s+)?[aá]udio|prefer[eo]\s+[aá]udio|me\s+mand[ae]?\s+(um\s+)?[aá]udio|pod[ee]?\s+mandar\s+(em\s+)?[aá]udio|envi[ae]?\s+(em\s+|um\s+)?[aá]udio)\b/i;
        const clientRequestedAudio = message_type === "text" && message_text && audioRequestPatterns.test(message_text);
        const shouldReplyAudio = (agent as any).reply_with_audio === true && (message_type === "audio" || clientRequestedAudio);
        console.log(`Audio reply check: reply_with_audio=${(agent as any).reply_with_audio}, message_type=${message_type}, clientRequestedAudio=${clientRequestedAudio}, shouldReplyAudio=${shouldReplyAudio}`);

        if (shouldReplyAudio) {
          // Generate TTS audio via ElevenLabs
          try {
            const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
            if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

            // Clean text for TTS
            const cleanText = reply
              .replace(/\*([^*]+)\*/g, "$1")
              .replace(/_([^_]+)_/g, "$1")
              .replace(/✅|📋|📅|🔔|👤|✏️|🤖|⚠️|📊|📌|📞|💬|👥|🔄|📈|🏆|☑️|🕐|📍|🎯|💡|🔴|🟠|🟡|🟢|🌟|⏳|🔍|📥|🔗|🚀|1️⃣|2️⃣|3️⃣/g, "")
              .replace(/https?:\/\/\S+/g, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim();

            const maxChars = (agent as any).max_tts_chars || 1000;
            
            // Split text into chunks at sentence boundaries
            const splitTextForTTS = (text: string, limit: number): string[] => {
              if (text.length <= limit) return [text];
              const chunks: string[] = [];
              let remaining = text;
              while (remaining.length > 0) {
                if (remaining.length <= limit) {
                  chunks.push(remaining);
                  break;
                }
                // Find last sentence boundary within limit
                let cutAt = -1;
                for (const sep of ['. ', '! ', '? ', '.\n', '!\n', '?\n']) {
                  const idx = remaining.lastIndexOf(sep, limit);
                  if (idx > cutAt) cutAt = idx + sep.length;
                }
                if (cutAt <= 0) {
                  // No sentence boundary, try comma or space
                  cutAt = remaining.lastIndexOf(', ', limit);
                  if (cutAt > 0) cutAt += 2;
                  else cutAt = remaining.lastIndexOf(' ', limit);
                  if (cutAt <= 0) cutAt = limit;
                }
                chunks.push(remaining.substring(0, cutAt).trim());
                remaining = remaining.substring(cutAt).trim();
              }
              return chunks;
            };

            const ttsChunks = splitTextForTTS(cleanText, maxChars);
            console.log(`TTS: splitting ${cleanText.length} chars into ${ttsChunks.length} chunk(s) (limit: ${maxChars})`);

            // Use agent's configured voice or fallback to Laura
            let voiceId = (agent as any).reply_voice_id || "FGY2WhTYpPnrIDTdsKH5";
            
            // Resolve "instance_owner" to the instance's configured voice
            if (voiceId === "instance_owner") {
              const { data: inst } = await supabase
                .from("whatsapp_instances")
                .select("voice_id")
                .eq("instance_name", instanceName)
                .maybeSingle();
              voiceId = inst?.voice_id || "FGY2WhTYpPnrIDTdsKH5";
              console.log(`Resolved instance_owner voice to: ${voiceId}`);
            }
            // If voice ID looks like a custom_voices UUID, resolve the ElevenLabs voice ID
            else if (voiceId.length === 36 && voiceId.includes("-")) {
              const { data: customVoice } = await supabase
                .from("custom_voices")
                .select("elevenlabs_voice_id")
                .eq("id", voiceId)
                .eq("status", "ready")
                .maybeSingle();
              voiceId = customVoice?.elevenlabs_voice_id || "FGY2WhTYpPnrIDTdsKH5";
            }

            for (let ci = 0; ci < ttsChunks.length; ci++) {
              const chunk = ttsChunks[ci];
              const ttsResp = await fetch(
                `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
                {
                  method: "POST",
                  headers: {
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    text: chunk,
                    model_id: "eleven_multilingual_v2",
                    voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0.3, speed: 1.1 },
                    ...(ci > 0 ? { previous_text: ttsChunks[ci - 1].slice(-200) } : {}),
                    ...(ci < ttsChunks.length - 1 ? { next_text: ttsChunks[ci + 1].slice(0, 200) } : {}),
                  }),
                }
              );

              if (!ttsResp.ok) {
                console.error(`ElevenLabs TTS error chunk ${ci + 1}:`, ttsResp.status, await ttsResp.text());
                throw new Error("TTS failed");
              }

              const audioBuffer = await ttsResp.arrayBuffer();
              const fileName = `tts-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
              const filePath = `tts/${fileName}`;

              const { error: uploadErr } = await supabase.storage
                .from("whatsapp-media")
                .upload(filePath, new Uint8Array(audioBuffer), {
                  contentType: "audio/mpeg",
                  upsert: false,
                });
              if (uploadErr) throw uploadErr;

              const { data: urlData } = supabase.storage.from("whatsapp-media").getPublicUrl(filePath);
              const audioUrl = urlData?.publicUrl;

              if (audioUrl) {
                const sendRes = await fetch(`${baseUrl}/send/media`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "token": token },
                  body: JSON.stringify({ number: phone, file: audioUrl, type: "audio" }),
                });
                if (!sendRes.ok) {
                  console.error("UazAPI audio send error:", sendRes.status, await sendRes.text());
                } else {
                  console.log(`UazAPI audio reply sent chunk ${ci + 1}/${ttsChunks.length} to ${phone}`);
                  sendSucceeded = true;
                }
              }

              // Delay between audio parts
              if (ci < ttsChunks.length - 1) {
                await new Promise(r => setTimeout(r, delayBetween));
              }
            }
          } catch (ttsErr) {
            console.error("TTS audio reply failed, falling back to text:", ttsErr);
            // Fallback: send as text
            for (let i = 0; i < messageParts.length; i++) {
              const fallbackRes = await fetch(`${baseUrl}/send/text`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "token": token },
                body: JSON.stringify({ number: phone, text: messageParts[i] }),
              });
              if (fallbackRes.ok) sendSucceeded = true;
              if (i < messageParts.length - 1) await new Promise(r => setTimeout(r, delayBetween));
            }
          }
        } else {
          // Standard text reply
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
              sendSucceeded = true;
            }
            if (i < messageParts.length - 1) {
              await new Promise(r => setTimeout(r, delayBetween));
            }
          }
        }
      } else {
        console.error("No instance found for", instance_name);
        return new Response(JSON.stringify({ error: "No instance found", success: false }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!sendSucceeded) {
        return new Response(JSON.stringify({ error: "Failed to send WhatsApp message", success: false }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Save outbound message (full reply)
      // Resolve lead_id and contact_id for linking
      let resolvedLeadId = lead_id || null;
      let resolvedContactId: string | null = null;
      if (!resolvedLeadId) {
        // Try to find lead via contact phone
        const normalizedP = phone.replace(/\D/g, '');
        const suffix8 = normalizedP.slice(-8);
        const { data: contactForLink } = await supabase
          .from("contacts")
          .select("id, lead_id")
          .ilike("phone", `%${suffix8}`)
          .limit(1)
          .maybeSingle();
        if (contactForLink) {
          resolvedContactId = contactForLink.id;
          resolvedLeadId = contactForLink.lead_id;
        }
        if (!resolvedLeadId) {
          const { data: leadForLink } = await supabase
            .from("leads")
            .select("id")
            .ilike("lead_name", `%${phone}%`)
            .limit(1)
            .maybeSingle();
          if (leadForLink) resolvedLeadId = leadForLink.id;
        }
      } else if (!resolvedContactId) {
        const normalizedP2 = phone.replace(/\D/g, '');
        const suffix8b = normalizedP2.slice(-8);
        const { data: contactForLink2 } = await supabase
          .from("contacts")
          .select("id")
          .ilike("phone", `%${suffix8b}`)
          .limit(1)
          .maybeSingle();
        if (contactForLink2) resolvedContactId = contactForLink2.id;
      }

      const outboundMsg = {
        phone, instance_name, direction: "outbound",
        message_text: reply, metadata: { ai_agent: (agent as any).name, ai_agent_id: (agent as any).id, split_count: messageParts.length },
        campaign_id: campaign_id || null,
        campaign_name: null,
        action_source: 'agent',
        action_source_detail: `Agente: ${(agent as any).name}`,
        lead_id: resolvedLeadId,
        contact_id: resolvedContactId,
      };
      await supabase.from("whatsapp_messages").insert(outboundMsg);

      // ========== AUTO-ADD CONTACT TO PHONE AGENDA via UazAPI ==========
      try {
        if (instance && (instance as any).instance_token) {
          // Build rich contact name with city/state/lead info from DB
          let contactDisplayName = contact_name || phone;
          const normalizedP = phone.replace(/\D/g, '');
          const suffix8 = normalizedP.slice(-8);
          
          // Fetch contact details from DB
          const { data: contactInfo } = await supabase
            .from("contacts")
            .select("full_name, city, state, profession, classifications, lead_id")
            .ilike("phone", `%${suffix8}`)
            .limit(1)
            .maybeSingle();

          if (contactInfo) {
            const nameParts: string[] = [contactInfo.full_name || contact_name || phone];
            
            // Add city/state
            const locationParts: string[] = [];
            if (contactInfo.city) locationParts.push(contactInfo.city);
            if (contactInfo.state) locationParts.push(contactInfo.state);
            if (locationParts.length > 0) nameParts.push(locationParts.join("/"));
            
            // Add profession if available
            if (contactInfo.profession) nameParts.push(contactInfo.profession);

            // Add lead board/product info if available
            const leadIdForInfo = resolvedLeadId || contactInfo.lead_id;
            if (leadIdForInfo) {
              const { data: leadInfo } = await supabase
                .from("leads")
                .select("lead_name, kanban_boards(name)")
                .eq("id", leadIdForInfo)
                .maybeSingle();
              if (leadInfo && (leadInfo as any).kanban_boards?.name) {
                nameParts.push((leadInfo as any).kanban_boards.name);
              }
            }

            contactDisplayName = nameParts.join(" | ");
          }

          const addBaseUrl = (instance as any).base_url || "https://abraci.uazapi.com";
          const addRes = await fetch(`${addBaseUrl}/contact/add`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: (instance as any).instance_token },
            body: JSON.stringify({ phone: phone, name: contactDisplayName }),
          });
          console.log(`UazAPI contact/add ${phone} "${contactDisplayName}": status=${addRes.status}`);
        }
      } catch (addErr) {
        console.error("Auto-add contact to agenda error:", addErr);
      }

      // ========== CHECK MAX UNANSWERED MESSAGES → AUTO INVIÁVEL ==========
      try {
        // Resolve campaign_id from lead if not provided
        let resolvedCampaignId = campaign_id;
        if (!resolvedCampaignId && lead_id) {
          const { data: ld } = await supabase.from("leads").select("campaign_id").eq("id", lead_id).maybeSingle();
          resolvedCampaignId = ld?.campaign_id;
        }
        if (resolvedCampaignId) {
          const { data: campLink } = await supabase
            .from("whatsapp_agent_campaign_links")
            .select("max_unanswered_messages, inviavel_agent_id")
            .eq("campaign_id", resolvedCampaignId)
            .eq("is_active", true)
            .maybeSingle();

          const maxUnanswered = (campLink as any)?.max_unanswered_messages || 0;
          if (maxUnanswered > 0 && lead_id) {
            // Count consecutive outbound messages (no inbound in between)
            const { data: recentMsgs } = await supabase
              .from("whatsapp_messages")
              .select("direction")
              .eq("phone", phone)
              .eq("instance_name", instance_name)
              .order("created_at", { ascending: false })
              .limit(maxUnanswered + 5);

            let consecutiveOutbound = 0;
            for (const m of (recentMsgs || [])) {
              if ((m as any).direction === "outbound") consecutiveOutbound++;
              else break;
            }

            console.log(`Unanswered check: ${consecutiveOutbound}/${maxUnanswered} consecutive outbound for ${phone}`);
            if (consecutiveOutbound >= maxUnanswered) {
              console.log(`Max unanswered reached (${consecutiveOutbound}/${maxUnanswered}). Marking lead ${lead_id} as inviavel (keeping followup active).`);
              await supabase.from("leads").update({ lead_status: "inviavel" }).eq("id", lead_id);
              
              // Do NOT deactivate agent or cancel followups — let followup continue until blocked

              // Send CAPI signal to Meta
              try {
                fetch(`${cloudFunctionsUrl}/functions/v1/meta-conversions-api`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cloudAnonKey}` },
                  body: JSON.stringify({ lead_id, event_name: 'Lead', custom_data: { lead_event_source: 'lead_unqualified' } }),
                }).catch(() => {});
              } catch {}
            }
          }
        }
      } catch (unansweredErr) {
        console.error("Unanswered check error:", unansweredErr);
      }

      // Release dedup lock
      await supabase.from("agent_reply_locks").delete().eq("phone", phone).eq("instance_name", instance_name);

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
