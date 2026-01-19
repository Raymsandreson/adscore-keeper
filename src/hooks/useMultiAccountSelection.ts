import { useState, useEffect, useCallback } from 'react';

export interface SavedAccount {
  id: string;
  name: string;
  accessToken: string;
  accountId: string;
}

export interface MultiAccountState {
  accounts: SavedAccount[];
  selectedAccountIds: string[];
  activeAccounts: SavedAccount[];
}

const STORAGE_KEY = "meta_saved_accounts";
const SELECTION_KEY = "meta_selected_account_ids";

export const useMultiAccountSelection = () => {
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  // Load saved accounts and selection on mount
  useEffect(() => {
    const savedAccounts = localStorage.getItem(STORAGE_KEY);
    if (savedAccounts) {
      try {
        const parsed = JSON.parse(savedAccounts);
        setAccounts(parsed);
        
        // Load previously selected accounts
        const savedSelection = localStorage.getItem(SELECTION_KEY);
        if (savedSelection) {
          const selection = JSON.parse(savedSelection);
          // Validate that selected IDs still exist
          const validSelection = selection.filter((id: string) => 
            parsed.some((acc: SavedAccount) => acc.id === id)
          );
          setSelectedAccountIds(validSelection);
        } else if (parsed.length > 0) {
          // Default to first account if no selection saved
          setSelectedAccountIds([parsed[0].id]);
        }
      } catch (e) {
        console.error("Error loading saved accounts:", e);
      }
    }
  }, []);

  // Save selection to localStorage when it changes
  useEffect(() => {
    if (selectedAccountIds.length > 0) {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(selectedAccountIds));
    }
  }, [selectedAccountIds]);

  // Get currently active (selected) accounts
  const activeAccounts = accounts.filter(acc => selectedAccountIds.includes(acc.id));

  // Toggle selection for an account
  const toggleAccountSelection = useCallback((accountId: string) => {
    setSelectedAccountIds(prev => {
      if (prev.includes(accountId)) {
        // Don't allow deselecting the last account
        if (prev.length === 1) return prev;
        return prev.filter(id => id !== accountId);
      } else {
        return [...prev, accountId];
      }
    });
  }, []);

  // Select all accounts
  const selectAllAccounts = useCallback(() => {
    setSelectedAccountIds(accounts.map(acc => acc.id));
  }, [accounts]);

  // Select only one account
  const selectSingleAccount = useCallback((accountId: string) => {
    setSelectedAccountIds([accountId]);
  }, []);

  // Check if an account is selected
  const isAccountSelected = useCallback((accountId: string) => {
    return selectedAccountIds.includes(accountId);
  }, [selectedAccountIds]);

  // Reload accounts from storage (useful after adding/removing accounts)
  const refreshAccounts = useCallback(() => {
    const savedAccounts = localStorage.getItem(STORAGE_KEY);
    if (savedAccounts) {
      try {
        const parsed = JSON.parse(savedAccounts);
        setAccounts(parsed);
        // Clean up selection for removed accounts
        setSelectedAccountIds(prev => 
          prev.filter(id => parsed.some((acc: SavedAccount) => acc.id === id))
        );
      } catch (e) {
        console.error("Error refreshing accounts:", e);
      }
    }
  }, []);

  // Get combined account IDs for filtering data
  const getActiveAccountIds = useCallback(() => {
    return activeAccounts.map(acc => acc.accountId);
  }, [activeAccounts]);

  return {
    accounts,
    selectedAccountIds,
    activeAccounts,
    toggleAccountSelection,
    selectAllAccounts,
    selectSingleAccount,
    isAccountSelected,
    refreshAccounts,
    getActiveAccountIds,
    hasMultipleSelected: selectedAccountIds.length > 1,
    selectedCount: selectedAccountIds.length,
  };
};
