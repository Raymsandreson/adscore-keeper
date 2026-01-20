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

    // First, check what type of token we have by calling /me
    const meResponse = await fetch(
      `https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${accessToken}`
    );
    const meData = await meResponse.json();
    
    if (!meResponse.ok) {
      console.error('Token validation error:', meData);
      return new Response(
        JSON.stringify({ error: 'Token inválido', details: meData }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Token belongs to:', meData);

    // Try to get pages - this works with User tokens
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,instagram_business_account{id,username,profile_picture_url,followers_count,follows_count,media_count}&access_token=${accessToken}`
    );

    const pagesData = await pagesResponse.json();

    // If /me/accounts fails, the token might be a Page token
    // In that case, try to get the Instagram account directly from the page
    if (!pagesResponse.ok || pagesData.error) {
      console.log('Failed to get pages, trying direct page Instagram lookup...');
      
      // Try to get Instagram Business Account directly from the page
      const pageIgResponse = await fetch(
        `https://graph.facebook.com/v18.0/${meData.id}?fields=id,name,instagram_business_account{id,username,profile_picture_url,followers_count,follows_count,media_count}&access_token=${accessToken}`
      );
      
      const pageIgData = await pageIgResponse.json();
      
      if (!pageIgResponse.ok) {
        console.error('Page Instagram lookup error:', pageIgData);
        return new Response(
          JSON.stringify({ 
            error: 'Não foi possível buscar contas Instagram', 
            details: pageIgData,
            hint: 'Certifique-se de que o token tem permissões pages_read_engagement e instagram_basic'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // If this page has an Instagram account, return it
      if (pageIgData.instagram_business_account) {
        const instagramAccounts = [{
          page_id: pageIgData.id,
          page_name: pageIgData.name || meData.name,
          instagram_id: pageIgData.instagram_business_account.id,
          username: pageIgData.instagram_business_account.username,
          profile_picture_url: pageIgData.instagram_business_account.profile_picture_url,
          followers_count: pageIgData.instagram_business_account.followers_count,
          follows_count: pageIgData.instagram_business_account.follows_count,
          media_count: pageIgData.instagram_business_account.media_count,
        }];

        return new Response(
          JSON.stringify({ success: true, accounts: instagramAccounts }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          accounts: [],
          message: 'Nenhuma conta Instagram Business encontrada vinculada a esta página'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract Instagram accounts from pages (User token flow)
    const instagramAccounts = (pagesData.data || [])
      .filter((page: FacebookPage) => page.instagram_business_account)
      .map((page: FacebookPage) => ({
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
