import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { metaAPIService, MetaAPIConfig } from '@/services/metaAPI';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

export interface UnifiedMetaCredentials {
  accessToken: string;
  accountId: string;
  pageId?: string;
  accountName?: string;
}

export interface MetaConnectionStatus {
  paid: boolean;
  organic: boolean;
  unified: boolean;
  lastSync?: Date;
}

export interface GoalBias {
  type: 'leads' | 'conversions' | 'revenue' | 'followers' | 'engagement' | 'cpc' | 'ctr';
  currentValue: number;
  targetValue: number;
  progress: number;
  daysLeft: number;
  dailyRequired: number;
  trend: 'up' | 'down' | 'stable';
  message: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface UnifiedMetrics {
  // Paid metrics
  paid: {
    cpc: number;
    ctr: number;
    cpm: number;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    leads: number;
  };
  // Organic metrics  
  organic: {
    followers: number;
    newFollowers: number;
    reach: number;
    impressions: number;
    engagement: number;
    likes: number;
    comments: number;
    shares: number;
  };
  // Calculated biases
  biases: GoalBias[];
}

const STORAGE_KEY = 'unified_meta_credentials';
const BIAS_CACHE_KEY = 'goal_biases_cache';

export const useUnifiedMetaConnection = () => {
  const [credentials, setCredentials] = useState<UnifiedMetaCredentials | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<MetaConnectionStatus>({
    paid: false,
    organic: false,
    unified: false
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unifiedMetrics, setUnifiedMetrics] = useState<UnifiedMetrics | null>(null);
  const [biases, setBiases] = useState<GoalBias[]>([]);

  // Load saved credentials on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCredentials(parsed);
        // Auto-validate on load
        validateAndConnect(parsed);
      } catch (e) {
        console.error('Error loading saved credentials:', e);
      }
    }
  }, []);

  // Calculate goal biases based on current metrics and goals
  const calculateBiases = useCallback((metrics: UnifiedMetrics, goals: any[]): GoalBias[] => {
    const biases: GoalBias[] = [];
    
    goals.forEach(goal => {
      const now = new Date();
      const deadline = new Date(goal.deadline);
      const daysLeft = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      
      let currentValue = goal.currentValue;
      let targetValue = goal.targetValue;
      
      // Map goal type to actual metric
      switch (goal.type) {
        case 'leads':
          currentValue = metrics.paid.leads || currentValue;
          break;
        case 'conversions':
          currentValue = metrics.paid.conversions || currentValue;
          break;
        case 'followers':
          currentValue = metrics.organic.followers || currentValue;
          break;
        case 'engagement':
          currentValue = metrics.organic.engagement || currentValue;
          break;
        case 'cpc':
          currentValue = metrics.paid.cpc || currentValue;
          break;
        case 'ctr':
          currentValue = metrics.paid.ctr || currentValue;
          break;
      }

      const progress = goal.type === 'cpc' 
        ? (currentValue <= targetValue ? 100 : Math.max(0, (1 - (currentValue - targetValue) / currentValue) * 100))
        : Math.min(100, (currentValue / targetValue) * 100);

      const remaining = goal.type === 'cpc' 
        ? Math.max(0, currentValue - targetValue)
        : Math.max(0, targetValue - currentValue);
      
      const dailyRequired = daysLeft > 0 ? remaining / daysLeft : remaining;

      // Calculate trend based on recent performance
      const trend: 'up' | 'down' | 'stable' = progress > 70 ? 'up' : progress < 30 ? 'down' : 'stable';

      // Determine urgency
      let urgency: GoalBias['urgency'] = 'low';
      if (daysLeft <= 3 && progress < 80) urgency = 'critical';
      else if (daysLeft <= 7 && progress < 60) urgency = 'high';
      else if (progress < 40) urgency = 'medium';

      // Generate motivational message with bias
      const message = generateBiasMessage(goal.type, progress, daysLeft, dailyRequired, urgency);

      biases.push({
        type: goal.type,
        currentValue,
        targetValue,
        progress,
        daysLeft,
        dailyRequired,
        trend,
        message,
        urgency
      });
    });

    return biases;
  }, []);

  // Generate motivational bias messages
  const generateBiasMessage = (
    type: string,
    progress: number,
    daysLeft: number,
    dailyRequired: number,
    urgency: string
  ): string => {
    const typeLabels: Record<string, string> = {
      leads: 'leads',
      conversions: 'conversões',
      revenue: 'de receita',
      followers: 'seguidores',
      engagement: 'de engajamento',
      cpc: 'no CPC',
      ctr: 'de CTR'
    };

    if (progress >= 100) {
      return `🎉 Meta de ${typeLabels[type]} atingida! Continue assim!`;
    }

    if (urgency === 'critical') {
      return `⚠️ URGENTE: ${daysLeft} dia${daysLeft !== 1 ? 's' : ''} restante${daysLeft !== 1 ? 's' : ''}! Precisa de ${dailyRequired.toFixed(1)} ${typeLabels[type]}/dia`;
    }

    if (urgency === 'high') {
      return `🔥 Acelere! Meta de ${typeLabels[type]} precisa de ${dailyRequired.toFixed(1)}/dia para atingir em ${daysLeft} dias`;
    }

    if (progress >= 70) {
      return `💪 Quase lá! ${(100 - progress).toFixed(0)}% restante para a meta de ${typeLabels[type]}`;
    }

    if (progress >= 40) {
      return `📈 No caminho certo! ${dailyRequired.toFixed(1)} ${typeLabels[type]}/dia para atingir a meta`;
    }

    return `🎯 Foco em ${typeLabels[type]}: ${dailyRequired.toFixed(1)}/dia nos próximos ${daysLeft} dias`;
  };

  // Validate and connect with unified credentials
  const validateAndConnect = useCallback(async (creds: UnifiedMetaCredentials) => {
    setIsConnecting(true);
    setError(null);

    try {
      // Validate token
      const isTokenValid = await metaAPIService.validateToken(creds.accessToken);
      if (!isTokenValid) {
        throw new Error('Access Token inválido');
      }

      // Validate ads account
      let paidConnected = false;
      if (creds.accountId) {
        const accountValidation = await metaAPIService.validateAccount(creds.accessToken, creds.accountId);
        paidConnected = accountValidation.valid;
      }

      // Check organic permissions by testing page access
      let organicConnected = false;
      try {
        const pagesResponse = await fetch(
          `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${creds.accessToken}`
        );
        const pagesData = await pagesResponse.json();
        organicConnected = pagesData.data && pagesData.data.length > 0;
        
        // Auto-set pageId if not provided
        if (organicConnected && !creds.pageId && pagesData.data[0]) {
          creds.pageId = pagesData.data[0].id;
        }
      } catch (e) {
        console.warn('Could not validate organic permissions:', e);
      }

      setConnectionStatus({
        paid: paidConnected,
        organic: organicConnected,
        unified: paidConnected && organicConnected,
        lastSync: new Date()
      });

      // Save credentials
      localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
      setCredentials(creds);

      return { paid: paidConnected, organic: organicConnected };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao conectar';
      setError(errorMessage);
      setConnectionStatus({ paid: false, organic: false, unified: false });
      return { paid: false, organic: false };
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // Connect to Meta (unified)
  const connect = useCallback(async (creds: UnifiedMetaCredentials) => {
    return validateAndConnect(creds);
  }, [validateAndConnect]);

  // Disconnect
  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setCredentials(null);
    setConnectionStatus({ paid: false, organic: false, unified: false });
    setUnifiedMetrics(null);
    setBiases([]);
    setError(null);
  }, []);

  // Fetch unified metrics (paid + organic)
  const fetchUnifiedMetrics = useCallback(async (period: number = 7) => {
    if (!credentials) return null;

    try {
      // Fetch both in parallel
      const [paidResult, organicResult] = await Promise.all([
        // Paid metrics from service
        connectionStatus.paid 
          ? metaAPIService.getAdInsights({
              accessToken: credentials.accessToken,
              accountId: credentials.accountId
            }, 'last_7d')
          : null,
        // Organic metrics from edge function
        connectionStatus.organic
          ? cloudFunctions.invoke('fetch-organic-insights', {
              body: { 
                pageId: credentials.pageId, 
                accessToken: credentials.accessToken, 
                period 
              }
            })
          : { data: null }
      ]);

      const organicData = organicResult?.data?.platforms?.[0]?.insights;

      const metrics: UnifiedMetrics = {
        paid: {
          cpc: paidResult?.cpc || 0,
          ctr: paidResult?.ctr || 0,
          cpm: paidResult?.cpm || 0,
          spend: paidResult?.spend || 0,
          impressions: paidResult?.impressions || 0,
          clicks: paidResult?.clicks || 0,
          conversions: paidResult?.conversions || 0,
          leads: paidResult?.conversions || 0 // Map conversions to leads
        },
        organic: {
          followers: organicData?.totalFollowers || 0,
          newFollowers: organicData?.newFollowers || 0,
          reach: organicData?.reach || 0,
          impressions: organicData?.impressions || 0,
          engagement: organicData?.engagementRate || 0,
          likes: organicData?.likes || 0,
          comments: organicData?.comments || 0,
          shares: organicData?.shares || 0
        },
        biases: []
      };

      // Load goals and calculate biases
      const savedGoals = localStorage.getItem('marketing_goals');
      if (savedGoals) {
        const goals = JSON.parse(savedGoals);
        metrics.biases = calculateBiases(metrics, goals);
        setBiases(metrics.biases);
      }

      setUnifiedMetrics(metrics);
      setConnectionStatus(prev => ({ ...prev, lastSync: new Date() }));

      return metrics;
    } catch (err) {
      console.error('Error fetching unified metrics:', err);
      return null;
    }
  }, [credentials, connectionStatus, calculateBiases]);

  // Get motivational nudges based on current biases
  const getMotivationalNudges = useCallback(() => {
    return biases
      .filter(b => b.urgency !== 'low' || b.progress < 50)
      .sort((a, b) => {
        const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      })
      .slice(0, 3);
  }, [biases]);

  return {
    credentials,
    connectionStatus,
    isConnecting,
    error,
    unifiedMetrics,
    biases,
    connect,
    disconnect,
    fetchUnifiedMetrics,
    getMotivationalNudges,
    calculateBiases
  };
};
