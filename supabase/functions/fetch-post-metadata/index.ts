import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PostMetadataRequest {
  postUrl: string;
}

// Extract shortcode from Instagram URL
function extractShortcode(url: string): string | null {
  const match = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
  return match ? match[2] : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: PostMetadataRequest = await req.json();
    const { postUrl } = body;
    
    if (!postUrl) {
      throw new Error("postUrl é obrigatório");
    }

    // Normalize URL
    let normalizedUrl = postUrl.trim();
    normalizedUrl = normalizedUrl.replace(/\/reels\//gi, '/reel/');
    normalizedUrl = normalizedUrl.replace(/\/$/, '');
    
    const shortcode = extractShortcode(normalizedUrl);

    console.log(`🔍 Buscando metadados do post: ${normalizedUrl} (shortcode: ${shortcode})`);

    // Try multiple methods in order of reliability
    let metadata = null;

    // Helper to decode HTML entities (handles multiple levels of escaping)
    const decodeHtmlEntities = (text: string): string => {
      if (!text) return "";
      let decoded = text;
      let prevDecoded = "";
      
      // Keep decoding until no more changes (handles multiple escape levels)
      while (decoded !== prevDecoded) {
        prevDecoded = decoded;
        decoded = decoded
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&#39;/g, "'")
          // Decode hex entities &#xNN;
          .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          // Decode decimal entities &#NNN;
          .replace(/&#([0-9]+);/g, (_, num) => String.fromCharCode(parseInt(num)));
      }
      return decoded;
    };

    // Helper to extract username from title like "X likes, Y comments - username on Date: ..."
    const extractUsernameFromTitle = (title: string): string => {
      // Pattern: "5,107 likes, 256 comments - jornaldaeptvcampinas on February 3, 2026"
      const match = title.match(/[\d,]+\s+likes?,?\s*[\d,]+\s+comments?\s*-\s*([a-zA-Z0-9_.]+)\s+on\s+/i);
      if (match) return match[1];
      
      // Fallback: "username on Instagram"
      const match2 = title.match(/^([a-zA-Z0-9_.]+)\s+on\s+Instagram/i);
      return match2 ? match2[1] : "";
    };

    // Method 1: Try Iframely (free, reliable)
    try {
      const iframelyUrl = `https://iframe.ly/api/oembed?url=${encodeURIComponent(normalizedUrl)}&api_key=free`;
      const iframelyResponse = await fetch(iframelyUrl);
      
      if (iframelyResponse.ok) {
        const data = await iframelyResponse.json();
        console.log(`✅ Iframely success:`, { title: data.title?.substring(0, 50), thumbnail: !!data.thumbnail_url, author: data.author_name });
        
        const rawCaption = data.title || data.description || "";
        const cleanCaption = decodeHtmlEntities(rawCaption);
        const extractedUsername = extractUsernameFromTitle(rawCaption) || data.author_name || "";
        
        // Clean the thumbnail URL (remove HTML entity encoding)
        const cleanThumbnail = data.thumbnail_url ? decodeHtmlEntities(data.thumbnail_url) : null;
        
        metadata = {
          caption: cleanCaption,
          thumbnailUrl: cleanThumbnail,
          ownerUsername: extractedUsername,
          mediaType: rawCaption.toLowerCase().includes('video') || normalizedUrl.includes('/reel') ? 'video' as const : 'image' as const,
        };
      }
    } catch (e) {
      console.log(`⚠️ Iframely failed:`, e);
    }

    // Method 2: Try fetching the page HTML directly and parsing meta tags
    if (!metadata?.thumbnailUrl) {
      try {
        console.log(`📄 Fetching page HTML...`);
        const pageResponse = await fetch(normalizedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });
        
        if (pageResponse.ok) {
          const html = await pageResponse.text();
          
          // Extract Open Graph meta tags
          const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1] ||
                          html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/)?.[1];
          const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/)?.[1] ||
                          html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/)?.[1];
          const ogDescription = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/)?.[1] ||
                                html.match(/<meta\s+content="([^"]+)"\s+property="og:description"/)?.[1];
          
          // Try to extract username from URL or page
          const usernameMatch = html.match(/"owner":\s*\{\s*"username":\s*"([^"]+)"/);
          const authorUsername = usernameMatch?.[1] || 
                                 normalizedUrl.match(/instagram\.com\/([^\/]+)\//)?.[1] || "";

          if (ogImage || ogDescription) {
            console.log(`✅ HTML parsing success:`, { 
              hasImage: !!ogImage, 
              hasDesc: !!ogDescription?.substring(0, 30) 
            });
            
            metadata = {
              caption: ogDescription || ogTitle || metadata?.caption || "",
              thumbnailUrl: ogImage || metadata?.thumbnailUrl || null,
              ownerUsername: authorUsername || metadata?.ownerUsername || "",
              mediaType: normalizedUrl.includes('/reel') ? 'video' as const : 'image' as const,
            };
          }
        }
      } catch (e) {
        console.log(`⚠️ HTML fetch failed:`, e);
      }
    }

    // Method 3: Try Instagram's __a=1 endpoint (may be blocked but worth trying)
    if (!metadata?.thumbnailUrl && shortcode) {
      try {
        console.log(`🔗 Trying Instagram API endpoint...`);
        const apiUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
        const apiResponse = await fetch(apiUrl, {
          headers: {
            'User-Agent': 'Instagram 123.0.0.21.114',
          },
        });
        
        if (apiResponse.ok) {
          const data = await apiResponse.json();
          const item = data?.items?.[0] || data?.graphql?.shortcode_media;
          
          if (item) {
            console.log(`✅ Instagram API success`);
            metadata = {
              caption: item.caption?.text || item.edge_media_to_caption?.edges?.[0]?.node?.text || metadata?.caption || "",
              thumbnailUrl: item.image_versions2?.candidates?.[0]?.url || 
                           item.display_url || 
                           item.thumbnail_src || 
                           metadata?.thumbnailUrl || null,
              ownerUsername: item.user?.username || item.owner?.username || metadata?.ownerUsername || "",
              mediaType: item.media_type === 2 || item.is_video ? 'video' as const : 'image' as const,
            };
          }
        }
      } catch (e) {
        console.log(`⚠️ Instagram API failed:`, e);
      }
    }

    // If we got metadata, return it
    if (metadata && (metadata.thumbnailUrl || metadata.caption)) {
      console.log(`✅ Final metadata:`, {
        caption: metadata.caption?.substring(0, 50) + "...",
        thumbnailUrl: metadata.thumbnailUrl ? "presente" : "ausente",
        owner: metadata.ownerUsername,
      });

      return new Response(
        JSON.stringify({
          success: true,
          metadata,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // No metadata found
    console.log(`❌ Could not fetch metadata for: ${normalizedUrl}`);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Não foi possível obter metadados do post",
        metadata: null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Erro:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        metadata: null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }
});
