import { useState, useEffect, useCallback } from 'react';
import { metaAPIService, MetaAPIConfig, AdInsights, CampaignInsight, DailyInsight, PlacementInsight } from '@/services/metaAPI';
import { SavedAccount, useMultiAccountSelection } from './useMultiAccountSelection';
import { DateRangeOption, MetricData } from './useMetaAPI';

export interface AggregatedMetrics {
  metrics: MetricData;
  campaigns: CampaignInsight[];
  adSets: CampaignInsight[];
  creatives: CampaignInsight[];
  dailyData: DailyInsight[];
  placementData: PlacementInsight[];
  isLoading: boolean;
  error: string | null;
  accountBreakdown: Map<string, MetricData>;
}

const emptyMetrics: MetricData = {
  cpc: 0,
  ctr: 0,
  cpm: 0,
  conversionRate: 0,
  hookRate: 0,
  spend: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0
};

// Aggregate metrics from multiple accounts
export const aggregateMetrics = (metricsArray: MetricData[]): MetricData => {
  if (metricsArray.length === 0) return emptyMetrics;
  if (metricsArray.length === 1) return metricsArray[0];

  const totals = metricsArray.reduce((acc, m) => ({
    spend: acc.spend + (m.spend || 0),
    impressions: acc.impressions + (m.impressions || 0),
    clicks: acc.clicks + (m.clicks || 0),
    conversions: acc.conversions + (m.conversions || 0),
    hookRate: acc.hookRate + (m.hookRate || 0) * (m.impressions || 0), // Weighted sum
  }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, hookRate: 0 });

  // Calculate weighted averages
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
  const conversionRate = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;
  const hookRate = totals.impressions > 0 ? totals.hookRate / totals.impressions : 0;

  return {
    cpc,
    ctr,
    cpm,
    conversionRate,
    hookRate,
    spend: totals.spend,
    impressions: totals.impressions,
    clicks: totals.clicks,
    conversions: totals.conversions
  };
};

// Aggregate daily data from multiple accounts
export const aggregateDailyData = (dailyArrays: DailyInsight[][]): DailyInsight[] => {
  if (dailyArrays.length === 0) return [];
  if (dailyArrays.length === 1) return dailyArrays[0];

  // Create a map by date
  const dateMap = new Map<string, DailyInsight>();

  dailyArrays.flat().forEach(day => {
    const existing = dateMap.get(day.date);
    if (existing) {
      const newSpend = existing.spend + day.spend;
      const newImpressions = existing.impressions + day.impressions;
      const newClicks = existing.clicks + day.clicks;
      const newConversions = existing.conversions + day.conversions;

      dateMap.set(day.date, {
        date: day.date,
        spend: newSpend,
        impressions: newImpressions,
        clicks: newClicks,
        conversions: newConversions,
        cpc: newClicks > 0 ? newSpend / newClicks : 0,
        ctr: newImpressions > 0 ? (newClicks / newImpressions) * 100 : 0,
        cpm: newImpressions > 0 ? (newSpend / newImpressions) * 1000 : 0,
        conversionRate: newClicks > 0 ? (newConversions / newClicks) * 100 : 0
      });
    } else {
      dateMap.set(day.date, { ...day });
    }
  });

  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
};

// Aggregate campaigns/adsets/creatives - combine by adding account prefix
export const aggregateCampaigns = (campaignArrays: CampaignInsight[][], accounts: SavedAccount[]): CampaignInsight[] => {
  if (campaignArrays.length === 0) return [];
  
  return campaignArrays.flatMap((campaigns, index) => {
    const accountName = accounts[index]?.name || `Conta ${index + 1}`;
    return campaigns.map(c => ({
      ...c,
      name: campaignArrays.length > 1 ? `[${accountName}] ${c.name}` : c.name,
      id: `${accounts[index]?.id || index}_${c.id}`
    }));
  });
};

// Aggregate placement data
export const aggregatePlacements = (placementArrays: PlacementInsight[][]): PlacementInsight[] => {
  if (placementArrays.length === 0) return [];
  if (placementArrays.length === 1) return placementArrays[0];

  const placementMap = new Map<string, PlacementInsight>();

  placementArrays.flat().forEach(placement => {
    const existing = placementMap.get(placement.placement);
    if (existing) {
      const newSpend = existing.spend + placement.spend;
      const newImpressions = existing.impressions + placement.impressions;
      const newClicks = existing.clicks + placement.clicks;
      const newConversions = existing.conversions + placement.conversions;

      placementMap.set(placement.placement, {
        ...existing,
        spend: newSpend,
        impressions: newImpressions,
        clicks: newClicks,
        conversions: newConversions,
        cpc: newClicks > 0 ? newSpend / newClicks : 0,
        ctr: newImpressions > 0 ? (newClicks / newImpressions) * 100 : 0,
        cpm: newImpressions > 0 ? (newSpend / newImpressions) * 1000 : 0,
        conversionRate: newClicks > 0 ? (newConversions / newClicks) * 100 : 0
      });
    } else {
      placementMap.set(placement.placement, { ...placement });
    }
  });

  return Array.from(placementMap.values());
};

export const useAggregatedMetrics = (dateRange: DateRangeOption = 'last_7d') => {
  const { activeAccounts, hasMultipleSelected, selectedCount } = useMultiAccountSelection();
  const [aggregatedData, setAggregatedData] = useState<AggregatedMetrics>({
    metrics: emptyMetrics,
    campaigns: [],
    adSets: [],
    creatives: [],
    dailyData: [],
    placementData: [],
    isLoading: false,
    error: null,
    accountBreakdown: new Map()
  });

  const fetchAllAccountsData = useCallback(async () => {
    if (activeAccounts.length === 0) {
      return;
    }

    setAggregatedData(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const results = await Promise.all(
        activeAccounts.map(async (account) => {
          const config: MetaAPIConfig = {
            accessToken: account.accessToken,
            accountId: account.accountId
          };

          try {
            const [insights, campaigns, adSets, creatives, daily, placements] = await Promise.all([
              metaAPIService.getAdInsights(config, dateRange),
              metaAPIService.getCampaignInsights(config, dateRange),
              metaAPIService.getAdSetInsights(config, dateRange),
              metaAPIService.getAdCreativeInsights(config, dateRange),
              metaAPIService.getDailyInsights(config, dateRange),
              metaAPIService.getPlacementInsights(config, dateRange)
            ]);

            return {
              accountId: account.id,
              accountName: account.name,
              success: true,
              data: {
                insights,
                campaigns,
                adSets,
                creatives,
                daily,
                placements
              }
            };
          } catch (error) {
            console.error(`Error fetching data for account ${account.name}:`, error);
            return {
              accountId: account.id,
              accountName: account.name,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            };
          }
        })
      );

      // Filter successful results
      const successfulResults = results.filter(r => r.success && r.data);
      
      if (successfulResults.length === 0) {
        setAggregatedData(prev => ({
          ...prev,
          isLoading: false,
          error: 'Não foi possível obter dados de nenhuma conta'
        }));
        return;
      }

      // Build account breakdown
      const accountBreakdown = new Map<string, MetricData>();
      successfulResults.forEach(result => {
        if (result.data) {
          accountBreakdown.set(result.accountId, result.data.insights);
        }
      });

      // Aggregate all data
      const allMetrics = successfulResults.map(r => r.data!.insights);
      const allCampaigns = successfulResults.map(r => r.data!.campaigns);
      const allAdSets = successfulResults.map(r => r.data!.adSets);
      const allCreatives = successfulResults.map(r => r.data!.creatives);
      const allDaily = successfulResults.map(r => r.data!.daily);
      const allPlacements = successfulResults.map(r => r.data!.placements);

      setAggregatedData({
        metrics: aggregateMetrics(allMetrics),
        campaigns: aggregateCampaigns(allCampaigns, activeAccounts),
        adSets: aggregateCampaigns(allAdSets, activeAccounts),
        creatives: aggregateCampaigns(allCreatives, activeAccounts),
        dailyData: aggregateDailyData(allDaily),
        placementData: aggregatePlacements(allPlacements),
        isLoading: false,
        error: null,
        accountBreakdown
      });

    } catch (error) {
      console.error('Error aggregating metrics:', error);
      setAggregatedData(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Erro ao agregar métricas'
      }));
    }
  }, [activeAccounts, dateRange]);

  // Fetch data when active accounts or date range changes
  useEffect(() => {
    if (activeAccounts.length > 0) {
      fetchAllAccountsData();
    }
  }, [activeAccounts.length, dateRange]); // Only re-fetch on account count or date range change

  return {
    ...aggregatedData,
    hasMultipleSelected,
    selectedCount,
    activeAccounts,
    refreshData: fetchAllAccountsData
  };
};
