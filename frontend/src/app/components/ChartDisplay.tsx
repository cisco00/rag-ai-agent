import { useRef } from 'react';
import { Download } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie,
  ScatterChart, Scatter, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from 'recharts';

interface VisualizationData {
  labels?: string[];
  values?: number[] | number[][];
  datasets?: Array<{ label: string; values: number[]; color?: string }>;
  x?: number[];
  y?: number[];
}

interface ChartDisplayProps {
  visualization: {
    type: string;
    data: VisualizationData;
    title?: string;
    description?: string;
    x_label?: string;
    y_label?: string;
  };
}

const PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#6366f1',
  '#84cc16', '#f97316',
];

/** Normalise the wildly varied visualization payloads the LLM can emit */
function normaliseData(data: VisualizationData): {
  flat: Array<Record<string, any>>;
  seriesKeys: string[];
  isMultiSeries: boolean;
} {
  // Case 1: explicit datasets array  { labels, datasets: [{label, values}] }
  if (data.datasets && Array.isArray(data.datasets) && data.datasets.length > 0) {
    const labels = data.labels || data.datasets[0].values.map((_, i) => String(i));
    const flat = labels.map((label, i) => {
      const row: Record<string, any> = { name: label };
      data.datasets!.forEach((ds) => {
        row[ds.label] = ds.values?.[i] ?? null;
      });
      return row;
    });
    return { flat, seriesKeys: data.datasets.map((d) => d.label), isMultiSeries: data.datasets.length > 1 };
  }

  // Case 2: values is a 2D array  { labels, values: [[…], […]] }
  if (Array.isArray(data.values?.[0])) {
    const labels = data.labels || (data.values as number[][])[0].map((_, i) => `Series ${i + 1}`);
    const series = data.values as number[][];
    const flat = labels.map((label, i) => {
      const row: Record<string, any> = { name: label };
      series.forEach((s, si) => { row[`Series ${si + 1}`] = s[i] ?? null; });
      return row;
    });
    const seriesKeys = series.map((_, si) => `Series ${si + 1}`);
    return { flat, seriesKeys, isMultiSeries: series.length > 1 };
  }

  // Case 3: scatter  { x, y }
  if (data.x && data.y) {
    const flat = data.x.map((xv, i) => ({ x: xv, y: data.y![i] ?? null }));
    return { flat, seriesKeys: ['y'], isMultiSeries: false };
  }

  // Case 4: simple { labels, values }  (most common)
  const labels = data.labels || [];
  const values = (data.values as number[]) || [];
  const flat = labels.map((label, i) => ({ name: label, value: values[i] ?? null }));
  return { flat, seriesKeys: ['value'], isMultiSeries: false };
}

function formatValue(v: number): string {
  if (v === null || v === undefined) return '—';
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

export function ChartDisplay({ visualization }: ChartDisplayProps) {
  const { type, data, title, description, x_label, y_label } = visualization;
  const chartRef = useRef<HTMLDivElement>(null);

  const handleExportPNG = async () => {
    if (!chartRef.current) return;
    try {
      // Dynamic import so bundle stays light
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(chartRef.current, { backgroundColor: '#ffffff', pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `${(title || 'chart').replace(/\s+/g, '-').toLowerCase()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Chart export failed:', err);
    }
  };

  // Guard against missing/malformed data
  if (!data || typeof data !== 'object') {
    return (
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
        Chart data is unavailable.
      </div>
    );
  }

  let flat: Array<Record<string, any>>;
  let seriesKeys: string[];
  let isMultiSeries: boolean;

  try {
    ({ flat, seriesKeys, isMultiSeries } = normaliseData(data));
  } catch {
    return (
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
        Could not parse chart data.
      </div>
    );
  }

  if (!flat.length) {
    return (
      <div className="p-4 bg-gray-100 rounded-lg text-sm text-gray-500 text-center">
        No data to display.
      </div>
    );
  }

  const commonAxis = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
      <XAxis
        dataKey="name"
        tick={{ fontSize: 12, fill: '#6b7280' }}
        label={x_label ? { value: x_label, position: 'insideBottom', offset: -4, fontSize: 12 } : undefined}
        tickLine={false}
      />
      <YAxis
        tickFormatter={formatValue}
        tick={{ fontSize: 12, fill: '#6b7280' }}
        label={y_label ? { value: y_label, angle: -90, position: 'insideLeft', fontSize: 12 } : undefined}
        axisLine={false}
        tickLine={false}
        width={y_label ? 60 : 48}
      />
      <Tooltip formatter={(v: number, name: string) => [formatValue(v), name]} />
      {isMultiSeries && <Legend wrapperStyle={{ fontSize: 12 }} />}
    </>
  );

  const renderChart = () => {
    const chartType = type?.toLowerCase();

    if (chartType === 'bar' || chartType === 'bar_chart' || chartType === 'column') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={flat} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            {commonAxis}
            {seriesKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]}
                name={key === 'value' ? (description || 'Value') : key} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'line' || chartType === 'line_chart') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={flat} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            {commonAxis}
            {seriesKeys.map((key, i) => (
              <Line key={key} type="monotone" dataKey={key}
                stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5}
                dot={{ r: 3 }} activeDot={{ r: 5 }}
                name={key === 'value' ? (description || 'Value') : key} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'area' || chartType === 'area_chart') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={flat} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <defs>
              {seriesKeys.map((key, i) => (
                <linearGradient key={key} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {commonAxis}
            {seriesKeys.map((key, i) => (
              <Area key={key} type="monotone" dataKey={key}
                stroke={PALETTE[i % PALETTE.length]} fill={`url(#grad-${i})`} strokeWidth={2.5}
                name={key === 'value' ? (description || 'Value') : key} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'pie' || chartType === 'pie_chart' || chartType === 'donut') {
      const pieData = flat.map((row) => ({ name: row.name, value: Number(row.value ?? row[seriesKeys[0]]) }));
      const isDonut = chartType === 'donut';
      return (
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%"
              innerRadius={isDonut ? 60 : 0} outerRadius={100}
              labelLine={false}
              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
              dataKey="value">
              {pieData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => formatValue(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'scatter' || chartType === 'scatter_plot') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="x" type="number" name={x_label || 'X'} tick={{ fontSize: 12, fill: '#6b7280' }} tickLine={false} />
            <YAxis dataKey="y" type="number" name={y_label || 'Y'} tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number) => formatValue(v)} />
            <Scatter data={flat} fill={PALETTE[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    // Unknown type — render as bar
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={flat} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          {commonAxis}
          {seriesKeys.map((key, i) => (
            <Bar key={key} dataKey={key} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]}
              name={key === 'value' ? (description || 'Value') : key} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 mt-2">
      <div className="flex items-start justify-between mb-1 gap-2">
        <div className="min-w-0">
          {title && <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>}
          {description && !isMultiSeries && (
            <p className="text-xs text-gray-500 mt-0.5">{description}</p>
          )}
        </div>
        <button
          onClick={handleExportPNG}
          title="Download chart as PNG"
          className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Download className="size-3" />
          PNG
        </button>
      </div>
      <div ref={chartRef}>
        {renderChart()}
      </div>
    </div>
  );
}
