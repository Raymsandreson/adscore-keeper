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
  pushNotificationsEnabled: boolean; // browser push notifications
}

const STORAGE_KEY = 'conversion_alert_settings';

const DEFAULT_GLOBAL_MIN_RATE = 30; // 30% default threshold

export const useConversionAlerts = (
  board: KanbanBoard | null,
  leadsPerStage: Record<string, number>
) => {
  const notifiedRef = useRef<Set<string>>(new Set());
  const [settings, setSettings] = useState<BoardConversionSettings | null>(null);
  const permissionRef = useRef<NotificationPermission>('default');

  // Initialize permission check
  useEffect(() => {
    if ('Notification' in window) {
      permissionRef.current = Notification.permission;
    }
  }, []);

  // Load settings from localStorage
  const loadSettings = useCallback((boardId: string): BoardConversionSettings => {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY}_${boardId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...parsed,
          pushNotificationsEnabled: parsed.pushNotificationsEnabled ?? false,
        };
      }
    } catch (e) {
      console.error('Error loading conversion settings:', e);
    }
    return {
      boardId,
      enabled: true,
      globalMinRate: DEFAULT_GLOBAL_MIN_RATE,
      stageThresholds: [],
      pushNotificationsEnabled: false,
    };
  }, []);

  // Save settings to localStorage
  const saveSettings = useCallback((newSettings: BoardConversionSettings) => {
    localStorage.setItem(`${STORAGE_KEY}_${newSettings.boardId}`, JSON.stringify(newSettings));
    setSettings(newSettings);
    toast.success('Configurações de alerta salvas');
  }, []);

  // Request browser notification permission
  const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) {
      console.log('Browser does not support notifications');
      return false;
    }

    if (Notification.permission === 'granted') {
      permissionRef.current = 'granted';
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      permissionRef.current = permission;
      return permission === 'granted';
    }

    return false;
  }, []);

  // Send browser push notification
  const sendPushNotification = useCallback((title: string, body: string) => {
    if (
      permissionRef.current === 'granted' && 
      'Notification' in window && 
      settings?.pushNotificationsEnabled
    ) {
      new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: `conversion_${title}`,
        requireInteraction: true,
      });
    }
  }, [settings?.pushNotificationsEnabled]);

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

  // Trigger toast and push notifications for new alerts
  const triggerNotifications = useCallback((alerts: ReturnType<typeof checkConversionRates>) => {
    alerts.forEach(alert => {
      if (!notifiedRef.current.has(alert.key)) {
        notifiedRef.current.add(alert.key);
        
        const title = alert.severity === 'critical' 
          ? `🚨 Conversão Crítica` 
          : `⚠️ Conversão Baixa`;
        
        const message = `${alert.fromStage} → ${alert.toStage}: ${alert.currentRate}% (mínimo: ${alert.threshold}%)`;
        
        // Toast notification
        if (alert.severity === 'critical') {
          toast.error(title, { description: message, duration: 10000 });
        } else {
          toast.warning(title, { description: message, duration: 8000 });
        }

        // Push notification
        sendPushNotification(title, message);
      }
    });
  }, [sendPushNotification]);

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
    requestNotificationPermission,
    hasNotificationPermission: permissionRef.current === 'granted',
  };
};
