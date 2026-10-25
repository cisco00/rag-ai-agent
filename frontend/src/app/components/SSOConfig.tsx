/**
 * SSOConfig.tsx — Feature #12: SSO / SAML 2.0 Configuration
 *
 * Admin panel for configuring a SAML 2.0 Identity Provider (Okta, Azure AD,
 * Google Workspace, etc.).  Displays:
 *   • SP metadata URL for IdP onboarding
 *   • IdP configuration form (entity ID, SSO URL, SLO URL, X.509 cert)
 *   • Attribute mapping (which SAML attribute carries email / name / role)
 *   • Config readiness checklist
 *   • Enable/disable toggle
 */

import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import {
  KeyRound,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
} from 'lucide-react';

/* ─────────────────────────── types ───────────────────────────────────────── */

interface SSOConfigData {
  is_enabled: boolean;
  idp_entity_id: string | null;
  idp_sso_url: string | null;
  idp_slo_url: string | null;
  idp_x509_cert: string | null;
  sp_entity_id: string | null;
  attribute_email: string;
  attribute_name: string;
  attribute_role: string;
  default_role: string;
  provider_name: string;
  cert_configured: boolean;
}

interface TestResult {
  ready: boolean;
  checks: Record<string, boolean>;
  missing: string[];
}

/* ─────────────────────────── helpers ─────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
      title="Copy"
    >
      {copied ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </button>
  );
}

const PROVIDER_GUIDES: Record<string, string> = {
  Okta:            'https://developer.okta.com/docs/guides/build-sso-integration/saml2/main/',
  'Azure AD':      'https://learn.microsoft.com/en-us/azure/active-directory/manage-apps/add-application-portal-setup-sso',
  'Google Workspace': 'https://support.google.com/a/answer/6087519',
  OneLogin:        'https://onelogin.com/connector/saml-custom-connector',
};

/* ─────────────────────────── main component ──────────────────────────────── */

export function SSOConfig() {
  const [config, setConfig]     = useState<SSOConfigData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);
  const [showCert, setShowCert] = useState(false);

  // Form state
  const [form, setForm] = useState({
    provider_name:   'SSO',
    idp_entity_id:   '',
    idp_sso_url:     '',
    idp_slo_url:     '',
    idp_x509_cert:   '',
    sp_entity_id:    '',
    attribute_email: 'email',
    attribute_name:  'name',
    attribute_role:  'role',
    default_role:    'viewer',
  });

  const metadataUrl = `${window.location.origin}/auth/saml/{org_id}/metadata`;
  const acsUrl      = `${window.location.origin}/auth/saml/{org_id}/acs`;

  useEffect(() => {
    api.get<SSOConfigData>('/sso/config')
      .then(data => {
        setConfig(data);
        setForm(f => ({
          ...f,
          provider_name:   data.provider_name   || 'SSO',
          idp_entity_id:   data.idp_entity_id   || '',
          idp_sso_url:     data.idp_sso_url      || '',
          idp_slo_url:     data.idp_slo_url      || '',
          idp_x509_cert:   data.cert_configured ? '***' : '',
          sp_entity_id:    data.sp_entity_id     || '',
          attribute_email: data.attribute_email  || 'email',
          attribute_name:  data.attribute_name   || 'name',
          attribute_role:  data.attribute_role   || 'role',
          default_role:    data.default_role     || 'viewer',
        }));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function flash(msg: string, isErr = false) {
    if (isErr) { setError(msg); setTimeout(() => setError(null), 4000); }
    else        { setSuccess(msg); setTimeout(() => setSuccess(null), 3000); }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = { ...form };
      // Don't overwrite cert with placeholder
      if (payload.idp_x509_cert === '***') delete payload.idp_x509_cert;
      if (!payload.idp_x509_cert) delete payload.idp_x509_cert;
      const updated = await api.put<SSOConfigData>('/sso/config', payload);
      setConfig(updated);
      flash('SSO configuration saved');
    } catch (e: any) {
      flash(e.message || 'Failed to save', true);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    if (!config) return;
    try {
      const updated = await api.put<SSOConfigData>('/sso/config', { is_enabled: !config.is_enabled });
      setConfig(updated);
      flash(updated.is_enabled ? 'SSO enabled' : 'SSO disabled');
    } catch (e: any) {
      flash(e.message || 'Toggle failed', true);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const result = await api.post<TestResult>('/sso/test', {});
      setTestResult(result);
    } catch { /* ignore */ }
    setTesting(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <Loader2 className="size-7 animate-spin text-slate-300" />
    </div>
  );

  const guideUrl = PROVIDER_GUIDES[form.provider_name];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-3 bg-blue-50 rounded-2xl">
          <KeyRound className="size-7 text-blue-600" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black text-slate-900">SSO / SAML 2.0</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Let users log in via Okta, Azure AD, Google Workspace or any SAML 2.0 IdP.
              </p>
            </div>
            {config && (
              <button
                onClick={handleToggle}
                className="flex items-center gap-2 text-sm font-semibold transition-colors"
              >
                {config.is_enabled
                  ? <><ToggleRight className="size-6 text-emerald-500" /> <span className="text-emerald-600">Enabled</span></>
                  : <><ToggleLeft  className="size-6 text-slate-400"   /> <span className="text-slate-400">Disabled</span></>
                }
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Toasts */}
      {success && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm">
          <CheckCircle2 className="size-4 shrink-0" /> {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <AlertCircle className="size-4 shrink-0" /> {error}
        </div>
      )}

      {/* SP endpoints for the IdP admin */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-black text-slate-700 uppercase tracking-widest">
          Your SP endpoints — give these to your IdP admin
        </h2>
        {[
          { label: 'Metadata URL', url: metadataUrl },
          { label: 'ACS URL (Assertion Consumer Service)', url: acsUrl },
        ].map(({ label, url }) => (
          <div key={label}>
            <p className="text-xs text-slate-500 font-semibold mb-0.5">{label}</p>
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
              <code className="flex-1 text-xs font-mono text-slate-700 truncate">{url}</code>
              <CopyButton text={url} />
              <a href={metadataUrl} target="_blank" rel="noopener noreferrer" className="p-1 text-slate-400 hover:text-blue-600">
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Config form */}
      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <h2 className="font-black text-slate-800">Identity Provider Configuration</h2>

        {/* Provider preset */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Provider</label>
            <select
              value={form.provider_name}
              onChange={e => setForm(f => ({ ...f, provider_name: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
            >
              {['Okta', 'Azure AD', 'Google Workspace', 'OneLogin', 'Ping Identity', 'Custom'].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {guideUrl && (
              <a href={guideUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1">
                <ExternalLink className="size-3" /> Setup guide for {form.provider_name}
              </a>
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">SP Entity ID (override)</label>
            <input
              type="text"
              placeholder="Auto-derived from metadata URL"
              value={form.sp_entity_id}
              onChange={e => setForm(f => ({ ...f, sp_entity_id: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">IdP Entity ID</label>
          <input
            type="text"
            placeholder="https://your-idp.example.com/entity"
            value={form.idp_entity_id}
            onChange={e => setForm(f => ({ ...f, idp_entity_id: e.target.value }))}
            className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">IdP SSO URL</label>
            <input
              type="url"
              placeholder="https://your-idp.example.com/sso/saml"
              value={form.idp_sso_url}
              onChange={e => setForm(f => ({ ...f, idp_sso_url: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">IdP SLO URL <span className="font-normal text-slate-400">(optional)</span></label>
            <input
              type="url"
              placeholder="https://your-idp.example.com/slo"
              value={form.idp_slo_url}
              onChange={e => setForm(f => ({ ...f, idp_slo_url: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* X.509 cert */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold text-slate-700">IdP X.509 Certificate</label>
            <button type="button" onClick={() => setShowCert(v => !v)}
              className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
              {showCert ? <><EyeOff className="size-3" /> Hide</> : <><Eye className="size-3" /> Show</>}
            </button>
          </div>
          {config?.cert_configured && form.idp_x509_cert === '***' && (
            <p className="text-xs text-emerald-600 mb-1 flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Certificate is configured. Paste a new one to replace it.
            </p>
          )}
          <textarea
            rows={showCert ? 6 : 2}
            placeholder="-----BEGIN CERTIFICATE-----&#10;MIIBkTCB+wIJ...&#10;-----END CERTIFICATE-----"
            value={form.idp_x509_cert}
            onChange={e => setForm(f => ({ ...f, idp_x509_cert: e.target.value }))}
            className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-blue-500 resize-y"
            style={{ filter: !showCert && form.idp_x509_cert && form.idp_x509_cert !== '***' ? 'blur(3px)' : undefined }}
          />
        </div>

        {/* Attribute mapping */}
        <div>
          <h3 className="text-sm font-black text-slate-700 mb-2">Attribute Mapping</h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'attribute_email', label: 'Email attribute' },
              { key: 'attribute_name',  label: 'Name attribute' },
              { key: 'attribute_role',  label: 'Role attribute' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs text-slate-500 mb-1">{label}</label>
                <input
                  type="text"
                  value={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-400"
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <label className="block text-xs text-slate-500 mb-1">Default role (for new users with no role attribute)</label>
            <select
              value={form.default_role}
              onChange={e => setForm(f => ({ ...f, default_role: e.target.value }))}
              className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            >
              {['viewer', 'analyst', 'sales_team', 'marketing_team', 'operation_manager', 'product_manager', 'business_owner', 'admin'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save configuration
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-60"
          >
            {testing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Test readiness
          </button>
        </div>
      </form>

      {/* Test results */}
      {testResult && (
        <div className={`border rounded-2xl p-4 ${testResult.ready ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
          <p className={`font-bold text-sm mb-2 ${testResult.ready ? 'text-emerald-800' : 'text-amber-800'}`}>
            {testResult.ready ? '✅ Configuration is complete — SSO is ready to use.' : '⚠️ Configuration is incomplete.'}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(testResult.checks).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1.5 text-sm">
                {v
                  ? <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                  : <XCircle className="size-3.5 text-red-400 shrink-0" />
                }
                <span className={v ? 'text-slate-700' : 'text-red-600 font-semibold'}>
                  {k.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Login URL */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600">
        <p className="font-bold text-slate-700 mb-1">SSO Login URL</p>
        <p className="text-xs text-slate-500 mb-2">
          Share this with your users or add a "Sign in with {form.provider_name}" button to your login page.
        </p>
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
          <code className="flex-1 text-xs font-mono text-slate-700 truncate">
            {window.location.origin}/auth/saml/{'{org_id}'}/login
          </code>
          <CopyButton text={`${window.location.origin}/auth/saml/{org_id}/login`} />
        </div>
      </div>
    </div>
  );
}
