/**
 * OfflineBanner — detects internet / LLM connectivity loss and shows a clear
 * banner instead of letting API calls fail with cryptic errors.
 *
 * Strategy:
 *  1. Browser's navigator.onLine provides instant on/off events.
 *  2. Backend /system/connectivity probe runs periodically and after each
 *     navigator.onLine → true event (confirms the backend can reach the LLM).
 *     Desktop binary probes every 15 s (web: 30 s) for faster feedback.
 *  3. Three states:
 *      - "online"         → nothing shown
 *      - "no_internet"    → "No internet connection" banner
 *      - "no_llm"         → "LLM provider unreachable" banner (internet ✓, LLM ✗)
 *  4. Auth errors (HTTP 401/403) are NOT treated as "no internet" — the backend
 *     is reachable, only the token is stale.  Only a true network failure
 *     (TypeError / no response) triggers the no_internet state.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { WifiOff, AlertTriangle, RefreshCw, X, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type ConnState = 'online' | 'no_internet' | 'no_llm' | 'checking';

interface ConnectivityResult {
  internet: boolean;
  llm: boolean;
  llm_provider: string;
  error: string | null;
}

interface OfflineBannerProps {
  /** If true, skip the probe (used for public / unauthenticated views). */
  skip?: boolean;
  /**
   * Pass true for the desktop binary so the probe interval is 15 s
   * (the cloud build uses 30 s).
   */
  desktop?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the HTTP status code embedded in an error thrown by the api helper,
 * or null if the error is a plain network failure (TypeError / no status).
 */
function httpStatus(err: unknown): number | null {
  if (err && typeof err === 'object') {
    // Our api wrapper typically sets err.status or err.response?.status
    const e = err as Record<string, any>;
    if (typeof e.status === 'number') return e.status;
    if (typeof e.response?.status === 'number') return e.response.status;
    // Some wrappers put the status in the message: "HTTP 401"
    if (typeof e.message === 'string') {
      const m = e.message.match(/\b(4\d\d|5\d\d)\b/);
      if (m) return parseInt(m[1], 10);
    }
  }
  return null;
}

/** True when the error clearly indicates an auth problem, not a network outage. */
function isAuthError(err: unknown): boolean {
  const s = httpStatus(err);
  return s === 401 || s === 403;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

function useConnectivity(skip: boolean, desktop: boolean) {
  const [state, setState]       = useState<ConnState>('online');
  const [provider, setProvider] = useState('');
  const [retrying, setRetrying] = useState(false);
  const probeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Desktop binary gets a tighter polling interval (15 s vs 30 s)
  const INTERVAL_MS = desktop ? 15_000 : 30_000;

  const probe = useCallback(async (quiet = false) => {
    if (skip) return;
    if (!quiet) setRetrying(true);
    try {
      const result = await api.get<ConnectivityResult>('/system/connectivity');
      setProvider(result.llm_provider);
      if (!result.internet) {
        setState('no_internet');
      } else if (!result.llm) {
        setState('no_llm');
      } else {
        setState('online');
      }
    } catch (err) {
      if (isAuthError(err)) {
        // Backend is reachable — this is an auth error, not a network outage.
        // Don't flip to "no_internet"; leave the previous state intact so the
        // banner doesn't fire spuriously while the token refresh is in flight.
        return;
      }
      // A TypeError ("Failed to fetch") or any non-auth HTTP error means we
      // can't reach the backend at all → treat as no_internet.
      setState('no_internet');
    } finally {
      setRetrying(false);
    }
  }, [skip]);

  // Schedule periodic probes
  const scheduleProbe = useCallback(() => {
    if (probeRef.current) clearTimeout(probeRef.current);
    probeRef.current = setTimeout(() => {
      probe(true).then(scheduleProbe);
    }, INTERVAL_MS);
  }, [probe, INTERVAL_MS]);

  useEffect(() => {
    if (skip) return;

    // Initial probe
    probe(true).then(scheduleProbe);

    // Browser online / offline events
    const handleOnline = () => {
      // Browser says we're back — re-probe immediately
      probe(true).then(scheduleProbe);
    };
    const handleOffline = () => {
      setState('no_internet');
    };

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (probeRef.current) clearTimeout(probeRef.current);
    };
  }, [skip, probe, scheduleProbe]);

  return { state, provider, retrying, probe };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OfflineBanner({ skip = false, desktop = false }: OfflineBannerProps) {
  const { state, provider, retrying, probe } = useConnectivity(skip, desktop);
  const [dismissed, setDismissed]   = useState(false);
  const [justRestored, setJustRestored] = useState(false);
  const prevState = useRef<ConnState>('online');

  // Flash "back online" for 3 s when connectivity restores
  useEffect(() => {
    if (prevState.current !== 'online' && state === 'online') {
      setDismissed(false);
      setJustRestored(true);
      const t = setTimeout(() => setJustRestored(false), 3000);
      return () => clearTimeout(t);
    }
    prevState.current = state;
  }, [state]);

  if (skip || (state === 'online' && !justRestored)) return null;
  if (dismissed && state !== 'online') return null;

  // ── "Back online" flash ────────────────────────────────────────────────────
  if (justRestored) {
    return (
      <div className="relative overflow-hidden transition-all duration-500">
        <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2.5">
          <div className="flex items-center justify-center gap-2 max-w-screen-xl mx-auto">
            <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
            <span className="text-sm font-semibold text-emerald-800">
              Connection restored — you're back online.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Offline banner ─────────────────────────────────────────────────────────
  const isNoInternet = state === 'no_internet';
  const providerLabel = provider
    ? provider.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'LLM provider';

  return (
    <div className="relative overflow-hidden">
      {/* Accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${isNoInternet ? 'bg-red-500' : 'bg-amber-500'}`} />

      <div className={`border-b px-4 py-3 ${
        isNoInternet
          ? 'bg-red-50 border-red-200'
          : 'bg-amber-50 border-amber-200'
      }`}>
        <div className="flex items-center justify-between max-w-screen-xl mx-auto gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`size-8 rounded-xl flex items-center justify-center text-white shadow-md shrink-0 ${
              isNoInternet ? 'bg-red-500' : 'bg-amber-500'
            }`}>
              {isNoInternet
                ? <WifiOff size={16} />
                : <AlertTriangle size={16} />}
            </div>

            <div className="min-w-0">
              <p className={`text-sm font-bold truncate ${isNoInternet ? 'text-red-900' : 'text-amber-900'}`}>
                {isNoInternet
                  ? 'No internet connection'
                  : `${providerLabel} is unreachable`}
              </p>
              <p className={`text-xs truncate ${isNoInternet ? 'text-red-700' : 'text-amber-700'}`}>
                {isNoInternet
                  ? 'AI queries and cloud features are unavailable until your connection returns.'
                  : `The internet is reachable but ${providerLabel} isn't responding. AI queries will fail until it's restored.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => probe()}
              disabled={retrying}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                isNoInternet
                  ? 'bg-white/80 border-red-200 text-red-700 hover:bg-white'
                  : 'bg-white/80 border-amber-200 text-amber-700 hover:bg-white'
              } disabled:opacity-50`}
              title="Check connection again"
            >
              <RefreshCw size={12} className={retrying ? 'animate-spin' : ''} />
              {retrying ? 'Checking…' : 'Retry'}
            </button>

            <button
              onClick={() => setDismissed(true)}
              className={`p-1.5 rounded-lg transition-colors ${
                isNoInternet
                  ? 'text-red-400 hover:text-red-600 hover:bg-red-100'
                  : 'text-amber-400 hover:text-amber-600 hover:bg-amber-100'
              }`}
              title="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
