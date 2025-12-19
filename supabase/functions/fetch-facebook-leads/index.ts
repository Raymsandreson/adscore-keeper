import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FacebookLead {
  id: string;
  created_time: string;
  field_data: Array<{
    name: string;
    values: string[];
  }>;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  form_id?: string;
}

interface FacebookLeadForm {
  id: string;
  name: string;
  status: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accessToken = Deno.env.get('FACEBOOK_CAPI_ACCESS_TOKEN');
    const pageId = Deno.env.get('FACEBOOK_PAGE_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!accessToken || !pageId) {
      console.error('Missing required environment variables');
      return new Response(
        JSON.stringify({ error: 'Missing Facebook configuration' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { adAccountId } = await req.json().catch(() => ({}));

    console.log('Fetching lead forms for page:', pageId);

    // Step 1: Get all lead forms from the page
    const formsResponse = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?access_token=${accessToken}&fields=id,name,status`
    );

    if (!formsResponse.ok) {
      const errorData = await formsResponse.json();
      console.error('Error fetching lead forms:', errorData);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch lead forms', details: errorData }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const formsData = await formsResponse.json();
    const forms: FacebookLeadForm[] = formsData.data || [];
    console.log(`Found ${forms.length} lead forms`);

    let allLeads: FacebookLead[] = [];
    let importedCount = 0;
    let duplicateCount = 0;

    // Step 2: For each form, fetch the leads
    for (const form of forms) {
      console.log(`Fetching leads from form: ${form.name} (${form.id})`);
      
      let nextUrl = `https://graph.facebook.com/v19.0/${form.id}/leads?access_token=${accessToken}&fields=id,created_time,field_data,ad_id,adset_id,campaign_id,form_id`;
      
      while (nextUrl) {
        const leadsResponse = await fetch(nextUrl);
        
        if (!leadsResponse.ok) {
          const errorData = await leadsResponse.json();
          console.error(`Error fetching leads from form ${form.id}:`, errorData);
          break;
        }

        const leadsData = await leadsResponse.json();
        const leads: FacebookLead[] = leadsData.data || [];
        allLeads = [...allLeads, ...leads];
        
        // Handle pagination
        nextUrl = leadsData.paging?.next || null;
      }
    }

    console.log(`Total leads fetched: ${allLeads.length}`);

    // Step 3: Process and save leads to Supabase
    for (const lead of allLeads) {
      // Check if lead already exists
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('facebook_lead_id', lead.id)
        .single();

      if (existingLead) {
        duplicateCount++;
        continue;
      }

      // Extract field data
      const fieldData: Record<string, string> = {};
      for (const field of lead.field_data || []) {
        fieldData[field.name.toLowerCase()] = field.values[0] || '';
      }

      // Map common field names
      const leadName = fieldData['full_name'] || fieldData['nome'] || fieldData['name'] || fieldData['nome_completo'] || '';
      const leadEmail = fieldData['email'] || fieldData['e-mail'] || '';
      const leadPhone = fieldData['phone_number'] || fieldData['telefone'] || fieldData['phone'] || fieldData['celular'] || fieldData['whatsapp'] || '';

      // Get campaign/adset names if available
      let campaignName = '';
      let adsetName = '';

      if (lead.campaign_id) {
        try {
          const campaignResponse = await fetch(
            `https://graph.facebook.com/v19.0/${lead.campaign_id}?access_token=${accessToken}&fields=name`
          );
          if (campaignResponse.ok) {
            const campaignData = await campaignResponse.json();
            campaignName = campaignData.name || '';
          }
        } catch (e) {
          console.error('Error fetching campaign name:', e);
        }
      }

      if (lead.adset_id) {
        try {
          const adsetResponse = await fetch(
            `https://graph.facebook.com/v19.0/${lead.adset_id}?access_token=${accessToken}&fields=name`
          );
          if (adsetResponse.ok) {
            const adsetData = await adsetResponse.json();
            adsetName = adsetData.name || '';
          }
        } catch (e) {
          console.error('Error fetching adset name:', e);
        }
      }

      // Insert lead into Supabase
      const { error: insertError } = await supabase
        .from('leads')
        .insert({
          facebook_lead_id: lead.id,
          lead_name: leadName,
          lead_email: leadEmail,
          lead_phone: leadPhone,
          campaign_id: lead.campaign_id || null,
          campaign_name: campaignName,
          adset_id: lead.adset_id || null,
          adset_name: adsetName,
          creative_id: lead.ad_id || null,
          ad_account_id: adAccountId || null,
          source: 'facebook_leads',
          status: 'new',
          sync_status: 'synced',
          created_at: lead.created_time,
        });

      if (insertError) {
        console.error('Error inserting lead:', insertError);
      } else {
        importedCount++;
      }
    }

    console.log(`Import complete: ${importedCount} new, ${duplicateCount} duplicates`);

    return new Response(
      JSON.stringify({
        success: true,
        totalFetched: allLeads.length,
        imported: importedCount,
        duplicates: duplicateCount,
        forms: forms.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in fetch-facebook-leads:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
