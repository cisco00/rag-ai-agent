import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X, Check, CheckCheck, AlertTriangle, BarChart2, Mail, Info, Zap } from 'lucide-react';

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  read: number;
  created_at: string;
}

interface Props {
  apiKey: string;
  onNavigate?: (view: string) => void;
}

const API_BASE = (window as any).__VANTAGE_API_URL__ || import.meta.env.VITE_API_URL || 'http://localhost:8000';

const POLL_INTERVAL_MS = 30_000; // 30 s

function typeIcon(type: string) {
  switch (type) {
    case 'alert':       return <AlertTriangle size={15} className="text-amber-500 shrink-0" />;
    case 'report':      return <BarChart2     size={15} className="text-blue-500 shrink-0" />;
    case 'invite':      return <Mail          size={15} className="text-purple-500 shrink-0" />;
    case 'pipeline':    return <Zap           size={15} className="text-green-500 shrink-0" />;
    case 'data_quality':return <AlertTriangle size={15} className="text-orange-500 shrink-0" />;
    default:            return <Info          size={15} className="text-gray-400 shrink-0" />;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationCenter({ apiKey, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const headers = { 'X-API-Key': apiKey };

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/notifications?limit=50`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnread(data.unread_count ?? 0);
    } catch {
      // silent — network may be offline
    }
  }, [apiKey]);

  // Initial fetch + polling
  useEffect(() => {
    fetchNotifications();
    timerRef.current = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function markRead(id: number) {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: 1 } : n)
    );
    setUnread(prev => Math.max(0, prev - 1));
    try {
      await fetch(`${API_BASE}/notifications/${id}/read`, { method: 'POST', headers });
    } catch {}
  }

  async function markAllRead() {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/notifications/read-all`, { method: 'POST', headers });
      setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
      setUnread(0);
    } catch {}
    setLoading(false);
  }

  async function dismiss(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
    try {
      await fetch(`${API_BASE}/notifications/${id}`, { method: 'DELETE', headers });
    } catch {}
    // recount unread
    setUnread(prev => {
      const n = notifications.find(x => x.id === id);
      return n && !n.read ? Math.max(0, prev - 1) : prev;
    });
  }

  function handleNotifClick(n: Notification) {
    if (!n.read) markRead(n.id);
    if (n.link && onNavigate) {
      // strip leading slash and use as view name
      const view = n.link.replace(/^\//, '');
      if (view) onNavigate(view);
    }
    setOpen(false);
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-xl z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-gray-500" />
              <span className="font-semibold text-gray-900 text-sm">Notifications</span>
              {unread > 0 && (
                <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  {unread} new
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors disabled:opacity-50"
              >
                <CheckCheck size={13} />
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-96">
            {notifications.length === 0 ? (
              <div className="py-12 text-center">
                <Bell size={32} className="text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
                  className={`group flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-gray-50 last:border-b-0 ${
                    n.read ? 'hover:bg-gray-50' : 'bg-blue-50/40 hover:bg-blue-50'
                  }`}
                >
                  {/* Icon */}
                  <div className="mt-0.5">
                    {typeIcon(n.type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug truncate ${n.read ? 'text-gray-700' : 'text-gray-900 font-medium'}`}>
                      {n.title}
                    </p>
                    {n.message && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
                        {n.message}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-400 mt-1">{relativeTime(n.created_at)}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {!n.read && (
                      <button
                        onClick={e => { e.stopPropagation(); markRead(n.id); }}
                        className="p-1 rounded hover:bg-blue-100 text-blue-500"
                        title="Mark as read"
                      >
                        <Check size={13} />
                      </button>
                    )}
                    <button
                      onClick={e => dismiss(n.id, e)}
                      className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500"
                      title="Dismiss"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  {/* Unread dot */}
                  {!n.read && (
                    <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-1.5" />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <p className="text-xs text-gray-400 text-center">
                Showing last {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
