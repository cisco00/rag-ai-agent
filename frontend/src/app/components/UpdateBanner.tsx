/**
 * UpdateBanner — top-of-page notification when a new version is available.
 *
 * Web mode:   "Copy update cmd" copies the bash update command.
 * Desktop mode: "Download & Install" fetches the platform-specific GitHub
 *               release asset URL from /admin/updates/release-url and opens
 *               it in the default browser.  The changelog modal shows the
 *               release notes with a link to the GitHub release page instead
 *               of the shell command.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowUpCircle, X, ExternalLink, Terminal,
  BookOpen, ChevronDown, ChevronUp, Loader2,
  CheckCircle2, Copy, Check, Download,
} from 'lucide-react';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface UpdateStatus {
  update_available: boolean;
  current_version: string;
  latest_version: string;
  changelog_url: string;
  checked_at: string;
  update_command: string;
  error: string | null;
  dismissed_version: string | null;
}

interface ChangelogSection {
  version: string;
  content: string;
  is_latest: boolean;
}

interface ChangelogData {
  markdown: string;
  sections: ChangelogSection[];
  source: string;
  latest_version: string;
  changelog_url: string;
}

interface ReleaseInfo {
  release_url: string;
  download_url: string;
  tag_name: string;
  body: string;
  assets: { name: string; download_url: string; size: number }[];
}

interface UpdateBannerProps {
  user?: { is_superuser?: boolean; [key: string]: any };
  /** True when running inside the desktop binary (PyInstaller / Tauri). */
  desktop?: boolean;
}

// ── Markdown renderer (minimal — headings, bullets, bold) ────────────────────

function renderChangelog(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h4 class="text-xs font-black uppercase tracking-wider text-slate-500 mt-4 mb-1.5">$1</h4>')
    .replace(/^## (\[.+)$/gm, '<h3 class="text-sm font-black text-slate-800 mt-2 mb-2 flex items-center gap-1.5">$1</h3>')
    .replace(/^- \*\*(.+?)\*\* — (.+)$/gm,
      '<li class="text-sm text-slate-700 mb-1"><span class="font-semibold text-slate-800">$1</span> — $2</li>')
    .replace(/^- (.+)$/gm, '<li class="text-sm text-slate-600 mb-1">$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-slate-100 text-slate-700 px-1 py-0.5 rounded text-xs font-mono">$1</code>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (m) => `<ul class="list-disc list-inside space-y-0.5 ml-2 mb-2">${m}</ul>`)
    .replace(/\n\n+/g, '<div class="mt-2"></div>');
}

// ── Changelog modal ────────────────────────────────────────────────────────────

function ChangelogModal({
  status,
  desktop,
  onClose,
}: {
  status: UpdateStatus;
  desktop?: boolean;
  onClose: () => void;
}) {
  const [data, setData]           = useState<ChangelogData | null>(null);
  const [release, setRelease]     = useState<ReleaseInfo | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [expanded, setExpanded]   = useState<Record<string, boolean>>({});
  const [copied, setCopied]       = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const fetches: Promise<void>[] = [
      api.get<ChangelogData>('/admin/updates/changelog')
        .then(d => {
          setData(d);
          if (d.sections.length > 0) {
            setExpanded({ [d.sections[0].version]: true });
          }
        })
        .catch(() => setError('Could not load changelog.')),
    ];
    // Also pre-fetch release info for the download button
    if (desktop) {
      fetches.push(
        api.get<ReleaseInfo>('/admin/updates/release-url')
          .then(r => setRelease(r))
          .catch(() => {}),
      );
    }
    Promise.all(fetches).finally(() => setLoading(false));
  }, [desktop]);

  const handleCopy = () => {
    navigator.clipboard.writeText(status.update_command).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const info = release ?? await api.get<ReleaseInfo>('/admin/updates/release-url');
      window.open(info.download_url, '_blank', 'noopener,noreferrer');
    } catch {
      // Fallback: open the release page on GitHub
      window.open(status.changelog_url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl text-white shadow-md">
              <ArrowUpCircle className="size-5" />
            </div>
            <div>
              <h2 className="font-black text-slate-900">
                Vantage AI v{status.latest_version}
              </h2>
              <p className="text-xs text-slate-500">
                Update from v{status.current_version}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-amber-400" />
            </div>
          )}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
              <a
                href={status.changelog_url}
                target="_blank"
                rel="noreferrer"
                className="ml-2 underline text-blue-600"
              >
                Open on GitHub →
              </a>
            </div>
          )}
          {data && data.sections.length > 0 && (
            <div className="space-y-2">
              {data.sections.map((section, i) => (
                <div
                  key={section.version}
                  className={`border rounded-xl overflow-hidden transition-all ${
                    section.is_latest
                      ? 'border-amber-300 shadow-sm shadow-amber-100'
                      : 'border-slate-200'
                  }`}
                >
                  <button
                    onClick={() =>
                      setExpanded(prev => ({
                        ...prev,
                        [section.version]: !prev[section.version],
                      }))
                    }
                    className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                      section.is_latest
                        ? 'bg-amber-50 hover:bg-amber-100'
                        : 'bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`font-bold text-sm ${section.is_latest ? 'text-amber-800' : 'text-slate-700'}`}>
                        v{section.version}
                      </span>
                      {section.is_latest && (
                        <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-amber-400 text-white rounded-full">
                          Latest
                        </span>
                      )}
                      {i === 0 && !section.is_latest && (
                        <span className="text-[10px] text-slate-500">Most recent</span>
                      )}
                    </div>
                    {expanded[section.version]
                      ? <ChevronUp className="size-4 text-slate-400" />
                      : <ChevronDown className="size-4 text-slate-400" />}
                  </button>

                  {expanded[section.version] && (
                    <div
                      className="px-5 py-4 text-sm border-t border-slate-100 prose-sm max-w-none"
                      dangerouslySetInnerHTML={{
                        __html: renderChangelog(section.content),
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          {data && data.sections.length === 0 && !loading && (
            <p className="text-sm text-slate-500 py-8 text-center">
              No changelog entries found.{' '}
              <a href={data.changelog_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                View on GitHub
              </a>
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 shrink-0">
          {desktop ? (
            /* Desktop: big download button + release page link */
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Download the installer for your platform, then run it to update.
              </p>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 transition-all shadow-sm shadow-amber-200/50 shrink-0"
              >
                {downloading
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Download className="size-4" />}
                {downloading ? 'Opening…' : 'Download & Install'}
              </button>
            </div>
          ) : (
            /* Web: install command */
            <>
              <p className="text-xs text-slate-500 mb-2 font-medium">
                Run this command to update (from your server):
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-slate-900 text-green-400 text-xs font-mono px-3 py-2 rounded-lg truncate">
                  {status.update_command}
                </code>
                <button
                  onClick={handleCopy}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 ${
                    copied
                      ? 'bg-green-100 text-green-700 border border-green-300'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </>
          )}
          <div className="flex items-center justify-between mt-3">
            <a
              href={release?.release_url ?? data?.changelog_url ?? status.changelog_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
            >
              <ExternalLink className="size-3" />
              {desktop ? 'View release on GitHub' : 'View full changelog on GitHub'}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Banner ─────────────────────────────────────────────────────────────────────

export function UpdateBanner({ user, desktop = false }: UpdateBannerProps) {
  const [status, setStatus]               = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed]         = useState(false);
  const [visible, setVisible]             = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [copied, setCopied]               = useState(false);
  const [downloading, setDownloading]     = useState(false);

  const isSuperuser = user?.is_superuser;

  const fetchStatus = useCallback(async () => {
    if (!isSuperuser) return;
    try {
      const data = await api.get<UpdateStatus>('/admin/updates/status');
      setStatus(data);
      const sessionDismissed = sessionStorage.getItem('vantage_update_dismissed');
      if (
        sessionDismissed === data.latest_version ||
        data.dismissed_version === data.latest_version
      ) {
        setDismissed(true);
      }
    } catch { /* non-critical */ }
  }, [isSuperuser]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    if (status?.update_available && !dismissed) {
      const timer = setTimeout(() => setVisible(true), 100);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [status?.update_available, dismissed]);

  if (!isSuperuser || !status?.update_available || dismissed) return null;

  const handleDismiss = async () => {
    setVisible(false);
    setTimeout(() => {
      setDismissed(true);
      sessionStorage.setItem('vantage_update_dismissed', status.latest_version);
      api.post(`/admin/updates/dismiss?version=${encodeURIComponent(status.latest_version)}`).catch(() => {});
    }, 300);
  };

  const handleCopyUpdate = () => {
    navigator.clipboard.writeText(status.update_command).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /** Desktop only: fetch platform asset URL and open it. */
  const handleDownloadInstall = async () => {
    setDownloading(true);
    try {
      const info = await api.get<ReleaseInfo>('/admin/updates/release-url');
      window.open(info.download_url, '_blank', 'noopener,noreferrer');
    } catch {
      // Fallback to the GitHub release page
      window.open(status.changelog_url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <div
        className={`
          relative overflow-hidden transition-all duration-500 ease-out
          ${visible ? 'max-h-20 opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-2'}
        `}
      >
        {/* Gradient accent bar */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-400 via-orange-500 to-amber-400" />

        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200/60 px-4 py-3">
          <div className="flex items-center justify-between max-w-screen-xl mx-auto">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center size-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-200/50 shrink-0">
                <ArrowUpCircle size={18} />
              </div>
              <p className="text-sm font-bold text-amber-900 truncate">
                Vantage AI v{status.latest_version} is available
                <span className="font-normal text-amber-700 ml-1.5">
                  — You're on v{status.current_version}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-4">
              {/* What's new — opens changelog modal */}
              <button
                onClick={() => setShowChangelog(true)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-700 bg-white/80 border border-amber-200 rounded-lg hover:bg-white hover:border-amber-300 transition-all shadow-sm"
              >
                <BookOpen size={13} />
                What's new
              </button>

              {desktop ? (
                /* Desktop: "Download & Install" */
                <button
                  onClick={handleDownloadInstall}
                  disabled={downloading}
                  title="Download the installer for this platform and open it"
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 transition-all shadow-sm shadow-amber-200/50"
                >
                  {downloading
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Download size={13} />}
                  {downloading ? 'Opening…' : 'Download & Install'}
                </button>
              ) : (
                /* Web: copy shell update command */
                <button
                  onClick={handleCopyUpdate}
                  title="Copy update command to clipboard"
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg hover:from-amber-600 hover:to-orange-600 transition-all shadow-sm shadow-amber-200/50"
                >
                  {copied ? <CheckCircle2 size={13} /> : <Terminal size={13} />}
                  {copied ? 'Copied!' : 'Copy update cmd'}
                </button>
              )}

              <button
                onClick={handleDismiss}
                className="p-1.5 text-amber-400 hover:text-amber-600 hover:bg-amber-100 rounded-lg transition-all"
                title="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Changelog modal */}
      {showChangelog && (
        <ChangelogModal
          status={status}
          desktop={desktop}
          onClose={() => setShowChangelog(false)}
        />
      )}
    </>
  );
}
