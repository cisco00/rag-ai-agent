import { useState, useEffect } from 'react';
import { Palette, Save, Eye, RotateCcw, CheckCircle } from 'lucide-react';
import { api } from '../../lib/api';

interface Branding {
    org_name: string;
    tagline: string;
    primary_color: string;
    logo_url: string;
}

const PRESET_COLORS = [
    { name: 'Blue', value: '#2563eb' },
    { name: 'Indigo', value: '#4f46e5' },
    { name: 'Violet', value: '#7c3aed' },
    { name: 'Rose', value: '#e11d48' },
    { name: 'Orange', value: '#ea580c' },
    { name: 'Green', value: '#16a34a' },
    { name: 'Teal', value: '#0d9488' },
    { name: 'Slate', value: '#475569' },
];

interface BrandingSettingsProps {
    onBrandingChange: (branding: Branding) => void;
}

export function BrandingSettings({ onBrandingChange }: BrandingSettingsProps) {
    const [form, setForm] = useState<Branding>({
        org_name: '',
        tagline: '',
        primary_color: '#2563eb',
        logo_url: '',
    });
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [logoError, setLogoError] = useState(false);

    // Load current branding on mount
    useEffect(() => {
        const fetchBranding = async () => {
            try {
                const data = await api.get<Branding>('/branding');
                setForm(data);
            } catch (err) {
                console.error('Failed to load branding:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchBranding();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put<any>('/branding', form);
        } catch (err: any) {
            const msg: string = err?.message || String(err);
            // If it's a real error (not a missing endpoint), show it
            const isEndpointMissing = msg.includes('404') || msg.includes('405') ||
                msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('method not allowed');
            if (!isEndpointMissing) {
                alert(`Failed to save branding: ${msg}`);
                setSaving(false);
                return;
            }
            // Endpoint not deployed yet — fall back to localStorage
            console.warn('Branding API not available, saving to localStorage only.');
        }
        // Always apply to UI immediately
        localStorage.setItem('vantage_branding', JSON.stringify(form));
        onBrandingChange(form);
        setSaved(true);
        setSaving(false);
        setTimeout(() => setSaved(false), 3000);
    };

    const handleReset = () => {
        setForm({
            org_name: '',
            tagline: 'Analytics Portal',
            primary_color: '#2563eb',
            logo_url: '',
        });
        setLogoError(false);
    };

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center h-64 text-gray-400">
                Loading branding settings...
            </div>
        );
    }

    return (
        <div className="p-8 max-w-4xl">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                    <Palette className="size-8 text-purple-600" />
                    <h1 className="text-3xl font-bold text-gray-900">Custom Branding</h1>
                </div>
                <p className="text-gray-600">
                    Personalize the portal with your organization's identity. Changes are applied immediately across the entire interface.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Form */}
                <div className="lg:col-span-2 space-y-6">

                    {/* Org Name */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="font-semibold text-gray-900 mb-4">Organization Identity</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Organization Name
                                </label>
                                <input
                                    type="text"
                                    value={form.org_name}
                                    onChange={e => setForm(f => ({ ...f, org_name: e.target.value }))}
                                    placeholder="Acme Corp"
                                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                />
                                <p className="text-xs text-gray-400 mt-1">Displayed in the sidebar header</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Tagline
                                </label>
                                <input
                                    type="text"
                                    value={form.tagline}
                                    onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
                                    placeholder="Analytics Portal"
                                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                />
                                <p className="text-xs text-gray-400 mt-1">Shown below the organization name</p>
                            </div>
                        </div>
                    </div>

                    {/* Logo */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="font-semibold text-gray-900 mb-4">Logo</h3>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Logo URL
                            </label>
                            <input
                                type="url"
                                value={form.logo_url}
                                onChange={e => { setForm(f => ({ ...f, logo_url: e.target.value })); setLogoError(false); }}
                                placeholder="https://example.com/logo.png"
                                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                            />
                            <p className="text-xs text-gray-400 mt-1">
                                Link to your logo image (PNG, SVG, or JPEG). Leave blank to show text name instead.
                            </p>
                            {form.logo_url && !logoError && (
                                <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg inline-flex items-center gap-3">
                                    <img
                                        src={form.logo_url}
                                        alt="Logo preview"
                                        onError={() => setLogoError(true)}
                                        className="h-10 w-auto object-contain"
                                    />
                                    <span className="text-xs text-gray-500">Logo preview</span>
                                </div>
                            )}
                            {logoError && (
                                <p className="mt-2 text-xs text-red-500">⚠ Could not load logo from this URL</p>
                            )}
                        </div>
                    </div>

                    {/* Color */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="font-semibold text-gray-900 mb-4">Primary Color</h3>
                        <div className="space-y-4">
                            {/* Preset swatches */}
                            <div className="flex flex-wrap gap-3">
                                {PRESET_COLORS.map(c => (
                                    <button
                                        key={c.value}
                                        title={c.name}
                                        onClick={() => setForm(f => ({ ...f, primary_color: c.value }))}
                                        className={`w-9 h-9 rounded-lg transition-transform hover:scale-110 focus:outline-none ${form.primary_color === c.value
                                            ? 'ring-2 ring-offset-2 ring-gray-800 scale-110'
                                            : ''
                                            }`}
                                        style={{ backgroundColor: c.value }}
                                    />
                                ))}
                            </div>

                            {/* Custom hex picker */}
                            <div className="flex items-center gap-3">
                                <input
                                    type="color"
                                    value={form.primary_color}
                                    onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))}
                                    className="h-10 w-16 rounded cursor-pointer border border-gray-300"
                                />
                                <input
                                    type="text"
                                    value={form.primary_color}
                                    onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))}
                                    placeholder="#2563eb"
                                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-2 px-6 py-3 rounded-lg text-white font-semibold text-sm transition-all disabled:opacity-60"
                            style={{ backgroundColor: form.primary_color }}
                        >
                            {saved ? <CheckCircle className="size-4" /> : <Save className="size-4" />}
                            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Branding'}
                        </button>
                        <button
                            onClick={handleReset}
                            className="flex items-center gap-2 px-5 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors"
                        >
                            <RotateCcw className="size-4" />
                            Reset to Defaults
                        </button>
                    </div>
                </div>

                {/* Live Preview */}
                <div className="space-y-4">
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <Eye className="size-4 text-gray-500" />
                            <h3 className="font-semibold text-gray-700 text-sm">Sidebar Preview</h3>
                        </div>

                        {/* Simulated sidebar */}
                        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                            {/* Header */}
                            <div
                                className="p-4 border-b border-gray-100"
                                style={{ borderLeftColor: form.primary_color, borderLeftWidth: 3 }}
                            >
                                {form.logo_url && !logoError ? (
                                    <img
                                        src={form.logo_url}
                                        alt="Logo"
                                        onError={() => setLogoError(true)}
                                        className="h-8 w-auto object-contain mb-1"
                                    />
                                ) : (
                                    <p
                                        className="text-lg font-bold"
                                        style={{ color: form.primary_color }}
                                    >
                                        {form.org_name || 'Your Org'}
                                    </p>
                                )}
                                <p className="text-xs text-gray-500">{form.tagline || 'Analytics Portal'}</p>
                            </div>

                            {/* Fake nav items */}
                            <div className="p-3 space-y-1">
                                {['Dashboard', 'Database', 'Query', 'Analytics'].map((label, i) => (
                                    <div
                                        key={label}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${i === 0 ? 'text-white' : 'text-gray-600'
                                            }`}
                                        style={i === 0 ? { backgroundColor: form.primary_color } : {}}
                                    >
                                        <span className="w-2 h-2 rounded-full bg-current opacity-60" />
                                        {label}
                                    </div>
                                ))}
                            </div>

                            {/* Color chip */}
                            <div className="px-3 pb-3 pt-1">
                                <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 text-xs text-gray-500">
                                    <span
                                        className="w-4 h-4 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: form.primary_color }}
                                    />
                                    <span className="font-mono">{form.primary_color}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
