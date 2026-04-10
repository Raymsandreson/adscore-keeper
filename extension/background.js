const SUPABASE_URL = 'https://gliigkupoebmlbwyvijp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_SESSION') {
    chrome.storage.local.get(['session'], (result) => {
      sendResponse({ session: result.session || null });
    });
    return true;
  }

  if (msg.type === 'LOGIN') {
    loginUser(msg.email, msg.password).then(sendResponse);
    return true;
  }

  if (msg.type === 'LOGOUT') {
    logoutUser().then(sendResponse);
    return true;
  }

  if (msg.type === 'API_CALL') {
    makeApiCall(msg.endpoint, msg.method, msg.body).then(sendResponse);
    return true;
  }

  if (msg.type === 'INVOKE_FUNCTION') {
    invokeFunction(msg.functionName, msg.body).then(sendResponse);
    return true;
  }
});

async function parseJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (_) {
    return { raw: text };
  }
}

function buildErrorMessage(res, data, fallbackMessage) {
  return data?.error_description || data?.error || data?.message || data?.msg || `${fallbackMessage} (${res.status})`;
}

async function loginUser(email, password) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await parseJsonResponse(res);
    if (!res.ok || data?.error) {
      return { error: buildErrorMessage(res, data, 'Falha ao fazer login') };
    }

    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user,
      expires_at: Date.now() + (data.expires_in * 1000),
    };

    await chrome.storage.local.set({ session });
    return { success: true, session };
  } catch (e) {
    return { error: e.message || 'Falha ao conectar no login' };
  }
}

async function logoutUser() {
  const { session } = await chrome.storage.local.get(['session']);

  if (session?.access_token) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
      });
    } catch (_) {}
  }

  await chrome.storage.local.remove(['session']);
  return { success: true };
}

async function refreshTokenIfNeeded() {
  const { session } = await chrome.storage.local.get(['session']);
  if (!session) return null;

  if (session.expires_at && Date.now() > session.expires_at - 300000) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });

      const data = await parseJsonResponse(res);
      if (!res.ok || !data?.access_token) {
        await chrome.storage.local.remove(['session']);
        return null;
      }

      const newSession = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user: data.user,
        expires_at: Date.now() + (data.expires_in * 1000),
      };

      await chrome.storage.local.set({ session: newSession });
      return newSession;
    } catch (_) {
      await chrome.storage.local.remove(['session']);
      return null;
    }
  }

  return session;
}

async function makeApiCall(endpoint, method = 'GET', body = null) {
  const session = await refreshTokenIfNeeded();
  if (!session) return { error: 'Não autenticado' };

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${session.access_token}`,
  };

  const options = { method, headers };
  if (body && method !== 'GET') options.body = JSON.stringify(body);

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
    const data = await parseJsonResponse(res);

    if (!res.ok) {
      return { error: buildErrorMessage(res, data, 'Falha na API'), data };
    }

    return { data };
  } catch (e) {
    return { error: e.message || 'Falha ao chamar a API' };
  }
}

async function invokeFunction(functionName, body = {}) {
  const session = await refreshTokenIfNeeded();
  if (!session) return { error: 'Não autenticado' };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await parseJsonResponse(res);
    if (!res.ok) {
      return { error: buildErrorMessage(res, data, 'Falha ao executar função'), data };
    }

    return { data };
  } catch (e) {
    return { error: e.message || 'Falha ao executar função' };
  }
}
