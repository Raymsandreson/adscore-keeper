import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, endOfDay } from 'date-fns';

export interface GapItem {
  id: string;
  name: string;
  acolhedor: string | null;
  created_at: string;
  lead_id?: string | null;
  whatsapp_phone?: string | null;
  whatsapp_group_id?: string | null;
}

export interface OperationalGaps {
  closedWithoutGroup: GapItem[];
  withGroupWithoutCase: GapItem[];
  casesWithoutProcess: GapItem[];
  processesWithoutActivity: GapItem[];
}

export type GapType = keyof OperationalGaps;

export function useOperationalGaps() {
  const [gaps, setGaps] = useState<OperationalGaps>({
    closedWithoutGroup: [],
    withGroupWithoutCase: [],
    casesWithoutProcess: [],
    processesWithoutActivity: [],
  });
  const [loading, setLoading] = useState(false);

  const fetchGaps = useCallback(async (dateRange: { from: Date; to: Date }) => {
    setLoading(true);
    try {
      const start = startOfDay(dateRange.from).toISOString();
      const end = endOfDay(dateRange.to).toISOString();

      // 1. Closed leads in period
      const { data: closedLeads } = await supabase
        .from('leads')
        .select('id, lead_name, acolhedor, whatsapp_group_id, group_link, lead_phone, updated_at')
        .eq('lead_status', 'closed')
        .gte('updated_at', start)
        .lte('updated_at', end);

      const closed = closedLeads || [];

      // Closed without group (check both whatsapp_group_id and group_link)
      const closedWithoutGroup: GapItem[] = closed
        .filter(l => !l.whatsapp_group_id && !l.group_link)
        .map(l => ({ id: l.id, name: l.lead_name || 'Lead', acolhedor: l.acolhedor, created_at: l.updated_at, lead_id: l.id, whatsapp_phone: l.lead_phone }));

      // Leads with group (closed in period)
      const withGroup = closed.filter(l => !!l.whatsapp_group_id || !!l.group_link);
      const withGroupIds = withGroup.map(l => l.id);

      // 2. Check which of those have cases
      let leadsWithCases = new Set<string>();
      if (withGroupIds.length > 0) {
        for (let i = 0; i < withGroupIds.length; i += 100) {
          const batch = withGroupIds.slice(i, i + 100);
          const { data: cases } = await supabase
            .from('legal_cases')
            .select('lead_id')
            .in('lead_id', batch);
          (cases || []).forEach(c => { if (c.lead_id) leadsWithCases.add(c.lead_id); });
        }
      }

      const withGroupWithoutCase: GapItem[] = withGroup
        .filter(l => !leadsWithCases.has(l.id))
        .map(l => ({ id: l.id, name: l.lead_name || 'Lead', acolhedor: l.acolhedor, created_at: l.updated_at, lead_id: l.id, whatsapp_phone: l.lead_phone, whatsapp_group_id: l.whatsapp_group_id }));

      // 3. Cases created in period without processes
      const { data: casesData } = await supabase
        .from('legal_cases')
        .select('id, case_number, title, acolhedor, lead_id, created_at')
        .gte('created_at', start)
        .lte('created_at', end);

      const caseIds = (casesData || []).map(c => c.id);
      let casesWithProcesses = new Set<string>();
      if (caseIds.length > 0) {
        for (let i = 0; i < caseIds.length; i += 100) {
          const batch = caseIds.slice(i, i + 100);
          const { data: procs } = await supabase
            .from('lead_processes')
            .select('case_id')
            .in('case_id', batch);
          (procs || []).forEach(p => { if (p.case_id) casesWithProcesses.add(p.case_id); });
        }
      }

      // Fetch lead info for cases
      const caseLeadIds = (casesData || []).map(c => c.lead_id).filter(Boolean) as string[];
      let caseLeadMap: Record<string, { lead_phone: string | null; whatsapp_group_id: string | null }> = {};
      if (caseLeadIds.length > 0) {
        const { data: leads } = await supabase
          .from('leads')
          .select('id, lead_phone, whatsapp_group_id')
          .in('id', caseLeadIds);
        if (leads) {
          caseLeadMap = Object.fromEntries(leads.map(l => [l.id, { lead_phone: l.lead_phone, whatsapp_group_id: l.whatsapp_group_id }]));
        }
      }

      const casesWithoutProcess: GapItem[] = (casesData || [])
        .filter(c => !casesWithProcesses.has(c.id))
        .map(c => {
          const leadInfo = c.lead_id ? caseLeadMap[c.lead_id] : null;
          return { id: c.id, name: c.title || c.case_number || 'Caso', acolhedor: c.acolhedor, created_at: c.created_at, lead_id: c.lead_id, whatsapp_phone: leadInfo?.lead_phone, whatsapp_group_id: leadInfo?.whatsapp_group_id };
        });

      // 4. Processes created in period without activities
      const { data: processesData } = await supabase
        .from('lead_processes')
        .select('id, title, case_id, lead_id, created_at')
        .gte('created_at', start)
        .lte('created_at', end);

      const processIds = (processesData || []).map(p => p.id);
      let processesWithActivities = new Set<string>();
      if (processIds.length > 0) {
        for (let i = 0; i < processIds.length; i += 100) {
          const batch = processIds.slice(i, i + 100);
          const { data: acts } = await supabase
            .from('lead_activities')
            .select('process_id')
            .in('process_id', batch);
          (acts || []).forEach(a => { if (a.process_id) processesWithActivities.add(a.process_id); });
        }
      }

      // Fetch lead info for processes
      const procLeadIds = (processesData || []).map(p => p.lead_id).filter(Boolean) as string[];
      let procLeadMap: Record<string, { lead_phone: string | null; whatsapp_group_id: string | null }> = {};
      if (procLeadIds.length > 0) {
        const { data: leads } = await supabase
          .from('leads')
          .select('id, lead_phone, whatsapp_group_id')
          .in('id', procLeadIds);
        if (leads) {
          procLeadMap = Object.fromEntries(leads.map(l => [l.id, { lead_phone: l.lead_phone, whatsapp_group_id: l.whatsapp_group_id }]));
        }
      }

      const processesWithoutActivity: GapItem[] = (processesData || [])
        .filter(p => !processesWithActivities.has(p.id))
        .map(p => {
          const leadInfo = p.lead_id ? procLeadMap[p.lead_id] : null;
          return { id: p.id, name: p.title || 'Processo', acolhedor: null, created_at: p.created_at, lead_id: p.lead_id, whatsapp_phone: leadInfo?.lead_phone, whatsapp_group_id: leadInfo?.whatsapp_group_id };
        });

      setGaps({ closedWithoutGroup, withGroupWithoutCase, casesWithoutProcess, processesWithoutActivity });
    } catch (err) {
      console.error('Error fetching operational gaps:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { gaps, gapsLoading: loading, fetchGaps };
}
