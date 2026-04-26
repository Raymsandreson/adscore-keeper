// Edge function: get-group-invite-link
// Busca o link de convite de um grupo WhatsApp via UazAPI a partir do JID.
// Persiste em leads.group_link e lead_whatsapp_groups.group_link quando lead_id é fornecido.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveSupabaseUrl, resolveServiceRoleKey } from '../_shared/supabase-url-resolver.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function isInstanceConnected(inst: any): Promise<boolean> {
  try {
    const url = (inst.base_url || 'https://abraci.uazapi.com') + '/status'
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', token: inst.instance_token },
    })
    if (!res.ok) return false
    const data = await res.json()
    const statusObj = data?.status
    if (typeof statusObj === 'object' && statusObj !== null) {
      const checked = statusObj?.checked_instance
      if (checked?.connection_status === 'connected' || checked?.is_healthy === true) return true
    }
    const raw = statusObj || data?.state || data?.connection || ''
    const status = typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
    return ['connected', 'open', 'CONNECTED'].includes(status)
      || data?.connected === true
      || data?.status === true
  } catch {
    return false
  }
}

// Extrai código/link de convite a partir de um payload arbitrário do /group/info
function extractInvite(payload: any): { code: string | null; link: string | null } {
  const candidates = [payload, payload?.data, payload?.group, payload?.data?.group].filter(Boolean)
  for (const c of candidates) {
    const link = c?.inviteLink || c?.invite_link || c?.invitelink || c?.InviteLink || null
    const code = c?.inviteCode || c?.invite_code || c?.invitecode || c?.InviteCode || c?.code || null
    if (link || code) {
      const cleanLink = link ? String(link).trim() : null
      const cleanCode = code ? String(code).trim() : null
      return { code: cleanCode, link: cleanLink }
    }
  }
  return { code: null, link: null }
}

// Chama POST /group/info conforme documentação UazAPI v2 com getInviteLink=true.
async function fetchGroupInvite(
  baseUrl: string,
  token: string,
  groupJid: string,
): Promise<{ code: string | null; link: string | null; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/group/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({
        groupjid: groupJid,
        getInviteLink: true,
        getRequestsParticipants: false,
        force: false,
      }),
    })
    const text = await res.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { /* texto não-JSON */ }

    if (!res.ok) {
      const msg = data?.message || data?.error || text?.slice(0, 200) || `HTTP ${res.status}`
      console.warn(`[invite] /group/info failed (${res.status}):`, msg)
      return { code: null, link: null, error: msg }
    }

    const { code, link } = extractInvite(data)
    return { code, link }
  } catch (e: any) {
    console.warn('[invite] /group/info exception', e)
    return { code: null, link: null, error: e?.message || 'request failed' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const supabase = createClient(resolveSupabaseUrl(), resolveServiceRoleKey())
    const body = await req.json().catch(() => ({}))
    const groupJidRaw: string = String(body?.group_jid || '').trim()
    const leadId: string | null = body?.lead_id ? String(body.lead_id) : null
    const requestedInstanceId: string | null = body?.instance_id ? String(body.instance_id) : null

    if (!groupJidRaw) {
      return jsonResponse({ success: false, error: 'group_jid is required' }, 400)
    }

    const groupJid = groupJidRaw.includes('@g.us') ? groupJidRaw : `${groupJidRaw}@g.us`

    // Pick a connected instance: requested first, fallback to any active connected.
    let chosen: any = null
    if (requestedInstanceId) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('id', requestedInstanceId)
        .eq('is_active', true)
        .maybeSingle()
      if (data && (await isInstanceConnected(data))) chosen = data
    }

    if (!chosen) {
      const { data: instances } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('is_active', true)
        .limit(20)
      for (const inst of instances || []) {
        if (await isInstanceConnected(inst)) { chosen = inst; break }
      }
    }

    if (!chosen) {
      return jsonResponse({ success: false, error: 'No connected WhatsApp instance available' }, 200)
    }

    const baseUrl = chosen.base_url || 'https://abraci.uazapi.com'
    const { code, link, error: apiError } = await fetchGroupInvite(baseUrl, chosen.instance_token, groupJid)

    if (!code && !link) {
      return jsonResponse({
        success: false,
        error: apiError
          || 'Could not retrieve invite link (admin permission required or group not found)',
      }, 200)
    }

    const inviteLink = link || `https://chat.whatsapp.com/${code}`

    // Persist link if a lead is provided (best-effort, non-blocking on errors).
    if (leadId) {
      try {
        await supabase
          .from('lead_whatsapp_groups')
          .update({ group_link: inviteLink })
          .eq('lead_id', leadId)
          .eq('group_jid', groupJid)
      } catch (e) { console.warn('[invite] update lead_whatsapp_groups failed', e) }

      try {
        // Update leads.group_link only if currently empty or not a chat.whatsapp.com URL,
        // to avoid overwriting a manually-set primary link.
        const { data: leadRow } = await supabase
          .from('leads')
          .select('group_link, whatsapp_group_id')
          .eq('id', leadId)
          .maybeSingle()
        const current = String(leadRow?.group_link || '')
        const shouldUpdate = !current.includes('chat.whatsapp.com')
          && (leadRow?.whatsapp_group_id === groupJid || !leadRow?.whatsapp_group_id)
        if (shouldUpdate) {
          await supabase.from('leads').update({ group_link: inviteLink }).eq('id', leadId)
        }
      } catch (e) { console.warn('[invite] update leads.group_link failed', e) }
    }

    return jsonResponse({
      success: true,
      group_jid: groupJid,
      invite_code: code,
      invite_link: inviteLink,
      instance_name: chosen.instance_name,
    })
  } catch (e: any) {
    console.error('[get-group-invite-link] error', e)
    return jsonResponse({ success: false, error: e?.message || 'unknown error' }, 500)
  }
})
