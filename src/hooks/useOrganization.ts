import { useEffect, useState, useCallback } from 'react';
import { db } from '@/integrations/supabase';

export interface Organization {
  id: string;
  name: string | null;
  logo_url: string | null;
  lawyer_name: string | null;
  oab_number: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  signature: string | null;
  is_active: boolean | null;
}

export function useOrganization() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await (db as any)
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      setError(error.message);
    } else {
      setOrganization(data as Organization | null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { organization, loading, error, reload: load };
}
