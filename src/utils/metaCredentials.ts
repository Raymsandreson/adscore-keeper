import { supabase } from "@/integrations/supabase/client";

type LegacyMetaAccount = {
  id?: string;
  accessToken?: string;
  accountId?: string;
  adAccountId?: string;
  ad_account_id?: string;
};

export interface MetaCredentials {
  accessToken: string | null;
  adAccountId: string | null;
}

const LEGACY_STORAGE_KEY = "meta_saved_accounts";
const LEGACY_SELECTED_ACCOUNT_KEY = "meta_selected_account";

function getLegacyMetaCredentials(): MetaCredentials {
  if (typeof window === "undefined") {
    return { accessToken: null, adAccountId: null };
  }

  try {
    const savedAccounts = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (savedAccounts) {
      const accounts = JSON.parse(savedAccounts) as LegacyMetaAccount[];
      const selectedId = localStorage.getItem(LEGACY_SELECTED_ACCOUNT_KEY);
      const selected = accounts.find((account) => account.id === selectedId) || accounts[0];

      if (selected?.accessToken) {
        return {
          accessToken: selected.accessToken,
          adAccountId: selected.accountId || selected.adAccountId || selected.ad_account_id || null,
        };
      }
    }

    return {
      accessToken: localStorage.getItem("meta_access_token"),
      adAccountId: localStorage.getItem("meta_ad_account_id"),
    };
  } catch (error) {
    console.error("[MetaCredentials] Error reading legacy Meta credentials:", error);
    return { accessToken: null, adAccountId: null };
  }
}

export async function getMetaCredentials(): Promise<MetaCredentials> {
  const selectedId = typeof window !== "undefined"
    ? localStorage.getItem(LEGACY_SELECTED_ACCOUNT_KEY)
    : null;

  try {
    const { data, error } = await supabase
      .from("meta_ad_accounts")
      .select("id, access_token, account_id")
      .order("created_at", { ascending: true });

    if (error) throw error;

    const selectedAccount = selectedId
      ? data?.find((account) => account.id === selectedId)
      : null;
    const account = selectedAccount || data?.[0];

    if (account?.access_token) {
      return {
        accessToken: account.access_token,
        adAccountId: account.account_id || null,
      };
    }
  } catch (error) {
    console.error("[MetaCredentials] Error fetching Meta credentials from database:", error);
  }

  return getLegacyMetaCredentials();
}