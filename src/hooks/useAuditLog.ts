import { supabase } from '@/integrations/supabase/client';

interface AuditEntry {
  action: 'create' | 'update' | 'delete';
  entityType: string;
  entityId?: string;
  entityName?: string;
  details?: Record<string, any>;
}

export async function logAudit(entry: AuditEntry) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get user name from profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', user.id)
      .single();

    await supabase.from('audit_logs' as any).insert({
      user_id: user.id,
      user_name: profile?.full_name || user.email || 'Desconhecido',
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId || null,
      entity_name: entry.entityName || null,
      details: entry.details || {},
    } as any);
  } catch (e) {
    console.warn('Audit log failed:', e);
  }
}
