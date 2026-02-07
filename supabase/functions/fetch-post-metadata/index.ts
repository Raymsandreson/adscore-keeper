import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PostMetadataRequest {
  postUrl: string;
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

    // Normalizar URL
    let normalizedUrl = postUrl.trim();
    normalizedUrl = normalizedUrl.replace(/\/reels\//gi, '/reel/');
    normalizedUrl = normalizedUrl.replace(/\/$/, '');

    console.log(`🔍 Buscando metadados do post via oEmbed: ${normalizedUrl}`);

    // Use Instagram oEmbed API (free, no auth required)
    const oEmbedUrl = `https://api.instagram.com/oembed?url=${encodeURIComponent(normalizedUrl)}`;
    
    const response = await fetch(oEmbedUrl);
    
    if (!response.ok) {
      console.error(`oEmbed error: ${response.status}`);
      throw new Error(`Não foi possível obter metadados: ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log(`📦 oEmbed response:`, {
      title: data.title?.substring(0, 50),
      author: data.author_name,
      thumbnail: data.thumbnail_url ? 'present' : 'absent',
    });

    // Extract metadata from oEmbed response
    const metadata = {
      caption: data.title || "",
      thumbnailUrl: data.thumbnail_url || null,
      thumbnailWidth: data.thumbnail_width,
      thumbnailHeight: data.thumbnail_height,
      ownerUsername: data.author_name || "",
      authorUrl: data.author_url || "",
      mediaType: data.media_id?.includes('video') ? 'video' as const : 'image' as const,
      html: data.html || null,
    };

    console.log(`✅ Metadados extraídos via oEmbed:`, {
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

  } catch (error: any) {
    console.error("Erro:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        metadata: null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 } // Return 200 so client can handle gracefully
    );
  }
});
