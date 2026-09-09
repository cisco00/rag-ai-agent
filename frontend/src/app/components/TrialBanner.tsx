import { useState } from 'react';
import { Crown, Clock, Lock, CheckCircle2, AlertTriangle, X, Sparkles } from 'lucide-react';
import { LicenseManager, LicenseTier } from '../../lib/license';

interface TrialBannerProps {
  license: LicenseManager;
  onLicenseChange: () => void;
}

export function TrialBanner({ license, onLicenseChange }: TrialBannerProps) {
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState('');

  const status = license.status;

  const handleActivate = () => {
    setKeyError('');
    if (license.activateLicense(keyInput)) {
      setShowKeyDialog(false);
      setKeyInput('');
      onLicenseChange();
    } else {
      setKeyError('Invalid license key format. Expected: VANTAGE-XXXX-XXXX-XXXX');
    }
  };

  // Premium — minimal green badge
  if (status.tier === 'premium') {
    return (
      <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-1.5 flex items-center justify-center gap-2 text-sm text-emerald-700 shrink-0">
        <Crown size={14} />
        <span className="font-medium">Premium</span>
      </div>
    );
  }

  // Trial — countdown banner
  if (status.tier === 'trial') {
    const urgency = status.trialDaysRemaining <= 7;
    return (
      <div className={`border-b px-4 py-2 flex items-center justify-between text-sm shrink-0 ${
        urgency
          ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-blue-50 border-blue-200 text-blue-800'
      }`}>
        <div className="flex items-center gap-2">
          <Clock size={14} />
          <span>
            <strong>{status.trialDaysRemaining} days</strong> remaining in your free trial
            {urgency && ' — upgrade to keep all features'}
          </span>
        </div>
        <button
          onClick={() => setShowKeyDialog(true)}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            urgency
              ? 'bg-amber-600 text-white hover:bg-amber-500'
              : 'bg-blue-600 text-white hover:bg-blue-500'
          }`}
        >
          Enter License Key
        </button>

        {showKeyDialog && <LicenseKeyDialog
          keyInput={keyInput}
          keyError={keyError}
          onKeyChange={setKeyInput}
          onActivate={handleActivate}
          onClose={() => { setShowKeyDialog(false); setKeyError(''); setKeyInput(''); }}
        />}
      </div>
    );
  }

  // Freemium — upgrade prompt
  return (
    <>
      <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex items-center justify-between text-sm text-slate-700 shrink-0">
        <div className="flex items-center gap-2">
          <Lock size={14} />
          <span>
            Free plan — some features are limited.
            <strong className="ml-1">Upgrade to Premium</strong> for full access.
          </span>
        </div>
        <button
          onClick={() => setShowKeyDialog(true)}
          className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-500 transition-colors"
        >
          Enter License Key
        </button>
      </div>

      {showKeyDialog && <LicenseKeyDialog
        keyInput={keyInput}
        keyError={keyError}
        onKeyChange={setKeyInput}
        onActivate={handleActivate}
        onClose={() => { setShowKeyDialog(false); setKeyError(''); setKeyInput(''); }}
      />}
    </>
  );
}

// ── License Key Dialog ──────────────────────────────────────────────────

interface LicenseKeyDialogProps {
  keyInput: string;
  keyError: string;
  onKeyChange: (val: string) => void;
  onActivate: () => void;
  onClose: () => void;
}

function LicenseKeyDialog({ keyInput, keyError, onKeyChange, onActivate, onClose }: LicenseKeyDialogProps) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-blue-600" />
            <h3 className="text-lg font-semibold text-slate-900">Activate Premium</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">
            Enter your license key to unlock all premium features.
          </p>

          <input
            type="text"
            value={keyInput}
            onChange={e => onKeyChange(e.target.value.toUpperCase())}
            placeholder="VANTAGE-XXXX-XXXX-XXXX"
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 font-mono text-sm tracking-wider focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-slate-400"
            onKeyDown={e => e.key === 'Enter' && onActivate()}
          />

          {keyError && (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <AlertTriangle size={14} />
              {keyError}
            </div>
          )}

          <button
            onClick={onActivate}
            disabled={!keyInput.trim()}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <CheckCircle2 size={16} />
            Activate License
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar License Badge ───────────────────────────────────────────────

interface LicenseBadgeProps {
  tier: LicenseTier;
  trialDays: number;
}

export function LicenseBadge({ tier, trialDays }: LicenseBadgeProps) {
  if (tier === 'premium') {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-medium">
        <Crown size={12} /> Premium
      </div>
    );
  }
  if (tier === 'trial') {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 text-xs font-medium">
        <Clock size={12} /> Trial ({trialDays}d left)
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-500/10 text-slate-400 text-xs font-medium">
      <Lock size={12} /> Free
    </div>
  );
}
