// Edge function TEMPORÁRIA — revela GOOGLE_MAIL_API_KEY* pro usuário autorizado.
// APAGAR depois de copiar pro Railway.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const AUTHORIZED_USER_ID = "981d9d44-97d8-480e-9d22-92d26babf992";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user || user.id !== AUTHORIZED_USER_ID) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Coleta TODAS as env vars que começam com GOOGLE_MAIL_API_KEY + a LOVABLE_API_KEY
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(Deno.env.toObject())) {
      if (k.startsWith("GOOGLE_MAIL_API_KEY") || k === "LOVABLE_API_KEY") {
        result[k] = v;
      }
    }

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
