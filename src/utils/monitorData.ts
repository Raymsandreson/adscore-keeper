const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/monitor-data';

export const monitorData = async (action: string, params: Record<string, any> = {}) => {
  const r = await fetch(EXT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  return r.json();
};
