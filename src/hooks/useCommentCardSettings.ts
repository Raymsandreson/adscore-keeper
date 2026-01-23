import { useState, useEffect } from 'react';

export interface CommentCardFieldsConfig {
  followerStatus: boolean;
  classification: boolean;
  linkedLeads: boolean;
  connections: boolean;
}

const DEFAULT_CONFIG: CommentCardFieldsConfig = {
  followerStatus: true,
  classification: true,
  linkedLeads: true,
  connections: true,
};

const STORAGE_KEY = 'comment-card-fields-config';

export function useCommentCardSettings() {
  const [config, setConfig] = useState<CommentCardFieldsConfig>(() => {
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

  const updateField = (field: keyof CommentCardFieldsConfig, value: boolean) => {
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
