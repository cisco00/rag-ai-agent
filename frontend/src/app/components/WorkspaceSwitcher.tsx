/**
 * WorkspaceSwitcher — appears in the Sidebar to let users jump between
 * their personal workspace and any org workspaces they belong to.
 *
 * Self-contained: reads its own token, fetches /workspaces/, and when the
 * user switches it PUTs the new JWT into secureStorage then reloads the
 * page so all state resets cleanly.
 */

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Briefcase, User as UserIcon, Building2, Plus, Check, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { secureStorage } from '../../lib/secureStorage';

interface Workspace {
    id: number;
    name: string;
    type: 'personal' | 'organization';
    organization_id?: number | null;
    role?: string;
}

interface WorkspaceSwitcherProps {
    /** ID of the workspace that is currently active (from JWT payload). */
    currentWorkspaceId?: number | null;
    collapsed?: boolean;
    /** Called after a successful switch so the parent can react without a full reload. */
    onSwitch?: (workspaceId: number) => void;
}

export function WorkspaceSwitcher({ currentWorkspaceId, collapsed, onSwitch }: WorkspaceSwitcherProps) {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [current, setCurrent] = useState<Workspace | null>(null);
    const [open, setOpen] = useState(false);
    const [switching, setSwitching] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const ref = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    useEffect(() => {
        let mounted = true;
        api.get<Workspace[]>('/workspaces/')
            .then(data => {
                if (!mounted) return;
                setWorkspaces(data);
                const active = data.find(w => w.id === currentWorkspaceId) ?? data[0] ?? null;
                setCurrent(active);
            })
            .catch(() => { /* silent — user may not have workspaces yet */ })
            .finally(() => { if (mounted) setLoading(false); });
        return () => { mounted = false; };
    }, [currentWorkspaceId]);

    const handleSwitch = async (ws: Workspace) => {
        if (ws.id === current?.id) { setOpen(false); return; }
        setSwitching(ws.id);
        try {
            const res = await api.post<{ access_token: string; workspace: Workspace }>('/workspaces/switch', {
                workspace_id: ws.id,
            });
            // Replace the access token so the next request uses the new workspace scope
            secureStorage.setItem('vantage_access_token', res.access_token);
            setCurrent(ws);
            setOpen(false);
            if (onSwitch) {
                onSwitch(ws.id);
            } else {
                // Full reload to clear all cached workspace data
                window.location.reload();
            }
        } catch (err: any) {
            console.error('[WorkspaceSwitcher] switch failed:', err);
        } finally {
            setSwitching(null);
        }
    };

    if (loading || workspaces.length === 0) return null;

    // Collapsed: just an icon button
    if (collapsed) {
        return (
            <div ref={ref} className="relative flex justify-center">
                <button
                    onClick={() => setOpen(o => !o)}
                    title={current?.name ?? 'Switch Workspace'}
                    className="size-9 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all border border-slate-700"
                >
                    {current?.type === 'personal' ? <UserIcon size={16} /> : <Building2 size={16} />}
                </button>

                {open && (
                    <WorkspaceDropdown
                        workspaces={workspaces}
                        current={current}
                        switching={switching}
                        onSelect={handleSwitch}
                        className="absolute left-12 top-0 z-50"
                    />
                )}
            </div>
        );
    }

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 transition-all group"
            >
                <div className="size-7 rounded-lg bg-slate-700 flex items-center justify-center shrink-0">
                    {current?.type === 'personal'
                        ? <UserIcon size={14} className="text-blue-400" />
                        : <Building2 size={14} className="text-indigo-400" />
                    }
                </div>
                <div className="flex-1 min-w-0 text-left">
                    <p className="text-[12px] font-bold text-white truncate leading-tight">
                        {current?.name ?? 'Select Workspace'}
                    </p>
                    <p className="text-[9px] uppercase tracking-widest font-bold text-slate-500">
                        {current?.type === 'personal' ? 'Personal' : 'Organisation'} · {current?.role ?? 'member'}
                    </p>
                </div>
                <ChevronDown
                    size={14}
                    className={`text-slate-500 group-hover:text-slate-300 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
                />
            </button>

            {open && (
                <WorkspaceDropdown
                    workspaces={workspaces}
                    current={current}
                    switching={switching}
                    onSelect={handleSwitch}
                    className="absolute left-0 right-0 bottom-full mb-1 z-50"
                />
            )}
        </div>
    );
}

// ── Shared dropdown ────────────────────────────────────────────────────────────

function WorkspaceDropdown({
    workspaces,
    current,
    switching,
    onSelect,
    className,
}: {
    workspaces: Workspace[];
    current: Workspace | null;
    switching: number | null;
    onSelect: (ws: Workspace) => void;
    className?: string;
}) {
    const personal = workspaces.filter(w => w.type === 'personal');
    const orgs     = workspaces.filter(w => w.type === 'organization');

    return (
        <div
            className={`${className} bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden min-w-[220px]`}
        >
            {personal.length > 0 && (
                <WorkspaceSection label="Personal" items={personal} current={current} switching={switching} onSelect={onSelect} />
            )}
            {orgs.length > 0 && (
                <WorkspaceSection label="Organisations" items={orgs} current={current} switching={switching} onSelect={onSelect} />
            )}

            {/* Create org shortcut — only visible if user has no org workspace yet */}
            {orgs.length === 0 && (
                <div className="p-2 border-t border-slate-700">
                    <button
                        onClick={() => { window.location.hash = '#create-org'; }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-all text-[12px] font-semibold"
                    >
                        <Plus size={14} />
                        Create Organisation
                    </button>
                </div>
            )}
        </div>
    );
}

function WorkspaceSection({
    label, items, current, switching, onSelect,
}: {
    label: string;
    items: Workspace[];
    current: Workspace | null;
    switching: number | null;
    onSelect: (ws: Workspace) => void;
}) {
    return (
        <div className="p-2">
            <p className="px-2 pb-1 text-[9px] uppercase tracking-widest font-black text-slate-500">{label}</p>
            {items.map(ws => (
                <button
                    key={ws.id}
                    onClick={() => onSelect(ws)}
                    disabled={switching !== null}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all group ${
                        ws.id === current?.id
                            ? 'bg-blue-600/20 text-white'
                            : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                    } disabled:opacity-60`}
                >
                    <div className={`size-6 rounded-lg flex items-center justify-center shrink-0 ${
                        ws.type === 'personal' ? 'bg-blue-600/20' : 'bg-indigo-600/20'
                    }`}>
                        {ws.type === 'personal'
                            ? <UserIcon size={12} className="text-blue-400" />
                            : <Briefcase size={12} className="text-indigo-400" />
                        }
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                        <p className="text-[12px] font-semibold truncate">{ws.name}</p>
                        {ws.role && (
                            <p className="text-[9px] uppercase tracking-wider text-slate-500">{ws.role}</p>
                        )}
                    </div>
                    {switching === ws.id ? (
                        <Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />
                    ) : ws.id === current?.id ? (
                        <Check size={14} className="text-blue-400 shrink-0" />
                    ) : null}
                </button>
            ))}
        </div>
    );
}
