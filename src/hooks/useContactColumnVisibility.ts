import { useState, useEffect } from 'react';

export interface ContactColumnVisibility {
  name: boolean;
  phone: boolean;
  email: boolean;
  instagram: boolean;
  followerStatus: boolean;
  city: boolean;
  state: boolean;
  classification: boolean;
  status: boolean;
}

const DEFAULT_VISIBILITY: ContactColumnVisibility = {
  name: true,
  phone: true,
  email: true,
  instagram: true,
  followerStatus: true,
  city: true,
  state: true,
  classification: true,
  status: true,
};

const STORAGE_KEY = 'contact_column_visibility';

export function useContactColumnVisibility() {
  const [visibility, setVisibility] = useState<ContactColumnVisibility>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_VISIBILITY, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Error loading column visibility:', e);
    }
    return DEFAULT_VISIBILITY;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
    } catch (e) {
      console.error('Error saving column visibility:', e);
    }
  }, [visibility]);

  const toggleColumn = (column: keyof ContactColumnVisibility) => {
    setVisibility(prev => ({
      ...prev,
      [column]: !prev[column],
    }));
  };

  const resetToDefault = () => {
    setVisibility(DEFAULT_VISIBILITY);
  };

  return {
    visibility,
    toggleColumn,
    resetToDefault,
  };
}
