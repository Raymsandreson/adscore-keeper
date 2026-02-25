import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InvitationRequest {
  email: string;
  role: string;
  invitedByName?: string;
  appUrl: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, role, invitedByName, appUrl }: InvitationRequest = await req.json();

    if (!email || !appUrl) {
      throw new Error("Email e URL do app são obrigatórios");
    }

    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY não configurada");
    }

    const roleLabel = role === 'admin' ? 'Administrador' : 'Membro';
    const inviterText = invitedByName ? `${invitedByName} convidou você` : 'Você foi convidado';

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
            <h1 style="color: #18181b; font-size: 24px; margin: 0 0 8px 0;">Convite para a Equipe</h1>
            <p style="color: #71717a; font-size: 16px; margin: 0;">${inviterText}</p>
          </div>
          
          <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <p style="color: #3f3f46; margin: 0 0 8px 0; font-size: 14px;">Você foi convidado como:</p>
            <p style="color: #18181b; font-weight: 600; font-size: 18px; margin: 0;">
              ${roleLabel}
            </p>
          </div>
          
          <p style="color: #52525b; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
            Clique no botão abaixo para criar sua conta e acessar o sistema. O convite expira em 7 dias.
          </p>
          
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${appUrl}" style="display: inline-block; background: #3b82f6; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Criar Conta
            </a>
          </div>
          
          <p style="color: #a1a1aa; font-size: 12px; text-align: center; margin: 0;">
            Se você não esperava este convite, pode ignorar este email.
          </p>
        </div>
      </body>
      </html>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Equipe <contato@familiaabraci.com.br>",
        to: [email],
        subject: `${inviterText} para a equipe`,
        html: emailHtml,
      }),
    });

    if (!res.ok) {
      const errorData = await res.text();
      console.error("Resend API error:", errorData);
      throw new Error(`Erro ao enviar email: ${errorData}`);
    }

    const emailResponse = await res.json();
    console.log("Invitation email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending invitation email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
