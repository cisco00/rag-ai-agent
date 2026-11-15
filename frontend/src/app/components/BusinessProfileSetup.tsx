/**
 * BusinessProfileSetup.tsx — Org Business Profile Setup
 *
 * A lightweight 4-step wizard that captures the org context fields
 * used by the AI interpretation engine to give business-specific
 * rather than generic analytics explanations.
 *
 * Also doubles as a full settings page when shown standalone.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Target,
  BarChart2,
  FileText,
  CheckCircle2,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  X,
  Info,
  Globe,
  Users,
  Lightbulb,
  Save,
  AlertCircle,
} from 'lucide-react';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  industry?:         string;
  business_model?:   string;
  key_metrics?:      string[];
  objectives?:       string;
  data_description?: string;
  team_size?:        string;
  region?:           string;
  custom_context?:   string;
  completeness?:     number;
  industries?:       string[];
  team_sizes?:       string[];
  updated_at?:       string;
}

interface BusinessProfileSetupProps {
  /** If true, shown as an inline page; if false, shown as a modal */
  inline?: boolean;
  onClose?: () => void;
  /** Called after a successful save */
  onSaved?: (profile: Profile) => void;
}

// ── Completeness ring ─────────────────────────────────────────────────────────

function CompletenessRing({ pct }: { pct: number }) {
  const r = 24;
  const circ = 2 * Math.PI * r;
  const filled = (pct / 100) * circ;
  const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#6366f1';
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={64} height={64} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={32} cy={32} r={r} fill="none" stroke="#e2e8f0" strokeWidth={5} />
        <circle
          cx={32} cy={32} r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <span className="absolute text-sm font-bold" style={{ color }}>{pct}%</span>
    </div>
  );
}

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: 'Industry & Size',    icon: Building2,  key: 'industry'         },
  { id: 2, title: 'Business Model',     icon: Target,     key: 'business_model'   },
  { id: 3, title: 'Key Metrics',        icon: BarChart2,  key: 'key_metrics'      },
  { id: 4, title: 'Data & Objectives',  icon: FileText,   key: 'data_description' },
];

const COMMON_METRICS = [
  'Revenue', 'Monthly Recurring Revenue (MRR)', 'Churn Rate',
  'Customer Acquisition Cost (CAC)', 'Lifetime Value (LTV)',
  'Transactions per Day', 'Active Users', 'Conversion Rate',
  'Average Order Value', 'Net Promoter Score (NPS)',
  'Gross Margin', 'Inventory Turnover', 'Patient Volume',
  'Claims Processed', 'Loan Default Rate',
];

// ── Component ─────────────────────────────────────────────────────────────────

export function BusinessProfileSetup({ inline = false, onClose, onSaved }: BusinessProfileSetupProps) {
  const [profile, setProfile]     = useState<Profile>({});
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState(false);
  const [step, setStep]           = useState(1);
  const [metricInput, setMetricInput] = useState('');

  const industries = profile.industries || [];
  const teamSizes  = profile.team_sizes  || [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Profile>('/business-profile');
      setProfile(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        industry:         profile.industry,
        business_model:   profile.business_model,
        key_metrics:      profile.key_metrics,
        objectives:       profile.objectives,
        data_description: profile.data_description,
        team_size:        profile.team_size,
        region:           profile.region,
        custom_context:   profile.custom_context,
      };
      const updated = await api.put<Profile>('/business-profile', payload);
      setProfile(prev => ({ ...prev, ...updated }));
      setSuccess(true);
      onSaved?.(updated);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleMetric = (m: string) => {
    const cur = profile.key_metrics || [];
    setProfile(prev => ({
      ...prev,
      key_metrics: cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m],
    }));
  };

  const addCustomMetric = () => {
    const val = metricInput.trim();
    if (!val) return;
    const cur = profile.key_metrics || [];
    if (!cur.includes(val)) {
      setProfile(prev => ({ ...prev, key_metrics: [...cur, val] }));
    }
    setMetricInput('');
  };

  const pct = profile.completeness ?? 0;
  const isComplete = pct === 100;

  // ── Shared field editor per step ─────────────────────────────────────────

  const stepContent = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Industry <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {industries.map(ind => (
                  <button
                    key={ind}
                    onClick={() => setProfile(prev => ({ ...prev, industry: ind }))}
                    className={`text-sm px-3 py-2 rounded-xl border text-left transition-colors ${
                      profile.industry === ind
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                    }`}
                  >
                    {ind}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  <Users className="size-3.5 inline mr-1" />Team size
                </label>
                <select
                  value={profile.team_size || ''}
                  onChange={e => setProfile(prev => ({ ...prev, team_size: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="">Select…</option>
                  {teamSizes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  <Globe className="size-3.5 inline mr-1" />Region
                </label>
                <input
                  type="text"
                  value={profile.region || ''}
                  onChange={e => setProfile(prev => ({ ...prev, region: e.target.value }))}
                  placeholder="e.g. United States, EU, Global"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Describe your business model <span className="text-red-400">*</span>
              </label>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
                How does the organisation operate and generate value? (2–4 sentences)
              </p>
              <textarea
                rows={4}
                value={profile.business_model || ''}
                onChange={e => setProfile(prev => ({ ...prev, business_model: e.target.value }))}
                placeholder={
                  profile.industry === 'E-commerce'
                    ? 'e.g. We operate a B2C online marketplace selling consumer electronics. Revenue comes from product margins and a third-party seller commission. Key seasonal peaks occur in Q4.'
                    : profile.industry === 'SaaS / Software'
                    ? 'e.g. We sell a subscription-based project management platform to SMBs. Revenue is monthly recurring. Churn and expansion revenue are our primary growth levers.'
                    : 'Describe how your organisation operates and generates revenue…'
                }
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none leading-relaxed"
              />
              <p className="text-xs text-slate-400 mt-1">{(profile.business_model || '').length} chars</p>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Which metrics matter most to your organisation? <span className="text-red-400">*</span>
              </label>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                Pick from common metrics or add your own. These help the AI interpret results in terms you care about.
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {COMMON_METRICS.map(m => {
                  const sel = (profile.key_metrics || []).includes(m);
                  return (
                    <button
                      key={m}
                      onClick={() => toggleMetric(m)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        sel
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-300 hover:text-indigo-600'
                      }`}
                    >
                      {sel ? '✓ ' : ''}{m}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={metricInput}
                  onChange={e => setMetricInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomMetric(); } }}
                  placeholder="Add custom metric…"
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={addCustomMetric}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
                >
                  Add
                </button>
              </div>
              {(profile.key_metrics || []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(profile.key_metrics || []).map(m => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700"
                    >
                      {m}
                      <button onClick={() => toggleMetric(m)} className="ml-0.5 hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                What does your connected data represent? <span className="text-red-400">*</span>
              </label>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
                Briefly describe the tables and what their records mean (e.g. each row in `orders` is a completed purchase).
              </p>
              <textarea
                rows={3}
                value={profile.data_description || ''}
                onChange={e => setProfile(prev => ({ ...prev, data_description: e.target.value }))}
                placeholder="e.g. The `orders` table contains completed customer purchases since 2021. The `customers` table contains registered users. The `products` table lists the current catalogue with pricing."
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                <Lightbulb className="size-3.5 inline mr-1 text-amber-500" />
                Strategic objectives
              </label>
              <textarea
                rows={2}
                value={profile.objectives || ''}
                onChange={e => setProfile(prev => ({ ...prev, objectives: e.target.value }))}
                placeholder="e.g. Reduce churn by 15% in H1, grow into European markets, improve inventory forecasting accuracy."
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                <Info className="size-3.5 inline mr-1 text-slate-400" />
                Anything else the AI should know
              </label>
              <textarea
                rows={2}
                value={profile.custom_context || ''}
                onChange={e => setProfile(prev => ({ ...prev, custom_context: e.target.value }))}
                placeholder="e.g. We recently migrated from a legacy ERP; some historical data before 2022 is unreliable. Currency is always USD."
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none leading-relaxed"
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const wrapper = (children: React.ReactNode) => {
    if (inline) {
      return (
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          {children}
        </div>
      );
    }
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col border border-slate-200 dark:border-slate-700">
          {children}
        </div>
      </div>
    );
  };

  if (loading) {
    return wrapper(
      <div className="flex justify-center items-center py-24">
        <Loader2 className="size-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return wrapper(
    <>
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-4">
          <CompletenessRing pct={pct} />
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="size-5 text-indigo-500" />
              Business Profile
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {pct === 0
                ? 'Complete your profile to unlock context-aware AI interpretations'
                : pct < 60
                ? 'Keep going — more context = better interpretations'
                : pct < 100
                ? 'Almost there — your interpretations are getting specific'
                : '✓ Profile complete — AI interpretations are fully personalised'}
            </p>
          </div>
        </div>
        {!inline && onClose && (
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X className="size-5" />
          </button>
        )}
      </div>

      {/* Step tabs */}
      <div className="flex border-b border-slate-100 dark:border-slate-800">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = profile[s.key as keyof Profile] &&
            (s.key !== 'key_metrics' || (profile.key_metrics?.length ?? 0) > 0);
          return (
            <button
              key={s.id}
              onClick={() => setStep(s.id)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 text-xs font-medium border-b-2 transition-colors ${
                step === s.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <div className="relative">
                <Icon className="size-4" />
                {done && (
                  <div className="absolute -top-1 -right-1 size-2.5 bg-emerald-500 rounded-full border border-white dark:border-slate-900" />
                )}
              </div>
              <span className="hidden sm:block">{s.title}</span>
              <span className="sm:hidden">{i + 1}</span>
            </button>
          );
        })}
      </div>

      {/* Step body */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-5">
          <h3 className="font-bold text-slate-900 dark:text-white mb-0.5">
            Step {step} of {STEPS.length}: {STEPS[step - 1].title}
          </h3>
        </div>
        {stepContent()}
      </div>

      {/* Footer */}
      <div className="p-6 border-t border-slate-100 dark:border-slate-800">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mb-3">
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 mb-3">
            <CheckCircle2 className="size-4 shrink-0" />
            Profile saved — AI interpretations will now use this context.
          </div>
        )}

        <div className="flex gap-3">
          {step > 1 && (
            <button
              onClick={() => setStep(s => s - 1)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors"
            >
              <ChevronLeft className="size-4" />
              Back
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </button>
          {step < STEPS.length && (
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium transition-colors ml-auto"
            >
              Next
              <ChevronRight className="size-4" />
            </button>
          )}
          {step === STEPS.length && isComplete && onClose && (
            <button
              onClick={onClose}
              className="ml-auto flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
            >
              <CheckCircle2 className="size-4" />
              Done
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Compact completeness nudge (for Dashboard) ────────────────────────────────

export function ProfileCompletenessBanner({ onOpen }: { onOpen: () => void }) {
  const [pct, setPct] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('profile_banner_dismissed') === '1'; }
    catch { return false; }
  });

  useEffect(() => {
    if (dismissed) return;
    api.get<{ completeness: number }>('/business-profile')
      .then(d => setPct(d.completeness ?? 0))
      .catch(() => {});
  }, [dismissed]);

  if (dismissed || pct === null || pct >= 100) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem('profile_banner_dismissed', '1'); } catch {}
  };

  return (
    <div className="mb-5 flex items-center gap-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-2xl px-5 py-4">
      <div className="size-9 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
        <Sparkles className="size-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-indigo-900 dark:text-indigo-100 text-sm">
          Make AI interpretations specific to your business
        </p>
        <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">
          Your profile is {pct}% complete — add your industry, key metrics, and data description for personalised analytics insights.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onOpen}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors"
        >
          Complete profile
        </button>
        <button onClick={dismiss} className="p-1.5 text-indigo-400 hover:text-indigo-600 transition-colors">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
