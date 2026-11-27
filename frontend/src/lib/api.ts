
// In Tauri desktop mode, the backend URL is injected by the Rust shell
// via window.__VANTAGE_API_URL__ before the app loads.
declare global {
  interface Window {
    __VANTAGE_API_URL__?: string;
    __TAURI_INTERNALS__?: any;
  }
}

import { secureStorage } from './secureStorage';

/** Check if running inside Tauri desktop wrapper */
export const isDesktopMode = (): boolean =>
  !!(window.__VANTAGE_API_URL__ || window.__TAURI_INTERNALS__);

/** Always read the latest backend URL (may be injected after initial load) */
const getBaseUrl = (): string =>
  window.__VANTAGE_API_URL__ || import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const getApiKey = () => secureStorage.getItem('vantage_api_key');
export const getAccessToken = () => secureStorage.getItem('vantage_access_token');

export const clearSession = () => {
  secureStorage.removeItem('vantage_api_key');
  secureStorage.removeItem('vantage_access_token');
  secureStorage.removeItem('vantage_refresh_token');
  localStorage.removeItem('vantage_user');
  localStorage.removeItem('vantage_branding');
};

/**
 * Singleton refresh promise — prevents concurrent 401 responses from each
 * triggering a separate refresh call. The backend rotates the refresh token
 * on every use (old token deleted), so a second concurrent call with the
 * same token would invalidate the first and cascade into a logout.
 */
let _refreshInFlight: Promise<string | null> | null = null;

/** Attempt to refresh access token. Returns new token or null on failure. */
async function tryRefreshToken(): Promise<string | null> {
  // If a refresh is already in flight, piggyback on it rather than starting
  // a new one (which would race against the token rotation).
  if (_refreshInFlight) return _refreshInFlight;

  const refreshToken = secureStorage.getItem('vantage_refresh_token');
  if (!refreshToken) {
    console.warn('[api] No refresh token available.');
    return null;
  }

  _refreshInFlight = (async () => {
    try {
      const res = await fetch(
        `${getBaseUrl()}/auth/refresh`,
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

      secureStorage.setItem('vantage_access_token', data.access_token);
      // The backend rotates the refresh token on every use — save the new one
      // so subsequent refreshes don't use the now-invalidated old token.
      if (data.refresh_token) {
        secureStorage.setItem('vantage_refresh_token', data.refresh_token);
      }
      console.log('[api] Token successfully refreshed.');
      return data.access_token;
    } catch (err) {
      console.error('[api] Error during token refresh:', err);
      return null;
    } finally {
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
}

/** Sleep helper */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;

  // In desktop mode, skip auth headers — no login required
  const desktopMode = isDesktopMode();
  const apiKey = desktopMode ? null : getApiKey();
  let token = desktopMode ? null : getAccessToken();

  const buildHeaders = (tok: string | null) => {
    const h = new Headers(options.headers);
    if (apiKey) h.set('X-API-KEY', apiKey);
    if (tok) h.set('Authorization', `Bearer ${tok}`);
    if (!(options.body instanceof FormData) && !h.has('Content-Type')) {
      h.set('Content-Type', 'application/json');
    }
    return h;
  };

  // In desktop mode, retry on network errors (backend may still be starting)
  const maxRetries = desktopMode ? 15 : 1;
  const retryDelay = 2000;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Re-read base URL on retry (may have been injected since last attempt)
      const retryUrl = attempt > 1
        ? (path.startsWith('http') ? path : `${getBaseUrl()}${path}`)
        : url;

      let response = await fetch(retryUrl, {
        ...options,
        headers: buildHeaders(token),
      });

      // If 401 and not a login/refresh request, try to silently refresh
      if (!desktopMode && response.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/refresh')) {
        console.warn(`[api] 401 on ${path} — attempting token refresh.`);

        const newToken = await tryRefreshToken();
        if (newToken) {
          response = await fetch(retryUrl, {
            ...options,
            headers: buildHeaders(newToken),
          });
        } else {
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

    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries && desktopMode) {
        console.warn(`[api] Attempt ${attempt}/${maxRetries} failed for ${path}. Retrying in ${retryDelay}ms...`, lastError.message);
        await sleep(retryDelay);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError || new Error('Request failed');
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
    const wsBase = getBaseUrl().replace(/^http/, 'ws');
    const apiKey = getApiKey();
    const separator = path.includes('?') ? '&' : '?';
    return `${wsBase}${path}${apiKey ? `${separator}api_key=${apiKey}` : ''}`;
  },

  resolveUrl: (path: string | null | undefined) => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    if (path.startsWith('/')) return `${getBaseUrl()}${path}`;
    return path;
  }
};
