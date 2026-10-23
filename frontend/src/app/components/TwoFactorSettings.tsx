/**
 * TwoFactorSettings.tsx — Feature #9: Two-Factor Authentication (TOTP)
 *
 * Renders a self-contained settings panel that lets the authenticated user:
 *   • See whether 2FA is currently enabled
 *   • Enable 2FA: shows a QR code + manual key, then asks for the first code
 *   • Disable 2FA: asks for a current code to confirm identity
 */

import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import {
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  KeyRound,
  QrCode,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react';

/* ─────────────────────── helpers ─────────────────────────────────────────── */

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

/* ─────────────────────── sub-components ──────────────────────────────────── */

function CodeInput({
  value,
  onChange,
  label = 'Authenticator code',
  placeholder = '000000',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
        {label}
      </label>
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder={placeholder}
        className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl text-center text-2xl font-mono tracking-[0.5em] text-slate-800 focus:outline-none focus:border-blue-500 transition-colors"
      />
    </div>
  );
}

/* ─────────────────────── main component ──────────────────────────────────── */

type Phase = 'loading' | 'disabled' | 'setup-qr' | 'setup-confirm' | 'enabled' | 'disable-confirm';

export function TwoFactorSettings() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [qrCode, setQrCode] = useState<string>('');
  const [manualKey, setManualKey] = useState<string>('');
  const [showManualKey, setShowManualKey] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  /* load current status --------------------------------------------------- */
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ enabled: boolean }>('/auth/totp/status');
        setPhase(res.enabled ? 'enabled' : 'disabled');
      } catch {
        setPhase('disabled');
      }
    })();
  }, []);

  /* ── begin setup ─────────────────────────────────────────────────────── */
  async function handleBeginSetup() {
    setIsBusy(true);
    setError(null);
    try {
      const res = await api.post<{ qr_code: string; manual_entry_key: string; secret: string }>(
        '/auth/totp/setup',
        {}
      );
      setQrCode(res.qr_code);
      setManualKey(res.manual_entry_key ?? res.secret);
      setCode('');
      setPhase('setup-qr');
    } catch (e: any) {
      setError(e.message || 'Failed to start 2FA setup');
    } finally {
      setIsBusy(false);
    }
  }

  /* ── proceed from QR → confirm ─────────────────────────────────────── */
  function handleQrNext() {
    setCode('');
    setError(null);
    setPhase('setup-confirm');
  }

  /* ── confirm setup ────────────────────────────────────────────────── */
  async function handleConfirmSetup() {
    if (code.length !== 6) { setError('Enter the 6-digit code'); return; }
    setIsBusy(true);
    setError(null);
    try {
      await api.post('/auth/totp/confirm', { code });
      setSuccess('Two-factor authentication is now active!');
      setPhase('enabled');
    } catch (e: any) {
      setError(e.message || 'Invalid code — try again');
    } finally {
      setIsBusy(false);
    }
  }

  /* ── disable 2FA ──────────────────────────────────────────────────── */
  async function handleDisable() {
    if (code.length !== 6) { setError('Enter the 6-digit code'); return; }
    setIsBusy(true);
    setError(null);
    try {
      await api.post('/auth/totp/disable', { code });
      setSuccess('Two-factor authentication has been disabled.');
      setPhase('disabled');
    } catch (e: any) {
      setError(e.message || 'Invalid code');
    } finally {
      setIsBusy(false);
    }
  }

  /* ─────────────────────────── render ──────────────────────────────────── */
  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-2xl bg-blue-50">
          <ShieldCheck className="size-7 text-blue-600" />
        </div>
        <div>
          <h2 className="text-xl font-black text-slate-900">Two-Factor Authentication</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Add an extra layer of security to your account using a time-based one-time password.
          </p>
        </div>
      </div>

      {/* Status badge */}
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
          phase === 'enabled' || phase === 'disable-confirm'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-slate-50 border-slate-200 text-slate-600'
        }`}
      >
        {phase === 'enabled' || phase === 'disable-confirm' ? (
          <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
        ) : (
          <ShieldAlert className="size-5 text-slate-400 shrink-0" />
        )}
        <span className="text-sm font-semibold">
          {phase === 'enabled' || phase === 'disable-confirm'
            ? '2FA is enabled on your account'
            : '2FA is not enabled'}
        </span>
      </div>

      {/* Success message */}
      {success && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
          <CheckCircle2 className="size-5 shrink-0" />
          <span className="text-sm font-medium">{success}</span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-medium">
          {error}
        </div>
      )}

      {/* ── Phase: disabled — offer to enable ─────────────────────────── */}
      {phase === 'disabled' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <p className="text-sm text-slate-600">
            With 2FA enabled, you'll need to enter a code from your authenticator app
            (Google Authenticator, Authy, etc.) each time you sign in.
          </p>
          <button
            onClick={handleBeginSetup}
            disabled={isBusy}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isBusy ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
            Enable Two-Factor Authentication
          </button>
        </div>
      )}

      {/* ── Phase: setup-qr — show QR code ────────────────────────────── */}
      {phase === 'setup-qr' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="font-bold text-slate-800 mb-1">Step 1 — Scan the QR Code</h3>
            <p className="text-sm text-slate-500">
              Open your authenticator app and scan the QR code below.
            </p>
          </div>

          {qrCode && (
            <div className="flex justify-center">
              <img
                src={qrCode}
                alt="2FA QR Code"
                className="size-48 rounded-xl border border-slate-200 shadow"
              />
            </div>
          )}

          {/* Manual entry key */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Can't scan? Enter this key manually:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono text-slate-700 break-all">
                {showManualKey ? manualKey : '••••••••••••••••••••••••••••••••'}
              </code>
              <button
                onClick={() => setShowManualKey((s) => !s)}
                className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
                title={showManualKey ? 'Hide key' : 'Show key'}
              >
                {showManualKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              <button
                onClick={() => copyToClipboard(manualKey)}
                className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
                title="Copy key"
              >
                <Copy className="size-4" />
              </button>
            </div>
          </div>

          <button
            onClick={handleQrNext}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors"
          >
            I've added it to my app →
          </button>
        </div>
      )}

      {/* ── Phase: setup-confirm — verify first code ─────────────────── */}
      {phase === 'setup-confirm' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="font-bold text-slate-800 mb-1">Step 2 — Verify the Code</h3>
            <p className="text-sm text-slate-500">
              Enter the 6-digit code from your authenticator app to confirm setup.
            </p>
          </div>

          <CodeInput value={code} onChange={setCode} />

          <div className="flex gap-3">
            <button
              onClick={() => { setPhase('setup-qr'); setError(null); }}
              className="flex-1 py-3 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={handleConfirmSetup}
              disabled={isBusy || code.length !== 6}
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isBusy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              Activate 2FA
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: enabled — offer to disable ────────────────────────── */}
      {phase === 'enabled' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <p className="text-sm text-slate-600">
            Your account is protected by two-factor authentication. You'll be asked for
            a code from your authenticator app each time you sign in.
          </p>
          <button
            onClick={() => { setPhase('disable-confirm'); setCode(''); setError(null); }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-xl transition-colors"
          >
            <ShieldOff className="size-4" />
            Disable Two-Factor Authentication
          </button>
        </div>
      )}

      {/* ── Phase: disable-confirm ────────────────────────────────────── */}
      {phase === 'disable-confirm' && (
        <div className="bg-white border border-red-200 rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="font-bold text-red-700 mb-1">Disable 2FA</h3>
            <p className="text-sm text-slate-500">
              Enter your current authenticator code to confirm you want to disable 2FA.
            </p>
          </div>

          <CodeInput value={code} onChange={setCode} />

          <div className="flex gap-3">
            <button
              onClick={() => { setPhase('enabled'); setError(null); }}
              className="flex-1 py-3 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDisable}
              disabled={isBusy || code.length !== 6}
              className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isBusy ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
              Disable 2FA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
