import { useState, useEffect } from 'react';
import { ArrowUpCircle, X, ExternalLink, Terminal } from 'lucide-react';
import { api } from '../../lib/api';

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

interface UpdateBannerProps {
  user?: {
    is_superuser?: boolean;
    [key: string]: any;
  };
}

export function UpdateBanner({ user }: UpdateBannerProps) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  // Only superusers see this banner
  const isSuperuser = user?.is_superuser;

  useEffect(() => {
    if (!isSuperuser) return;

    const fetchStatus = async () => {
      try {
        const data = await api.get<UpdateStatus>('/admin/updates/status');
        setStatus(data);

        // Check if this version was already dismissed in this session
        const sessionDismissed = sessionStorage.getItem('vantage_update_dismissed');
        if (sessionDismissed === data.latest_version) {
          setDismissed(true);
        }

        // Also check server-side dismiss
        if (data.dismissed_version === data.latest_version) {
          setDismissed(true);
        }
      } catch {
        // Silently fail — update banner is non-critical
      }
    };

    fetchStatus();

    // Poll every 30 minutes for status changes
    const interval = setInterval(fetchStatus, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isSuperuser]);

  // Trigger entrance animation
  useEffect(() => {
    if (status?.update_available && !dismissed) {
      const timer = setTimeout(() => setVisible(true), 100);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [status?.update_available, dismissed]);

  if (!isSuperuser || !status?.update_available || dismissed) {
    return null;
  }

  const handleDismiss = async () => {
    setVisible(false);
    // Wait for exit animation
    setTimeout(() => {
      setDismissed(true);
      sessionStorage.setItem('vantage_update_dismissed', status.latest_version);
      // Also tell the server
      try {
        api.post(`/admin/updates/dismiss?version=${encodeURIComponent(status.latest_version)}`);
      } catch {
        // Non-critical
      }
    }, 300);
  };

  return (
    <div
      className={`
        relative overflow-hidden transition-all duration-500 ease-out
        ${visible
          ? 'max-h-20 opacity-100 translate-y-0'
          : 'max-h-0 opacity-0 -translate-y-2'
        }
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
            <div className="min-w-0">
              <p className="text-sm font-bold text-amber-900 truncate">
                Vantage AI v{status.latest_version} is available
                <span className="font-normal text-amber-700 ml-1.5">
                  — You're running v{status.current_version}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-4">
            <a
              href={status.changelog_url}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-700 bg-white/80 border border-amber-200 rounded-lg hover:bg-white hover:border-amber-300 transition-all shadow-sm"
            >
              <ExternalLink size={13} />
              Changelog
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(status.update_command);
              }}
              title="Copy update command"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg hover:from-amber-600 hover:to-orange-600 transition-all shadow-sm shadow-amber-200/50"
            >
              <Terminal size={13} />
              Update
            </button>
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
  );
}
