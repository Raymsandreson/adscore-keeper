// Edge function: get-group-invite-link
// Busca o link de convite de um grupo WhatsApp via UazAPI a partir do JID.
// Persiste em leads.group_link e lead_whatsapp_groups.group_link quando lead_id é fornecido.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://esm.sh/zod@3.23.8'
import { resolveSupabaseUrl, resolveServiceRoleKey } from '../_shared/supabase-url-resolver.ts'

import { getExternalClient } from "../_shared/external-client.ts";
// Schema de entrada do client. group_jid aceita JID completo (`...@g.us`) ou
// apenas o número de 15+ dígitos. UUIDs validados quando presentes.
const RequestSchema = z.object({
  group_jid: z
    .string({ required_error: 'group_jid is required' })
    .trim()
    .min(10, 'group_jid is too short')
    .max(80, 'group_jid is too long')
    // Aceita: dígitos puros (>=10), formato novo `<digitos>@g.us`, ou legacy `<digitos>-<digitos>@g.us`.
    .regex(/^(\d{10,}(-\d{5,})?)(@g\.us)?$/, 'group_jid must be a WhatsApp group ID (digits, optionally with -timestamp and @g.us)'),
  lead_id: z.string().uuid('lead_id must be a UUID').optional().nullable(),
  instance_id: z.string().uuid('instance_id must be a UUID').optional().nullable(),
  get_invite_link: z.boolean().optional(),
})

// Body enviado à UazAPI POST /group/info — getInviteLink obrigatoriamente true aqui.
const UazApiBodySchema = z.object({
  groupjid: z.string().regex(/^\d{10,}(-\d{5,})?@g\.us$/, 'normalized JID must end with @g.us'),
  getInviteLink: z.literal(true),
  getRequestsParticipants: z.boolean(),
  force: z.boolean(),
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Sem timeout, cada chamada à UazAPI pode ficar pendurada até o limite de
// ociosidade da edge (150s). Com dezenas de instâncias checadas em série isso
// estourava sempre. Todo fetch externo agora tem teto próprio.
const STATUS_TIMEOUT_MS = 5000
const INFO_TIMEOUT_MS = 12000
const MAX_CANDIDATES = 6

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(tid)
  }
}

async function isInstanceConnected(inst: any): Promise<boolean> {
  try {
    const url = (inst.base_url || 'https://abraci.uazapi.com') + '/status'
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', token: inst.instance_token },
    }, STATUS_TIMEOUT_MS)
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
    // Validação final do payload antes de chamar a UazAPI — garante groupjid e getInviteLink=true.
    const uazBody = UazApiBodySchema.parse({
      groupjid: groupJid,
      getInviteLink: true,
      getRequestsParticipants: false,
      force: false,
    })
    const res = await fetchWithTimeout(`${baseUrl}/group/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify(uazBody),
    }, INFO_TIMEOUT_MS)
    const text = await res.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { /* texto não-JSON */ }

    if (!res.ok) {
      const msg = data?.message || data?.error || text?.slice(0, 200) || `HTTP ${res.status}`
      console.warn(`[invite] /group/info failed (${res.status}):`, msg)
      return { code: null, link: null, error: msg }
    }

    const { code, link } = extractInvite(data)
    if (!code && !link) {
      // Doc UazAPI retorna 'invite_link' no nível raiz quando getInviteLink=true e a instância é admin.
      // Se vier vazio, geralmente significa: instância não é admin, ou getInviteLink foi ignorado.
      const jid = data?.JID || data?.jid || groupJid
      console.warn(`[invite] /group/info OK mas sem invite_link para ${jid}. Provável: instância não é admin. Keys:`,
        data && typeof data === 'object' ? Object.keys(data).slice(0, 20) : typeof data)
    }
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
    const rawBody = await req.json().catch(() => ({}))
    const parsed = RequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      return jsonResponse({
        success: false,
        error: 'Invalid request',
        details: parsed.error.flatten().fieldErrors,
      }, 400)
    }
    // get_invite_link é opcional no client, mas SEMPRE forçamos true para a UazAPI;
    const extClient = getExternalClient();
    // recusamos chamada se o cliente passar explicitamente false (uso indevido desta função).
    if (parsed.data.get_invite_link === false) {
      return jsonResponse({
        success: false,
        error: 'This endpoint requires get_invite_link=true (omit the field or set to true).',
      }, 400)
    }
    const groupJidRaw = parsed.data.group_jid
    const leadId = parsed.data.lead_id ?? null
    const requestedInstanceId = parsed.data.instance_id ?? null

    const groupJid = groupJidRaw.includes('@g.us') ? groupJidRaw : `${groupJidRaw}@g.us`

    // Carrega as instâncias ativas de uma vez e checa conectividade EM PARALELO.
    // Antes era em série (até 40 chamadas encadeadas sem timeout), o que estourava
    // o limite de 150s de ociosidade da edge antes de qualquer resposta.
    const { data: allInstances } = await supabase
      .from('whatsapp_instances')
      .select('*')
      .eq('is_active', true)
      .limit(20)

    const list: any[] = allInstances || []
    const preferred = requestedInstanceId ? list.find((i) => i.id === requestedInstanceId) : null
    const ordered = preferred ? [preferred, ...list.filter((i) => i.id !== preferred.id)] : list

    const connectedFlags = await Promise.all(ordered.map((i) => isInstanceConnected(i)))
    const candidates = ordered.filter((_, idx) => connectedFlags[idx]).slice(0, MAX_CANDIDATES)

    if (candidates.length === 0) {
      return jsonResponse({ success: false, error: 'No connected WhatsApp instance available' }, 200)
    }

    let used: any = null
    let code: string | null = null
    let link: string | null = null
    let lastError: string | undefined
    const attempts: Array<{ instance: string; error?: string }> = []

    // Orçamento global: nunca chegar perto dos 150s da edge.
    const deadline = Date.now() + 90_000

    for (const inst of candidates) {
      if (Date.now() > deadline) {
        lastError = lastError || 'timeout while querying WhatsApp instances'
        break
      }
      const baseUrl = inst.base_url || 'https://abraci.uazapi.com'
      const result = await fetchGroupInvite(baseUrl, inst.instance_token, groupJid)
      attempts.push({ instance: inst.instance_name, error: result.error })
      if (result.code || result.link) {
        used = inst
        code = result.code
        link = result.link
        break
      }
      lastError = result.error || lastError
      console.warn(`[invite] instance "${inst.instance_name}" could not fetch link${result.error ? ': ' + result.error : ''}. Trying next…`)
    }

    if (!used) {
      return jsonResponse({
        success: false,
        error: lastError
          || 'Could not retrieve invite link (admin permission required or group not found)',
        attempts,
      }, 200)
    }

    const chosenFinal = used
    const inviteLink = link || `https://chat.whatsapp.com/${code}`

    // Persist link if a lead is provided (best-effort, non-blocking on errors).
    if (leadId) {
      try {
        await extClient
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
      invite_code: code || inviteLink.split('/').pop() || null,
      invite_link: inviteLink,
      instance_name: chosenFinal.instance_name,
      instance_id: chosenFinal.id,
      attempts_count: attempts.length,
      attempts,
    })
  } catch (e: any) {
    console.error('[get-group-invite-link] error', e)
    return jsonResponse({ success: false, error: e?.message || 'unknown error' }, 500)
  }
})
