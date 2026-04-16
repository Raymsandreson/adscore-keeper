import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, redirectTo } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: 'Email é obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY não configurada' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use admin client to generate recovery link
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Check if user exists
    const { data: listData } = await supabase.auth.admin.listUsers();
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = listData?.users?.find(
      (u) => u.email?.toLowerCase().trim() === normalizedEmail
    );

    if (!existingUser) {
      // Return success anyway to avoid email enumeration
      console.log(`[RESET] User not found for email: ${normalizedEmail}`);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate a magic link for password recovery
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: {
        redirectTo: redirectTo || `${supabaseUrl.replace('.supabase.co', '.lovable.app')}/reset-password`,
      },
    });

    if (linkError) {
      console.error('[RESET] Error generating recovery link:', linkError);
      return new Response(JSON.stringify({ error: linkError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The action_link contains the full recovery URL
    const recoveryLink = linkData?.properties?.action_link;
    if (!recoveryLink) {
      console.error('[RESET] No action_link returned');
      return new Response(JSON.stringify({ error: 'Falha ao gerar link de recuperação' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[RESET] Recovery link generated for: ${normalizedEmail}`);

    // Send email via Resend
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; margin: 0; padding: 40px 20px;">
        <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 32px;">
            <div style="display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">
              <span style="font-size: 28px; font-weight: 300; color: #18181b;">whats</span>
              <span style="font-size: 28px; font-weight: 700; color: white; background: hsl(153, 100%, 33%); padding: 2px 8px; border-radius: 6px;">JUD</span>
            </div>
            <h1 style="color: #18181b; font-size: 22px; margin: 0 0 8px 0;">Redefinição de Senha</h1>
            <p style="color: #71717a; font-size: 15px; margin: 0;">Recebemos uma solicitação para redefinir sua senha</p>
          </div>
          
          <p style="color: #52525b; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
            Clique no botão abaixo para criar uma nova senha. Este link expira em 1 hora.
          </p>
          
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${recoveryLink}" style="display: inline-block; background: hsl(153, 100%, 33%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Redefinir Senha
            </a>
          </div>
          
          <p style="color: #a1a1aa; font-size: 12px; text-align: center; margin: 0;">
            Se você não solicitou esta redefinição, pode ignorar este email com segurança.
          </p>
        </div>
      </body>
      </html>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "WhatsJUD <noreply@familiaabraci.com.br>",
        to: [normalizedEmail],
        subject: "Redefinir sua senha - WhatsJUD",
        html: emailHtml,
      }),
    });

    if (!resendRes.ok) {
      const errorData = await resendRes.text();
      console.error("[RESET] Resend API error:", errorData);
      return new Response(JSON.stringify({ error: `Erro ao enviar email: ${errorData}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resendData = await resendRes.json();
    console.log("[RESET] ✅ Password reset email sent:", resendData.id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error("[RESET] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
