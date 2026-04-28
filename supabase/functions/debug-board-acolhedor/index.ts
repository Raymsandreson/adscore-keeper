import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(resolveSupabaseUrl(), resolveServiceRoleKey());

    const { data: boards } = await supabase
      .from("kanban_boards")
      .select("id, name");

    const { data: settings } = await supabase
      .from("board_group_settings")
      .select("board_id, post_sign_mode, processual_acolhedor_id, auto_close_lead_on_sign, auto_create_group_on_sign");

    // Get profiles for all processual_acolhedor_ids
    const ids = (settings || []).map((s: any) => s.processual_acolhedor_id).filter(Boolean);
    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("user_id, full_name").in("user_id", ids)
      : { data: [] };

    const profMap = new Map((profiles || []).map((p: any) => [p.user_id, p.full_name]));
    const boardMap = new Map((boards || []).map((b: any) => [b.id, b.name]));

    const result = (settings || []).map((s: any) => ({
      board_id: s.board_id,
      board_name: boardMap.get(s.board_id) || "(unknown)",
      post_sign_mode: s.post_sign_mode,
      processual_acolhedor_id: s.processual_acolhedor_id,
      processual_acolhedor_name: s.processual_acolhedor_id ? profMap.get(s.processual_acolhedor_id) : null,
      auto_close_lead_on_sign: s.auto_close_lead_on_sign,
      auto_create_group_on_sign: s.auto_create_group_on_sign,
    }));

    return new Response(JSON.stringify({ success: true, boards_with_settings: result }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
