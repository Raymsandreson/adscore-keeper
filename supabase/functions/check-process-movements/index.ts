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
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = RESOLVED_SUPABASE_URL;
  const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Get all active monitors
    const { data: monitors, error: monErr } = await supabase
      .from('process_movement_monitors')
      .select('*, lead_processes(id, process_number, polo_ativo, polo_passivo, movimentacoes, case_id, legal_cases(case_number, title))')
      .eq('is_active', true);

    if (monErr) throw monErr;
    if (!monitors || monitors.length === 0) {
      return new Response(JSON.stringify({ message: 'Nenhum monitor ativo', checked: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const escavadorToken = Deno.env.get('ESCAVADOR_API_TOKEN');
    let notifiedCount = 0;
    let checkedCount = 0;

    for (const monitor of monitors) {
      const process = (monitor as any).lead_processes;
      if (!process?.process_number) continue;

      checkedCount++;
      const processNumber = process.process_number;

      try {
        // Check Escavador for latest movements
        const escResp = await fetch(
          `https://api.escavador.com/api/v2/processos/numero_cnj/${encodeURIComponent(processNumber)}/movimentacoes`,
          {
            headers: {
              'Authorization': `Bearer ${escavadorToken}`,
              'Accept': 'application/json',
            },
          }
        );

        if (!escResp.ok) {
          console.error(`Escavador error for ${processNumber}: ${escResp.status}`);
          continue;
        }

        const escData = await escResp.json();
        const movements = escData.items || escData.data || (Array.isArray(escData) ? escData : []);
        const currentCount = movements.length;
        const previousCount = monitor.last_movement_count || 0;

        // Update last checked
        await supabase
          .from('process_movement_monitors')
          .update({ last_checked_at: new Date().toISOString() })
          .eq('id', monitor.id);

        // If there are new movements
        if (currentCount > previousCount) {
          const newMovements = movements.slice(0, currentCount - previousCount);
          
          // Build notification message
          const caseName = process.legal_cases?.title || process.polo_ativo || processNumber;
          const caseNumber = process.legal_cases?.case_number || '';
          
          let message = `📋 *Atualização Processual*\n\n`;
          message += `📌 *Processo:* ${processNumber}\n`;
          if (caseNumber) message += `📁 *Caso:* ${caseNumber}\n`;
          message += `👤 *Parte:* ${caseName}\n\n`;
          message += `🔔 *${newMovements.length} nova(s) movimentação(ões):*\n\n`;

          for (const mov of newMovements.slice(0, 5)) {
            const date = mov.data || mov.date || '';
            const tipo = mov.tipo || mov.type || mov.titulo || mov.title || 'Movimentação';
            const conteudo = mov.conteudo || mov.content || mov.descricao || mov.description || '';
            
            message += `📅 *${date}* — ${tipo}\n`;
            if (conteudo) {
              // Truncate long content
              const short = conteudo.length > 200 ? conteudo.substring(0, 200) + '...' : conteudo;
              message += `${short}\n`;
            }
            message += `\n`;
          }

          if (newMovements.length > 5) {
            message += `_...e mais ${newMovements.length - 5} movimentação(ões)_\n`;
          }

          message += `\n💡 _Notificação automática do sistema WhatsJUD_`;

          // Find a WhatsApp instance to send from
          const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('id')
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();

          if (instance) {
            // Send WhatsApp notification
            const sendResp = await fetch(`${cloudFunctionsUrl}/functions/v1/send-whatsapp`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                phone: monitor.phone,
                message,
                instance_id: instance.id,
              }),
            });

            const sendResult = await sendResp.json();
            const status = sendResult.success ? 'sent' : 'failed';

            // Log notification
            await supabase.from('process_movement_notifications').insert({
              monitor_id: monitor.id,
              process_id: monitor.process_id,
              movement_summary: message,
              notification_type: 'text',
              status,
              error_message: sendResult.success ? null : JSON.stringify(sendResult.error),
            });

            if (sendResult.success) notifiedCount++;
          }

          // Update monitor with new count
          await supabase
            .from('process_movement_monitors')
            .update({
              last_movement_count: currentCount,
              last_movement_date: new Date().toISOString(),
              last_notified_at: new Date().toISOString(),
            })
            .eq('id', monitor.id);

          // Also update lead_processes movimentacoes
          if (movements.length > 0) {
            await supabase
              .from('lead_processes')
              .update({ movimentacoes: movements })
              .eq('id', monitor.process_id);
          }
        }
      } catch (procErr) {
        console.error(`Error checking process ${processNumber}:`, procErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      checked: checkedCount,
      notified: notifiedCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
