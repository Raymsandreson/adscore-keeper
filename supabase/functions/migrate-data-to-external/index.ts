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
    const { table, batch_size = 500, offset = 0 } = await req.json();

    // Internal DB (Lovable Cloud - source)
    const internalUrl = Deno.env.get('SUPABASE_URL')!;
    const internalKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const internalClient = createClient(internalUrl, internalKey);

    // External DB (destination)
    const externalUrl = Deno.env.get('EXTERNAL_SUPABASE_URL')!;
    const externalKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY')!;
    const externalClient = createClient(externalUrl, externalKey);

    const allowedTables = ['whatsapp_messages', 'webhook_logs', 'contacts', 'whatsapp_command_history'];
    if (!allowedTables.includes(table)) {
      return new Response(JSON.stringify({ error: `Tabela não permitida: ${table}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get total count
    const { count: totalCount } = await internalClient
      .from(table)
      .select('*', { count: 'exact', head: true });

    // Fetch batch from internal
    const { data: rows, error: fetchError } = await internalClient
      .from(table)
      .select('*')
      .range(offset, offset + batch_size - 1)
      .order('created_at', { ascending: true });

    if (fetchError) {
      return new Response(JSON.stringify({ error: `Erro ao ler ${table}: ${fetchError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: `Migração de ${table} concluída!`,
        total: totalCount,
        migrated: offset,
        done: true,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert batch into external (using id as conflict key)
    const { error: insertError } = await externalClient
      .from(table)
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

    if (insertError) {
      return new Response(JSON.stringify({
        error: `Erro ao inserir em ${table}: ${insertError.message}`,
        offset,
        batch_size,
        rows_in_batch: rows.length,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const nextOffset = offset + rows.length;
    const done = rows.length < batch_size;

    return new Response(JSON.stringify({
      success: true,
      table,
      migrated_this_batch: rows.length,
      total: totalCount,
      next_offset: done ? null : nextOffset,
      done,
      progress_percent: totalCount ? Math.round((nextOffset / totalCount) * 100) : 100,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
