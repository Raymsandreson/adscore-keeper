// Diagnóstico temporário: lista domínios verificados no Resend.
import { requireAdmin, forbidden } from "../_shared/require-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const admin = await requireAdmin(req);
  if (!admin) return forbidden(corsHeaders);

  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    return new Response(JSON.stringify({ success: false, error: 'RESEND_API_KEY ausente' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Equipe <noreply@familiaabraci.com.br>',
      to: ['delivered@resend.dev'],
      subject: 'Diagnostico de envio',
      html: '<p>diagnostico</p>',
    }),
  });
  const body = await r.text();
  return new Response(JSON.stringify({ success: r.ok, status: r.status, body: body.slice(0, 2000) }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
