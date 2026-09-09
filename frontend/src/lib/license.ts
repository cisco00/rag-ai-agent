// ---------------------------------------------------------------------------
// License Manager — handles trial, freemium, and premium tiers for desktop
// ---------------------------------------------------------------------------

export type LicenseTier = 'trial' | 'freemium' | 'premium';

export interface LicenseStatus {
  tier: LicenseTier;
  installDate: string;        // ISO date string
  trialDaysRemaining: number; // 0 if expired
  trialDaysTotal: number;     // 30
  licenseKey: string | null;
  deviceId: string;
}

// Features that can be gated
export type GatedFeature =
  | 'export'
  | 'scheduled_reports'
  | 'advanced_analytics'
  | 'data_transformations'
  | 'insights'
  | 'integrations'
  | 'admin_panel'
  | 'unlimited_databases'
  | 'unlimited_queries'
  | 'unlimited_dashboards';

const TRIAL_DAYS = 30;
const STORAGE_PREFIX = 'vantage_desktop_';

// Simple license key validation (offline, no server needed for beta)
// Format: VANTAGE-XXXX-XXXX-XXXX where X is alphanumeric
const LICENSE_KEY_PATTERN = /^VANTAGE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// Freemium limits
export const FREEMIUM_LIMITS = {
  maxDatabases: 1,
  maxQueriesPerDay: 10,
  maxDashboards: 3,
} as const;

// Features available per tier
const TIER_FEATURES: Record<LicenseTier, Set<GatedFeature>> = {
  trial: new Set([
    'export', 'scheduled_reports', 'advanced_analytics',
    'data_transformations', 'insights', 'integrations',
    'admin_panel', 'unlimited_databases', 'unlimited_queries',
    'unlimited_dashboards',
  ]),
  premium: new Set([
    'export', 'scheduled_reports', 'advanced_analytics',
    'data_transformations', 'insights', 'integrations',
    'admin_panel', 'unlimited_databases', 'unlimited_queries',
    'unlimited_dashboards',
  ]),
  freemium: new Set<GatedFeature>(), // No gated features in freemium
};

function generateDeviceId(): string {
  // Generate a stable-ish device ID from available browser/system info
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
  ].join('|');

  // Simple hash
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'DEV-' + Math.abs(hash).toString(36).toUpperCase().padStart(8, '0');
}

function getStoredValue(key: string): string | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

function setStoredValue(key: string, value: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch { /* ignore storage errors */ }
}

export class LicenseManager {
  private _status: LicenseStatus;

  constructor() {
    this._status = this._initialize();
  }

  private _initialize(): LicenseStatus {
    // Get or create device ID
    let deviceId = getStoredValue('device_id');
    if (!deviceId) {
      deviceId = generateDeviceId();
      setStoredValue('device_id', deviceId);
    }

    // Get or set install date
    let installDate = getStoredValue('install_date');
    if (!installDate) {
      installDate = new Date().toISOString();
      setStoredValue('install_date', installDate);
    }

    // Check for saved license key
    const licenseKey = getStoredValue('license_key');

    // Calculate trial days remaining
    const installMs = new Date(installDate).getTime();
    const nowMs = Date.now();
    const daysPassed = Math.floor((nowMs - installMs) / (1000 * 60 * 60 * 24));
    const trialDaysRemaining = Math.max(0, TRIAL_DAYS - daysPassed);

    // Determine tier
    let tier: LicenseTier;
    if (licenseKey && this._validateKeyFormat(licenseKey)) {
      tier = 'premium';
    } else if (trialDaysRemaining > 0) {
      tier = 'trial';
    } else {
      tier = 'freemium';
    }

    // Track daily query count
    const today = new Date().toISOString().split('T')[0];
    const storedDate = getStoredValue('query_date');
    if (storedDate !== today) {
      setStoredValue('query_date', today);
      setStoredValue('query_count', '0');
    }

    return {
      tier,
      installDate,
      trialDaysRemaining,
      trialDaysTotal: TRIAL_DAYS,
      licenseKey,
      deviceId,
    };
  }

  private _validateKeyFormat(key: string): boolean {
    return LICENSE_KEY_PATTERN.test(key.trim().toUpperCase());
  }

  get status(): LicenseStatus {
    return { ...this._status };
  }

  get tier(): LicenseTier {
    return this._status.tier;
  }

  get isPremium(): boolean {
    return this._status.tier === 'premium';
  }

  get isTrial(): boolean {
    return this._status.tier === 'trial';
  }

  get isFreemium(): boolean {
    return this._status.tier === 'freemium';
  }

  get trialDaysRemaining(): number {
    return this._status.trialDaysRemaining;
  }

  /** Check if a specific gated feature is available in the current tier */
  hasFeature(feature: GatedFeature): boolean {
    return TIER_FEATURES[this._status.tier].has(feature);
  }

  /** Check and increment daily query count. Returns true if allowed. */
  canQuery(): boolean {
    if (this.hasFeature('unlimited_queries')) return true;

    const count = parseInt(getStoredValue('query_count') || '0', 10);
    if (count >= FREEMIUM_LIMITS.maxQueriesPerDay) return false;

    setStoredValue('query_count', String(count + 1));
    return true;
  }

  /** Get remaining queries for the day */
  get queriesRemaining(): number {
    if (this.hasFeature('unlimited_queries')) return Infinity;
    const count = parseInt(getStoredValue('query_count') || '0', 10);
    return Math.max(0, FREEMIUM_LIMITS.maxQueriesPerDay - count);
  }

  /** Activate a license key. Returns true on success. */
  activateLicense(key: string): boolean {
    const normalizedKey = key.trim().toUpperCase();
    if (!this._validateKeyFormat(normalizedKey)) {
      return false;
    }

    setStoredValue('license_key', normalizedKey);
    this._status.licenseKey = normalizedKey;
    this._status.tier = 'premium';
    return true;
  }

  /** Remove the current license key */
  deactivateLicense(): void {
    try {
      localStorage.removeItem(STORAGE_PREFIX + 'license_key');
    } catch { /* ignore */ }
    this._status.licenseKey = null;
    this._status = this._initialize();
  }
}

// Singleton instance
let _instance: LicenseManager | null = null;

export function getLicenseManager(): LicenseManager {
  if (!_instance) {
    _instance = new LicenseManager();
  }
  return _instance;
}

/** Check if running in Tauri desktop mode */
export function isDesktopMode(): boolean {
  return !!window.__VANTAGE_API_URL__;
}
