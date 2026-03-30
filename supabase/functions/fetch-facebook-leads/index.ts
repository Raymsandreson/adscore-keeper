import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


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

// Helper function to fetch leads from campaigns when leadgen_forms endpoint fails
async function fetchLeadsFromCampaigns(
  supabase: any,
  accessToken: string,
  adAccountId: string
): Promise<Response> {
  try {
    // Get campaigns with leads objective
    const campaignsResponse = await fetch(
      `https://graph.facebook.com/v19.0/${adAccountId}/campaigns?access_token=${accessToken}&fields=id,name,objective&limit=100`
    );

    if (!campaignsResponse.ok) {
      const errorData = await campaignsResponse.json();
      console.error('Error fetching campaigns:', errorData);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to fetch campaigns. Please check your permissions (ads_read required).',
          details: errorData 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const campaignsData = await campaignsResponse.json();
    const campaigns = campaignsData.data || [];
    console.log(`Found ${campaigns.length} campaigns`);

    // Filter for lead generation campaigns
    const leadCampaigns = campaigns.filter((c: { objective?: string }) => 
      c.objective === 'LEAD_GENERATION' || c.objective === 'OUTCOME_LEADS'
    );
    console.log(`Found ${leadCampaigns.length} lead generation campaigns`);

    let importedCount = 0;
    let duplicateCount = 0;

    // For each lead campaign, get ads and their leads
    for (const campaign of leadCampaigns) {
      // Get ads from this campaign
      const adsResponse = await fetch(
        `https://graph.facebook.com/v19.0/${campaign.id}/ads?access_token=${accessToken}&fields=id,name,adset_id,creative`
      );

      if (!adsResponse.ok) continue;

      const adsData = await adsResponse.json();
      const ads = adsData.data || [];

      for (const ad of ads) {
        // Try to get lead form from ad creative
        if (ad.creative?.id) {
          const creativeResponse = await fetch(
            `https://graph.facebook.com/v19.0/${ad.creative.id}?access_token=${accessToken}&fields=lead_gen_form_id`
          );

          if (creativeResponse.ok) {
            const creativeData = await creativeResponse.json();
            if (creativeData.lead_gen_form_id) {
              // Fetch leads from this form
              const leadsResponse = await fetch(
                `https://graph.facebook.com/v19.0/${creativeData.lead_gen_form_id}/leads?access_token=${accessToken}&fields=id,created_time,field_data,ad_id,adset_id,campaign_id`
              );

              if (leadsResponse.ok) {
                const leadsData = await leadsResponse.json();
                const leads = leadsData.data || [];

                for (const lead of leads) {
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

                  const leadName = fieldData['full_name'] || fieldData['nome'] || fieldData['name'] || fieldData['nome_completo'] || '';
                  const leadEmail = fieldData['email'] || fieldData['e-mail'] || '';
                  const leadPhone = fieldData['phone_number'] || fieldData['telefone'] || fieldData['phone'] || fieldData['celular'] || fieldData['whatsapp'] || '';

                  const { error: insertError } = await supabase
                    .from('leads')
                    .insert({
                      facebook_lead_id: lead.id,
                      lead_name: leadName,
                      lead_email: leadEmail,
                      lead_phone: leadPhone,
                      campaign_id: campaign.id,
                      campaign_name: campaign.name,
                      adset_id: lead.adset_id || ad.adset_id || null,
                      creative_id: ad.id,
                      ad_account_id: adAccountId.replace('act_', ''),
                      source: 'facebook_leads',
                      status: 'new',
                      sync_status: 'synced',
                      created_at: lead.created_time,
                    });

                  if (!insertError) importedCount++;
                }
              }
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported: importedCount,
        duplicates: duplicateCount,
        campaigns: leadCampaigns.length,
        message: 'Imported via campaigns approach'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in fetchLeadsFromCampaigns:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accessToken = Deno.env.get('FACEBOOK_CAPI_ACCESS_TOKEN');
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;

    if (!accessToken) {
      console.error('Missing FACEBOOK_CAPI_ACCESS_TOKEN');
      return new Response(
        JSON.stringify({ error: 'Missing Facebook access token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { adAccountId } = await req.json().catch(() => ({}));

    if (!adAccountId) {
      return new Response(
        JSON.stringify({ error: 'Ad Account ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format ad account ID (add act_ prefix if not present)
    const formattedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    console.log('Fetching lead forms for ad account:', formattedAdAccountId);

    // Step 1: Get all lead forms from the ad account using Marketing API
    const formsResponse = await fetch(
      `https://graph.facebook.com/v19.0/${formattedAdAccountId}/leadgen_forms?access_token=${accessToken}&fields=id,name,status`
    );

    if (!formsResponse.ok) {
      const errorData = await formsResponse.json();
      console.error('Error fetching lead forms:', errorData);
      
      // If leadgen_forms endpoint fails, try getting leads directly from campaigns
      console.log('Trying alternative approach: fetching from campaigns...');
      return await fetchLeadsFromCampaigns(supabase, accessToken, formattedAdAccountId);
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
