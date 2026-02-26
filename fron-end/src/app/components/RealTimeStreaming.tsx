import React, { useState, useEffect, useRef } from 'react';
import { Radio, Play, Pause, RotateCcw, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface RealTimeStreamingProps {
  apiKey: string;
}

interface DataPoint {
  timestamp: string;
  value: number;
  source: string;
}

export function RealTimeStreaming({ }: RealTimeStreamingProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [selectedSource, setSelectedSource] = useState('1');
  const [updateInterval, setUpdateInterval] = useState(1000);
  const [maxDataPoints, setMaxDataPoints] = useState(50);
  const wsRef = useRef<WebSocket | null>(null);

  const dataSources = [
    { id: '1', name: 'Sales Stream', baseValue: 50000, variance: 10000 },
    { id: '2', name: 'Website Traffic', baseValue: 1500, variance: 300 },
    { id: '3', name: 'Server Metrics', baseValue: 75, variance: 15 },
    { id: '4', name: 'Inventory Levels', baseValue: 10000, variance: 2000 },
  ];

  const currentSource = dataSources.find(s => s.id === selectedSource) || dataSources[0];

  useEffect(() => {
    if (isStreaming) {
      const wsUrl = `ws://localhost:8000/ws/stream/${selectedSource}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const scaledValue = (data.value / 100) * currentSource.baseValue;

          const newPoint: DataPoint = {
            timestamp: new Date(data.timestamp).toLocaleTimeString(),
            value: scaledValue,
            source: currentSource.name,
          };

          setDataPoints((prev: DataPoint[]) => {
            const updated = [...prev, newPoint];
            return updated.slice(-maxDataPoints);
          });
        } catch (e) {
          console.error('Failed to parse websocket message', e);
        }
      };

      ws.onerror = (e) => {
        console.error('WebSocket error', e);
        setIsStreaming(false);
      };

      ws.onclose = () => {
        setIsStreaming(false);
      };
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isStreaming, selectedSource, maxDataPoints, currentSource]);

  const handleStart = () => {
    setIsStreaming(true);
  };

  const handlePause = () => {
    setIsStreaming(false);
  };

  const handleReset = () => {
    setIsStreaming(false);
    setDataPoints([]);
  };

  const getStats = () => {
    if (dataPoints.length === 0) return { current: 0, avg: 0, min: 0, max: 0 };

    const values = dataPoints.map((d: DataPoint) => d.value);
    const current = values[values.length - 1];
    const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    return { current, avg, min, max };
  };

  const stats = getStats();

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Radio className="size-8 text-red-600" />
          <h1 className="text-3xl font-bold text-gray-900">Real-Time Data Streaming</h1>
        </div>
        <p className="text-gray-600">
          Monitor live data feeds with low-latency WebSocket connections.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Controls */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <div>
            <h3 className="font-bold text-gray-900 mb-4">Stream Configuration</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Data Source
                </label>
                <select
                  value={selectedSource}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    setSelectedSource(e.target.value);
                    setDataPoints([]);
                  }}
                  disabled={isStreaming}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
                >
                  {dataSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Update Interval (ms)
                </label>
                <input
                  type="number"
                  value={updateInterval}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUpdateInterval(parseInt(e.target.value))}
                  disabled={true}
                  title="Server controls interval"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
                  min="100"
                  max="5000"
                  step="100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Data Points
                </label>
                <input
                  type="number"
                  value={maxDataPoints}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxDataPoints(parseInt(e.target.value))}
                  disabled={isStreaming}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
                  min="10"
                  max="200"
                  step="10"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {!isStreaming ? (
              <button
                onClick={handleStart}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                <Play className="size-5" />
                Start
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
              >
                <Pause className="size-5" />
                Pause
              </button>
            )}
            <button
              onClick={handleReset}
              className="px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              <RotateCcw className="size-5" />
            </button>
          </div>

          {isStreaming && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <Activity className="size-5 text-green-600 animate-pulse" />
              <span className="text-sm font-medium text-green-700">Streaming Active</span>
            </div>
          )}

          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>WebSocket:</strong> Low-latency bidirectional communication
            </p>
            <p className="text-sm text-blue-800 mt-2">
              Data points: {dataPoints.length}
            </p>
          </div>
        </div>

        {/* Visualization */}
        <div className="lg:col-span-3 space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-600 mb-1">Current Value</p>
              <p className="text-2xl font-bold text-blue-600">
                {stats.current.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-600 mb-1">Average</p>
              <p className="text-2xl font-bold text-purple-600">
                {stats.avg.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-600 mb-1">Minimum</p>
              <p className="text-2xl font-bold text-green-600">
                {stats.min.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-600 mb-1">Maximum</p>
              <p className="text-2xl font-bold text-red-600">
                {stats.max.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Live Data Stream</h3>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
                <span className="text-sm text-gray-600">
                  {isStreaming ? 'Live' : 'Paused'}
                </span>
              </div>
            </div>

            {dataPoints.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={dataPoints}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    name={currentSource.name}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-96 text-gray-400">
                <div className="text-center">
                  <Radio className="size-16 mx-auto mb-3 text-gray-300" />
                  <p>Click Start to begin streaming data</p>
                </div>
              </div>
            )}
          </div>

          {/* Recent Data Table */}
          {dataPoints.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-bold text-gray-900 mb-4">Recent Data Points</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Timestamp
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Value
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Source
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {dataPoints.slice(-10).reverse().map((point, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900 font-mono">
                          {point.timestamp}
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-blue-600">
                          {point.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {point.source}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
