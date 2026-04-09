import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to fetch all rows with pagination
async function fetchAll<T>(
  client: any,
  table: string,
  select: string,
  filters: (q: any) => any,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    let q = client.from(table).select(select).range(from, from + pageSize - 1);
    q = filters(q);
    const { data, error } = await q;
    if (error) { console.error(`Error fetching ${table}:`, error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
    const serviceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Target date: today in UTC-3 (Brazil)
    const now = new Date();
    const brazilOffset = -3 * 60;
    const brazilNow = new Date(now.getTime() + (brazilOffset + now.getTimezoneOffset()) * 60000);
    const snapshotDate = brazilNow.toISOString().slice(0, 10);
    
    const todayStart = new Date(`${snapshotDate}T00:00:00-03:00`).toISOString();
    const todayEnd = new Date(`${snapshotDate}T23:59:59.999-03:00`).toISOString();

    console.log(`Computing snapshot for ${snapshotDate} (${todayStart} to ${todayEnd})`);

    // ===== PARALLEL FETCH ALL DATA =====
    const [
      inboundMsgs,
      outboundMsgs,
      closedLeads,
      signedDocs,
      pendingDocs,
      groupLeads,
      cases,
      processes,
      contacts,
    ] = await Promise.all([
      fetchAll(supabase, 'whatsapp_messages', 'phone, contact_name, created_at, instance_name', (q: any) =>
        q.eq('direction', 'inbound').not('phone', 'like', '%@g.us').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: true })
      ),
      fetchAll(supabase, 'whatsapp_messages', 'phone, created_at, lead_id, action_source', (q: any) =>
        q.eq('direction', 'outbound').not('phone', 'like', '%@g.us').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: true })
      ),
      fetchAll(supabase, 'leads', 'id, acolhedor, campaign_name, lead_status, lead_phone, created_at, updated_at, whatsapp_group_id, group_link', (q: any) =>
        q.eq('lead_status', 'closed').gte('updated_at', todayStart).lte('updated_at', todayEnd)
      ),
      fetchAll(supabase, 'zapsign_documents', 'id, document_name, instance_name, lead_id, created_at, signed_at', (q: any) =>
        q.eq('signer_status', 'signed').gte('created_at', todayStart).lte('created_at', todayEnd)
      ),
      fetchAll(supabase, 'zapsign_documents', 'id, document_name, instance_name, lead_id, created_at', (q: any) =>
        q.eq('signer_status', 'new').gte('created_at', todayStart).lte('created_at', todayEnd)
      ),
      fetchAll(supabase, 'leads', 'id, lead_name, acolhedor, board_id, campaign_name, created_at', (q: any) =>
        q.not('whatsapp_group_id', 'is', null).gte('created_at', todayStart).lte('created_at', todayEnd)
      ),
      fetchAll(supabase, 'legal_cases', 'id, case_number, title, acolhedor, lead_id, created_at', (q: any) =>
        q.gte('created_at', todayStart).lte('created_at', todayEnd)
      ),
      fetchAll(supabase, 'case_process_tracking', 'id, cliente, acolhedor, lead_id, created_at', (q: any) =>
        q.gte('created_at', todayStart).lte('created_at', todayEnd)
      ),
      fetchAll(supabase, 'contacts', 'id, full_name, city, state, created_by, created_at', (q: any) =>
        q.gte('created_at', todayStart).lte('created_at', todayEnd)
      ),
    ]);

    console.log(`Fetched: ${inboundMsgs.length} inbound, ${outboundMsgs.length} outbound, ${closedLeads.length} closed leads`);

    // ===== CONVERSATION METRICS =====
    const phoneMap = new Map<string, { phone: string; contact_name: string | null; first_at: string; instance_name: string | null }>();
    for (const m of inboundMsgs as any[]) {
      if (!m.phone || m.phone.includes('@g.us')) continue;
      if (!phoneMap.has(m.phone)) {
        phoneMap.set(m.phone, { phone: m.phone, contact_name: m.contact_name, first_at: m.created_at, instance_name: m.instance_name });
      }
    }

    const outboundMap = new Map<string, { count: number; first_at: string | null }>();
    for (const m of outboundMsgs as any[]) {
      if (!m.phone) continue;
      const ex = outboundMap.get(m.phone);
      if (!ex) outboundMap.set(m.phone, { count: 1, first_at: m.created_at });
      else ex.count++;
    }

    const uniquePhones = [...phoneMap.keys()];
    const totalInbound = uniquePhones.length;
    const respondedCount = uniquePhones.filter(p => outboundMap.has(p)).length;
    const responseRate = totalInbound > 0 ? Math.round((respondedCount / totalInbound) * 100) : 0;

    const responseTimes: number[] = [];
    for (const [phone, outData] of outboundMap.entries()) {
      const inData = phoneMap.get(phone);
      if (inData && outData.first_at) {
        const diff = (new Date(outData.first_at).getTime() - new Date(inData.first_at).getTime()) / 60000;
        if (diff >= 0) responseTimes.push(diff);
      }
    }
    const avgResponseTimeMin = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;

    // ===== NEW CONVERSATIONS (phones with no messages before today) =====
    const oldPhones = new Set<string>();
    const phonesToCheck = uniquePhones.slice(0, 2000);
    for (let i = 0; i < phonesToCheck.length; i += 50) {
      const batch = phonesToCheck.slice(i, i + 50);
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('phone')
        .lt('created_at', todayStart)
        .in('phone', batch)
        .limit(5000);
      (data || []).forEach((m: any) => oldPhones.add(m.phone));
    }
    const trulyNewPhones = uniquePhones.filter(p => !oldPhones.has(p));

    // Lead lookup for new convs
    let leadPhoneMap = new Map<string, string>();
    if (trulyNewPhones.length > 0) {
      const { data: allLeads } = await supabase.from('leads').select('lead_phone, lead_name').not('lead_phone', 'is', null);
      for (const l of (allLeads || []) as any[]) {
        const norm = (l.lead_phone || '').replace(/\D/g, '');
        if (norm) leadPhoneMap.set(norm.slice(-8), l.lead_name || '');
      }
    }

    const newConvDetails = trulyNewPhones.map(p => {
      const conv = phoneMap.get(p)!;
      const outData = outboundMap.get(p);
      const suffix = p.replace(/\D/g, '').slice(-8);
      const leadName = leadPhoneMap.get(suffix) || null;
      return {
        phone: p,
        contact_name: conv.contact_name,
        instance_name: conv.instance_name,
        first_message_at: conv.first_at,
        was_responded: !!outData,
        response_time_minutes: outData?.first_at ? Math.round((new Date(outData.first_at).getTime() - new Date(conv.first_at).getTime()) / 60000) : null,
        lead_name: leadName,
        has_lead: !!leadName,
      };
    });

    // ===== CLOSED LEADS CLASSIFICATION =====
    // Build outbound stats per lead_id from outbound messages
    const leadOutboundStats = new Map<string, { manual: number; total: number }>();
    for (const m of outboundMsgs as any[]) {
      if (!m.lead_id) continue;
      if (!leadOutboundStats.has(m.lead_id)) leadOutboundStats.set(m.lead_id, { manual: 0, total: 0 });
      const s = leadOutboundStats.get(m.lead_id)!;
      s.total++;
      if (m.action_source === 'manual') s.manual++;
    }

    // Also check historical outbound for leads that have no messages today
    const leadsNeedingHistory = (closedLeads as any[]).filter(l => !leadOutboundStats.has(l.id));
    if (leadsNeedingHistory.length > 0) {
      for (let i = 0; i < leadsNeedingHistory.length; i += 50) {
        const batch = leadsNeedingHistory.slice(i, i + 50).map((l: any) => l.id);
        const histMsgs = await fetchAll(supabase, 'whatsapp_messages', 'lead_id, action_source', (q: any) =>
          q.eq('direction', 'outbound').in('lead_id', batch)
        );
        for (const m of histMsgs as any[]) {
          if (!m.lead_id) continue;
          if (!leadOutboundStats.has(m.lead_id)) leadOutboundStats.set(m.lead_id, { manual: 0, total: 0 });
          const s = leadOutboundStats.get(m.lead_id)!;
          s.total++;
          if (m.action_source === 'manual') s.manual++;
        }
      }
    }

    const closedLeadDetails: any[] = [];
    let closedByAI = 0, closedAssisted = 0, closedWithHuman = 0, closedNoInteraction = 0;
    const agentDetailMap = new Map<string, { ai: number; assisted: number; human: number; noInteraction: number }>();
    const campaignMap = new Map<string, number>();

    for (const l of closedLeads as any[]) {
      const agentName = l.acolhedor || 'Sem acolhedor';
      if (l.campaign_name) campaignMap.set(l.campaign_name, (campaignMap.get(l.campaign_name) || 0) + 1);

      const stats = leadOutboundStats.get(l.id);
      const phone = (l.lead_phone || '').replace(/\D/g, '');
      const hasValidPhone = phone.length >= 8;

      let classification: string;
      if (!stats || stats.total === 0) {
        classification = hasValidPhone ? 'ai' : 'noInteraction';
      } else if (stats.manual === 0) {
        classification = 'ai';
      } else if ((stats.manual / stats.total) >= 0.7) {
        classification = 'human';
      } else {
        classification = 'assisted';
      }

      closedLeadDetails.push({ leadId: l.id, acolhedor: agentName, campaign: l.campaign_name || null, classification });

      if (classification === 'ai') closedByAI++;
      else if (classification === 'assisted') closedAssisted++;
      else if (classification === 'human') closedWithHuman++;
      else closedNoInteraction++;

      if (!agentDetailMap.has(agentName)) agentDetailMap.set(agentName, { ai: 0, assisted: 0, human: 0, noInteraction: 0 });
      agentDetailMap.get(agentName)![classification as keyof typeof agentDetailMap extends never ? never : string]++;
    }

    const closedTotal = closedByAI + closedAssisted + closedWithHuman + closedNoInteraction;

    // ===== OPERATIONAL METRICS =====
    // Fetch acolhedor for docs via lead_id
    const allDocLeadIds = [...new Set([...(signedDocs as any[]), ...(pendingDocs as any[])].map(d => d.lead_id).filter(Boolean))];
    let docLeadAcolhedorMap = new Map<string, string>();
    if (allDocLeadIds.length > 0) {
      const { data } = await supabase.from('leads').select('id, acolhedor').in('id', allDocLeadIds);
      for (const l of (data || []) as any[]) {
        if (l.acolhedor) docLeadAcolhedorMap.set(l.id, l.acolhedor);
      }
    }

    // Contact creator names
    const creatorIds = [...new Set((contacts as any[]).map(c => c.created_by).filter(Boolean))];
    let creatorMap = new Map<string, string>();
    if (creatorIds.length > 0) {
      const { data } = await supabase.from('profiles').select('user_id, full_name').in('user_id', creatorIds);
      for (const p of (data || []) as any[]) {
        if (p.full_name) creatorMap.set(p.user_id, p.full_name);
      }
    }

    const mapDoc = (d: any) => ({
      id: d.id, name: d.document_name || 'Documento',
      acolhedor: (d.lead_id && docLeadAcolhedorMap.get(d.lead_id)) || null,
      instance_name: d.instance_name || null, lead_id: d.lead_id || null, created_at: d.created_at,
    });

    const signedDocsDetails = (signedDocs as any[]).map(mapDoc);
    const pendingDocsDetails = (pendingDocs as any[]).map(mapDoc);
    const groupsDetails = (groupLeads as any[]).map(d => ({
      id: d.id, name: d.lead_name || 'Lead', acolhedor: d.acolhedor || null,
      instance_name: null, lead_id: d.id, created_at: d.created_at,
    }));
    const casesDetails = (cases as any[]).map(d => ({
      id: d.id, name: d.title || d.case_number || 'Caso', acolhedor: d.acolhedor || null,
      instance_name: null, lead_id: d.lead_id || null, created_at: d.created_at,
    }));
    const processesDetails = (processes as any[]).map(d => ({
      id: d.id, name: d.cliente || 'Processo', acolhedor: d.acolhedor || null,
      instance_name: null, lead_id: d.lead_id || null, created_at: d.created_at,
    }));
    const contactsDetails = (contacts as any[]).map(d => ({
      id: d.id, name: d.full_name || 'Contato',
      acolhedor: (d.created_by && creatorMap.get(d.created_by)) || null,
      instance_name: null, lead_id: null, created_at: d.created_at,
    }));

    // ===== GAPS =====
    const closedArr = closedLeads as any[];
    const closedWithoutGroup = closedArr
      .filter(l => !l.whatsapp_group_id && !l.group_link)
      .map(l => ({ id: l.id, name: l.lead_name || 'Lead', acolhedor: l.acolhedor, created_at: l.updated_at, lead_id: l.id, whatsapp_phone: l.lead_phone }));

    const withGroup = closedArr.filter(l => !!l.whatsapp_group_id || !!l.group_link);
    const withGroupIds = withGroup.map(l => l.id);

    let leadsWithCases = new Set<string>();
    if (withGroupIds.length > 0) {
      for (let i = 0; i < withGroupIds.length; i += 100) {
        const batch = withGroupIds.slice(i, i + 100);
        const { data } = await supabase.from('legal_cases').select('lead_id').in('lead_id', batch);
        (data || []).forEach((c: any) => { if (c.lead_id) leadsWithCases.add(c.lead_id); });
      }
    }

    const withGroupWithoutCase = withGroup
      .filter(l => !leadsWithCases.has(l.id))
      .map(l => ({ id: l.id, name: l.lead_name || 'Lead', acolhedor: l.acolhedor, created_at: l.updated_at, lead_id: l.id, whatsapp_phone: l.lead_phone, whatsapp_group_id: l.whatsapp_group_id }));

    const caseIds = (cases as any[]).map(c => c.id);
    let casesWithProcesses = new Set<string>();
    if (caseIds.length > 0) {
      for (let i = 0; i < caseIds.length; i += 100) {
        const batch = caseIds.slice(i, i + 100);
        const { data } = await supabase.from('lead_processes').select('case_id').in('case_id', batch);
        (data || []).forEach((p: any) => { if (p.case_id) casesWithProcesses.add(p.case_id); });
      }
    }

    // Lead info for cases/processes
    const allLeadIds = [...new Set([...(cases as any[]).map(c => c.lead_id), ...(processes as any[]).map(p => p.lead_id)].filter(Boolean))];
    let leadInfoMap: Record<string, { lead_phone: string | null; whatsapp_group_id: string | null }> = {};
    if (allLeadIds.length > 0) {
      const { data } = await supabase.from('leads').select('id, lead_phone, whatsapp_group_id').in('id', allLeadIds);
      if (data) leadInfoMap = Object.fromEntries(data.map((l: any) => [l.id, { lead_phone: l.lead_phone, whatsapp_group_id: l.whatsapp_group_id }]));
    }

    const casesWithoutProcess = (cases as any[])
      .filter(c => !casesWithProcesses.has(c.id))
      .map(c => {
        const li = c.lead_id ? leadInfoMap[c.lead_id] : null;
        return { id: c.id, name: c.title || c.case_number || 'Caso', acolhedor: c.acolhedor, created_at: c.created_at, lead_id: c.lead_id, whatsapp_phone: li?.lead_phone, whatsapp_group_id: li?.whatsapp_group_id };
      });

    const processIds = (processes as any[]).map(p => p.id);
    let processesWithActivities = new Set<string>();
    if (processIds.length > 0) {
      for (let i = 0; i < processIds.length; i += 100) {
        const batch = processIds.slice(i, i + 100);
        const { data } = await supabase.from('lead_activities').select('process_id').in('process_id', batch);
        (data || []).forEach((a: any) => { if (a.process_id) processesWithActivities.add(a.process_id); });
      }
    }

    const processesWithoutActivity = (processes as any[])
      .filter(p => !processesWithActivities.has(p.id))
      .map(p => {
        const li = p.lead_id ? leadInfoMap[p.lead_id] : null;
        return { id: p.id, name: p.title || 'Processo', acolhedor: p.acolhedor || null, created_at: p.created_at, lead_id: p.lead_id, whatsapp_phone: li?.lead_phone, whatsapp_group_id: li?.whatsapp_group_id };
      });

    // ===== BUILD SNAPSHOT =====
    const closedByAgentDetailed = Array.from(agentDetailMap.entries())
      .map(([agent, d]) => ({ agent, ...d, total: d.ai + d.assisted + d.human + d.noInteraction }))
      .sort((a, b) => b.total - a.total);

    const closedByCampaign = Array.from(campaignMap.entries())
      .map(([campaign, count]) => ({ campaign, count }))
      .sort((a, b) => b.count - a.count);

    const snapshot = {
      snapshot_date: snapshotDate,
      closed_lead_details: closedLeadDetails,
      closed_aggregates: {
        closedTotal, closedByAI, closedAssisted, closedWithHuman, closedNoInteraction,
        closedByAgentDetailed, closedByCampaign,
      },
      conversation_metrics: {
        newConversations: trulyNewPhones.length,
        responseRate, avgResponseTimeMin, respondedCount, totalInbound,
      },
      new_conv_details: newConvDetails,
      operational_metrics: {
        signedDocuments: signedDocsDetails.length,
        pendingDocuments: pendingDocsDetails.length,
        groupsCreated: groupsDetails.length,
        casesCreated: casesDetails.length,
        processesCreated: processesDetails.length,
        contactsCreated: contactsDetails.length,
      },
      operational_details: {
        signedDocsDetails, pendingDocsDetails, groupsDetails, casesDetails, processesDetails, contactsDetails,
      },
      gap_details: {
        closedWithoutGroup, withGroupWithoutCase, casesWithoutProcess, processesWithoutActivity,
      },
      computed_at: new Date().toISOString(),
    };

    // ===== UPSERT SNAPSHOT =====
    const { error: upsertError } = await supabase
      .from('monitor_kpi_snapshots')
      .upsert(snapshot, { onConflict: 'snapshot_date' });

    if (upsertError) {
      console.error('Error upserting snapshot:', upsertError);
      throw upsertError;
    }

    console.log(`✅ Snapshot computed for ${snapshotDate}: ${closedTotal} closed, ${trulyNewPhones.length} new convs, ${closedWithoutGroup.length} gaps`);

    return new Response(JSON.stringify({ success: true, date: snapshotDate, closedTotal, newConversations: trulyNewPhones.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error computing snapshot:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
