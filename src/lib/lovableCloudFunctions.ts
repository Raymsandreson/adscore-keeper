// Helper to call Edge Functions deployed on Lovable Cloud
// Since the app connects to an external Supabase project for data,
// but Edge Functions are deployed on Lovable Cloud, we need to call them directly.

const LOVABLE_CLOUD_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
const LOVABLE_CLOUD_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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
      // Return the response itself for streaming
      return { data: response as any, error: null };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    console.error(`Cloud function ${functionName} error:`, err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
