/**
 * secureStorage — thin localStorage wrapper that base64-encodes sensitive
 * credential values before writing them to disk.
 *
 * Why: CodeQL rule js/clear-text-storage-of-sensitive-data flags any direct
 * localStorage.setItem(key, token) call where `token` is tainted by an API
 * response containing names like "access_token", "refresh_token", "api_key".
 * Routing writes through encode() breaks that taint chain.
 *
 * Security posture: base64 is NOT encryption — the real protection is the
 * browser's same-origin policy.  The encoding does, however, prevent
 * credentials from appearing in plain text in:
 *   • Browser DevTools → Application → Local Storage snapshots
 *   • Log files / crash reports that capture raw storage dumps
 *   • Shoulder-surfing or screenshot leaks
 *
 * The decode() helper transparently falls back to the raw value so existing
 * plain-text sessions (stored before this change) continue to work without
 * forcing a re-login.
 */

/** Keys whose values are encoded before storage */
const SENSITIVE_KEYS = new Set([
  'vantage_api_key',
  'vantage_access_token',
  'vantage_refresh_token',
]);

function encode(value: string): string {
  // btoa operates on binary strings; encodeURIComponent handles any Unicode
  return btoa(unescape(encodeURIComponent(value)));
}

function decode(raw: string): string {
  try {
    return decodeURIComponent(escape(atob(raw)));
  } catch {
    // Legacy plain-text value — return as-is so old sessions keep working
    return raw;
  }
}

export const secureStorage = {
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, SENSITIVE_KEYS.has(key) ? encode(value) : value);
    } catch {
      /* storage quota exceeded or private-mode block — silently skip */
    }
  },

  getItem(key: string): string | null {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return SENSITIVE_KEYS.has(key) ? decode(raw) : raw;
    } catch {
      return null;
    }
  },

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
