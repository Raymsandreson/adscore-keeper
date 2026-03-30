import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface CampaignAction {
  action: 'update_status' | 'update_budget' | 'update_bid' | 'duplicate' | 'update_creative';
  entityId: string;
  entityType: 'campaign' | 'adset' | 'ad';
  status?: 'ACTIVE' | 'PAUSED';
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidAmount?: number;
  bidStrategy?: string;
  adAccountId?: string;
  creativeData?: {
    title?: string;
    body?: string;
    linkDescription?: string;
    callToActionType?: string;
  };
}

interface LogActionParams {
  entityId: string;
  entityType: 'campaign' | 'adset' | 'ad';
  entityName?: string;
  action: 'pause' | 'activate' | 'update_budget' | 'update_bid' | 'duplicate' | 'update_creative';
  oldValue?: string;
  newValue?: string;
}

export const useCampaignManager = () => {
  const [isLoading, setIsLoading] = useState(false);

  const getAccessToken = (): string | null => {
    const savedAccounts = localStorage.getItem('meta_saved_accounts');
    if (savedAccounts) {
      const accounts = JSON.parse(savedAccounts);
      const selectedId = localStorage.getItem('meta_selected_account');
      const selected = accounts.find((a: any) => a.id === selectedId) || accounts[0];
      return selected?.accessToken || null;
    }
    return localStorage.getItem('meta_access_token');
  };

  const getAdAccountId = (): string | null => {
    const savedAccounts = localStorage.getItem('meta_saved_accounts');
    if (savedAccounts) {
      const accounts = JSON.parse(savedAccounts);
      const selectedId = localStorage.getItem('meta_selected_account');
      const selected = accounts.find((a: any) => a.id === selectedId) || accounts[0];
      return selected?.adAccountId || null;
    }
    return localStorage.getItem('meta_ad_account_id');
  };

  const logAction = async (params: LogActionParams) => {
    try {
      const adAccountId = getAdAccountId();
      await supabase.from('campaign_action_history').insert({
        entity_id: params.entityId,
        entity_type: params.entityType,
        entity_name: params.entityName || null,
        action: params.action,
        old_value: params.oldValue || null,
        new_value: params.newValue || null,
        ad_account_id: adAccountId,
      });
    } catch (error) {
      console.error('Error logging action:', error);
    }
  };

  const executeAction = async (params: Omit<CampaignAction, 'accessToken'>) => {
    const accessToken = getAccessToken();
    if (!accessToken) {
      toast.error('Token de acesso não encontrado. Conecte sua conta Meta primeiro.');
      return { success: false, error: 'No access token' };
    }

    setIsLoading(true);
    
    try {
      const response = await fetch(`https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/meta-campaign-manager`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...params,
          accessToken,
          adAccountId: params.adAccountId || getAdAccountId(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao executar ação');
      }

      return { success: true, data: data.data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error('Campaign action error:', error);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  };

  const updateStatus = async (
    entityId: string, 
    entityType: 'campaign' | 'adset' | 'ad', 
    status: 'ACTIVE' | 'PAUSED',
    entityName?: string
  ) => {
    const result = await executeAction({ action: 'update_status', entityId, entityType, status });
    if (result.success) {
      const action = status === 'PAUSED' ? 'pause' : 'activate';
      await logAction({
        entityId,
        entityType,
        entityName,
        action,
        newValue: status,
      });
      toast.success(`${entityType === 'campaign' ? 'Campanha' : entityType === 'adset' ? 'Conjunto' : 'Anúncio'} ${status === 'PAUSED' ? 'pausado' : 'ativado'} com sucesso!`);
    } else {
      toast.error(`Erro: ${result.error}`);
    }
    return result;
  };

  const updateBudget = async (
    entityId: string, 
    entityType: 'campaign' | 'adset', 
    dailyBudget?: number, 
    lifetimeBudget?: number,
    entityName?: string,
    oldBudget?: number
  ) => {
    const result = await executeAction({ 
      action: 'update_budget', 
      entityId, 
      entityType, 
      dailyBudget, 
      lifetimeBudget 
    });
    if (result.success) {
      const newValue = dailyBudget ? `R$ ${dailyBudget}/dia` : `R$ ${lifetimeBudget} total`;
      const oldValue = oldBudget ? `R$ ${oldBudget}` : undefined;
      await logAction({
        entityId,
        entityType,
        entityName,
        action: 'update_budget',
        oldValue,
        newValue,
      });
      toast.success('Orçamento atualizado com sucesso!');
    } else {
      toast.error(`Erro: ${result.error}`);
    }
    return result;
  };

  const updateBid = async (
    entityId: string, 
    bidAmount?: number, 
    bidStrategy?: string,
    entityName?: string,
    oldBid?: number
  ) => {
    const result = await executeAction({ 
      action: 'update_bid', 
      entityId, 
      entityType: 'adset',
      bidAmount, 
      bidStrategy 
    });
    if (result.success) {
      const newValue = bidAmount ? `R$ ${bidAmount}` : bidStrategy;
      const oldValue = oldBid ? `R$ ${oldBid}` : undefined;
      await logAction({
        entityId,
        entityType: 'adset',
        entityName,
        action: 'update_bid',
        oldValue,
        newValue,
      });
      toast.success('Lance atualizado com sucesso!');
    } else {
      toast.error(`Erro: ${result.error}`);
    }
    return result;
  };

  const duplicate = async (
    entityId: string, 
    entityType: 'campaign' | 'adset' | 'ad',
    entityName?: string
  ) => {
    const result = await executeAction({ 
      action: 'duplicate', 
      entityId, 
      entityType 
    });
    if (result.success) {
      await logAction({
        entityId,
        entityType,
        entityName,
        action: 'duplicate',
        newValue: result.data?.newId || 'Novo ID',
      });
      toast.success(`${entityType === 'campaign' ? 'Campanha' : entityType === 'adset' ? 'Conjunto' : 'Anúncio'} duplicado com sucesso!`);
    } else {
      toast.error(`Erro: ${result.error}`);
    }
    return result;
  };

  const updateCreative = async (
    adId: string,
    creativeData: {
      title?: string;
      body?: string;
      linkDescription?: string;
      callToActionType?: string;
    },
    entityName?: string
  ) => {
    const result = await executeAction({
      action: 'update_creative',
      entityId: adId,
      entityType: 'ad',
      creativeData,
    });
    if (result.success) {
      const updatedFields = Object.keys(creativeData).filter(k => creativeData[k as keyof typeof creativeData] !== undefined);
      await logAction({
        entityId: adId,
        entityType: 'ad',
        entityName,
        action: 'update_creative',
        newValue: `Campos atualizados: ${updatedFields.join(', ')}`,
      });
      toast.success('Copy do anúncio atualizado com sucesso!');
    } else {
      toast.error(`Erro: ${result.error}`);
    }
    return result;
  };

  return {
    isLoading,
    updateStatus,
    updateBudget,
    updateBid,
    duplicate,
    updateCreative,
  };
};
