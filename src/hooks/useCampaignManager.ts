import { useState } from 'react';
import { toast } from 'sonner';

interface CampaignAction {
  action: 'update_status' | 'update_budget' | 'update_bid' | 'duplicate';
  entityId: string;
  entityType: 'campaign' | 'adset' | 'ad';
  status?: 'ACTIVE' | 'PAUSED';
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidAmount?: number;
  bidStrategy?: string;
  adAccountId?: string;
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

  const executeAction = async (params: Omit<CampaignAction, 'accessToken'>) => {
    const accessToken = getAccessToken();
    if (!accessToken) {
      toast.error('Token de acesso não encontrado. Conecte sua conta Meta primeiro.');
      return { success: false, error: 'No access token' };
    }

    setIsLoading(true);
    
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-campaign-manager`, {
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

  const updateStatus = async (entityId: string, entityType: 'campaign' | 'adset' | 'ad', status: 'ACTIVE' | 'PAUSED') => {
    const result = await executeAction({ action: 'update_status', entityId, entityType, status });
    if (result.success) {
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
    lifetimeBudget?: number
  ) => {
    const result = await executeAction({ 
      action: 'update_budget', 
      entityId, 
      entityType, 
      dailyBudget, 
      lifetimeBudget 
    });
    if (result.success) {
      toast.success('Orçamento atualizado com sucesso!');
    } else {
      toast.error(`Erro: ${result.error}`);
    }
    return result;
  };

  const updateBid = async (entityId: string, bidAmount?: number, bidStrategy?: string) => {
    const result = await executeAction({ 
      action: 'update_bid', 
      entityId, 
      entityType: 'adset',
      bidAmount, 
      bidStrategy 
    });
    if (result.success) {
      toast.success('Lance atualizado com sucesso!');
    } else {
      toast.error(`Erro: ${result.error}`);
    }
    return result;
  };

  const duplicate = async (entityId: string, entityType: 'campaign' | 'adset' | 'ad') => {
    const result = await executeAction({ 
      action: 'duplicate', 
      entityId, 
      entityType 
    });
    if (result.success) {
      toast.success(`${entityType === 'campaign' ? 'Campanha' : entityType === 'adset' ? 'Conjunto' : 'Anúncio'} duplicado com sucesso!`);
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
  };
};
