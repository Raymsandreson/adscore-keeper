// Helper to call Edge Functions deployed on Lovable Cloud
// Since the app connects to an external Supabase project for data,
// but Edge Functions are deployed on Lovable Cloud, we need to call them directly.

const LOVABLE_CLOUD_URL = 'https://gliigkupoebmlbwyvijp.supabase.co';
const LOVABLE_CLOUD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38';

export async function invokeCloudFunction<T = any>(
  functionName: string,
  body?: Record<string, any>
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const url = `${LOVABLE_CLOUD_URL}/functions/v1/${functionName}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_CLOUD_ANON_KEY}`,
        'apikey': LOVABLE_CLOUD_ANON_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Function error ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      return { data: response as any, error: null };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    console.error(`Cloud function ${functionName} error:`, err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// Compatible proxy that mimics supabase.functions interface
// Use: replace `supabase.functions.invoke(...)` with `cloudFunctions.invoke(...)`
export const cloudFunctions = {
  invoke: async <T = any>(functionName: string, options?: { body?: any }): Promise<{ data: T | null; error: Error | null }> => {
    return invokeCloudFunction<T>(functionName, options?.body);
  }
};
