import { useState, useEffect } from 'react';

export interface CardFieldsConfig {
  phone: boolean;
  email: boolean;
  campaign: boolean;
  conversionValue: boolean;
  followerBadge: boolean;
  classification: boolean;
  createdAt: boolean;
  syncStatus: boolean;
  city: boolean;
  state: boolean;
}

const DEFAULT_CONFIG: CardFieldsConfig = {
  phone: true,
  email: true,
  campaign: true,
  conversionValue: true,
  followerBadge: true,
  classification: true,
  createdAt: true,
  syncStatus: true,
  city: false,
  state: false,
};

const STORAGE_KEY = 'lead-card-fields-config';

export function useCardFieldsSettings() {
  const [config, setConfig] = useState<CardFieldsConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
      } catch {
        return DEFAULT_CONFIG;
      }
    }
    return DEFAULT_CONFIG;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const updateField = (field: keyof CardFieldsConfig, value: boolean) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const resetToDefaults = () => {
    setConfig(DEFAULT_CONFIG);
  };

  return {
    config,
    updateField,
    resetToDefaults,
  };
}
