// @ts-ignore
import { createClient } from 'npm:@supabase/supabase-js@2';
import { geminiChat } from './_shared/gemini.ts';
import { urlToBase64DataUri } from './_shared/doc-utils.ts';
const RESOLVED_SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const cloudFunctionsUrl = Deno.env.get('CLOUD_FUNCTIONS_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co';
const cloudAnonKey = Deno.env.get('CLOUD_ANON_KEY') || '';
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    const { phone, instance_name, message_text, message_type, lead_id, campaign_id, is_group, contact_name, is_followup } = await req.json();
    console.log(`Agent reply request: phone=${phone}, instance=${instance_name}, is_followup=${!!is_followup}, msg_type=${message_type || 'text'}`);
    if (!phone || !instance_name) {
      return new Response(JSON.stringify({
        error: "Missing fields"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);
    // DEDUP LOCK
    if (!is_followup) {
      const { error: lockErr } = await supabase.from("agent_reply_locks").insert({
        phone,
        instance_name,
        locked_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 120000).toISOString()
      });
      if (lockErr) {
        console.log(`Reply lock exists for ${phone}@${instance_name}, skipping duplicate`);
        return new Response(JSON.stringify({
          skipped: true,
          reason: "Duplicate reply prevented by lock"
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    let assignment = null;
    const { data: existingAssignment } = await supabase.from("whatsapp_conversation_agents").select("agent_id, is_active, updated_at").eq("phone", phone).eq("instance_name", instance_name).eq("is_active", true).maybeSingle();
    assignment = existingAssignment;
    const isGroup = phone.startsWith('120363') || phone.includes('@g.us');
    if (!assignment && campaign_id) {
      const { data: campaignLink } = await supabase.from("whatsapp_agent_campaign_links").select("agent_id, closed_agent_id, refused_agent_id, inviavel_agent_id").eq("campaign_id", campaign_id).eq("is_active", true).maybeSingle();
      if (campaignLink) {
        let resolvedAgentId = campaignLink.agent_id;
        if (lead_id) {
          const { data: leadCheck } = await supabase.from("leads").select("lead_status").eq("id", lead_id).maybeSingle();
          const statusAgentMap = {
            closed: campaignLink.closed_agent_id,
            refused: campaignLink.refused_agent_id,
            inviavel: campaignLink.inviavel_agent_id
          };
          const statusAgent = leadCheck?.lead_status ? statusAgentMap[leadCheck.lead_status] : null;
          if (statusAgent) resolvedAgentId = statusAgent;
        }
        await supabase.from("whatsapp_conversation_agents").upsert({
          phone,
          instance_name,
          agent_id: resolvedAgentId,
          is_active: true,
          activated_by: isGroup ? "instance_default" : "campaign_auto"
        }, {
          onConflict: "phone,instance_name"
        });
        assignment = {
          agent_id: resolvedAgentId,
          is_active: true
        };
      }
    }
    if (!assignment && lead_id) {
      const { data: lead } = await supabase.from("leads").select("campaign_id").eq("id", lead_id).maybeSingle();
      if (lead?.campaign_id) {
        const { data: campaignLink } = await supabase.from("whatsapp_agent_campaign_links").select("agent_id, closed_agent_id, refused_agent_id, inviavel_agent_id").eq("campaign_id", lead.campaign_id).eq("is_active", true).maybeSingle();
        if (campaignLink) {
          let resolvedAgentId = campaignLink.agent_id;
          const { data: leadStatus } = await supabase.from("leads").select("lead_status").eq("id", lead_id).maybeSingle();
          const statusAgentMap = {
            closed: campaignLink.closed_agent_id,
            refused: campaignLink.refused_agent_id,
            inviavel: campaignLink.inviavel_agent_id
          };
          const statusAgent = leadStatus?.lead_status ? statusAgentMap[leadStatus.lead_status] : null;
          if (statusAgent) resolvedAgentId = statusAgent;
          await supabase.from("whatsapp_conversation_agents").upsert({
            phone,
            instance_name,
            agent_id: resolvedAgentId,
            is_active: true,
            activated_by: isGroup ? "instance_default" : "campaign_auto"
          }, {
            onConflict: "phone,instance_name"
          });
          assignment = {
            agent_id: resolvedAgentId,
            is_active: true
          };
        }
      }
    }
    if (!assignment && lead_id) {
      const { data: lead } = await supabase.from("leads").select("board_id, status").eq("id", lead_id).maybeSingle();
      if (lead?.board_id && lead?.status) {
        const { data: stageAssignment } = await supabase.from("agent_stage_assignments").select("agent_id").eq("board_id", lead.board_id).eq("stage_id", lead.status).maybeSingle();
        if (stageAssignment) {
          await supabase.from("whatsapp_conversation_agents").upsert({
            phone,
            instance_name,
            agent_id: stageAssignment.agent_id,
            is_active: true,
            activated_by: "stage_auto"
          }, {
            onConflict: "phone,instance_name"
          });
          assignment = {
            agent_id: stageAssignment.agent_id,
            is_active: true
          };
        }
      }
    }
    if (!assignment) {
      const normalizedPhoneForStatus = phone.replace(/\D/g, '');
      const phoneSuffixForStatus = normalizedPhoneForStatus.slice(-8);
      let leadStatusToCheck = null;
      let foundLeadId = lead_id || null;
      let foundLeadBoardId = null;
      if (foundLeadId) {
        const { data: leadData } = await supabase.from("leads").select("lead_status, board_id").eq("id", foundLeadId).maybeSingle();
        leadStatusToCheck = leadData?.lead_status || 'active';
        foundLeadBoardId = leadData?.board_id || null;
      }
      if (leadStatusToCheck) {
        const { data: matchingAgents } = await supabase.from("wjia_command_shortcuts").select("id, lead_status_filter, lead_status_board_ids").eq("is_active", true).not("lead_status_filter", "is", null);
        if (matchingAgents) {
          const matched = matchingAgents.find((a)=>{
            if (!Array.isArray(a.lead_status_filter) || !a.lead_status_filter.includes(leadStatusToCheck)) return false;
            if (Array.isArray(a.lead_status_board_ids) && a.lead_status_board_ids.length > 0) return foundLeadBoardId && a.lead_status_board_ids.includes(foundLeadBoardId);
            return true;
          });
          if (matched) {
            await supabase.from("whatsapp_conversation_agents").upsert({
              phone,
              instance_name,
              agent_id: matched.id,
              is_active: true,
              activated_by: "lead_status_auto"
            }, {
              onConflict: "phone,instance_name"
            });
            assignment = {
              agent_id: matched.id,
              is_active: true
            };
          }
        }
      }
    }
    if (!assignment) {
      const { data: instanceData } = await supabase.from("whatsapp_instances").select("default_agent_id").eq("instance_name", instance_name).maybeSingle();
      if (instanceData?.default_agent_id) {
        await supabase.from("whatsapp_conversation_agents").upsert({
          phone,
          instance_name,
          agent_id: instanceData.default_agent_id,
          is_active: true,
          activated_by: "instance_default"
        }, {
          onConflict: "phone,instance_name"
        });
        assignment = {
          agent_id: instanceData.default_agent_id,
          is_active: true
        };
      }
    }
    let instanceOwnerName = null;
    {
      const { data: instInfo } = await supabase.from("whatsapp_instances").select("owner_name").eq("instance_name", instance_name).maybeSingle();
      instanceOwnerName = instInfo?.owner_name || null;
    }
    if (!assignment) return new Response(JSON.stringify({
      skipped: true,
      reason: "No active agent"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
    const { data: pauseCheck } = await supabase.from("whatsapp_conversation_agents").select("human_paused_until").eq("phone", phone).eq("instance_name", instance_name).maybeSingle();
    if (pauseCheck?.human_paused_until && !is_followup) {
      const pausedUntil = new Date(pauseCheck.human_paused_until);
      if (pausedUntil > new Date()) return new Response(JSON.stringify({
        skipped: true,
        reason: "Human pause active"
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      await supabase.from("whatsapp_conversation_agents").update({
        human_paused_until: null
      }).eq("phone", phone).eq("instance_name", instance_name);
    }
    let agent = null;
    const { data: aiAgent } = await supabase.from("whatsapp_ai_agents").select("*").eq("id", assignment.agent_id).eq("is_active", true).maybeSingle();
    if (aiAgent) {
      agent = aiAgent;
      const { data: matchingShortcut } = await supabase.from("wjia_command_shortcuts").select("template_token, template_name, shortcut_name, request_documents, document_types, custom_document_names, document_type_modes, followup_steps, notify_on_signature, send_signed_pdf, history_limit").eq("id", assignment.agent_id).eq("is_active", true).maybeSingle();
      if (matchingShortcut && matchingShortcut.template_token) {
        agent.is_shortcut = true;
        agent.template_token = matchingShortcut.template_token;
        agent.template_name = matchingShortcut.template_name;
        agent.shortcut_name = matchingShortcut.shortcut_name;
        agent.history_limit = matchingShortcut.history_limit;
      }
    } else {
      const { data: shortcut } = await supabase.from("wjia_command_shortcuts").select("*").eq("id", assignment.agent_id).eq("is_active", true).maybeSingle();
      if (shortcut) agent = {
        id: shortcut.id,
        name: '#' + shortcut.shortcut_name,
        base_prompt: shortcut.prompt_instructions,
        model: shortcut.model || "google/gemini-2.5-flash",
        temperature: shortcut.temperature ?? 70,
        max_tokens: shortcut.max_tokens ?? 1024,
        max_tts_chars: shortcut.max_tts_chars ?? 1000,
        response_delay_seconds: shortcut.response_delay_seconds || 0,
        split_messages: shortcut.split_messages || false,
        split_delay_seconds: shortcut.split_delay_seconds || 2,
        sign_messages: false,
        provider: "lovable",
        respond_in_groups: shortcut.respond_in_groups || false,
        reply_with_audio: shortcut.reply_with_audio || false,
        reply_voice_id: shortcut.reply_voice_id || null,
        human_reply_pause_minutes: shortcut.human_reply_pause_minutes || 10,
        is_shortcut: true,
        template_token: shortcut.template_token || null,
        send_window_start_hour: shortcut.send_window_start_hour ?? 8,
        send_window_end_hour: shortcut.send_window_end_hour ?? 20,
        history_limit: shortcut.history_limit || null,
        handoff_config: shortcut.handoff_config || null,
        describe_documents_in_groups: shortcut.describe_documents_in_groups !== false
      };
    }
    if (!agent) return new Response(JSON.stringify({
      skipped: true,
      reason: "Agent inactive"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
    if (is_group && !agent.respond_in_groups) return new Response(JSON.stringify({
      skipped: true,
      reason: "Agent not allowed in groups"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
    if (is_followup) {
      const nowBrasilia = new Date(new Date().toLocaleString("en-US", {
        timeZone: "America/Sao_Paulo"
      }));
      const currentHour = nowBrasilia.getHours();
      const windowStart = agent.send_window_start_hour ?? 8;
      const windowEnd = agent.send_window_end_hour ?? 20;
      if (currentHour < windowStart || currentHour >= windowEnd) return new Response(JSON.stringify({
        skipped: true,
        reason: `Follow-up outside window`
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const batchDelaySeconds = agent.response_delay_seconds || 0;
    if (batchDelaySeconds > 0 && !is_followup) {
      console.log(`Batching delay: waiting ${batchDelaySeconds}s`);
      await new Promise((resolve)=>setTimeout(resolve, batchDelaySeconds * 1000));
      const cutoffTime = new Date(Date.now() - batchDelaySeconds * 1000).toISOString();
      const { data: newerMessages } = await supabase.from("whatsapp_messages").select("id, created_at").eq("phone", phone).eq("instance_name", instance_name).eq("direction", "inbound").gt("created_at", cutoffTime).order("created_at", {
        ascending: false
      }).limit(1);
      if (newerMessages && newerMessages.length > 0) {
        const newestMsgTime = new Date(newerMessages[0].created_at).getTime();
        if (Date.now() - newestMsgTime < batchDelaySeconds * 800) return new Response(JSON.stringify({
          skipped: true,
          reason: "Batching: newer message will handle"
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    // Content moderation
    if (message_text && !is_followup) {
      try {
        const moderationResult = await geminiChat({
          model: "google/gemini-2.5-flash-lite",
          temperature: 0,
          max_tokens: 20,
          messages: [
            {
              role: "system",
              content: "Você é um classificador de conteúdo. Responda APENAS 'BLOCK' se contiver conteúdo sexual, assédio, xingamentos graves, ameaças. Responda 'OK' para qualquer outro conteúdo."
            },
            {
              role: "user",
              content: message_text
            }
          ]
        });
        const verdict = moderationResult?.choices?.[0]?.message?.content?.trim()?.toUpperCase() || "OK";
        if (verdict.includes("BLOCK")) {
          await supabase.from("whatsapp_conversation_agents").update({
            is_active: false,
            is_blocked: true
          }).eq("phone", phone).eq("instance_name", instance_name);
          try {
            const { data: inst } = await supabase.from("whatsapp_instances").select("base_url, instance_token").eq("instance_name", instance_name).maybeSingle();
            if (inst?.instance_token) {
              const blockBaseUrl = inst.base_url || "https://abraci.uazapi.com";
              await fetch(`${blockBaseUrl}/chat/block`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  token: inst.instance_token
                },
                body: JSON.stringify({
                  number: phone,
                  block: true
                })
              });
            }
          } catch (_) {}
          if (!is_followup) await supabase.from("agent_reply_locks").delete().eq("phone", phone).eq("instance_name", instance_name);
          return new Response(JSON.stringify({
            blocked: true,
            reason: "Inappropriate content detected"
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
      } catch (_) {}
    }
    if (agent.provider === "lovable") {
      const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
      if (!GOOGLE_AI_API_KEY) return new Response(JSON.stringify({
        error: "GOOGLE_AI_API_KEY not configured"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      const { data: knowledgeDocs } = await supabase.from("agent_knowledge_documents").select("file_name, extracted_text").eq("agent_id", agent.id).eq("status", "ready");
      let knowledgeContext = "";
      if (knowledgeDocs && knowledgeDocs.length > 0) {
        const docTexts = knowledgeDocs.filter((d)=>d.extracted_text?.trim()).map((d)=>`--- Documento: ${d.file_name} ---\n${d.extracted_text}`).join("\n\n");
        if (docTexts) knowledgeContext = docTexts.length > 30000 ? docTexts.substring(0, 30000) + "\n[... truncada]" : docTexts;
      }
      const humanizationPrefix = `REGRA ABSOLUTA DE TOM E ESTILO:\nVocê é um ser humano real conversando pelo WhatsApp. NUNCA revele ou insinue que é uma IA/robô/assistente virtual.\n- Escreva como uma pessoa real digitaria no WhatsApp: frases curtas, naturais, com linguagem do dia a dia\n- PROIBIDO usar listas com bullets, numeração ou formatação estruturada\n- PROIBIDO usar emojis em excesso \u2014 use no máximo 1-2 por mensagem\n- Mantenha mensagens curtas, como alguém digitando rápido no celular\n- Use "você", "tá", "tô", "pra" \u2014 linguagem informal brasileira natural\n- PROIBIDO ABSOLUTO: NUNCA mencione ligações telefônicas ou ações internas do sistema\n\nREGRAS DE ENDEREÇO E CEP:\n- Se o cliente informar o CEP, NÃO pergunte rua, bairro, cidade ou estado\n- Se precisar de endereço, peça o CEP primeiro\n\nREGRAS DE EXTRAÇÃO DE DOCUMENTOS:\n- Se o cliente enviar uma FOTO ou PDF de documento, você DEVE LER e EXTRAIR automaticamente todos os dados visíveis\n- NUNCA peça ao cliente dados que estão visíveis em um documento que ele já enviou\n\n`;
      const effectivePrompt = is_followup && agent.followup_prompt?.trim() ? agent.followup_prompt : agent.base_prompt || '';
      // === DOM — Assessor Jurídico Virtual =====================================
      // Só para agentes com contexto_processual ligado. Busca o andamento REAL do
      // processo daquele grupo + as respostas que a equipe já deu para perguntas
      // parecidas. Sem isso o agente tenta deduzir o andamento da conversa, que é
      // o motivo de ele estar desligado até hoje.
      let domCtx = null;
      if (agent.contexto_processual && is_group) {
        try {
          const domResp = await fetch(`${RESOLVED_SUPABASE_URL}/functions/v1/dom-contexto`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${RESOLVED_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ group_jid: phone, pergunta: message_text || '' })
          });
          domCtx = await domResp.json();
        } catch (e) {
          console.error('[dom] contexto falhou', e?.message || e);
        }
        // Falha ao buscar contexto = silêncio. Responder sem o andamento é pior
        // que não responder: é exatamente aí que ele inventa.
        if (!domCtx || domCtx.error) return new Response(JSON.stringify({
          skipped: true,
          reason: "Dom: contexto indisponível"
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (domCtx.atende === false) return new Response(JSON.stringify({
          skipped: true,
          reason: domCtx.motivo || "Dom: grupo fora do piloto"
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // O Dom assina como assistente virtual, então a regra "nunca revele que é
      // uma IA" do prefixo padrão não pode valer para ele — instrução contraditória
      // no mesmo prompt faz o modelo escolher sozinho qual obedecer.
      const prefixoDoAgente = domCtx
        ? humanizationPrefix.replace(
            'Você é um ser humano real conversando pelo WhatsApp. NUNCA revele ou insinue que é uma IA/robô/assistente virtual.',
            'Escreva como uma pessoa real digitaria no WhatsApp: curto, natural, informal. Você NÃO finge ser humano — você é o Dom, assessor virtual, e assina como tal.')
        : humanizationPrefix;
      let systemPrompt = prefixoDoAgente + effectivePrompt + (domCtx?.blocos ? '\n\n' + domCtx.blocos : '');
      // === FIM DOM ============================================================
      // CONTEXTO TEMPORAL — injetado dinamicamente a cada resposta (fuso Brasília)
      {
        const nowBR = new Date().toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          dateStyle: "full",
          timeStyle: "short"
        });
        const dateBR = new Date().toLocaleDateString("pt-BR", {
          timeZone: "America/Sao_Paulo"
        });
        const isoBR = new Date().toLocaleString("sv-SE", {
          timeZone: "America/Sao_Paulo"
        }).replace(" ", "T");
        systemPrompt += `\n\n=== CONTEXTO TEMPORAL (verdade absoluta) ===\nData/hora agora (Brasília): ${nowBR}\nData de hoje: ${dateBR} (ISO: ${isoBR})\nSempre que o cliente perguntar "que dia é hoje", "que horas são", "hoje é dia X?", ou se referir a datas relativas (hoje, amanhã, ontem, semana que vem), use SOMENTE este bloco como referência. NUNCA invente datas nem diga que não sabe o dia.\n=== FIM CONTEXTO TEMPORAL ===`;
      }
      if (is_followup) systemPrompt += `\n\nCONTEXTO DE FOLLOW-UP:\n- Esta é uma mensagem de FOLLOW-UP automático. O lead não respondeu recentemente.\n- NÃO repita a última mensagem enviada. Gere uma abordagem DIFERENTE e criativa.`;
      if (agent.is_shortcut && agent.template_token) {
        const zapsignToken = Deno.env.get("ZAPSIGN_API_TOKEN");
        if (zapsignToken) {
          try {
            const tplRes = await fetch(`https://api.zapsign.com.br/api/v1/templates/${agent.template_token}/`, {
              headers: {
                Authorization: `Bearer ${zapsignToken}`,
                "Content-Type": "application/json"
              }
            });
            if (tplRes.ok) {
              const tplDetail = await tplRes.json();
              const tplFields = (tplDetail.inputs || []).map((inp)=>({
                  variable: inp.variable || "",
                  label: inp.label || "",
                  required: inp.required || false
                }));
              if (tplFields.length > 0) {
                const fieldsList = tplFields.map((f)=>`- ${f.variable} (${f.label || 'sem label'})${f.required ? ' [OBRIGATÓRIO]' : ' [opcional]'}`).join("\n");
                systemPrompt += `\n\n=== CAMPOS DO DOCUMENTO ZAPSIGN ===\nEsses são os ÚNCOS campos que você precisa coletar para o documento "${tplDetail.name || 'Procuração'}":\n${fieldsList}\n\nREGRAS:\n1. Se o cliente enviou imagens/PDFs, LEIA E EXTRAIA todos os dados visíveis.\n2. NÃO peça dados que já foram fornecidos ou que estão nos documentos.\n3. Quando tiver todos os dados obrigatórios, confirme e diga que vai preparar o documento.\n4. NUNCA invente links de assinatura.\n=== FIM DOS CAMPOS ===`;
              }
            }
          } catch (_) {}
        }
      }
      if (instanceOwnerName) systemPrompt += `\n\nSUA IDENTIDADE:\nVocê se chama ${instanceOwnerName}. Quando se apresentar, use esse nome.`;
      if (contact_name) systemPrompt += `\n\nIDENTIFICAÇÃO DO CONTATO:\nVocê está conversando com: ${contact_name} (telefone: ${phone}).`;
      if (knowledgeContext) systemPrompt += "\n\n=== BASE DE CONHECIMENTO ===\n" + knowledgeContext + "\n\n=== FIM DA BASE DE CONHECIMENTO ===";
      // === HANDOFF HUMANO ===
      // Injeta instruções para o agente sinalizar quando precisa de ação humana
      // usando marcadores invisíveis [HANDOFF:tipo: motivo]. Os marcadores são
      // removidos da mensagem antes do envio (parser abaixo). A criação da
      // atividade + DM no chat interno é tratada no passo D (handler dedicado).
      {
        const hc = agent.handoff_config || {};
        const handoffEnabled = hc.enabled !== false; // default ON
        if (handoffEnabled) {
          const mode = hc.mode === 'transparent' ? 'transparent' : 'disguised';
          const eodHour = Number(hc.end_of_day_hour ?? 18);
          const nowBrasilia = new Date(new Date().toLocaleString('en-US', {
            timeZone: 'America/Sao_Paulo'
          }));
          const curH = nowBrasilia.getHours();
          const deadlineHint = curH < eodHour ? `hoje até ${String(eodHour).padStart(2, '0')}:00` : `amanhã pela manhã`;
          const phrases = hc.phrases || {};
          const modeBlock = mode === 'transparent' ? `MODO TRANSPARENTE: você PODE dizer ao cliente que vai "confirmar com o time", "alinhar com a equipe" e dar prazo (${deadlineHint}).` : `MODO DISFARÇADO (você é a própria pessoa que atende): NUNCA mencione "time", "equipe", "vou verificar com alguém", "outro atendente". Fale como se a ação fosse SUA ("vou olhar isso", "te ligo daqui a pouco", "vou organizar"). Pode dizer prazo como se fosse pessoal ("te falo ${deadlineHint}").`;
          systemPrompt += `\n\n=== HANDOFF HUMANO ===\n${modeBlock}\n\nQuando precisar de ação humana, escreva no FINAL da sua resposta UM dos marcadores abaixo (eles NÃO aparecem para o cliente — são removidos antes do envio). Você AINDA DEVE escrever uma resposta natural conforme o modo acima.\n\n[HANDOFF:retorno: <motivo curto>]      — precisa que humano confirme algo antes de responder\n[HANDOFF:ligacao: <motivo curto>]      — humano precisa LIGAR para o cliente\n[HANDOFF:reuniao: <motivo curto>]      — precisa AGENDAR reunião\n[HANDOFF:fechamento: <motivo curto>]   — caso pronto para fechar, só falta humano confirmar\n\nSugestões de frases visíveis (adapte ao contexto, não copie literal):\n- retorno: ${phrases.retorno || (mode === 'transparent' ? `"Deixa eu confirmar com o time e te retorno ${deadlineHint}."` : `"Deixa eu olhar uma coisa aqui rapidinho e já te chamo, tá?"`)}\n- ligacao: ${phrases.ligacao || (mode === 'transparent' ? `"Vou pedir pra alguém do time te ligar pra explicar melhor."` : `"Te ligo daqui a pouco pra explicar melhor, ok?"`)}\n- reuniao: ${phrases.reuniao || (mode === 'transparent' ? `"Vou alinhar uma reunião com o time."` : `"Acho melhor a gente conversar com calma — qual horário você prefere?"`)}\n- fechamento: ${phrases.fechamento || (mode === 'transparent' ? `"Vou organizar isso com o time e já te confirmo."` : `"Vou organizar isso e já te confirmo."`)}\n=== FIM HANDOFF HUMANO ===`;
        }
      }
      // === ANTI-NARRAÇÃO DE DOCUMENTOS EM GRUPOS ===
      if (is_group && agent.describe_documents_in_groups === false) {
        systemPrompt += `\n\n=== DOCUMENTOS EM GRUPO ===\nVocê está em um GRUPO. Quando receber qualquer documento, imagem ou PDF aqui:\n- NÃO leia/descreva o conteúdo extraído em voz alta.\n- NÃO liste dados (nomes, datas, valores, cláusulas, honorários, endereços) só porque viu o documento.\n- Apenas reconheça brevemente o recebimento de forma natural (ex: "Recebido!", "Beleza, vou olhar aqui" ou silêncio se nada foi perguntado).\n- Só responda sobre o conteúdo se alguém PERGUNTAR explicitamente algo específico.\n- Nunca diga frases como "É isso que consegui extrair do documento" ou similares.\n=== FIM DOCUMENTOS EM GRUPO ===`;
      }
      const { data: recentMessages } = await supabase.from("whatsapp_messages").select("direction, message_text, message_type, media_url, created_at").eq("phone", phone).eq("instance_name", instance_name).order("created_at", {
        ascending: false
      }).limit(agent?.history_limit || (is_followup ? 40 : 20));
      const contextMessages = [];
      for (const m of (recentMessages || []).reverse()){
        const role = m.direction === "inbound" ? "user" : "assistant";
        const msgType = m.message_type || "text";
        const mediaUrl = m.media_url;
        const msgText = m.message_text;
        if (msgType === "audio") {
          contextMessages.push({
            role,
            content: msgText?.trim() && msgText !== "[áudio inaudível]" ? `[Mensagem de voz]: ${msgText}` : "[Mensagem de voz não transcrita]"
          });
        } else if (msgType === "image" && mediaUrl) {
          contextMessages.push({
            role,
            content: [
              {
                type: "text",
                text: msgText ? `${msgText} [com imagem anexada]` : "Olhe esta imagem:"
              },
              {
                type: "image_url",
                image_url: {
                  url: mediaUrl
                }
              }
            ]
          });
        } else if (msgType === "document" && mediaUrl) {
          const fileName = mediaUrl.split("/").pop() || "documento";
          const isPdf = mediaUrl.toLowerCase().includes(".pdf") || fileName.toLowerCase().endsWith(".pdf");
          if (isPdf) {
            try {
              const docBase64 = await urlToBase64DataUri(mediaUrl);
              contextMessages.push({
                role,
                content: [
                  {
                    type: "text",
                    text: msgText || `Documento: ${decodeURIComponent(fileName)}. Extraia todos os dados visíveis.`
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: docBase64
                    }
                  }
                ]
              });
            } catch (_) {
              contextMessages.push({
                role,
                content: msgText || `[Documento: ${decodeURIComponent(fileName)}]`
              });
            }
          } else {
            contextMessages.push({
              role,
              content: msgText || `[Documento: ${decodeURIComponent(fileName)}]`
            });
          }
        } else if (msgText?.trim()) {
          contextMessages.push({
            role,
            content: msgText
          });
        }
      }
      const aiResult = await geminiChat({
        model: agent.model || "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          ...contextMessages
        ],
        // Teto sensato (~2k tokens) pra evitar gerar 14k chars em caso de loop degenerativo.
        max_tokens: Math.min(Math.max(agent.max_tokens || 1024, 256), 4096),
        temperature: agent.temperature / 100
      });
      let reply = aiResult.choices?.[0]?.message?.content || "";
      // Anti-loop: detecta repetição degenerativa (mesma frase curta repetida >=5x seguidas)
      // e trunca antes da terceira repetição. Loga incidente.
      reply = function dedupLoop(text) {
        if (!text || text.length < 200) return text;
        // procura n-gram de 2 a 8 palavras que se repete consecutivamente
        for(let n = 2; n <= 8; n++){
          const re = new RegExp(`((?:\\S+\\s+){${n - 1}}\\S+[.!?\\s]+)\\1{4,}`, "i");
          const m = text.match(re);
          if (m) {
            const phrase = m[1];
            const before = text.slice(0, m.index);
            const truncated = (before + phrase + phrase).replace(/\s+$/, "") + "…";
            console.warn(`[anti-loop] Repetição detectada (${n}-gram): "${phrase.trim().slice(0, 60)}" — truncando ${text.length}→${truncated.length}`);
            return truncated;
          }
        }
        return text;
      }(reply);
      // === HANDOFF: extrai marcadores [HANDOFF:tipo: motivo] e remove do texto visível.
      // A criação da atividade + DM no chat interno é feita no passo D (handler dedicado).
      // Por enquanto apenas logamos para validar que o agente emite os marcadores corretamente.
      const handoffMarkers = [];
      reply = reply.replace(/\[HANDOFF:\s*(retorno|ligacao|reuniao|fechamento)\s*:\s*([^\]]*?)\s*\]/gi, (_m, t, r)=>{
        handoffMarkers.push({
          type: t.toLowerCase(),
          reason: (r || '').trim()
        });
        return '';
      }).replace(/\n{3,}/g, '\n\n').trim();
      if (handoffMarkers.length) {
        console.log('[handoff] markers detectados', {
          phone,
          instance_name,
          agent_id: agent.id,
          markers: handoffMarkers
        });
        // Dispatch p/ Cloud: cria atividade no Externo + mensagem/menção no chat interno
        try {
          fetch(`${cloudFunctionsUrl}/functions/v1/whatsapp-handoff-dispatch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cloudAnonKey}` },
            body: JSON.stringify({
              lead_id: lead_id || null,
              phone,
              instance_name,
              agent_id: agent.id,
              agent_name: agent.name || null,
              handoff_config: agent.handoff_config || {},
              markers: handoffMarkers,
            }),
          }).catch((e)=> console.warn('[handoff] dispatch fail', e?.message || e));
        } catch (e) { console.warn('[handoff] dispatch threw', e); }
      }
      // === DOM — triagem do que não sai sem revisão humana ====================
      // Mesmo mecanismo do [HANDOFF:...] acima: o modelo marca a própria resposta,
      // o marcador é removido do texto visível. Se marcou, a resposta vai para a
      // fila em vez do grupo.
      let domRevisar = null;
      if (domCtx) {
        reply = reply.replace(/\[REVISAR:\s*([^\]]*?)\s*\]/gi, (_m, motivo) => {
          domRevisar = (motivo || '').trim() || 'sem motivo informado';
          return '';
        }).replace(/\n{3,}/g, '\n\n').trim();

        if (domCtx.modo === 'rascunho') domRevisar = domRevisar || 'modo rascunho: tudo passa por revisão';

        if (domRevisar && domCtx.modo !== 'automatico') {
          const { error: errFila } = await supabase.from('dom_respostas_pendentes').insert({
            group_jid: String(phone).split('@')[0],
            group_name: domCtx.contexto?.grupo || null,
            instance_name,
            lead_id: lead_id || domCtx.contexto?.lead_id || null,
            pergunta: message_text || null,
            pergunta_autor: contact_name || null,
            resposta_sugerida: reply,
            motivo_revisao: domRevisar,
            contexto_usado: domCtx.contexto || null
          });
          if (errFila) console.error('[dom] falha ao enfileirar', errFila.message);
          console.log(`[dom] resposta retida para revisão: grupo=${String(phone).split('@')[0]} motivo=${domRevisar}`);
          return new Response(JSON.stringify({
            queued: true,
            reason: domRevisar,
            sent: false
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
      // === FIM DOM ============================================================
      // Teto final de segurança no envio: WhatsApp aceita até ~4096 chars por mensagem.
      if (reply.length > 4000) {
        console.warn(`[anti-loop] reply >4000 chars (${reply.length}), truncando.`);
        reply = reply.slice(0, 4000).replace(/\s+\S*$/, "") + "…";
      }
      if (!reply.trim()) return new Response(JSON.stringify({
        skipped: true,
        reason: "Empty response"
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      // Extract group messages
      let groupMessageToSend = null;
      const grupoTagRegex = /\[GRUPO\]([\s\S]*?)\[\/GRUPO\]/gi;
      const grupoMatches = reply.match(grupoTagRegex);
      if (grupoMatches) {
        groupMessageToSend = grupoMatches.map((m)=>m.replace(/\[GRUPO\]/gi, '').replace(/\[\/GRUPO\]/gi, '').trim()).join('\n\n');
        reply = reply.replace(grupoTagRegex, '').replace(/\n{3,}/g, '\n\n').trim();
      }
      // Shortcut document handoff — trigger wjia-agent in Lovable Cloud
      if (agent.is_shortcut && agent.template_token) {
        const { data: existingSession } = await supabase.from("wjia_collection_sessions").select("id, status, sign_url").eq("phone", phone.replace(/\D/g, "").replace(/^0+/, "")).eq("instance_name", instance_name).in("status", [
          "collecting",
          "collecting_docs",
          "processing_docs",
          "ready",
          "generated"
        ]).order("created_at", {
          ascending: false
        }).limit(1).maybeSingle();
        if (existingSession?.status === "generated" && existingSession?.sign_url) {
          reply = `Esse é o link para assinatura do documento \uD83D\uDC47\n\n${existingSession.sign_url}\n\nSe tiver algum dado faltando, pode preencher direto no formulário. 🙏`;
        } else if (!existingSession) {
          const replyLower = reply.toLowerCase();
          if ((replyLower.includes("procuração") || replyLower.includes("documento")) && (replyLower.includes("link") || replyLower.includes("preparar") || replyLower.includes("gerar"))) {
            const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");
            const shortcutName = agent.name?.replace(/^#/, "") || "";
            const { data: recentMsg } = await supabase.from("whatsapp_messages").select("contact_id, lead_id").eq("phone", phone).eq("instance_name", instance_name).not("contact_id", "is", null).order("created_at", {
              ascending: false
            }).limit(1).maybeSingle();
            fetch(`${cloudFunctionsUrl}/functions/v1/wjia-agent`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${cloudAnonKey}`
              },
              body: JSON.stringify({
                phone: normalizedPhone,
                instance_name,
                command: `#${shortcutName}`,
                contact_id: recentMsg?.contact_id || null,
                lead_id: recentMsg?.lead_id || lead_id || null,
                reset_memory: false
              })
            }).catch(()=>{});
            reply = reply.replace(/https?:\/\/\S+/gi, "").replace(/www\.\S+/gi, "").replace(/\n{3,}/g, "\n\n").trim();
            if (!reply) reply = "Perfeito! Vou preparar o documento agora. Em instantes você recebe o link para assinar. \uD83D\uDCC4";
          }
        }
        reply = reply.replace(/https?:\/\/\S+/gi, "").replace(/www\.\S+/gi, "").replace(/\n{3,}/g, "\n\n").trim();
      }
      const splitMessages = agent.split_messages === true;
      let messageParts = [];
      if (splitMessages) {
        const paragraphs = reply.split(/\n\n+/).filter((p)=>p.trim());
        if (paragraphs.length > 1) {
          let current = "";
          for (const p of paragraphs){
            if (current && current.length + p.length > 300) {
              messageParts.push(current.trim());
              current = p;
            } else current = current ? current + "\n\n" + p : p;
          }
          if (current.trim()) messageParts.push(current.trim());
        } else messageParts = [
          reply
        ];
      } else messageParts = [
        reply
      ];
      if (agent.sign_messages) {
        const lastIdx = messageParts.length - 1;
        messageParts[lastIdx] = `${messageParts[lastIdx]}\n\n_\uD83E\uDD16 ${agent.name}_`;
        reply = messageParts.join("\n\n");
      } else if (domCtx) {
        // A view whatsapp_ai_agents devolve sign_messages como `false` FIXO
        // (\u00E9 literal na defini\u00E7\u00E3o da view, n\u00E3o um valor configur\u00E1vel), ent\u00E3o o
        // ramo acima nunca roda para estes agentes. O Dom PRECISA sair
        // assinado: o cliente tem que saber que quem respondeu foi um assessor
        // virtual, e n\u00E3o um dos advogados. Por isso a assinatura \u00E9 feita aqui.
        const lastIdx = messageParts.length - 1;
        messageParts[lastIdx] = `${messageParts[lastIdx]}\n\n_\uD83E\uDD16 Dom \u2014 Assessor Jur\u00EDdico Virtual_`;
        reply = messageParts.join("\n\n");
      }
      const { data: instance } = await supabase.from("whatsapp_instances").select("base_url, instance_token, instance_name").eq("instance_name", instance_name).maybeSingle();
      let sendSucceeded = false;
      if (instance) {
        const baseUrl = instance.base_url || "https://abraci.uazapi.com";
        const token = instance.instance_token;
        const delayBetween = (agent.split_delay_seconds || 2) * 1000;
        const audioRequestPatterns = /\b(mand[ae]?\s+(um\s+)?[áa]udio|fal[ae]?\s+(pra\s+mim|comigo)|grav[ae]?\s+(um\s+)?[áa]udio|respond[ae]?\s+(em\s+|com\s+)?[áa]udio)\b/i;
        const clientRequestedAudio = message_type === "text" && message_text && audioRequestPatterns.test(message_text);
        const isInboundAudio = [
          "audio",
          "ptt",
          "voice"
        ].includes(String(message_type || "").toLowerCase());
        const shouldReplyAudio = agent.reply_with_audio === true && (isInboundAudio || clientRequestedAudio);
        if (shouldReplyAudio) {
          try {
            const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
            if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");
            const cleanText = reply.replace(/\*([^*]+)\*/g, "$1").replace(/_([^_]+)_/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/\n{3,}/g, "\n\n").trim();
            const maxChars = agent.max_tts_chars || 1000;
            const ttsChunks = cleanText.length <= maxChars ? [
              cleanText
            ] : [
              cleanText.substring(0, maxChars)
            ];
            let voiceId = agent.reply_voice_id || "FGY2WhTYpPnrIDTdsKH5";
            if (voiceId === "instance_owner") {
              const { data: inst } = await supabase.from("whatsapp_instances").select("voice_id").eq("instance_name", instance_name).maybeSingle();
              voiceId = inst?.voice_id || "FGY2WhTYpPnrIDTdsKH5";
            } else if (voiceId.length === 36 && voiceId.includes("-")) {
              const { data: customVoice } = await supabase.from("custom_voices").select("elevenlabs_voice_id").eq("id", voiceId).eq("status", "ready").maybeSingle();
              voiceId = customVoice?.elevenlabs_voice_id || "FGY2WhTYpPnrIDTdsKH5";
            }
            for(let ci = 0; ci < ttsChunks.length; ci++){
              const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`, {
                method: "POST",
                headers: {
                  "xi-api-key": ELEVENLABS_API_KEY,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  text: ttsChunks[ci],
                  model_id: "eleven_multilingual_v2",
                  voice_settings: {
                    stability: 0.6,
                    similarity_boost: 0.75,
                    style: 0.3,
                    speed: 1.1
                  }
                })
              });
              if (!ttsResp.ok) throw new Error("TTS failed");
              const audioBuffer = await ttsResp.arrayBuffer();
              const fileName = `tts-agent-${Date.now()}.mp3`;
              const { error: uploadErr } = await supabase.storage.from("whatsapp-media").upload(`tts/${fileName}`, new Uint8Array(audioBuffer), {
                contentType: "audio/mpeg",
                upsert: false
              });
              if (uploadErr) throw uploadErr;
              const { data: urlData } = supabase.storage.from("whatsapp-media").getPublicUrl(`tts/${fileName}`);
              if (urlData?.publicUrl) {
                const sendRes = await fetch(`${baseUrl}/send/media`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "token": token
                  },
                  body: JSON.stringify({
                    number: phone,
                    file: urlData.publicUrl,
                    type: "audio"
                  })
                });
                if (sendRes.ok) sendSucceeded = true;
              }
              if (ci < ttsChunks.length - 1) await new Promise((r)=>setTimeout(r, delayBetween));
            }
          } catch (_) {
            for(let i = 0; i < messageParts.length; i++){
              const fallbackRes = await fetch(`${baseUrl}/send/text`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "token": token
                },
                body: JSON.stringify({
                  number: phone,
                  text: messageParts[i]
                })
              });
              if (fallbackRes.ok) sendSucceeded = true;
              if (i < messageParts.length - 1) await new Promise((r)=>setTimeout(r, delayBetween));
            }
          }
        } else {
          for(let i = 0; i < messageParts.length; i++){
            const sendRes = await fetch(`${baseUrl}/send/text`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "token": token
              },
              body: JSON.stringify({
                number: phone,
                text: messageParts[i]
              })
            });
            if (sendRes.ok) sendSucceeded = true;
            else console.error("UazAPI send error:", sendRes.status, await sendRes.text());
            if (i < messageParts.length - 1) await new Promise((r)=>setTimeout(r, delayBetween));
          }
        }
      } else return new Response(JSON.stringify({
        error: "No instance found",
        success: false
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      if (!sendSucceeded) return new Response(JSON.stringify({
        error: "Failed to send WhatsApp message",
        success: false
      }), {
        status: 502,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      // Save outbound message
      let resolvedLeadId = lead_id || null;
      let resolvedContactId = null;
      if (!resolvedLeadId) {
        const normalizedP = phone.replace(/\D/g, '');
        const suffix8 = normalizedP.slice(-8);
        const { data: contactForLink } = await supabase.from("contacts").select("id, lead_id").ilike("phone", `%${suffix8}`).limit(1).maybeSingle();
        if (contactForLink) {
          resolvedContactId = contactForLink.id;
          resolvedLeadId = contactForLink.lead_id;
        }
      }
      const outboundMsg = {
        phone,
        instance_name,
        direction: "outbound",
        message_text: reply,
        metadata: {
          ai_agent: agent.name,
          ai_agent_id: agent.id,
          split_count: messageParts.length
        },
        campaign_id: campaign_id || null,
        action_source: 'agent',
        action_source_detail: `Agente: ${agent.name}`,
        lead_id: resolvedLeadId,
        contact_id: resolvedContactId
      };
      await supabase.from("whatsapp_messages").insert(outboundMsg);
      await supabase.from("agent_reply_locks").delete().eq("phone", phone).eq("instance_name", instance_name);
      if (agent.followup_enabled) {
        const scheduledAt = new Date(Date.now() + agent.followup_interval_minutes * 60 * 1000).toISOString();
        const { data: existingFollowup } = await supabase.from("whatsapp_agent_followups").select("id").eq("phone", phone).eq("instance_name", instance_name).eq("status", "pending").maybeSingle();
        if (!existingFollowup) await supabase.from("whatsapp_agent_followups").insert({
          phone,
          instance_name,
          agent_id: agent.id,
          attempt_number: 1,
          scheduled_at: scheduledAt,
          status: "pending"
        });
      }
      try {
        await supabase.from("whatsapp_conversation_agents").update({
          human_paused_until: null
        }).eq("phone", phone).eq("instance_name", instance_name);
      } catch (_) {}
      return new Response(JSON.stringify({
        success: true,
        reply: reply.substring(0, 100)
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      skipped: true,
      reason: "UazAPI agents managed externally"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    console.error("Agent reply error:", e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Unknown"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
