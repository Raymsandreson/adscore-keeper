import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { KanbanBoard } from './useKanbanBoards';

export interface ConversionThreshold {
  stageFromId: string;
  stageToId: string;
  minRate: number; // percentage 0-100
}

export interface BoardConversionSettings {
  boardId: string;
  enabled: boolean;
  globalMinRate: number; // default threshold for all stages
  stageThresholds: ConversionThreshold[]; // per-stage overrides
}

const STORAGE_KEY = 'conversion_alert_settings';
const NOTIFIED_KEY = 'conversion_alerts_notified';

const DEFAULT_GLOBAL_MIN_RATE = 30; // 30% default threshold

export const useConversionAlerts = (
  board: KanbanBoard | null,
  leadsPerStage: Record<string, number>
) => {
  const notifiedRef = useRef<Set<string>>(new Set());
  const [settings, setSettings] = useState<BoardConversionSettings | null>(null);

  // Load settings from localStorage
  const loadSettings = useCallback((boardId: string): BoardConversionSettings => {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY}_${boardId}`);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('Error loading conversion settings:', e);
    }
    return {
      boardId,
      enabled: true,
      globalMinRate: DEFAULT_GLOBAL_MIN_RATE,
      stageThresholds: [],
    };
  }, []);

  // Save settings to localStorage
  const saveSettings = useCallback((newSettings: BoardConversionSettings) => {
    localStorage.setItem(`${STORAGE_KEY}_${newSettings.boardId}`, JSON.stringify(newSettings));
    setSettings(newSettings);
    toast.success('Configurações de alerta salvas');
  }, []);

  // Get threshold for a specific stage transition
  const getThresholdForStage = useCallback((
    fromStageId: string,
    toStageId: string,
    boardSettings: BoardConversionSettings
  ): number => {
    const stageThreshold = boardSettings.stageThresholds.find(
      t => t.stageFromId === fromStageId && t.stageToId === toStageId
    );
    return stageThreshold?.minRate ?? boardSettings.globalMinRate;
  }, []);

  // Calculate conversion rates and check for alerts
  const checkConversionRates = useCallback(() => {
    if (!board?.stages?.length || !settings?.enabled) return [];

    const alerts: Array<{
      key: string;
      fromStage: string;
      toStage: string;
      currentRate: number;
      threshold: number;
      severity: 'warning' | 'critical';
    }> = [];

    for (let i = 0; i < board.stages.length - 1; i++) {
      const fromStage = board.stages[i];
      const toStage = board.stages[i + 1];
      
      const fromCount = leadsPerStage[fromStage.id] || 0;
      const toCount = leadsPerStage[toStage.id] || 0;
      
      // Skip if no leads in source stage
      if (fromCount === 0) continue;
      
      const conversionRate = Math.round((toCount / fromCount) * 100);
      const threshold = getThresholdForStage(fromStage.id, toStage.id, settings);
      
      if (conversionRate < threshold) {
        const key = `${fromStage.id}_${toStage.id}_${conversionRate}`;
        const severity = conversionRate < threshold * 0.5 ? 'critical' : 'warning';
        
        alerts.push({
          key,
          fromStage: fromStage.name,
          toStage: toStage.name,
          currentRate: conversionRate,
          threshold,
          severity,
        });
      }
    }

    return alerts;
  }, [board, leadsPerStage, settings, getThresholdForStage]);

  // Trigger toast notifications for new alerts
  const triggerNotifications = useCallback((alerts: ReturnType<typeof checkConversionRates>) => {
    alerts.forEach(alert => {
      if (!notifiedRef.current.has(alert.key)) {
        notifiedRef.current.add(alert.key);
        
        const title = alert.severity === 'critical' 
          ? `🚨 Conversão Crítica` 
          : `⚠️ Conversão Baixa`;
        
        const message = `${alert.fromStage} → ${alert.toStage}: ${alert.currentRate}% (mínimo: ${alert.threshold}%)`;
        
        if (alert.severity === 'critical') {
          toast.error(title, { description: message, duration: 10000 });
        } else {
          toast.warning(title, { description: message, duration: 8000 });
        }
      }
    });
  }, []);

  // Reset notifications when board changes
  const resetNotifications = useCallback(() => {
    notifiedRef.current.clear();
  }, []);

  // Load settings when board changes
  useEffect(() => {
    if (board?.id) {
      const loaded = loadSettings(board.id);
      setSettings(loaded);
      resetNotifications();
    }
  }, [board?.id, loadSettings, resetNotifications]);

  // Check and notify on data changes
  useEffect(() => {
    if (settings?.enabled) {
      const alerts = checkConversionRates();
      triggerNotifications(alerts);
    }
  }, [settings?.enabled, checkConversionRates, triggerNotifications]);

  return {
    settings,
    saveSettings,
    checkConversionRates,
    resetNotifications,
    getThresholdForStage,
  };
};
