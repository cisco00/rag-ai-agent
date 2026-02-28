import { useState } from 'react';
import { X, Copy, CheckCircle, Share2 } from 'lucide-react';
import { api } from '../../lib/api';

interface ShareModalProps {
  message: any;
  onClose: () => void;
  apiKey: string;
}

export function ShareModal({ message, onClose }: ShareModalProps) {
  const [shareUrl, setShareUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerateLink = async () => {
    setIsGenerating(true);

    try {
      const res = await api.post<any>('/share', {
        query: message.content || 'Shared Report',
        visual_type: message.visualization?.type || 'table',
        visual_data: message.visualization?.data || {}
      });

      const url = `${window.location.origin}/shared/${res.share_id}`;
      setShareUrl(url);
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Share2 className="size-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Share Report</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="size-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <p className="text-gray-600">
            Generate a shareable link to this report. Anyone with the link can view the results and visualization.
          </p>

          {!shareUrl ? (
            <button
              onClick={handleGenerateLink}
              disabled={isGenerating}
              className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors font-medium"
            >
              {isGenerating ? 'Generating Link...' : 'Generate Shareable Link'}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
                <CheckCircle className="size-5" />
                <span className="font-medium">Link generated successfully!</span>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Share URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 font-mono text-sm"
                  />
                  <button
                    onClick={handleCopy}
                    className="px-4 py-3 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                  >
                    {copied ? <CheckCircle className="size-5" /> : <Copy className="size-5" />}
                  </button>
                </div>
              </div>

              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  💡 This link doesn't expire and can be viewed by anyone without authentication.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
