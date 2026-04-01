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
    const { email, password, full_name } = await req.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'email and password required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use CLOUD Supabase (not external) - this is where auth lives
    const cloudUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(cloudUrl, serviceKey);

    // Try to create user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name || '' },
    });

    if (createError) {
      // If user already exists, update password
      if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
        const { data: listData } = await supabase.auth.admin.listUsers();
        const existing = listData?.users?.find(u => u.email === email.toLowerCase().trim());
        
        if (existing) {
          const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
            password,
            email_confirm: true,
          });
          
          if (updateError) {
            return new Response(JSON.stringify({ error: updateError.message }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          return new Response(JSON.stringify({ ok: true, status: 'password_reset', user_id: existing.id }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, status: 'created', user_id: newUser.user?.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
