import { BarChart, Bar, LineChart, Line, PieChart, Pie, ScatterChart, Scatter, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

interface ChartDisplayProps {
  visualization: {
    type: string;
    data: any;
    title?: string;
    description?: string;
  };
}

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1'];

export function ChartDisplay({ visualization }: ChartDisplayProps) {
  const { type, data, title, description } = visualization;

  // Transform data for recharts
  const chartData = data.labels.map((label: string, index: number) => ({
    name: label,
    value: data.values[index],
  }));

  const renderChart = () => {
    switch (type) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value: number) => value.toLocaleString()} />
              <Legend />
              <Bar dataKey="value" fill="#3b82f6" name={description || 'Value'} />
            </BarChart>
          </ResponsiveContainer>
        );

      case 'line':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value: number) => value.toLocaleString()} />
              <Legend />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#3b82f6"
                strokeWidth={2}
                name={description || 'Value'}
              />
            </LineChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name}: ${value}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {chartData.map((_: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value: number) => value.toLocaleString()} />
              <Legend />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#3b82f6"
                fill="#93c5fd"
                name={description || 'Value'}
              />
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis dataKey="value" />
              <Tooltip formatter={(value: number) => value.toLocaleString()} />
              <Legend />
              <Scatter
                data={chartData}
                fill="#3b82f6"
                name={description || 'Value'}
              />
            </ScatterChart>
          </ResponsiveContainer>
        );

      default:
        return (
          <div className="p-4 bg-gray-100 rounded text-center text-gray-600">
            Unsupported chart type: {type}
          </div>
        );
    }
  };

  return (
    <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
      {title && (
        <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
      )}
      {description && (
        <p className="text-sm text-gray-600 mb-4">{description}</p>
      )}
      <div className="mt-4">
        {renderChart()}
      </div>
    </div>
  );
}
