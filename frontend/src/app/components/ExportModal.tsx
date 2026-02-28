import { useState } from 'react';
import { X, FileDown, FileText, Presentation, CheckCircle } from 'lucide-react';

interface ExportModalProps {
  message: any;
  onClose: () => void;
  apiKey: string;
}

export function ExportModal({ message, onClose, apiKey }: ExportModalProps) {
  const [exportFormat, setExportFormat] = useState<'pdf' | 'pptx'>('pdf');
  const [isExporting, setIsExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);

    try {
      const endpoint = exportFormat === 'pdf' ? '/export/pdf' : '/export/pptx';
      const requestApiKey = apiKey || localStorage.getItem('vantage_api_key') || '';

      const response = await fetch(`http://localhost:8000${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(requestApiKey ? { 'X-API-KEY': requestApiKey } : {})
        },
        body: JSON.stringify({
          query: message.content || 'report',
          visual_type: message.visualization?.type || 'table',
          visual_data: message.visualization?.data || {}
        })
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${new Date().getTime()}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setExported(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <FileDown className="size-6 text-green-600" />
            <h2 className="text-xl font-bold text-gray-900">Export Report</h2>
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
          {!exported ? (
            <>
              <p className="text-gray-600">
                Export this report with your query, insights, and visualization.
              </p>

              {/* Format Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Export Format
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setExportFormat('pdf')}
                    className={`p-4 rounded-lg border-2 transition-all ${exportFormat === 'pdf'
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300'
                      }`}
                  >
                    <FileText className="size-8 mx-auto mb-2 text-red-600" />
                    <p className="font-medium text-gray-900">PDF</p>
                    <p className="text-xs text-gray-600 mt-1">Portable Document</p>
                  </button>

                  <button
                    onClick={() => setExportFormat('pptx')}
                    className={`p-4 rounded-lg border-2 transition-all ${exportFormat === 'pptx'
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300'
                      }`}
                  >
                    <Presentation className="size-8 mx-auto mb-2 text-orange-600" />
                    <p className="font-medium text-gray-900">PowerPoint</p>
                    <p className="text-xs text-gray-600 mt-1">Presentation Slides</p>
                  </button>
                </div>
              </div>

              {/* Export Info */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  {exportFormat === 'pdf'
                    ? '📄 Your report will be exported as a PDF with text, charts, and formatting.'
                    : '📊 Your report will be exported as a PowerPoint presentation with slides.'}
                </p>
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <CheckCircle className="size-16 text-green-600 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-gray-900 mb-2">Export Complete!</h3>
              <p className="text-gray-600">Your report has been downloaded successfully.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {!exported && (
          <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 transition-colors font-medium"
            >
              {isExporting ? 'Exporting...' : `Export as ${exportFormat.toUpperCase()}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
