import { useState, useEffect } from 'react';
import { Share2, ExternalLink, Calendar, BarChart3, Eye, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';

interface ReportsProps {
  apiKey: string;
}

interface SharedReport {
  id: string;
  query: string;
  createdAt: Date;
  views: number;
  chartType: string;
}

export function Reports({ }: ReportsProps) {
  const [reports, setReports] = useState<SharedReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const response = await api.get<{ reports: any[] }>('/shared');
        const formattedReports = response.reports.map(r => ({
          id: r.id,
          query: r.query,
          createdAt: new Date(r.created_at),
          views: 0, // Backend does not track views yet
          chartType: r.visualization ? JSON.parse(r.visualization).type || 'bar' : 'text',
        }));
        setReports(formattedReports);
      } catch (error) {
        console.error('Error fetching reports:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchReports();
  }, []);

  const getChartIcon = () => {
    return <BarChart3 className="size-5 text-blue-600" />;
  };

  const openReport = (reportId: string) => {
    window.open(`${window.location.origin}/shared/${reportId}`, '_blank');
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Share2 className="size-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Shared Reports</h1>
        </div>
        <p className="text-gray-600">
          View and manage your shared analytics reports.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Reports</p>
              <p className="text-3xl font-bold text-gray-900">{isLoading ? '-' : reports.length}</p>
            </div>
            <Share2 className="size-10 text-blue-100" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Views</p>
              <p className="text-3xl font-bold text-gray-900">
                {reports.reduce((sum, r) => sum + r.views, 0)}
              </p>
            </div>
            <Eye className="size-10 text-green-100" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Avg. Views</p>
              <p className="text-3xl font-bold text-gray-900">
                {Math.round(reports.reduce((sum, r) => sum + r.views, 0) / reports.length)}
              </p>
            </div>
            <BarChart3 className="size-10 text-purple-100" />
          </div>
        </div>
      </div>

      {/* Reports List */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">All Shared Reports</h2>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500">
            <Loader2 className="size-8 animate-spin mb-4" />
            <p>Loading reports...</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {reports.map((report) => (
              <div
                key={report.id}
                className="p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      {getChartIcon()}
                      <h3 className="font-bold text-gray-900">{report.query}</h3>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <Calendar className="size-4" />
                        {report.createdAt.toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-1">
                        <Eye className="size-4" />
                        {report.views} views
                      </div>
                      <div className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                        {report.chartType}
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>Share URL:</span>
                        <code className="px-2 py-1 bg-gray-100 rounded font-mono">
                          /shared/{report.id}
                        </code>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => openReport(report.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    <ExternalLink className="size-4" />
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Empty State (if no reports) */}
      {!isLoading && reports.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Share2 className="size-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">No Shared Reports Yet</h3>
          <p className="text-gray-600 mb-6">
            Create queries in the Query interface and share them to see reports here.
          </p>
        </div>
      )}
    </div>
  );
}
