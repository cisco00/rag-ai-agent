import { useState } from 'react';
import { X, FileDown, FileText, Presentation, CheckCircle, Table2, FileSpreadsheet } from 'lucide-react';
import { api } from '../../lib/api';

interface ExportModalProps {
  message: any;
  onClose: () => void;
  apiKey: string;
}

type ExportFormat = 'pdf' | 'pptx' | 'csv' | 'xlsx';

/** Pull rows + columns out of the visualization payload (table or chart). */
function extractTableData(message: any): { columns: string[]; rows: any[] } | null {
  const viz = message?.visualization;
  if (!viz) return null;

  // Table-type visualization
  if (viz.type === 'table' && Array.isArray(viz.data)) {
    const columns = viz.columns || (viz.data.length > 0 ? Object.keys(viz.data[0]) : []);
    return { columns, rows: viz.data };
  }
  // Chart-type: labels + datasets → transpose into rows
  if (Array.isArray(viz.labels) && Array.isArray(viz.datasets)) {
    const columns = ['label', ...viz.datasets.map((d: any) => d.label || 'value')];
    const rows = viz.labels.map((label: string, i: number) => {
      const row: any = { label };
      viz.datasets.forEach((d: any) => {
        row[d.label || 'value'] = Array.isArray(d.data) ? d.data[i] : '';
      });
      return row;
    });
    return { columns, rows };
  }
  return null;
}

export function ExportModal({ message, onClose, apiKey }: ExportModalProps) {
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [isExporting, setIsExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState('');

  const tableData = extractTableData(message);
  const hasTableData = !!tableData;

  const handleExport = async () => {
    setIsExporting(true);
    setError('');

    try {
      const requestApiKey = apiKey || localStorage.getItem('vantage_api_key') || '';
      const apiBase =
        (window as any).__VANTAGE_API_URL__ ||
        (import.meta as any).env?.VITE_API_URL ||
        'http://localhost:8000';

      if (exportFormat === 'csv' || exportFormat === 'xlsx') {
        if (!tableData) throw new Error('No table data available to export.');
        const safeName = (message?.content || 'export')
          .slice(0, 40)
          .replace(/[^a-z0-9_\- ]/gi, '')
          .trim()
          .replace(/\s+/g, '_') || 'export';

        const res = await fetch(`${apiBase}/export/${exportFormat}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(requestApiKey ? { 'X-API-KEY': requestApiKey } : {}),
          },
          body: JSON.stringify({ columns: tableData.columns, rows: tableData.rows, filename: safeName }),
        });
        if (!res.ok) throw new Error(`Export failed (${res.status})`);
        const blob = await res.blob();
        const ext = exportFormat === 'csv' ? 'csv' : 'xlsx';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.${ext}`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        // PDF / PPTX — existing flow
        const endpoint = exportFormat === 'pdf' ? '/export/pdf' : '/export/pptx';
        const res = await fetch(`${apiBase}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(requestApiKey ? { 'X-API-KEY': requestApiKey } : {}),
          },
          body: JSON.stringify({
            query: message.content || 'report',
            visual_type: message.visualization?.type || 'table',
            visual_data: message.visualization?.data || {},
          }),
        });
        if (!res.ok) throw new Error(`Export failed (${res.status})`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report_${Date.now()}.${exportFormat}`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }

      setExported(true);
      setTimeout(onClose, 1800);
    } catch (err: any) {
      setError(err.message || 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const formats: { id: ExportFormat; label: string; sub: string; icon: React.ReactNode; disabled?: boolean }[] = [
    {
      id: 'csv',
      label: 'CSV',
      sub: 'Comma-separated values',
      icon: <Table2 className="size-7 text-green-600" />,
      disabled: !hasTableData,
    },
    {
      id: 'xlsx',
      label: 'Excel',
      sub: 'Formatted spreadsheet',
      icon: <FileSpreadsheet className="size-7 text-emerald-600" />,
      disabled: !hasTableData,
    },
    {
      id: 'pdf',
      label: 'PDF',
      sub: 'Portable document',
      icon: <FileText className="size-7 text-red-600" />,
    },
    {
      id: 'pptx',
      label: 'PowerPoint',
      sub: 'Presentation slides',
      icon: <Presentation className="size-7 text-orange-600" />,
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <FileDown className="size-5 text-green-600" />
            <h2 className="text-lg font-bold text-gray-900">Export Report</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="size-4 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {exported ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <CheckCircle className="size-14 text-green-500" />
              <p className="font-semibold text-gray-900">Downloaded!</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500">Choose a format to download this result.</p>

              {!hasTableData && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  CSV and Excel export require a table or chart result. PDF/PPTX are always available.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {formats.map(({ id, label, sub, icon, disabled }) => (
                  <button
                    key={id}
                    onClick={() => !disabled && setExportFormat(id)}
                    disabled={disabled}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center
                      ${exportFormat === id
                        ? 'border-blue-500 bg-blue-50'
                        : disabled
                          ? 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                  >
                    {icon}
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
                    </div>
                  </button>
                ))}
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!exported && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium"
            >
              {isExporting ? 'Exporting…' : `Download ${exportFormat.toUpperCase()}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
