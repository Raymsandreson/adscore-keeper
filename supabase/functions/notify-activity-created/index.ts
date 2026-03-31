import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      RESOLVED_SUPABASE_URL,
      RESOLVED_SERVICE_ROLE_KEY
    );

    const body = await req.json();
    const {
      activity_id,
      title,
      description,
      activity_type,
      status,
      priority,
      assigned_to,
      assigned_to_name,
      created_by,
      deadline,
      lead_name,
      lead_id,
      contact_name,
      contact_id,
      what_was_done,
      next_steps,
      current_status_notes,
      notes,
    } = body;

    if (!assigned_to) {
      return new Response(JSON.stringify({ ok: false, reason: 'no_assigned_to' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Don't notify if the creator is the same as the assignee
    if (assigned_to === created_by) {
      return new Response(JSON.stringify({ ok: false, reason: 'self_assigned' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get assigned user's profile (phone + default instance)
    const { data: profile } = await supabase
      .from('profiles')
      .select('phone, default_instance_id, full_name')
      .eq('user_id', assigned_to)
      .single();

    if (!profile?.phone || !profile?.default_instance_id) {
      return new Response(JSON.stringify({ ok: false, reason: 'no_phone_or_instance' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get creator's name
    let creatorName = 'Sistema';
    if (created_by) {
      const { data: creatorProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', created_by)
        .single();
      if (creatorProfile?.full_name) creatorName = creatorProfile.full_name;
    }

    // Get the instance details
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('base_url, instance_token, instance_name')
      .eq('id', profile.default_instance_id)
      .single();

    if (!instance?.base_url || !instance?.instance_token) {
      return new Response(JSON.stringify({ ok: false, reason: 'instance_not_configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build deep link
    const appUrl = Deno.env.get('APP_URL') || 'https://adscore-keeper.lovable.app';
    const deepLink = `${appUrl}/atividades?openActivity=${activity_id}`;

    // Build activity type label
    const typeLabels: Record<string, string> = {
      tarefa: '📋 Tarefa',
      ligacao: '📞 Ligação',
      reuniao: '🤝 Reunião',
      email: '📧 E-mail',
      whatsapp: '💬 WhatsApp',
      visita: '🏢 Visita',
      notificacao: '🔔 Notificação',
      audiencia: '⚖️ Audiência',
      prazo: '⏰ Prazo',
    };

    const priorityLabels: Record<string, string> = {
      baixa: '🟢 Baixa',
      normal: '🟡 Normal',
      alta: '🟠 Alta',
      urgente: '🔴 Urgente',
    };

    // Build message
    const lines: string[] = [];
    lines.push('📌 *Nova Atividade Atribuída*');
    lines.push('');
    lines.push(`📝 *Assunto:* ${title || 'Sem título'}`);
    lines.push(`📂 *Tipo:* ${typeLabels[activity_type] || activity_type || 'Tarefa'}`);
    lines.push(`🔖 *Prioridade:* ${priorityLabels[priority] || priority || 'Normal'}`);
    
    if (deadline) {
      const d = new Date(deadline);
      lines.push(`📅 *Data:* ${d.toLocaleDateString('pt-BR')}`);
    }

    lines.push('');

    if (lead_name) lines.push(`🏢 *Lead:* ${lead_name}`);
    if (contact_name) lines.push(`👤 *Contato:* ${contact_name}`);

    if (lead_name || contact_name) lines.push('');

    if (description) lines.push(`📄 *Descrição:* ${description}`);
    if (current_status_notes) lines.push(`📊 *Status atual:* ${current_status_notes}`);
    if (what_was_done) lines.push(`✅ *O que foi feito:* ${what_was_done}`);
    if (next_steps) lines.push(`➡️ *Próximo passo:* ${next_steps}`);
    if (notes) lines.push(`📝 *Observação:* ${notes}`);

    lines.push('');
    lines.push(`👤 *Registrado por:* ${creatorName}`);
    lines.push('');
    lines.push(`🔗 *Acessar:* ${deepLink}`);

    const message = lines.join('\n');

    // Send via UazAPI
    const phone = profile.phone.replace(/\D/g, '');
    const baseUrl = instance.base_url.replace(/\/$/, '');

    const response = await fetch(`${baseUrl}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${instance.instance_token}`,
      },
      body: JSON.stringify({
        number: phone,
        text: message,
      }),
    });

    const result = await response.json().catch(() => ({}));

    return new Response(JSON.stringify({ ok: true, sent: true, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in notify-activity-created:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
