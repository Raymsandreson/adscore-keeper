import { useState, useCallback } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { supabase as cloudSupabase } from '@/integrations/supabase/client';
import { remapToExternal, remapToCloud, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { getTimeOffConflicts, describeTimeOff } from '@/lib/timeOff';
import { toast } from 'sonner';
import { logAudit } from '@/hooks/useAuditLog';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

// Lock global em memória para impedir cliques duplos / StrictMode duplicar criação
const inflightCreates = new Set<string>();

export interface LeadActivity {
  id: string;
  lead_id: string | null;
  lead_name: string | null;
  title: string;
  description: string | null;
  activity_type: string;
  status: string;
  priority: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  /** Todos os assessores (principal primeiro). Requer as colunas de array no Externo. */
  assigned_to_ids?: string[] | null;
  assigned_to_names?: string[] | null;
  /** Observadores (criador é o natural; pode haver mais). UUIDs do Externo no banco. */
  observer_ids?: string[] | null;
  observer_names?: string[] | null;
  /** Liga as N cópias criadas quando há N responsáveis. */
  assignment_group_id?: string | null;
  /** Feedback preenchido pelo responsável na própria atividade. */
  feedback?: string | null;
  /** Data para a qual a atividade foi reagendada (status 'reagendada'). */
  rescheduled_to?: string | null;
  deadline: string | null;
  notification_date: string | null;
  /** Data e hora da reunião (só quando activity_type = 'reuniao'). timestamptz no Externo. */
  meeting_at?: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_name: string | null;
  notes: string | null;
  what_was_done: string | null;
  next_steps: string | null;
  current_status_notes: string | null;
  solicitacao?: string | null;
  resposta_juizo?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  contact_id: string | null;
  contact_name: string | null;
  matrix_quadrant: string | null;
  case_id: string | null;
  case_title: string | null;
  process_id: string | null;
  process_title: string | null;
  is_system: boolean | null;
  is_management?: boolean | null;
  client_name_override?: string | null;
  workflow_id?: string | null;
  cobranca_phone?: string | null;
  cobranca_email?: string | null;
}

export function useLeadActivities() {
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchActivities = useCallback(async (filters?: {
    status?: string | string[];
    activity_type?: string | string[];
    assigned_to?: string | string[];
    lead_id?: string | string[];
    contact_id?: string | string[];
    workflow_id?: string | string[];
    limit?: number;
    /** Busca também TODAS as atrasadas (prazo vencido, não concluídas), paginando sem teto de linhas. */
    overdue?: boolean;
  }) => {
    setLoading(true);
    try {
      await ensureRemapCache();

      const toVals = (v?: string | string[]) =>
        v ? (Array.isArray(v) ? v : [v]).filter(x => x !== 'all') : [];

      const statusVals = toVals(filters?.status);
      const typeVals = toVals(filters?.activity_type);
      const leadVals = toVals(filters?.lead_id);
      const contactVals = toVals(filters?.contact_id);
      const workflowVals = toVals(filters?.workflow_id);

      const assigneeVals = toVals(filters?.assigned_to);
      const hasUnassigned = assigneeVals.includes('__unassigned__');
      const cloudUserIds = assigneeVals.filter(v => v !== '__unassigned__');
      // Remapear cloud → ext para casar com o que está no Externo
      const remapped = await Promise.all(cloudUserIds.map(id => remapToExternal(id)));
      const assigneeExtIds = remapped.filter(Boolean) as string[];

      // Filtros comuns (tudo exceto status/ordenação) — usados na busca normal e na de atrasadas
      const buildQuery = () => {
        let q = externalSupabase
          .from('lead_activities')
          .select('*')
          .is('deleted_at', null);

        if (typeVals.length === 1) q = q.eq('activity_type', typeVals[0]);
        else if (typeVals.length > 1) q = q.in('activity_type', typeVals);

        // Multi-assessor: além do principal (assigned_to), casa também quem está
        // como co-assessor no array assigned_to_ids (operador ov = overlap).
        if (hasUnassigned && assigneeExtIds.length > 0) {
          q = q.or(`assigned_to.in.(${assigneeExtIds.join(',')}),assigned_to_ids.ov.{${assigneeExtIds.join(',')}},assigned_to.is.null`);
        } else if (hasUnassigned) {
          q = q.is('assigned_to', null);
        } else if (assigneeExtIds.length > 0) {
          q = q.or(`assigned_to.in.(${assigneeExtIds.join(',')}),assigned_to_ids.ov.{${assigneeExtIds.join(',')}}`);
        }

        if (leadVals.length === 1) q = q.eq('lead_id', leadVals[0]);
        else if (leadVals.length > 1) q = q.in('lead_id', leadVals);

        if (contactVals.length === 1) q = q.eq('contact_id', contactVals[0]);
        else if (contactVals.length > 1) q = q.in('contact_id', contactVals);

        const hasNullWorkflow = workflowVals.includes('__unassigned__');
        const workflowIds = workflowVals.filter(v => v !== '__unassigned__');
        if (hasNullWorkflow && workflowIds.length > 0) {
          q = (q as any).or(`workflow_id.in.(${workflowIds.join(',')}),workflow_id.is.null`);
        } else if (hasNullWorkflow) {
          q = q.is('workflow_id', null);
        } else if (workflowIds.length === 1) {
          q = (q as any).eq('workflow_id', workflowIds[0]);
        } else if (workflowIds.length > 1) {
          q = (q as any).in('workflow_id', workflowIds);
        }

        return q;
      };

      // Busca normal (limitada). Com overdue ativo e nenhum status real selecionado, ela é
      // dispensável — as atrasadas já cobrem tudo que a tela vai exibir.
      let rows: LeadActivity[] = [];
      if (!filters?.overdue || statusVals.length > 0) {
        let query = buildQuery().order('created_at', { ascending: false });
        if (statusVals.length === 1) query = query.eq('status', statusVals[0]);
        else if (statusVals.length > 1) query = query.in('status', statusVals);
        query = query.limit(filters?.limit ?? 500);

        const { data, error } = await query;
        if (error) throw error;
        rows = (data || []) as LeadActivity[];
      }

      if (filters?.overdue) {
        // Todas as vencidas não concluídas, em blocos de 1000 (PostgREST corta acima disso).
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const PAGE = 1000;
        const overdueRows: LeadActivity[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await buildQuery()
            .neq('status', 'concluida')
            .not('deadline', 'is', null)
            .lt('deadline', todayStart.toISOString())
            .order('deadline', { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw error;
          const chunk = (data || []) as LeadActivity[];
          overdueRows.push(...chunk);
          if (chunk.length < PAGE) break;
        }
        const seen = new Set(rows.map(r => r.id));
        rows = [...rows, ...overdueRows.filter(r => !seen.has(r.id))];
      }

      setActivities(rows);
    } catch (error) {
      console.error('Error fetching activities:', error);
      toast.error('Erro ao carregar atividades');
    } finally {
      setLoading(false);
    }
  }, []);

  const createActivity = async (activity: Partial<LeadActivity>) => {
    const dedupKey = `${activity.lead_id || activity.case_id || activity.process_id || 'sys'}|${(activity.title || '').trim().toLowerCase()}|${activity.activity_type || 'tarefa'}`;
    if (inflightCreates.has(dedupKey)) {
      console.warn('[createActivity] Duplicado ignorado (em voo):', dedupKey);
      return null;
    }
    inflightCreates.add(dedupKey);
    setTimeout(() => inflightCreates.delete(dedupKey), 5000);
    try {
      const hasLink = !!(activity.lead_id || activity.case_id || activity.process_id);
      if (!hasLink && !activity.is_system && !activity.is_management) {
        toast.error('Vincule a atividade a um Lead ou Caso, ou marque como "Sistema" / "Gerenciamento".');
        throw new Error('LINK_REQUIRED');
      }

      const { data: { user } } = await cloudSupabase.auth.getUser();
      const cloudUserId = user?.id || null;

      // Férias/compensação/folga (aba Férias da equipe): não deixa criar
      // atividade com prazo dentro de ausência registrada de qualquer responsável.
      // Roda antes do remap — a tabela member_time_off guarda Cloud UUIDs.
      const timeOffConflicts = await getTimeOffConflicts(
        [activity.assigned_to || cloudUserId, ...(activity.assigned_to_ids || [])],
        activity.deadline,
      );
      if (timeOffConflicts.length > 0) {
        const who = timeOffConflicts
          .map(c => `${c.user_name || 'Responsável'} — ${describeTimeOff(c)}`)
          .join('; ');
        toast.error(`Prazo cai em ausência registrada: ${who}. Escolha outra data ou outro responsável.`, { duration: 8000 });
        return null;
      }

      const extUserId = await remapToExternal(cloudUserId);
      const extAssignedTo = await remapToExternal(activity.assigned_to || cloudUserId);

      // Multi-assessor: remapeia cada Cloud UUID pro Externo. Só entra no insert
      // quando informado — banco sem a migração das colunas continua funcionando.
      let extAssignedToIds: string[] | null = null;
      if (Array.isArray(activity.assigned_to_ids) && activity.assigned_to_ids.length > 0) {
        const mapped = await Promise.all(activity.assigned_to_ids.map((id) => remapToExternal(id)));
        extAssignedToIds = mapped.filter(Boolean) as string[];
      }

      // Observadores: mesma remapeação Cloud → Externo, mantendo nomes alinhados.
      let extObserverIds: string[] | null = null;
      let extObserverNames: string[] | null = null;
      if (Array.isArray(activity.observer_ids) && activity.observer_ids.length > 0) {
        const names = activity.observer_names || [];
        const pairs = await Promise.all(activity.observer_ids.map(async (id, i) => ({
          ext: await remapToExternal(id),
          name: names[i] || null,
        })));
        const valid = pairs.filter(p => p.ext);
        extObserverIds = valid.map(p => p.ext as string);
        extObserverNames = valid.map(p => p.name || '');
      }

      const { data, error } = await externalSupabase
        .from('lead_activities')
        .insert({
          title: activity.title || 'Nova Atividade',
          lead_id: activity.lead_id || null,
          lead_name: activity.lead_name || null,
          description: activity.description || null,
          activity_type: activity.activity_type || 'tarefa',
          status: 'pendente',
          priority: activity.priority || 'normal',
          assigned_to: extAssignedTo,
          assigned_to_name: activity.assigned_to_name || null,
          deadline: activity.deadline || null,
          notification_date: activity.notification_date || null,
          meeting_at: activity.meeting_at || null,
          notes: activity.notes || null,
          created_by: extUserId,
          contact_id: activity.contact_id || null,
          contact_name: activity.contact_name || null,
          what_was_done: activity.what_was_done || null,
          current_status_notes: activity.current_status_notes || null,
          next_steps: activity.next_steps || null,
          matrix_quadrant: activity.matrix_quadrant || null,
          case_id: activity.case_id || null,
          case_title: activity.case_title || null,
          process_id: activity.process_id || null,
          process_title: activity.process_title || null,
          is_system: activity.is_system ?? false,
          is_management: activity.is_management ?? false,
          client_name_override: activity.client_name_override || null,
          workflow_id: activity.workflow_id || null,
          ...(extAssignedToIds ? {
            assigned_to_ids: extAssignedToIds,
            assigned_to_names: activity.assigned_to_names || null,
          } : {}),
          ...(extObserverIds ? {
            observer_ids: extObserverIds,
            observer_names: extObserverNames,
          } : {}),
          ...(activity.assignment_group_id ? { assignment_group_id: activity.assignment_group_id } : {}),
          ...(activity.feedback !== undefined ? { feedback: activity.feedback } : {}),
          ...(activity.rescheduled_to !== undefined ? { rescheduled_to: activity.rescheduled_to } : {}),
        } as any)
        .select()
        .single();

      if (error) throw error;

      // Popup in-app pro responsável quando a atividade foi repassada por outra pessoa
      // (grava em activity_notifications; o listener realtime mostra o popup).
      if (data && extAssignedTo && extAssignedTo !== extUserId) {
        (async () => {
          try {
            const { data: prof } = await cloudSupabase
              .from('profiles').select('full_name').eq('user_id', cloudUserId || '').maybeSingle();
            await externalSupabase.from('activity_notifications' as any).insert({
              activity_id: data.id,
              recipient_id: extAssignedTo,
              recipient_name: activity.assigned_to_name || null,
              type: 'assigned',
              title: 'Atividade repassada para você',
              body: activity.title || 'Nova Atividade',
              actor_id: extUserId,
              actor_name: (prof as any)?.full_name || null,
            } as any);
          } catch (e) {
            console.warn('[createActivity] notificação de atribuição falhou:', e);
          }
        })();
      }

      // Auto-sync to Google Calendar (silent, best-effort, only if connected)
      if (data && (activity.deadline || activity.notification_date)) {
        try {
          const { data: checkData } = await cloudFunctions.invoke('google-check-connection');
          if (checkData?.connected) {
            cloudFunctions.invoke('google-calendar-event', {
              body: {
                action_type: 'call',
                title: activity.title || 'Nova Atividade',
                description: activity.description || activity.notes || undefined,
                scheduled_at: activity.deadline || activity.notification_date,
                contact_name: activity.contact_name || activity.lead_name || undefined,
                notes: `Lead: ${activity.lead_name || ''}\nTipo: ${activity.activity_type || ''}\nStatus: pendente`,
              },
            }).catch(() => {});
          }
        } catch {}
      }

      toast.success('Atividade criada!');

      if (data) {
        const notifyBase = {
          activity_id: data.id,
          title: activity.title,
          description: activity.description,
          activity_type: activity.activity_type,
          status: 'pendente',
          priority: activity.priority,
          created_by: cloudUserId,
          deadline: activity.deadline,
          lead_name: activity.lead_name,
          lead_id: activity.lead_id,
          contact_name: activity.contact_name,
          contact_id: activity.contact_id,
          what_was_done: activity.what_was_done,
          next_steps: activity.next_steps,
          current_status_notes: activity.current_status_notes,
          notes: activity.notes,
        };
        const principalId = activity.assigned_to || cloudUserId;
        cloudFunctions.invoke('notify-activity-created', {
          body: {
            ...notifyBase,
            // Notificações usam Cloud UUID (continuam batendo no Cloud auth)
            assigned_to: principalId,
            assigned_to_name: activity.assigned_to_name,
          },
        }).catch(() => {});
        // Multi-assessor: cada co-assessor também é notificado (a edge já ignora
        // quem for o próprio criador).
        const allIds = activity.assigned_to_ids || [];
        const allNames = activity.assigned_to_names || [];
        allIds.forEach((coId, i) => {
          if (!coId || coId === principalId) return;
          cloudFunctions.invoke('notify-activity-created', {
            body: {
              ...notifyBase,
              assigned_to: coId,
              assigned_to_name: allNames[i] || null,
            },
          }).catch(() => {});
        });
      }

      return data;
    } catch (error: any) {
      if (error?.message === 'LINK_REQUIRED') throw error;
      // Postgres unique_violation: já existe atividade pendente idêntica
      if (error?.code === '23505') {
        console.warn('[createActivity] Duplicado bloqueado pelo índice único:', dedupKey);
        toast.info('Já existe uma atividade pendente igual para este lead.');
        return null;
      }
      console.error('Error creating activity:', error);
      toast.error('Erro ao criar atividade');
      throw error;
    } finally {
      inflightCreates.delete(dedupKey);
    }
  };

  const updateActivity = async (id: string, updates: Partial<LeadActivity>) => {
    try {
      const { data: { user } } = await cloudSupabase.auth.getUser();

      // Mesmo bloqueio de ausência da criação, quando prazo ou responsáveis mudam.
      // updates traz Cloud UUIDs; a linha no banco guarda ids do Externo (remap de volta).
      if ('deadline' in updates || 'assigned_to' in updates || 'assigned_to_ids' in updates) {
        let deadline = 'deadline' in updates ? updates.deadline : undefined;
        let cloudIds: (string | null)[] = ('assigned_to' in updates || 'assigned_to_ids' in updates)
          ? [updates.assigned_to || null, ...(updates.assigned_to_ids || [])]
          : [];
        if (deadline === undefined || cloudIds.length === 0) {
          const { data: row } = await externalSupabase
            .from('lead_activities')
            .select('deadline, assigned_to, assigned_to_ids')
            .eq('id', id)
            .maybeSingle();
          if (deadline === undefined) deadline = (row as any)?.deadline || null;
          if (cloudIds.length === 0) {
            const extIds = [(row as any)?.assigned_to, ...(((row as any)?.assigned_to_ids) || [])].filter(Boolean) as string[];
            cloudIds = await Promise.all(extIds.map(eid => remapToCloud(eid)));
          }
        }
        const conflicts = await getTimeOffConflicts(cloudIds, deadline);
        if (conflicts.length > 0) {
          const who = conflicts.map(c => `${c.user_name || 'Responsável'} — ${describeTimeOff(c)}`).join('; ');
          toast.error(`Prazo cai em ausência registrada: ${who}. Escolha outra data ou outro responsável.`, { duration: 8000 });
          return;
        }
      }

      const extUserId = await remapToExternal(user?.id || null);

      // Remap assigned_to se estiver sendo atualizado (UI passa Cloud UUID)
      const patch: any = { ...updates, updated_by: extUserId };
      if ('assigned_to' in updates) {
        patch.assigned_to = await remapToExternal(updates.assigned_to || null);
      }
      if ('assigned_to_ids' in updates && Array.isArray(updates.assigned_to_ids)) {
        const mapped = await Promise.all(updates.assigned_to_ids.map((id) => remapToExternal(id)));
        patch.assigned_to_ids = mapped.filter(Boolean);
      }
      if ('observer_ids' in updates && Array.isArray(updates.observer_ids)) {
        const names = updates.observer_names || [];
        const pairs = await Promise.all(updates.observer_ids.map(async (oid, i) => ({
          ext: await remapToExternal(oid),
          name: names[i] || '',
        })));
        const valid = pairs.filter(p => p.ext);
        patch.observer_ids = valid.map(p => p.ext);
        patch.observer_names = valid.map(p => p.name);
      }

      const { error } = await externalSupabase
        .from('lead_activities')
        .update(patch)
        .eq('id', id);

      if (error) throw error;

      // If linking a lead, migrate orphan chat messages from activity_id to lead_id
      if (updates.lead_id) {
        await externalSupabase
          .from('activity_chat_messages')
          .update({ lead_id: updates.lead_id } as any)
          .eq('activity_id', id)
          .is('lead_id', null);
      }

      toast.success('Atividade atualizada!');
    } catch (error) {
      console.error('Error updating activity:', error);
      toast.error('Erro ao atualizar atividade');
    }
  };

  const completeActivity = async (id: string) => {
    try {
      const { data: { user } } = await cloudSupabase.auth.getUser();
      const extUserId = await remapToExternal(user?.id || null);

      // Profile pode estar no Cloud ou no Externo — tentar Externo primeiro
      let fullName: string | null = null;
      const { data: extProfile } = await externalSupabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', extUserId || '')
        .maybeSingle();
      fullName = extProfile?.full_name || null;
      if (!fullName) {
        const { data: cloudProfile } = await cloudSupabase
          .from('profiles')
          .select('full_name')
          .eq('user_id', user?.id || '')
          .maybeSingle();
        fullName = cloudProfile?.full_name || null;
      }

      const { error } = await externalSupabase
        .from('lead_activities')
        .update({
          status: 'concluida',
          completed_at: new Date().toISOString(),
          completed_by: extUserId,
          completed_by_name: fullName,
        })
        .eq('id', id);

      if (error) throw error;
      toast.success('Atividade concluída!');
    } catch (error) {
      console.error('Error completing activity:', error);
      toast.error('Erro ao concluir atividade');
    }
  };

  const deleteActivity = async (id: string) => {
    try {
      const { data: snapshot } = await externalSupabase
        .from('lead_activities')
        .select('*')
        .eq('id', id)
        .single();

      if (snapshot) {
        await logAudit({
          action: 'delete',
          entityType: 'lead_activity',
          entityId: id,
          entityName: snapshot.title || 'Atividade',
          details: { snapshot, soft_delete: true },
        });
      }

      const { error } = await externalSupabase
        .from('lead_activities')
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq('id', id);

      if (error) throw error;

      // Excluir a atividade também remove o tempo cronometrado nela
      // (senão o banco de horas contabiliza atv que não existe mais).
      await (externalSupabase as unknown as import('@supabase/supabase-js').SupabaseClient)
        .from('activity_time_entries')
        .delete()
        .eq('activity_id', id);

      toast.success('Atividade arquivada!');
    } catch (error) {
      console.error('Error archiving activity:', error);
      toast.error('Erro ao arquivar atividade');
    }
  };

  return {
    activities,
    loading,
    fetchActivities,
    createActivity,
    updateActivity,
    completeActivity,
    deleteActivity,
  };
}
