/**
 * AnalyticsInterpretation.tsx — Context-Aware AI Interpretation Panel
 *
 * Renders the 7-section structured interpretation returned by
 * POST /analytics/interpret, plus an interactive follow-up Q&A input.
 *
 * Usage:
 *   <AnalyticsInterpretation
 *     module="forecast"
 *     results={statsData}
 *     datasetMeta={{ table: "sales", columns: [...] }}
 *     objective="Forecast monthly revenue for Q3"
 *   />
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  TrendingUp,
  Lightbulb,
  CheckCircle2,
  Target,
  Info,
  MessageSquare,
  Send,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';
import { api } from '../../lib/api';

/** Minimal completeness nudge — shown when profile < 60% complete */
function ProfileNudge({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [pct, setPct] = useState<number | null>(null);
  useEffect(() => {
    api.get<{ completeness: number }>('/business-profile')
      .then(d => setPct(d.completeness ?? 0))
      .catch(() => {});
  }, []);
  if (pct === null || pct >= 60) return null;
  return (
    <div className="mx-5 mt-3 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-2.5 text-sm">
      <Lightbulb className="size-4 text-amber-500 shrink-0" />
      <span className="text-amber-800 dark:text-amber-200 flex-1">
        Your business profile is {pct}% complete — add more context for sharper AI interpretations.
      </span>
      {onNavigate && (
        <button
          onClick={() => onNavigate('business-profile')}
          className="shrink-0 text-xs font-semibold text-amber-700 dark:text-amber-300 underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
        >
          Complete profile →
        </button>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Interpretation {
  executive_summary:  string;
  what_results_show:  string;
  org_context:        string;
  key_findings:       string[];
  implications:       string;
  recommendations:    string[];
  limitations:        string;
}

interface InterpretationResponse {
  module:         string;
  org_name:       string;
  industry:       string;
  interpretation: Interpretation;
}

interface FollowUpMessage {
  role: 'user' | 'ai';
  text: string;
}

interface AnalyticsInterpretationProps {
  module: string;
  results: Record<string, any>;
  datasetMeta?: Record<string, any>;
  objective?: string;
  /** If true, automatically fetch interpretation when results arrive */
  autoFetch?: boolean;
  /** Label shown on the trigger button */
  label?: string;
  /** Navigate to a view — used by the completeness nudge */
  onNavigate?: (view: string) => void;
}

// ── Section config ────────────────────────────────────────────────────────────

const SECTIONS: Array<{
  key: keyof Interpretation;
  title: string;
  icon: React.ElementType;
  color: string;
  isList?: boolean;
}> = [
  { key: 'executive_summary', title: 'Executive Summary',       icon: Sparkles,     color: 'text-purple-600 dark:text-purple-400' },
  { key: 'what_results_show', title: 'What the Results Show',   icon: TrendingUp,   color: 'text-blue-600 dark:text-blue-400' },
  { key: 'org_context',       title: 'Organizational Context',  icon: Target,       color: 'text-indigo-600 dark:text-indigo-400' },
  { key: 'key_findings',      title: 'Key Findings',            icon: Lightbulb,    color: 'text-amber-600 dark:text-amber-400', isList: true },
  { key: 'implications',      title: 'Business Implications',   icon: AlertTriangle,color: 'text-orange-600 dark:text-orange-400' },
  { key: 'recommendations',   title: 'Recommendations',         icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', isList: true },
  { key: 'limitations',       title: 'Limitations & Confidence',icon: Info,         color: 'text-slate-500 dark:text-slate-400' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function AnalyticsInterpretation({
  module,
  results,
  datasetMeta,
  objective,
  autoFetch = false,
  label = 'AI Interpretation',
  onNavigate,
}: AnalyticsInterpretationProps) {
  const [open, setOpen]               = useState(false);
  const [loading, setLoading]         = useState(false);
  const [data, setData]               = useState<InterpretationResponse | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);
  const [followUps, setFollowUps]     = useState<FollowUpMessage[]>([]);
  const [followInput, setFollowInput] = useState('');
  const [followLoading, setFollowLoading] = useState(false);
  const followEndRef = useRef<HTMLDivElement>(null);
  const hasResults = results && Object.keys(results).length > 0;

  const fetchInterpretation = useCallback(async () => {
    if (!hasResults) return;
    setLoading(true);
    setError(null);
    setFollowUps([]);
    try {
      const resp = await api.post<InterpretationResponse>('/analytics/interpret', {
        module,
        results,
        dataset_meta: datasetMeta,
        objective,
      });
      setData(resp);
      setOpen(true);
    } catch (e: any) {
      setError(e?.message || 'Interpretation unavailable');
    } finally {
      setLoading(false);
    }
  }, [module, results, datasetMeta, objective, hasResults]);

  // Auto-fetch when results change and autoFetch is on
  useEffect(() => {
    if (autoFetch && hasResults) {
      fetchInterpretation();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]); // only on mount when autoFetch

  const handleFollowUp = async () => {
    const q = followInput.trim();
    if (!q || !data || followLoading) return;
    setFollowInput('');
    const userMsg: FollowUpMessage = { role: 'user', text: q };
    setFollowUps(prev => [...prev, userMsg]);
    setFollowLoading(true);
    try {
      const resp = await api.post<{ answer: string }>('/analytics/interpret/followup', {
        module,
        results,
        previous_interpretation: data.interpretation,
        question: q,
        dataset_meta: datasetMeta,
      });
      setFollowUps(prev => [...prev, { role: 'ai', text: resp.answer }]);
    } catch (e: any) {
      setFollowUps(prev => [...prev, { role: 'ai', text: `Error: ${e?.message || 'Request failed'}` }]);
    } finally {
      setFollowLoading(false);
      setTimeout(() => followEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  const handleCopy = async () => {
    if (!data) return;
    const text = SECTIONS.map(s => {
      const val = data.interpretation[s.key];
      if (Array.isArray(val)) return `${s.title}:\n${val.map(v => `• ${v}`).join('\n')}`;
      return `${s.title}:\n${val}`;
    }).join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const SUGGESTED_QUESTIONS = [
    'Why did the analysis produce this result?',
    'Which findings are most important for our business?',
    'What should we investigate next?',
    'How confident are you in these findings?',
  ];

  return (
    <div className="mt-4 rounded-2xl border border-purple-100 dark:border-purple-900/40 bg-gradient-to-br from-purple-50/60 to-indigo-50/40 dark:from-purple-900/10 dark:to-indigo-900/10 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="size-7 rounded-lg bg-purple-600 flex items-center justify-center">
            <Sparkles className="size-4 text-white" />
          </div>
          <span className="font-semibold text-slate-800 dark:text-white text-sm">{label}</span>
          {data && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              · {data.org_name}
              {data.industry && data.industry !== 'unknown industry' ? ` · ${data.industry}` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <>
              <button
                onClick={handleCopy}
                title="Copy interpretation"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              </button>
              <button
                onClick={fetchInterpretation}
                disabled={loading}
                title="Regenerate"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
          {!data && !loading && hasResults && (
            <button
              onClick={fetchInterpretation}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              <Sparkles className="size-3.5" />
              Interpret results
            </button>
          )}
          {data && (
            <button
              onClick={() => setOpen(v => !v)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-colors"
            >
              {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Profile completeness nudge */}
      <ProfileNudge onNavigate={onNavigate} />

      {/* Loading state */}
      {loading && (
        <div className="px-5 pb-5 flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="size-5 animate-spin text-purple-500" />
          Generating context-aware interpretation…
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="px-5 pb-5 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
          <button onClick={fetchInterpretation} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* Empty state — no results yet */}
      {!hasResults && !loading && !data && (
        <div className="px-5 pb-5 text-xs text-slate-400 dark:text-slate-500">
          Run the analysis to generate an AI interpretation.
        </div>
      )}

      {/* Interpretation body */}
      {data && open && !loading && (
        <div className="px-5 pb-5 space-y-4">

          {/* 7 sections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {SECTIONS.map(s => {
              const val = data.interpretation[s.key];
              if (!val || (Array.isArray(val) && val.length === 0)) return null;
              const Icon = s.icon;
              return (
                <div
                  key={s.key}
                  className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 ${
                    s.key === 'executive_summary' ? 'md:col-span-2' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`size-4 ${s.color} shrink-0`} />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {s.title}
                    </span>
                  </div>
                  {s.isList && Array.isArray(val) ? (
                    <ul className="space-y-1.5">
                      {(val as string[]).map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                          <span className={`mt-1.5 size-1.5 rounded-full shrink-0 ${s.color.split(' ')[0].replace('text-', 'bg-')}`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {Array.isArray(val) ? val.join(' ') : val}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Follow-up Q&A */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="size-4 text-indigo-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Ask a follow-up question
              </span>
            </div>

            {/* Suggested questions */}
            {followUps.length === 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {SUGGESTED_QUESTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => setFollowInput(q)}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Chat messages */}
            {followUps.length > 0 && (
              <div className="space-y-3 mb-3 max-h-72 overflow-y-auto">
                {followUps.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'ai' && (
                      <div className="size-6 rounded-full bg-purple-600 flex items-center justify-center shrink-0 mt-0.5">
                        <Sparkles className="size-3 text-white" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-600'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
                {followLoading && (
                  <div className="flex gap-2 justify-start">
                    <div className="size-6 rounded-full bg-purple-600 flex items-center justify-center shrink-0">
                      <Sparkles className="size-3 text-white" />
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-700 rounded-xl px-3.5 py-2.5 flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin text-purple-500" />
                      <span className="text-sm text-slate-400">Thinking…</span>
                    </div>
                  </div>
                )}
                <div ref={followEndRef} />
              </div>
            )}

            {/* Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={followInput}
                onChange={e => setFollowInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleFollowUp(); }}
                placeholder="Ask about these results…"
                className="flex-1 text-sm px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <button
                onClick={handleFollowUp}
                disabled={!followInput.trim() || followLoading}
                className="p-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white transition-colors"
              >
                <Send className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
