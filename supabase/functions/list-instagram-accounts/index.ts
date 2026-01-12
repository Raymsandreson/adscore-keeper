import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FacebookPage {
  id: string;
  name: string;
  instagram_business_account?: {
    id: string;
    username: string;
    profile_picture_url: string;
    followers_count: number;
    follows_count: number;
    media_count: number;
  };
}

interface PagesResponse {
  data: FacebookPage[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accessToken = Deno.env.get('META_ACCESS_TOKEN');

    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'META_ACCESS_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all pages connected to the token and their Instagram accounts
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,instagram_business_account{id,username,profile_picture_url,followers_count,follows_count,media_count}&access_token=${accessToken}`
    );

    const pagesData: PagesResponse = await pagesResponse.json();

    if (!pagesResponse.ok) {
      console.error('Facebook API error:', pagesData);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch pages', details: pagesData }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract Instagram accounts from pages
    const instagramAccounts = pagesData.data
      .filter(page => page.instagram_business_account)
      .map(page => ({
        page_id: page.id,
        page_name: page.name,
        instagram_id: page.instagram_business_account!.id,
        username: page.instagram_business_account!.username,
        profile_picture_url: page.instagram_business_account!.profile_picture_url,
        followers_count: page.instagram_business_account!.followers_count,
        follows_count: page.instagram_business_account!.follows_count,
        media_count: page.instagram_business_account!.media_count,
      }));

    return new Response(
      JSON.stringify({ 
        success: true, 
        accounts: instagramAccounts 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
