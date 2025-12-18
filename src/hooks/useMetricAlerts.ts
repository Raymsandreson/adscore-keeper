import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { MetricData } from './useMetaAPI';

export interface AlertThresholds {
  cpcMax: number;
  ctrMin: number;
  spendMax: number;
  conversionRateMin: number;
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  cpcMax: 3.0,
  ctrMin: 1.0,
  spendMax: 10000,
  conversionRateMin: 1.0,
};

const STORAGE_KEY = 'metric_alert_thresholds';
const NOTIFIED_KEY = 'metric_alerts_notified';

export const useMetricAlerts = (metrics: MetricData, isConnected: boolean) => {
  const notifiedRef = useRef<Set<string>>(new Set());
  const permissionRef = useRef<NotificationPermission>('default');

  // Load thresholds from localStorage
  const getThresholds = useCallback((): AlertThresholds => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_THRESHOLDS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Error loading thresholds:', e);
    }
    return DEFAULT_THRESHOLDS;
  }, []);

  // Save thresholds to localStorage
  const saveThresholds = useCallback((thresholds: AlertThresholds) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds));
  }, []);

  // Request browser notification permission
  const requestNotificationPermission = useCallback(async () => {
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
    if (permissionRef.current === 'granted' && 'Notification' in window) {
      new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: title,
        requireInteraction: true,
      });
    }
  }, []);

  // Check metrics and send alerts
  const checkMetrics = useCallback(() => {
    if (!isConnected) return;

    const thresholds = getThresholds();
    const alerts: { key: string; title: string; message: string; type: 'warning' | 'error' }[] = [];

    // CPC Alto
    if (metrics.cpc > thresholds.cpcMax) {
      const key = `cpc_${metrics.cpc.toFixed(2)}`;
      if (!notifiedRef.current.has(key)) {
        alerts.push({
          key,
          title: '⚠️ CPC Alto',
          message: `CPC atual R$ ${metrics.cpc.toFixed(2)} ultrapassou o limite de R$ ${thresholds.cpcMax.toFixed(2)}`,
          type: 'warning',
        });
      }
    }

    // CTR Baixo
    if (metrics.ctr < thresholds.ctrMin) {
      const key = `ctr_${metrics.ctr.toFixed(2)}`;
      if (!notifiedRef.current.has(key)) {
        alerts.push({
          key,
          title: '⚠️ CTR Baixo',
          message: `CTR atual ${metrics.ctr.toFixed(2)}% está abaixo do mínimo de ${thresholds.ctrMin.toFixed(2)}%`,
          type: 'warning',
        });
      }
    }

    // Gasto Alto
    if (metrics.spend > thresholds.spendMax) {
      const key = `spend_${Math.floor(metrics.spend)}`;
      if (!notifiedRef.current.has(key)) {
        alerts.push({
          key,
          title: '🚨 Gasto Elevado',
          message: `Gasto total R$ ${metrics.spend.toLocaleString('pt-BR')} ultrapassou o limite de R$ ${thresholds.spendMax.toLocaleString('pt-BR')}`,
          type: 'error',
        });
      }
    }

    // Taxa de Conversão Baixa
    if (metrics.conversionRate < thresholds.conversionRateMin) {
      const key = `conversion_${metrics.conversionRate.toFixed(2)}`;
      if (!notifiedRef.current.has(key)) {
        alerts.push({
          key,
          title: '⚠️ Conversão Baixa',
          message: `Taxa de conversão ${metrics.conversionRate.toFixed(2)}% está abaixo do mínimo de ${thresholds.conversionRateMin.toFixed(2)}%`,
          type: 'warning',
        });
      }
    }

    // Send all alerts
    alerts.forEach(alert => {
      notifiedRef.current.add(alert.key);
      
      // Toast notification
      if (alert.type === 'error') {
        toast.error(alert.title, { description: alert.message, duration: 10000 });
      } else {
        toast.warning(alert.title, { description: alert.message, duration: 8000 });
      }

      // Push notification
      sendPushNotification(alert.title, alert.message);
    });
  }, [metrics, isConnected, getThresholds, sendPushNotification]);

  // Reset notifications when metrics improve
  const resetNotifications = useCallback(() => {
    notifiedRef.current.clear();
  }, []);

  // Initialize permission check
  useEffect(() => {
    if ('Notification' in window) {
      permissionRef.current = Notification.permission;
    }
  }, []);

  // Check metrics on change
  useEffect(() => {
    checkMetrics();
  }, [checkMetrics]);

  return {
    getThresholds,
    saveThresholds,
    requestNotificationPermission,
    resetNotifications,
    hasNotificationPermission: permissionRef.current === 'granted',
  };
};
