import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';

export interface GoalForNotification {
  id: string;
  title: string;
  targetValue: number;
  currentValue: number;
  deadline: string;
  type: string;
}

interface NotificationSettings {
  lowProgressThreshold: number; // percentage below which to notify
  daysBeforeDeadline: number; // days before deadline to start notifying
  criticalDaysThreshold: number; // days for critical urgency
}

const DEFAULT_SETTINGS: NotificationSettings = {
  lowProgressThreshold: 50, // notify if below 50% with little time left
  daysBeforeDeadline: 7, // start notifying 7 days before
  criticalDaysThreshold: 3, // critical when 3 days or less
};

const STORAGE_KEY = 'goal_notification_settings';
const NOTIFIED_GOALS_KEY = 'goal_notifications_sent';

export const useGoalNotifications = (goals: GoalForNotification[]) => {
  const notifiedRef = useRef<Set<string>>(new Set());
  const permissionRef = useRef<NotificationPermission>('default');

  // Load settings from localStorage
  const getSettings = useCallback((): NotificationSettings => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Error loading goal notification settings:', e);
    }
    return DEFAULT_SETTINGS;
  }, []);

  // Save settings to localStorage
  const saveSettings = useCallback((settings: NotificationSettings) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, []);

  // Load previously notified goals (to avoid re-notifying on refresh)
  const loadNotifiedGoals = useCallback(() => {
    try {
      const stored = localStorage.getItem(NOTIFIED_GOALS_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        // Clear old notifications (older than 24h)
        const now = Date.now();
        const validNotifications = Object.entries(data).filter(
          ([, timestamp]) => now - (timestamp as number) < 24 * 60 * 60 * 1000
        );
        notifiedRef.current = new Set(validNotifications.map(([key]) => key));
      }
    } catch (e) {
      console.error('Error loading notified goals:', e);
    }
  }, []);

  // Save notified goal
  const saveNotifiedGoal = useCallback((key: string) => {
    try {
      const stored = localStorage.getItem(NOTIFIED_GOALS_KEY);
      const data = stored ? JSON.parse(stored) : {};
      data[key] = Date.now();
      localStorage.setItem(NOTIFIED_GOALS_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Error saving notified goal:', e);
    }
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
  const sendPushNotification = useCallback((title: string, body: string, tag: string) => {
    if (permissionRef.current === 'granted' && 'Notification' in window) {
      new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag,
        requireInteraction: true,
      });
    }
  }, []);

  // Calculate days remaining
  const getDaysRemaining = useCallback((deadline: string): number => {
    const deadlineDate = new Date(deadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    deadlineDate.setHours(0, 0, 0, 0);
    return Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }, []);

  // Check goals and send notifications
  const checkGoals = useCallback(() => {
    if (goals.length === 0) return;

    const settings = getSettings();
    const alerts: { key: string; title: string; message: string; type: 'critical' | 'warning' | 'info' }[] = [];

    goals.forEach(goal => {
      const daysRemaining = getDaysRemaining(goal.deadline);
      const progress = goal.targetValue > 0 ? (goal.currentValue / goal.targetValue) * 100 : 0;
      const progressPerDay = daysRemaining > 0 ? (goal.targetValue - goal.currentValue) / daysRemaining : 0;

      // Skip if goal is completed or expired
      if (progress >= 100 || daysRemaining < 0) return;

      // Critical: Very close to deadline with low progress
      if (daysRemaining <= settings.criticalDaysThreshold && progress < 80) {
        const key = `critical_${goal.id}_${daysRemaining}`;
        if (!notifiedRef.current.has(key)) {
          const remaining = goal.targetValue - goal.currentValue;
          alerts.push({
            key,
            title: `🚨 Meta Crítica: ${goal.title}`,
            message: `Faltam ${daysRemaining} dia${daysRemaining !== 1 ? 's' : ''} e ${progress.toFixed(0)}% concluído. Necessário ${progressPerDay.toFixed(1)}/dia para atingir.`,
            type: 'critical',
          });
        }
      }
      // Warning: Close to deadline with concerning progress
      else if (daysRemaining <= settings.daysBeforeDeadline) {
        // Calculate expected progress at this point
        const totalDays = Math.max(1, getDaysRemaining(goal.deadline) + (100 - progress) / (progress / Math.max(1, 30 - daysRemaining)));
        const expectedProgress = ((30 - daysRemaining) / 30) * 100; // Simple linear expectation
        
        if (progress < expectedProgress - 20) { // More than 20% behind schedule
          const key = `behind_${goal.id}_${Math.floor(progress / 10)}`;
          if (!notifiedRef.current.has(key)) {
            alerts.push({
              key,
              title: `⚠️ Meta Atrasada: ${goal.title}`,
              message: `Progresso de ${progress.toFixed(0)}% com ${daysRemaining} dias restantes. Acelere para ${progressPerDay.toFixed(1)}/dia.`,
              type: 'warning',
            });
          }
        }
      }

      // Low progress warning (regardless of time)
      if (progress < settings.lowProgressThreshold && daysRemaining <= 14) {
        const key = `low_${goal.id}_week_${Math.floor(daysRemaining / 7)}`;
        if (!notifiedRef.current.has(key)) {
          alerts.push({
            key,
            title: `📉 Baixo Progresso: ${goal.title}`,
            message: `Apenas ${progress.toFixed(0)}% concluído. Foco necessário para atingir a meta!`,
            type: 'info',
          });
        }
      }
    });

    // Send all alerts
    alerts.forEach(alert => {
      notifiedRef.current.add(alert.key);
      saveNotifiedGoal(alert.key);
      
      // Toast notification
      if (alert.type === 'critical') {
        toast.error(alert.title, { description: alert.message, duration: 15000 });
      } else if (alert.type === 'warning') {
        toast.warning(alert.title, { description: alert.message, duration: 10000 });
      } else {
        toast.info(alert.title, { description: alert.message, duration: 8000 });
      }

      // Push notification
      sendPushNotification(alert.title, alert.message, alert.key);
    });

    return alerts.length;
  }, [goals, getSettings, getDaysRemaining, sendPushNotification, saveNotifiedGoal]);

  // Reset notifications (for testing or manual reset)
  const resetNotifications = useCallback(() => {
    notifiedRef.current.clear();
    localStorage.removeItem(NOTIFIED_GOALS_KEY);
  }, []);

  // Initialize permission check and load notified goals
  useEffect(() => {
    if ('Notification' in window) {
      permissionRef.current = Notification.permission;
    }
    loadNotifiedGoals();
  }, [loadNotifiedGoals]);

  // Check goals when they change
  useEffect(() => {
    const timer = setTimeout(() => {
      checkGoals();
    }, 1000); // Small delay to avoid notification spam on load

    return () => clearTimeout(timer);
  }, [checkGoals]);

  // Periodic check (every 30 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      checkGoals();
    }, 30 * 60 * 1000);

    return () => clearInterval(interval);
  }, [checkGoals]);

  return {
    getSettings,
    saveSettings,
    requestNotificationPermission,
    resetNotifications,
    checkGoals,
    hasNotificationPermission: permissionRef.current === 'granted',
  };
};
