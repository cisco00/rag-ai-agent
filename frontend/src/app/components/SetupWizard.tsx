import { useState } from 'react';
import { Sparkles, ChevronRight, Eye, EyeOff, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

const LLM_PROVIDERS = [
  { value: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { value: 'google', label: 'Google Gemini', placeholder: 'AIza...' },
  { value: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-...' },
  { value: 'azure_openai', label: 'Azure OpenAI', placeholder: 'Your Azure key' },
  { value: 'huggingface', label: 'HuggingFace', placeholder: 'hf_...' },
];

interface SetupWizardProps {
  onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [azureEndpoint, setAzureEndpoint] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedProvider = LLM_PROVIDERS.find(p => p.value === provider)!;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const BASE = window.__VANTAGE_API_URL__ || 'http://localhost:8000';
      const res = await fetch(`${BASE}/api/desktop/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llm_provider: provider,
          llm_api_key: apiKey,
          azure_endpoint: provider === 'azure_openai' ? azureEndpoint : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to save configuration');
      }
      setStep(3);
    } catch (e: any) {
      setError(e.message || 'Connection failed. Is the backend running?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-white/10">
          <div
            className="h-full bg-blue-500 transition-all duration-500 ease-out"
            style={{ width: `${((step + 1) / 4) * 100}%` }}
          />
        </div>

        <div className="p-8">
          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="text-center space-y-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/20 text-blue-400">
                <Sparkles size={32} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Welcome to Vantage AI</h1>
                <p className="mt-2 text-slate-400">Your AI-powered analytics platform, running locally on your machine.</p>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-300">
                <AlertTriangle size={16} className="inline mr-2" />
                This is a <strong>beta preview</strong> for testing purposes. Some features may be unstable.
              </div>
              <button
                onClick={() => setStep(1)}
                className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                Get Started <ChevronRight size={18} />
              </button>
            </div>
          )}

          {/* Step 1: Provider Selection */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white">Choose Your LLM Provider</h2>
                <p className="mt-1 text-sm text-slate-400">Vantage AI needs an LLM to power its analytics engine.</p>
              </div>
              <div className="space-y-2">
                {LLM_PROVIDERS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setProvider(p.value)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                      provider === p.value
                        ? 'border-blue-500 bg-blue-500/10 text-white'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10'
                    }`}
                  >
                    <span className="font-medium">{p.label}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(0)} className="flex-1 py-3 px-6 bg-white/5 hover:bg-white/10 text-slate-300 font-medium rounded-xl border border-white/10 transition-colors">
                  Back
                </button>
                <button onClick={() => setStep(2)} className="flex-1 py-3 px-6 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2">
                  Next <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: API Key */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white">Enter Your API Key</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Your <strong className="text-white">{selectedProvider.label}</strong> API key. This is stored locally and never shared.
                </p>
              </div>
              <div className="space-y-4">
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={selectedProvider.placeholder}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 pr-12 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                  >
                    {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {provider === 'azure_openai' && (
                  <input
                    type="text"
                    value={azureEndpoint}
                    onChange={e => setAzureEndpoint(e.target.value)}
                    placeholder="https://your-resource.openai.azure.com/"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
                  />
                )}
              </div>
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 py-3 px-6 bg-white/5 hover:bg-white/10 text-slate-300 font-medium rounded-xl border border-white/10 transition-colors">
                  Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={!apiKey.trim() || saving}
                  className="flex-1 py-3 px-6 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? <><Loader2 size={18} className="animate-spin" /> Saving...</> : <>Save & Continue <ChevronRight size={18} /></>}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Success */}
          {step === 3 && (
            <div className="text-center space-y-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400">
                <CheckCircle2 size={32} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">You're All Set!</h2>
                <p className="mt-2 text-slate-400">Vantage AI is configured and ready to analyze your data.</p>
              </div>
              <button
                onClick={onComplete}
                className="w-full py-3 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors"
              >
                Launch Vantage AI
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
