
// In Tauri desktop mode, the backend URL is injected by the Rust shell
// via window.__VANTAGE_API_URL__ before the app loads.
declare global {
  interface Window {
    __VANTAGE_API_URL__?: string;
  }
}

const BASE_URL = window.__VANTAGE_API_URL__ || import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const getApiKey = () => localStorage.getItem('vantage_api_key');
export const getAccessToken = () => localStorage.getItem('vantage_access_token');

export const clearSession = () => {
  localStorage.removeItem('vantage_api_key');
  localStorage.removeItem('vantage_access_token');
  localStorage.removeItem('vantage_refresh_token');
  localStorage.removeItem('vantage_user');
  localStorage.removeItem('vantage_branding');
};

/** Attempt to refresh access token. Returns new token or null on failure. */
async function tryRefreshToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('vantage_refresh_token');
  if (!refreshToken) {
    console.warn('[api] No refresh token available.');
    return null;
  }

  try {
    const res = await fetch(
      `${BASE_URL}/auth/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );

    if (!res.ok) {
      console.warn('[api] Refresh token rejected by server.');
      return null;
    }

    const data = await res.json();
    if (!data.access_token) {
      console.warn('[api] Refresh response missing access_token.');
      return null;
    }

    localStorage.setItem('vantage_access_token', data.access_token);
    console.log('[api] Token successfully refreshed.');
    return data.access_token;
  } catch (err) {
    console.error('[api] Error during token refresh:', err);
    return null;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const apiKey = getApiKey();
  let token = getAccessToken();

  const buildHeaders = (tok: string | null) => {
    const h = new Headers(options.headers);
    if (apiKey) h.set('X-API-KEY', apiKey);
    if (tok) h.set('Authorization', `Bearer ${tok}`);
    if (!(options.body instanceof FormData) && !h.has('Content-Type')) {
      h.set('Content-Type', 'application/json');
    }
    return h;
  };

  // First attempt
  let response = await fetch(url, {
    ...options,
    headers: buildHeaders(token),
  });

  // If 401 and not a login/refresh request, try to silently refresh
  if (response.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/refresh')) {
    console.warn(`[api] 401 on ${path} — attempting token refresh.`);

    const newToken = await tryRefreshToken();
    if (newToken) {
      // Retry the original request with the new token
      response = await fetch(url, {
        ...options,
        headers: buildHeaders(newToken),
      });
    } else {
      // Refresh failed — clear session and force re-login
      clearSession();
      window.location.href = '/';
      throw new Error('Your session has expired. Please log in again.');
    }
  }

  if (!response.ok) {
    let errorDetail = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (Array.isArray(data.detail)) {
        // FastAPI 422 validation errors: [{loc, msg, type}, ...]
        errorDetail = data.detail.map((e: any) => e.msg || JSON.stringify(e)).join('; ');
      } else {
        errorDetail = data.detail || data.message || errorDetail;
      }
    } catch {
      errorDetail = response.statusText || errorDetail;
    }
    throw new Error(errorDetail);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  return response.text() as unknown as T;
}

export const api = {
  get: <T>(path: string, options?: RequestInit) =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: any, options?: RequestInit) =>
    request<T>(path, {
      ...options,
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  put: <T>(path: string, body?: any, options?: RequestInit) =>
    request<T>(path, {
      ...options,
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  patch: <T>(path: string, body?: any, options?: RequestInit) =>
    request<T>(path, {
      ...options,
      method: 'PATCH',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  delete: <T>(path: string, options?: RequestInit) =>
    request<T>(path, { ...options, method: 'DELETE' }),

  wsUrl: (path: string) => {
    const wsBase = BASE_URL.replace(/^http/, 'ws');
    const apiKey = getApiKey();
    const separator = path.includes('?') ? '&' : '?';
    return `${wsBase}${path}${apiKey ? `${separator}api_key=${apiKey}` : ''}`;
  },

  resolveUrl: (path: string | null | undefined) => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    if (path.startsWith('/')) return `${BASE_URL}${path}`;
    return path;
  }
};
