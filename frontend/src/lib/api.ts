/**
 * Core API utility for making standard fetch requests to the Vantage AI backend.
 * Automatically handles the X-API-KEY header and JWT Authorization header.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

/**
 * Session storage helpers
 */
export const getApiKey = (): string | null => localStorage.getItem('vantage_api_key');
export const getAccessToken = (): string | null => localStorage.getItem('vantage_access_token');
export const getRefreshToken = (): string | null => localStorage.getItem('vantage_refresh_token');

export const clearSession = () => {
  localStorage.removeItem('vantage_api_key');
  localStorage.removeItem('vantage_access_token');
  localStorage.removeItem('vantage_refresh_token');
  localStorage.removeItem('vantage_user');
  localStorage.removeItem('vantage_branding');
};

/**
 * Helper to construct URLs with query parameters
 */
const buildUrl = (endpoint: string, params?: Record<string, string>): string => {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }
  return url.toString();
};

let isRefreshing = false;

/**
 * Core fetch wrapper
 */
async function fetchApi<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const apiKey = getApiKey();
  const accessToken = getAccessToken();
  const { params, headers: customHeaders, ...customConfig } = options;

  const config: RequestInit = {
    ...customConfig,
  };

  const myHeaders = new Headers(customHeaders as any || {});

  if (apiKey) {
    myHeaders.set('X-API-KEY', apiKey);
  }

  if (accessToken) {
    myHeaders.set('Authorization', `Bearer ${accessToken}`);
  }

  if (!(config.body instanceof FormData) && !myHeaders.has('Content-Type')) {
    myHeaders.set('Content-Type', 'application/json');
  }
  config.headers = myHeaders;

  // Stringify body if it's an object and not FormData
  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }

  const url = buildUrl(endpoint, params);

  try {
    const response = await fetch(url, config);

    // Handle 401 Unauthorized (Stale token)
    if (response.status === 401 && !endpoint.includes('/auth/login')) {
      const refreshToken = getRefreshToken();

      if (refreshToken && !isRefreshing) {
        isRefreshing = true;
        try {
          // Attempt to refresh
          const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'refresh-token': refreshToken }
          });

          if (refreshRes.ok) {
            const data = await refreshRes.json();
            localStorage.setItem('vantage_access_token', data.access_token);
            isRefreshing = false;
            // Retry once
            return fetchApi(endpoint, options);
          }
        } catch (e) {
          console.error("Token refresh failed", e);
        }
        isRefreshing = false;
      }

      // If refresh failed or no token, clear and bounce
      clearSession();
      window.location.reload();
      throw new Error("Session expired. Please log in again.");
    }

    // Check if the response is JSON
    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.indexOf("application/json") !== -1) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      // Extract the most useful message from FastAPI's {detail: ...} format
      let errorMessage: string;
      if (data?.detail) {
        errorMessage = typeof data.detail === 'string'
          ? data.detail
          : data.detail?.message || JSON.stringify(data.detail);
      } else if (typeof data === 'string') {
        errorMessage = data;
      } else {
        errorMessage = response.statusText || `HTTP ${response.status}`;
      }
      throw new Error(errorMessage);
    }

    return data;
  } catch (error) {
    console.error(`API Error on ${endpoint}:`, error);
    throw error;
  }
}

// Export specific HTTP methods for cleaner usage
export const api = {
  get: <T>(endpoint: string, options?: RequestOptions) =>
    fetchApi<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, data?: any, options?: RequestOptions) =>
    fetchApi<T>(endpoint, { ...options, method: 'POST', body: data }),

  put: <T>(endpoint: string, data?: any, options?: RequestOptions) =>
    fetchApi<T>(endpoint, { ...options, method: 'PUT', body: data }),

  patch: <T>(endpoint: string, data?: any, options?: RequestOptions) =>
    fetchApi<T>(endpoint, { ...options, method: 'PATCH', body: data }),

  delete: <T>(endpoint: string, options?: RequestOptions) =>
    fetchApi<T>(endpoint, { ...options, method: 'DELETE' }),
};
