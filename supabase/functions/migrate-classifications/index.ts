import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all instagram_comments with prospect_classification
    const { data: comments, error: commentsError } = await supabase
      .from("instagram_comments")
      .select("author_username, prospect_classification")
      .not("prospect_classification", "is", null)
      .not("author_username", "is", null);

    if (commentsError) {
      throw commentsError;
    }

    // Group classifications by username
    const classificationsByUsername: Record<string, Set<string>> = {};
    
    for (const comment of comments || []) {
      if (!comment.author_username || !comment.prospect_classification) continue;
      
      const username = comment.author_username.toLowerCase();
      if (!classificationsByUsername[username]) {
        classificationsByUsername[username] = new Set();
      }
      
      // prospect_classification is an array
      const classifications = comment.prospect_classification as string[];
      for (const c of classifications) {
        if (c && c.trim()) {
          classificationsByUsername[username].add(c.trim());
        }
      }
    }

    const usernames = Object.keys(classificationsByUsername);
    let migrated = 0;
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const username of usernames) {
      const newClassifications = Array.from(classificationsByUsername[username]);
      if (newClassifications.length === 0) continue;

      // Check if contact exists
      const { data: existingContact } = await supabase
        .from("contacts")
        .select("id, classifications")
        .ilike("instagram_username", username)
        .maybeSingle();

      if (existingContact) {
        // Merge classifications
        const existingClassifications = existingContact.classifications || [];
        const mergedSet = new Set([...existingClassifications, ...newClassifications]);
        const mergedClassifications = Array.from(mergedSet);

        const { error: updateError } = await supabase
          .from("contacts")
          .update({ classifications: mergedClassifications })
          .eq("id", existingContact.id);

        if (updateError) {
          console.error(`Error updating contact ${username}:`, updateError);
          errors++;
        } else {
          updated++;
          migrated++;
        }
      } else {
        // Create new contact
        const { error: insertError } = await supabase
          .from("contacts")
          .insert({
            full_name: username,
            instagram_username: username,
            classifications: newClassifications,
            classification: newClassifications[0] || "prospect",
          });

        if (insertError) {
          console.error(`Error creating contact ${username}:`, insertError);
          errors++;
        } else {
          created++;
          migrated++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalUsernames: usernames.length,
        migrated,
        created,
        updated,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Migration error:", error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
