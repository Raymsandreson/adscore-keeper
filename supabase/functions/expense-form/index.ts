import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { action, token, responses } = await req.json();

    if (action === "validate") {
      // Validate token and return transactions
      const { data: tokenData, error: tokenError } = await supabase
        .from("expense_form_tokens")
        .select("*")
        .eq("token", token)
        .maybeSingle();

      if (tokenError || !tokenData) {
        return new Response(JSON.stringify({ error: "Link inválido ou não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (tokenData.submitted_at) {
        return new Response(JSON.stringify({ error: "Este formulário já foi preenchido", already_submitted: true }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (new Date(tokenData.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: "Este link expirou" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch transactions for this card/period
      let query = supabase
        .from("credit_card_transactions")
        .select("id, pluggy_transaction_id, description, amount, transaction_date, merchant_name, merchant_city, merchant_state, card_last_digits, category")
        .eq("card_last_digits", tokenData.card_last_digits)
        .gte("transaction_date", tokenData.date_from)
        .lte("transaction_date", tokenData.date_to)
        .order("transaction_date", { ascending: false });

      // If specific transaction IDs, filter by them
      if (tokenData.transaction_ids && tokenData.transaction_ids.length > 0) {
        query = query.in("pluggy_transaction_id", tokenData.transaction_ids);
      }

      const { data: transactions, error: txError } = await query;

      if (txError) {
        throw txError;
      }

      // Get existing overrides for these transactions
      const txIds = (transactions || []).map((t: any) => t.id);
      const { data: overrides } = await supabase
        .from("transaction_category_overrides")
        .select("transaction_id, category_id, notes, manual_city, manual_state, lead_id")
        .in("transaction_id", txIds);

      // Get existing form responses
      const { data: existingResponses } = await supabase
        .from("expense_form_responses")
        .select("transaction_id")
        .eq("token_id", tokenData.id);

      const respondedTxIds = new Set((existingResponses || []).map((r: any) => r.transaction_id));

      // Get expense categories
      const { data: categories } = await supabase
        .from("expense_categories")
        .select("id, name, parent_id, color, icon")
        .order("display_order");

      // Get card assignment info
      const { data: cardAssignment } = await supabase
        .from("card_assignments")
        .select("card_name, lead_name")
        .eq("card_last_digits", tokenData.card_last_digits)
        .maybeSingle();

      return new Response(JSON.stringify({
        token: tokenData,
        transactions: transactions || [],
        overrides: overrides || [],
        categories: categories || [],
        cardAssignment,
        respondedTransactionIds: Array.from(respondedTxIds),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "submit") {
      // Validate token again
      const { data: tokenData, error: tokenError } = await supabase
        .from("expense_form_tokens")
        .select("*")
        .eq("token", token)
        .maybeSingle();

      if (tokenError || !tokenData) {
        return new Response(JSON.stringify({ error: "Link inválido" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (tokenData.submitted_at) {
        return new Response(JSON.stringify({ error: "Já preenchido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!responses || !Array.isArray(responses) || responses.length === 0) {
        return new Response(JSON.stringify({ error: "Nenhuma resposta enviada" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Insert responses
      const formResponses = responses.map((r: any) => ({
        token_id: tokenData.id,
        transaction_id: r.transaction_id,
        description: r.description?.trim()?.substring(0, 500) || null,
        category: r.category || null,
        city: r.city?.trim()?.substring(0, 100) || null,
        state: r.state?.trim()?.substring(0, 2) || null,
        lead_name: r.lead_name?.trim()?.substring(0, 200) || null,
      }));

      const { error: insertError } = await supabase
        .from("expense_form_responses")
        .upsert(formResponses, { onConflict: "token_id,transaction_id" });

      if (insertError) throw insertError;

      // Update transaction_category_overrides with the descriptions/cities/states
      for (const r of responses) {
        if (r.description || r.city || r.state || r.category) {
          const updateData: any = {};
          if (r.description) updateData.notes = r.description;
          if (r.city) updateData.manual_city = r.city;
          if (r.state) updateData.manual_state = r.state;
          if (r.category) updateData.category_id = r.category;

          // Check if override exists
          const { data: existing } = await supabase
            .from("transaction_category_overrides")
            .select("id")
            .eq("transaction_id", r.transaction_id)
            .maybeSingle();

          if (existing) {
            await supabase
              .from("transaction_category_overrides")
              .update(updateData)
              .eq("id", existing.id);
          } else if (r.category) {
            await supabase
              .from("transaction_category_overrides")
              .insert({
                transaction_id: r.transaction_id,
                category_id: r.category,
                notes: r.description || null,
                manual_city: r.city || null,
                manual_state: r.state || null,
              });
          }
        }
      }

      // Mark token as submitted
      await supabase
        .from("expense_form_tokens")
        .update({ submitted_at: new Date().toISOString() })
        .eq("id", tokenData.id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Ação inválida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
