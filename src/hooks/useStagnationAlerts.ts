import { useState, useEffect, useMemo } from 'react';
import { Lead, LeadStatus } from './useLeads';
import { differenceInDays } from 'date-fns';

export interface StagnationThresholds {
  comment: number;
  new: number;
  contacted: number;
  qualified: number;
  not_qualified: number;
  converted: number;
  lost: number;
}

const DEFAULT_THRESHOLDS: StagnationThresholds = {
  comment: 2,
  new: 3,
  contacted: 5,
  qualified: 7,
  not_qualified: 14,
  converted: 30, // Less relevant for converted
  lost: 30, // Less relevant for lost
};

const STORAGE_KEY = 'lead-stagnation-thresholds';

export interface StagnantLead extends Lead {
  daysSinceLastActivity: number;
  threshold: number;
  isStagnant: boolean;
}

export const useStagnationAlerts = (leads: Lead[]) => {
  const [thresholds, setThresholds] = useState<StagnationThresholds>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_THRESHOLDS;
    } catch {
      return DEFAULT_THRESHOLDS;
    }
  });

  const [enabledStatuses, setEnabledStatuses] = useState<Record<LeadStatus, boolean>>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}-enabled`);
      return saved ? JSON.parse(saved) : {
        comment: true,
        new: true,
        contacted: true,
        qualified: true,
        not_qualified: false,
        converted: false,
        lost: false,
      };
    } catch {
      return {
        comment: true,
        new: true,
        contacted: true,
        qualified: true,
        not_qualified: false,
        converted: false,
        lost: false,
      };
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds));
  }, [thresholds]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}-enabled`, JSON.stringify(enabledStatuses));
  }, [enabledStatuses]);

  const updateThreshold = (status: LeadStatus, days: number) => {
    setThresholds(prev => ({ ...prev, [status]: days }));
  };

  const toggleStatusAlert = (status: LeadStatus, enabled: boolean) => {
    setEnabledStatuses(prev => ({ ...prev, [status]: enabled }));
  };

  const resetToDefaults = () => {
    setThresholds(DEFAULT_THRESHOLDS);
  };

  const getLastActivityDate = (lead: Lead): Date => {
    // Priority: last_followup_at > updated_at > created_at
    if (lead.last_followup_at) {
      return new Date(lead.last_followup_at);
    }
    return new Date(lead.created_at);
  };

  const stagnantLeads = useMemo(() => {
    const today = new Date();
    
    return leads
      .map(lead => {
        const lastActivity = getLastActivityDate(lead);
        const daysSinceLastActivity = differenceInDays(today, lastActivity);
        const threshold = thresholds[lead.status];
        const isStagnant = enabledStatuses[lead.status] && daysSinceLastActivity >= threshold;

        return {
          ...lead,
          daysSinceLastActivity,
          threshold,
          isStagnant,
        } as StagnantLead;
      })
      .filter(lead => lead.isStagnant)
      .sort((a, b) => b.daysSinceLastActivity - a.daysSinceLastActivity);
  }, [leads, thresholds, enabledStatuses]);

  const getStagnantLeadsByStatus = (status: LeadStatus): StagnantLead[] => {
    return stagnantLeads.filter(lead => lead.status === status);
  };

  const isLeadStagnant = (lead: Lead): { isStagnant: boolean; daysSinceLastActivity: number; threshold: number } => {
    if (!enabledStatuses[lead.status]) {
      return { isStagnant: false, daysSinceLastActivity: 0, threshold: thresholds[lead.status] };
    }

    const lastActivity = getLastActivityDate(lead);
    const daysSinceLastActivity = differenceInDays(new Date(), lastActivity);
    const threshold = thresholds[lead.status];
    
    return {
      isStagnant: daysSinceLastActivity >= threshold,
      daysSinceLastActivity,
      threshold,
    };
  };

  const stagnantCount = stagnantLeads.length;

  const stagnantByStatus = useMemo(() => {
    const result: Record<LeadStatus, number> = {
      comment: 0,
      new: 0,
      contacted: 0,
      qualified: 0,
      not_qualified: 0,
      converted: 0,
      lost: 0,
    };

    stagnantLeads.forEach(lead => {
      result[lead.status]++;
    });

    return result;
  }, [stagnantLeads]);

  return {
    thresholds,
    enabledStatuses,
    updateThreshold,
    toggleStatusAlert,
    resetToDefaults,
    stagnantLeads,
    stagnantCount,
    stagnantByStatus,
    getStagnantLeadsByStatus,
    isLeadStagnant,
  };
};
