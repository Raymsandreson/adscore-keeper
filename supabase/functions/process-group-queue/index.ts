import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const cloudFunctionsUrl = Deno.env.get('SUPABASE_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co'
const cloudAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY)

    // Get pending items (max 5 at a time)
    const { data: pendingItems, error } = await supabase
      .from('group_creation_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5)

    if (error) throw error
    if (!pendingItems?.length) {
      return new Response(JSON.stringify({ processed: 0, message: 'No pending items' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: any[] = []

    for (const item of pendingItems) {
      // Mark as processing
      await supabase
        .from('group_creation_queue')
        .update({ status: 'processing', attempts: item.attempts + 1 })
        .eq('id', item.id)

      try {
        // Call create-whatsapp-group
        const res = await fetch(`${cloudFunctionsUrl}/functions/v1/create-whatsapp-group`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cloudAnonKey}`,
          },
          body: JSON.stringify({
            lead_id: item.lead_id,
            lead_name: item.lead_name,
            phone: item.phone,
            contact_phone: item.contact_phone,
            board_id: item.board_id,
            creator_instance_id: item.creator_instance_id,
          }),
        })

        const data = await res.json()

        if (data.success) {
          await supabase
            .from('group_creation_queue')
            .update({ status: 'completed', processed_at: new Date().toISOString() })
            .eq('id', item.id)
          results.push({ id: item.id, status: 'completed' })
        } else if (data.queued) {
          // Still no instances available, keep as pending
          await supabase
            .from('group_creation_queue')
            .update({ status: 'pending', last_error: data.error })
            .eq('id', item.id)
          results.push({ id: item.id, status: 'still_pending' })
        } else {
          // Real error
          const newStatus = item.attempts + 1 >= 10 ? 'failed' : 'pending'
          await supabase
            .from('group_creation_queue')
            .update({ status: newStatus, last_error: data.error || 'Unknown error' })
            .eq('id', item.id)
          results.push({ id: item.id, status: newStatus })
        }
      } catch (err: any) {
        const newStatus = item.attempts + 1 >= 10 ? 'failed' : 'pending'
        await supabase
          .from('group_creation_queue')
          .update({ status: newStatus, last_error: err.message })
          .eq('id', item.id)
        results.push({ id: item.id, status: newStatus, error: err.message })
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
