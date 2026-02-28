/**
 * Core API utility for making standard fetch requests to the Vantage AI backend.
 * Automatically handles the X-API-KEY header and JSON serialization.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

/**
 * Gets the current API key from local storage
 */
export const getApiKey = (): string | null => {
  return localStorage.getItem('vantage_api_key');
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

/**
 * Core fetch wrapper
 */
async function fetchApi<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const apiKey = getApiKey();
  const { params, headers: customHeaders, ...customConfig } = options;

  const config: RequestInit = {
    ...customConfig,
  };

  const myHeaders = new Headers(customHeaders as any || {});
  if (apiKey) {
    myHeaders.set('X-API-KEY', apiKey);
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

    // Check if the response is JSON
    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.indexOf("application/json") !== -1) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (response.status === 401) {
      // Clear stale api key and bounce back to auth screen
      localStorage.removeItem('vantage_api_key');
      window.location.reload();
      throw new Error("Unauthorized - invalid API key");
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
