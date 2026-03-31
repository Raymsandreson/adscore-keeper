import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const cloudFunctionsUrl = Deno.env.get('SUPABASE_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co'
const cloudAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = RESOLVED_SUPABASE_URL;
  const serviceRoleKey = RESOLVED_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Find all pending tokens that haven't been submitted, haven't expired,
    // haven't reached max reminders, and haven't been reminded in last 24h
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const { data: pendingTokens, error: fetchError } = await supabase
      .from("expense_form_tokens")
      .select("*")
      .is("submitted_at", null)
      .gt("expires_at", now.toISOString())
      .lt("reminder_count", 3) // default max_reminders
      .or(`last_reminder_at.is.null,last_reminder_at.lt.${twentyFourHoursAgo.toISOString()}`);

    if (fetchError) throw fetchError;

    if (!pendingTokens || pendingTokens.length === 0) {
      return new Response(JSON.stringify({ success: true, reminders_sent: 0, message: "Nenhum lembrete pendente" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sentCount = 0;
    const errors: string[] = [];

    for (const token of pendingTokens) {
      try {
        // Get phone from token or look up via card_assignments → contacts
        let phone = token.contact_phone;
        let contactName = token.contact_name;
        let contactId: string | null = null;
        let leadId: string | null = null;

        if (!phone) {
          // Look up card assignment
          const { data: assignment } = await supabase
            .from("card_assignments")
            .select("contact_id, lead_id, card_name")
            .eq("card_last_digits", token.card_last_digits)
            .maybeSingle();

          if (!assignment?.contact_id) {
            console.log(`No contact for card ${token.card_last_digits}, skipping`);
            continue;
          }

          contactId = assignment.contact_id;
          leadId = assignment.lead_id;

          const { data: contact } = await supabase
            .from("contacts")
            .select("phone, full_name")
            .eq("id", assignment.contact_id)
            .single();

          if (!contact?.phone) {
            console.log(`Contact ${contact?.full_name} has no phone, skipping`);
            continue;
          }

          phone = contact.phone;
          contactName = contact.full_name;

          // Save phone/name on token for future reminders (avoid repeated lookups)
          await supabase
            .from("expense_form_tokens")
            .update({ contact_phone: phone, contact_name: contactName })
            .eq("id", token.id);
        }

        // Count pending transactions
        let txCount = 0;
        if (token.transaction_ids && token.transaction_ids.length > 0) {
          txCount = token.transaction_ids.length;
        } else {
          const { count } = await supabase
            .from("credit_card_transactions")
            .select("id", { count: "exact", head: true })
            .eq("card_last_digits", token.card_last_digits)
            .gte("transaction_date", token.date_from)
            .lte("transaction_date", token.date_to);
          txCount = count || 0;
        }

        const reminderNumber = token.reminder_count + 1;
        const link = `https://adscore-keeper.lovable.app/expense-form/${token.token}`;

        const urgencyEmoji = reminderNumber >= 3 ? "🚨" : reminderNumber >= 2 ? "⚠️" : "🔔";
        const urgencyText = reminderNumber >= 3
          ? "Este é o *último lembrete*!"
          : reminderNumber >= 2
            ? "Este é o *segundo lembrete*."
            : "Lembrete automático.";

        const message = `${urgencyEmoji} *Lembrete: Despesas pendentes de classificação*\n\n${urgencyText}\n\nCartão: *****${token.card_last_digits}*\nTransações pendentes: *${txCount}*\nPeríodo: ${token.date_from} a ${token.date_to}\n\nPor favor, cadastre o lead e a categoria de cada despesa:\n\n👉 ${link}`;

        // Send via WhatsApp
        const sendResponse = await fetch(`${cloudFunctionsUrl}/functions/v1/send-whatsapp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            phone,
            message,
            contact_id: contactId,
            lead_id: leadId,
          }),
        });

        if (!sendResponse.ok) {
          const errText = await sendResponse.text();
          errors.push(`Card ${token.card_last_digits}: ${errText}`);
          continue;
        }

        // Update reminder count
        await supabase
          .from("expense_form_tokens")
          .update({
            reminder_count: reminderNumber,
            last_reminder_at: now.toISOString(),
          })
          .eq("id", token.id);

        sentCount++;
        console.log(`Reminder #${reminderNumber} sent to ${contactName} (${phone}) for card ${token.card_last_digits}`);
      } catch (innerErr: any) {
        errors.push(`Token ${token.id}: ${innerErr.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        reminders_sent: sentCount,
        total_pending: pendingTokens.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Reminder error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
