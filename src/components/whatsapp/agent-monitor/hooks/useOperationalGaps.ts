import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

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
      const snapshotDate = format(dateRange.from, 'yyyy-MM-dd');
      
      const { data: snapshot, error } = await supabase
        .from('monitor_kpi_snapshots')
        .select('gap_details')
        .eq('snapshot_date', snapshotDate)
        .maybeSingle();

      if (error) {
        console.error('Error fetching gaps from snapshot:', error);
        setGaps({ closedWithoutGroup: [], withGroupWithoutCase: [], casesWithoutProcess: [], processesWithoutActivity: [] });
        return;
      }

      if (!snapshot || !snapshot.gap_details) {
        setGaps({ closedWithoutGroup: [], withGroupWithoutCase: [], casesWithoutProcess: [], processesWithoutActivity: [] });
        return;
      }

      const gapData = snapshot.gap_details as unknown as Record<string, GapItem[]>;

      setGaps({
        closedWithoutGroup: gapData.closedWithoutGroup || [],
        withGroupWithoutCase: gapData.withGroupWithoutCase || [],
        casesWithoutProcess: gapData.casesWithoutProcess || [],
        processesWithoutActivity: gapData.processesWithoutActivity || [],
      });
    } catch (err) {
      console.error('Error fetching operational gaps:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { gaps, gapsLoading: loading, fetchGaps };
}
