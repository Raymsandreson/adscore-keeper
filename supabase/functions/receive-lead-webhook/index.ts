import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY
    const supabase = createClient(supabaseUrl, supabaseKey)

    const body = await req.json()
    console.log('Received webhook payload:', JSON.stringify(body))

    // Extract lead data from webhook payload
    // Supports both Zapier and Make formats
    const leadData = {
      lead_name: body.lead_name || body.full_name || body.name || body.field_data?.find((f: any) => f.name === 'full_name')?.values?.[0] || null,
      lead_email: body.lead_email || body.email || body.field_data?.find((f: any) => f.name === 'email')?.values?.[0] || null,
      lead_phone: body.lead_phone || body.phone || body.phone_number || body.field_data?.find((f: any) => f.name === 'phone_number')?.values?.[0] || null,
      facebook_lead_id: body.lead_id || body.facebook_lead_id || body.id || null,
      campaign_id: body.campaign_id || body.ad_campaign_id || null,
      campaign_name: body.campaign_name || body.ad_campaign_name || null,
      adset_id: body.adset_id || body.ad_adset_id || null,
      adset_name: body.adset_name || body.ad_adset_name || null,
      creative_id: body.creative_id || body.ad_id || null,
      creative_name: body.creative_name || body.ad_name || null,
      ad_account_id: body.ad_account_id || body.account_id || null,
      source: 'facebook',
      status: 'new',
      sync_status: 'synced',
      notes: body.notes || null,
    }

    console.log('Parsed lead data:', JSON.stringify(leadData))

    // Check if lead already exists by facebook_lead_id
    if (leadData.facebook_lead_id) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('facebook_lead_id', leadData.facebook_lead_id)
        .single()

      if (existingLead) {
        console.log('Lead already exists:', existingLead.id)
        return new Response(
          JSON.stringify({ success: true, message: 'Lead already exists', lead_id: existingLead.id }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Insert the new lead
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert([leadData])
      .select()
      .single()

    if (error) {
      console.error('Error inserting lead:', error)
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Lead inserted successfully:', newLead.id)
    return new Response(
      JSON.stringify({ success: true, message: 'Lead created', lead_id: newLead.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Webhook error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
