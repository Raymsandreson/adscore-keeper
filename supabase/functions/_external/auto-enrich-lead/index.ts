// FONTE DA FUNÇÃO DO SUPABASE EXTERNO (kmedldlepwiityjsdahz).
// A pasta supabase/functions/auto-enrich-lead/ contém o PROXY do Cloud — não confundir.
// Deploy: via MCP/Management API no projeto Externo (inclui _shared/gemini.ts).
//
// v20: modos dry_run (extrai sem gravar, devolve extraído + valores atuais) e
// apply_fields (grava só os campos confirmados pelo usuário, sem re-extrair).
// Sem esses params o comportamento é idêntico ao v19 (webhook/zapsign não mudam).
// @ts-ignore
import { createClient } from 'npm:@supabase/supabase-js@2';
import { geminiChat } from './_shared/gemini.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLOUD_URL = Deno.env.get('CLOUD_FUNCTIONS_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON = Deno.env.get('CLOUD_ANON_KEY') || '';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const DEFAULT_INBOUND_THRESHOLD = 5;

// Fields nativos exclusivos do funil de Acidentes — não enviar p/ outros funis.
const ACCIDENT_ONLY_FIELDS = new Set([
  'victim_name', 'main_company', 'damage_description', 'accident_date',
  'case_type', 'visit_city', 'visit_state', 'visit_address',
]);

function slugify(name: string): string {
  return (name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { phone, instance_name, lead_id, contact_id, group_jid, force, dry_run, apply_fields } = await req.json();
    const isGroupEnrich = !!group_jid && !!lead_id;
    const isApply = !!apply_fields && typeof apply_fields === 'object' && !Array.isArray(apply_fields);
    if (isApply && !lead_id && !contact_id) {
      return new Response(JSON.stringify({ error: 'lead_id or contact_id required for apply_fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (!isApply && !isGroupEnrich && (!phone || !instance_name)) {
      return new Response(JSON.stringify({ error: 'phone and instance_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    console.log(`[auto-enrich] phone=${phone} instance=${instance_name} lead=${lead_id} contact=${contact_id} group_jid=${group_jid} force=${force} dry_run=${dry_run} apply=${isApply}`);

    // === Carrega lead p/ saber board_id e custom fields ===
    let leadBoardId: string | null = null;
    let boardName = '';
    let customFields: Array<{ id: string; field_name: string; field_type: string; slug: string }> = [];
    if (lead_id) {
      const { data: leadRow } = await supabase.from('leads').select('board_id').eq('id', lead_id).maybeSingle();
      leadBoardId = leadRow?.board_id ?? null;
      if (leadBoardId) {
        const [{ data: brd }, { data: cf }] = await Promise.all([
          supabase.from('kanban_boards').select('name').eq('id', leadBoardId).maybeSingle(),
          supabase.from('lead_custom_fields').select('id, field_name, field_type').eq('board_id', leadBoardId),
        ]);
        boardName = brd?.name || '';
        customFields = (cf || []).map((f: any) => ({ ...f, slug: slugify(f.field_name) }));
      }
    }
    const isAccidentBoard = /acident/i.test(boardName);

    let cleaned: Record<string, any> = {};
    if (isApply) {
      // Campos já extraídos e confirmados pelo usuário — não re-extrai.
      for (const [key, value] of Object.entries(apply_fields)){
        if (value !== null && value !== undefined && value !== '') cleaned[key] = value;
      }
    } else {
      let messages = null;
      if (isGroupEnrich) {
        const { data: groupMsgs } = await supabase.from('whatsapp_messages').select('direction, message_text, created_at, phone').eq('phone', group_jid).order('created_at', { ascending: true }).limit(200);
        if (!groupMsgs || groupMsgs.length === 0) return new Response(JSON.stringify({ ok: true, skipped: 'no_messages' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        messages = groupMsgs;
      } else {
        let INBOUND_THRESHOLD = DEFAULT_INBOUND_THRESHOLD;
        const { data: thresholdSetting } = await supabase.from('system_settings').select('value').eq('key', 'enrich_message_threshold').single();
        if (thresholdSetting?.value) INBOUND_THRESHOLD = parseInt(thresholdSetting.value, 10) || DEFAULT_INBOUND_THRESHOLD;
        const phoneSuffix = phone.replace(/\D/g, '').slice(-8);
        if (!force) {
          const { data: recentEnrich } = await supabase.from('lead_enrichment_log').select('id').ilike('phone', `%${phoneSuffix}`).eq('instance_name', instance_name).gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()).limit(1);
          if (recentEnrich && recentEnrich.length > 0) return new Response(JSON.stringify({ ok: true, skipped: 'recent_enrich' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
          const { count } = await supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('instance_name', instance_name).ilike('phone', `%${phoneSuffix}`).eq('direction', 'inbound');
          if (!count || count < INBOUND_THRESHOLD) return new Response(JSON.stringify({ ok: true, skipped: 'not_enough_messages', count }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const { data: privateMsgs } = await supabase.from('whatsapp_messages').select('direction, message_text, created_at').eq('instance_name', instance_name).ilike('phone', `%${phoneSuffix}`).order('created_at', { ascending: true }).limit(100);
        if (!privateMsgs || privateMsgs.length === 0) return new Response(JSON.stringify({ ok: true, skipped: 'no_messages' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        messages = privateMsgs;
      }
      const conversationText = messages.map((m)=>`[${m.direction === 'outbound' ? 'Atendente' : 'Cliente'}]: ${m.message_text || ''}`).join('\n');

      // === Monta schema do prompt baseado no funil ===
      // Campos base (comuns a todo lead/contato)
      const baseSchema: Record<string, string> = {
        full_name: 'nome completo',
        phone: 'outro telefone mencionado',
        email: 'e-mail',
        city: 'cidade',
        state: 'sigla do estado (SP, RJ, MG...)',
        neighborhood: 'bairro',
        street: 'logradouro/endereço',
        cep: 'CEP',
        profession: 'profissão/cargo',
        notes: 'resumo útil da conversa',
        instagram_url: 'perfil instagram',
        lead_status: 'null na maioria dos casos. Só preencha com closed/refused/unviable com certeza absoluta.',
        lead_status_reason: 'motivo em 1-2 frases. null se status for null.',
      };
      // Campos do funil de Acidentes só entram se o lead estiver nesse funil
      if (isAccidentBoard) {
        Object.assign(baseSchema, {
          victim_name: 'nome da vítima do acidente',
          main_company: 'empresa principal',
          damage_description: 'descrição do dano/lesão',
          accident_date: 'data do acidente (YYYY-MM-DD)',
          case_type: 'tipo do caso',
          visit_city: 'cidade da visita',
          visit_state: 'estado da visita (sigla UF)',
          visit_address: 'endereço completo para visita',
        });
      }
      // Custom fields do board (qualquer funil) entram pelo slug
      for (const f of customFields) {
        baseSchema[f.slug] = `[campo customizado] ${f.field_name}`;
      }
      const schemaLines = Object.entries(baseSchema).map(([k, v]) => `  "${k}": "${v}"`).join(',\n');
      const funnelHint = boardName
        ? `\nFunil deste lead: "${boardName}". Extraia APENAS os campos listados; não invente outros.\n`
        : '';
      const systemPrompt = `Você é um assistente especializado em extrair informações de conversas de WhatsApp.${funnelHint}
Analise a conversa e extraia TODAS as informações pessoais e do caso. Retorne APENAS um JSON válido:

{
${schemaLines},
  "referrals": []
}

REGRAS:
- Extraia APENAS informações explícitas na conversa
- Use null para campos não encontrados
- NÃO use campos que não estejam listados acima
- Retorne APENAS o JSON`;

      const result = await geminiChat({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: conversationText }
        ],
        temperature: 0.1
      });
      const content = result.choices?.[0]?.message?.content || '{}';
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      let extracted: any;
      try { extracted = JSON.parse(jsonStr); }
      catch {
        return new Response(JSON.stringify({ ok: false, error: 'parse_failed' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      for (const [key, value] of Object.entries(extracted)){
        if (value !== null && value !== undefined && value !== '') cleaned[key] = value;
      }
    }
    console.log('[auto-enrich] Extracted:', JSON.stringify(cleaned).substring(0, 500));

    // === Dry-run: devolve extraído + valores atuais, sem gravar nada ===
    if (dry_run && !isApply) {
      const current: Record<string, any> = {};
      let leadNameLocked = true;
      if (lead_id) {
        const { data: lr } = await supabase.from('leads')
          .select('lead_name, lead_email, city, state, neighborhood, notes, victim_name, main_company, damage_description, accident_date, case_type, visit_city, visit_state, visit_address, lead_status')
          .eq('id', lead_id).maybeSingle();
        if (lr) {
          current.full_name = lr.lead_name;
          current.email = lr.lead_email;
          current.city = lr.city;
          current.state = lr.state;
          current.neighborhood = lr.neighborhood;
          current.notes = lr.notes;
          current.victim_name = lr.victim_name;
          current.main_company = lr.main_company;
          current.damage_description = lr.damage_description;
          current.accident_date = lr.accident_date;
          current.case_type = lr.case_type;
          current.visit_city = lr.visit_city;
          current.visit_state = lr.visit_state;
          current.visit_address = lr.visit_address;
          current.lead_status = lr.lead_status;
          // lead_name só é sobrescrito quando o atual é numérico (mesma regra do apply)
          leadNameLocked = !(lr.lead_name && /^\d+$/.test(lr.lead_name.replace(/\D/g, '')));
        }
        if (customFields.length > 0) {
          const { data: cfv } = await supabase.from('lead_custom_field_values')
            .select('field_id, value_text, value_number, value_date, value_boolean')
            .eq('lead_id', lead_id);
          for (const f of customFields) {
            const row = (cfv || []).find((r: any) => r.field_id === f.id);
            if (row) current[f.slug] = row.value_text ?? row.value_number ?? row.value_date ?? row.value_boolean;
          }
        }
      }
      return new Response(JSON.stringify({
        ok: true, dry_run: true, extracted: cleaned, current, board: boardName,
        lead_name_locked: leadNameLocked,
        custom_fields: customFields.map((f) => ({ id: f.id, slug: f.slug, name: f.field_name, type: f.field_type })),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (lead_id) {
      const leadUpdate: Record<string, any> = {};
      if (cleaned.email) leadUpdate.lead_email = cleaned.email;
      const leadFields: Record<string, string> = {
        city: 'city', state: 'state', neighborhood: 'neighborhood', notes: 'notes',
      };
      if (isAccidentBoard) {
        Object.assign(leadFields, {
          victim_name: 'victim_name', main_company: 'main_company',
          damage_description: 'damage_description', accident_date: 'accident_date',
          case_type: 'case_type', visit_city: 'visit_city',
          visit_state: 'visit_state', visit_address: 'visit_address',
        });
      }
      for (const [k, v] of Object.entries(leadFields)){
        if (cleaned[k]) leadUpdate[v] = cleaned[k];
      }
      // Nunca permite vítima fora de Acidentes (defesa-em-profundidade)
      if (!isAccidentBoard) {
        for (const f of ACCIDENT_ONLY_FIELDS) delete leadUpdate[f];
      }
      if (cleaned.full_name || (isAccidentBoard && cleaned.victim_name)) {
        const { data: cl } = await supabase.from('leads').select('lead_name').eq('id', lead_id).single();
        if (cl?.lead_name && /^\d+$/.test(cl.lead_name.replace(/\D/g, ''))) {
          leadUpdate.lead_name = cleaned.full_name || cleaned.victim_name;
        }
      }
      if (Object.keys(leadUpdate).length > 0) {
        const { error } = await supabase.from('leads').update(leadUpdate).eq('id', lead_id);
        if (error) console.error('[auto-enrich] Lead update error:', error);
        else console.log(`[auto-enrich] Lead ${lead_id} updated with ${Object.keys(leadUpdate).length} fields`);
      }

      // === Salva custom fields do board ===
      let cfSaved = 0;
      for (const f of customFields) {
        const val = cleaned[f.slug];
        if (val === undefined || val === null || val === '') continue;
        const valueData: any = {
          lead_id, field_id: f.id,
          value_text: null, value_number: null, value_date: null, value_boolean: null,
        };
        switch (f.field_type) {
          case 'number': valueData.value_number = Number(val); break;
          case 'date': valueData.value_date = String(val); break;
          case 'checkbox': valueData.value_boolean = Boolean(val); break;
          default: valueData.value_text = String(val);
        }
        const { data: existing } = await supabase.from('lead_custom_field_values')
          .select('id').eq('lead_id', lead_id).eq('field_id', f.id).maybeSingle();
        if (existing?.id) {
          await supabase.from('lead_custom_field_values').update({
            value_text: valueData.value_text, value_number: valueData.value_number,
            value_date: valueData.value_date, value_boolean: valueData.value_boolean,
          }).eq('id', existing.id);
        } else {
          await supabase.from('lead_custom_field_values').insert(valueData);
        }
        cfSaved++;
      }
      if (cfSaved) console.log(`[auto-enrich] Lead ${lead_id} custom fields saved: ${cfSaved}`);

      if (cleaned.lead_status && ['closed','refused','unviable'].includes(cleaned.lead_status) && cleaned.lead_status_reason) {
        const { data: cl } = await supabase.from('leads').select('lead_status').eq('id', lead_id).single();
        if (cl?.lead_status === 'active' || !cl?.lead_status) {
          const statusMap: Record<string,string> = {
            closed: 'became_client_date', refused: 'classification_date', unviable: 'inviavel_date',
          };
          const today = new Date().toISOString().slice(0, 10);
          await supabase.from('leads').update({
            lead_status: cleaned.lead_status === 'unviable' ? 'inviavel' : cleaned.lead_status,
            lead_status_reason: cleaned.lead_status_reason,
            lead_status_changed_at: new Date().toISOString(),
            [statusMap[cleaned.lead_status]]: today
          }).eq('id', lead_id);
          await supabase.from('lead_status_history').insert({
            lead_id, from_status: 'active',
            to_status: cleaned.lead_status === 'unviable' ? 'inviavel' : cleaned.lead_status,
            reason: cleaned.lead_status_reason, changed_by: null, changed_by_type: 'ai'
          });
          try {
            fetch(`${CLOUD_URL}/functions/v1/facebook-capi`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON}` },
              body: JSON.stringify({ lead_id, event_name: 'Lead', custom_data: { lead_event_source: 'lead_unqualified' } })
            }).catch(()=>{});
          } catch (_) {}
        }
      }
    }
    if (contact_id) {
      const contactUpdate: Record<string, any> = {};
      const contactFields: Record<string, string> = {
        full_name: 'full_name', email: 'email', city: 'city', state: 'state',
        neighborhood: 'neighborhood', street: 'street', cep: 'cep',
        profession: 'profession', instagram_url: 'instagram_url', notes: 'notes'
      };
      for (const [k, v] of Object.entries(contactFields)){
        if (cleaned[k]) contactUpdate[v] = cleaned[k];
      }
      if (cleaned.full_name) {
        const { data: cc } = await supabase.from('contacts').select('full_name').eq('id', contact_id).single();
        if (cc?.full_name && /^\d+$/.test(cc.full_name.replace(/\D/g, ''))) contactUpdate.full_name = cleaned.full_name;
      }
      if (Object.keys(contactUpdate).length > 0) {
        const { error } = await supabase.from('contacts').update(contactUpdate).eq('id', contact_id);
        if (error) console.error('[auto-enrich] Contact update error:', error);
      }
    }
    await supabase.from('lead_enrichment_log').insert({
      phone: phone || group_jid || 'group_enrich',
      instance_name: instance_name || 'group',
      lead_id: lead_id || null,
      contact_id: contact_id || null,
      fields_updated: cleaned
    });
    console.log(`[auto-enrich] Complete for ${isGroupEnrich ? 'group=' + group_jid : 'phone=' + phone}${isApply ? ' (apply_fields)' : ''}`);
    return new Response(JSON.stringify({ ok: true, enriched: cleaned, applied: isApply || undefined, board: boardName }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[auto-enrich] Error:', error);
    return new Response(JSON.stringify({ error: (error as any).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
