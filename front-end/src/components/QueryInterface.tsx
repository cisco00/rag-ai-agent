import React, { useState } from 'react';
import { Send, Loader2, MessageSquare, FileText, Play, Code, Check, ThumbsUp, ThumbsDown } from 'lucide-react';
import { api } from '../services/api';
import Plot from 'react-plotly.js';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    visualization?: any;
    sql_query?: string;
    status?: 'success' | 'needs_verification' | 'error';
    original_query?: string;
    vote?: number; // 1 for up, -1 for down
}

import { useLocation } from 'react-router-dom';

export const QueryInterface: React.FC = () => {
    const location = useLocation();
    const initialQuery = location.state?.initialQuery || '';
    const [query, setQuery] = useState(initialQuery);
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: 'Hello! Ask me any question about your data.' }
    ]);
    const [loading, setLoading] = useState(false);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        const userMsg = query;
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setQuery('');
        setLoading(true);

        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error('No API key found');

            // First step: Verification (verify_only=true)
            const result = await api.query({
                query: userMsg,
                history: [], // Simplify history for now
                verify_only: true
            }, apiKey);

            setMessages(prev => [...prev, {
                role: 'assistant',
                content: result.response,
                visualization: result.visualization,
                sql_query: result.sql_query,
                status: result.status as any,
                original_query: userMsg // Store for execution context
            }]);
        } catch (err: any) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `Error: ${err.message || 'Something went wrong.'}`,
                status: 'error'
            }]);
        } finally {
            setLoading(false);
        }
    };

    const handleRunQuery = async (msgIndex: number, sql: string, originalQuery: string) => {
        setLoading(true);
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error('No API key found');

            // Update local message status to show it's being executed
            setMessages(prev => prev.map((m, i) =>
                i === msgIndex ? { ...m, status: 'success' } : m
            ));

            const result = await api.query({
                query: originalQuery,
                history: [],
                confirmed_sql: sql
            }, apiKey);

            // Add result message
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: result.response,
                visualization: result.visualization,
                status: 'success'
            }]);

        } catch (err: any) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `Error executing query: ${err.message}`,
                status: 'error'
            }]);
        } finally {
            setLoading(false);
        }
    };

    const updateMessageSql = (index: number, newSql: string) => {
        setMessages(prev => prev.map((m, i) =>
            i === index ? { ...m, sql_query: newSql } : m
        ));
    };

    const handleExportPPTX = async (msg: Message) => {
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) return;

            // Use the last user query as the title/query context if available
            // For simplicity, we'll just use a generic title or find the preceding user message
            // But the API expects 'query'. We can try to find it from the message history context or just pass "Analysis Result"
            // Actually, let's pass the message content as the response.
            // And we need the query that generated this. 
            // In this simple UI, we can just grab the content of the message.

            const blob = await api.exportPPTX({
                query: msg.original_query || "Analysis Result",
                response: msg.content,
                visualization: msg.visualization,
                status: "success"
            }, apiKey);

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `presentation_${Date.now()}.pptx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error("Failed to export PPTX", err);
            alert("Failed to create presentation");
        }
    };

    const handleFeedback = async (msgIndex: number, vote: number) => {
        const msg = messages[msgIndex];
        if (!msg.original_query) return;

        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) return;

            await api.feedback({
                query: msg.original_query,
                response: msg.content,
                vote: vote
            }, apiKey);

            // Update UI
            setMessages(prev => prev.map((m, i) =>
                i === msgIndex ? { ...m, vote: vote } : m
            ));

        } catch (err) {
            console.error("Failed to submit feedback", err);
        }
    };

    return (
        <div className="chat-interface">
            <div className="messages-area">
                {messages.map((msg, i) => (
                    <div key={i} className={`message ${msg.role}`}>
                        <div className="message-content">
                            {msg.role === 'assistant' && <MessageSquare size={16} className="msg-icon" />}
                            <div className="text-content">
                                <p>{msg.content}</p>

                                {msg.sql_query && (
                                    <div className="sql-card">
                                        <div className="sql-header">
                                            <Code size={14} /> Generated SQL
                                        </div>
                                        <textarea
                                            className="sql-display"
                                            value={msg.sql_query}
                                            onChange={(e) => updateMessageSql(i, e.target.value)}
                                            readOnly={msg.status !== 'needs_verification'}
                                        />
                                        {msg.status === 'needs_verification' && (
                                            <div className="sql-actions">
                                                <button
                                                    className="run-sql-btn"
                                                    onClick={() => handleRunQuery(i, msg.sql_query!, msg.original_query!)}
                                                    disabled={loading}
                                                >
                                                    <Play size={14} /> Run Query
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {msg.visualization && (
                                    <div className="viz-container">
                                        <Plot
                                            data={[
                                                {
                                                    type: msg.visualization.type || 'bar',
                                                    x: msg.visualization.data.x || [],
                                                    y: msg.visualization.data.y || [],
                                                    marker: { color: '#3b82f6' }
                                                }
                                            ]}
                                            layout={{
                                                width: undefined,
                                                height: 300,
                                                autosize: true,
                                                margin: { l: 40, r: 20, t: 20, b: 40 },
                                                paper_bgcolor: 'rgba(0,0,0,0)',
                                                plot_bgcolor: 'rgba(0,0,0,0)',
                                            }}
                                            style={{ width: '100%', height: '100%' }}
                                            config={{ responsive: true, displayModeBar: true }}
                                        />
                                    </div>
                                )}
                                {msg.role === 'assistant' && msg.status !== 'needs_verification' && msg.status !== 'error' && (
                                    <div className="message-actions">
                                        <button
                                            className={`action-btn ${msg.vote === 1 ? 'active' : ''}`}
                                            onClick={() => handleFeedback(i, 1)}
                                            title="Helpful"
                                        >
                                            <ThumbsUp size={14} />
                                        </button>
                                        <button
                                            className={`action-btn ${msg.vote === -1 ? 'active' : ''}`}
                                            onClick={() => handleFeedback(i, -1)}
                                            title="Not Helpful"
                                        >
                                            <ThumbsDown size={14} />
                                        </button>
                                        <div className="divider"></div>
                                        <button
                                            className="action-btn"
                                            onClick={() => handleExportPPTX(msg)}
                                            title="Export to PowerPoint"
                                        >
                                            <FileText size={14} />
                                            <span>Export to PPTX</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="message assistant">
                        <div className="message-content">
                            <Loader2 size={16} className="msg-icon spin" />
                            <span>Thinking...</span>
                        </div>
                    </div>
                )}
            </div>

            <form className="input-area" onSubmit={handleSend}>
                <input
                    type="text"
                    className="query-input"
                    placeholder="Ask a question about your data..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={loading}
                />
                <button type="submit" className="send-btn" disabled={loading || !query.trim()}>
                    <Send size={18} />
                </button>
            </form>

            <style>{`
                .chat-interface {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: white;
                    border-radius: 12px;
                    border: 1px solid var(--color-border);
                    overflow: hidden;
                }
                .messages-area {
                    flex: 1;
                    overflow-y: auto;
                    padding: 1.5rem;
                    display: flex;
                    flex-direction: column;
                    gap: 1.5rem;
                }
                .message {
                    display: flex;
                    max-width: 85%;
                }
                .message.user { align-self: flex-end; }
                .message.assistant { align-self: flex-start; }
                
                .message-content {
                    padding: 1rem;
                    border-radius: 12px;
                    display: flex;
                    gap: 0.75rem;
                    line-height: 1.5;
                }
                .message.user .message-content {
                    background-color: var(--color-primary);
                    color: white;
                }
                .message.assistant .message-content {
                    background-color: #f1f5f9;
                    color: var(--color-text-primary);
                }
                
                .msg-icon { margin-top: 0.25rem; flex-shrink: 0; }
                .text-content { flex: 1; }
                
                .viz-container {
                    margin-top: 1rem;
                    background: white;
                    padding: 1rem;
                    border-radius: 8px;
                    border: 1px solid var(--color-border);
                    width: 100%;
                    min-width: 400px;
                }

                .message-actions {
                    margin-top: 0.5rem;
                    display: flex;
                    gap: 0.5rem;
                }
                .action-btn {
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                    background: none;
                    border: 1px solid var(--color-border);
                    border-radius: 4px;
                    padding: 0.25rem 0.5rem;
                    font-size: 0.75rem;
                    color: var(--color-text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .action-btn:hover {
                    background: #f1f5f9;
                    color: var(--color-primary);
                }
                .action-btn.active {
                    background: #e0f2fe;
                    color: var(--color-primary);
                    border-color: var(--color-primary);
                }
                .divider {
                    width: 1px;
                    height: 16px;
                    background: var(--color-border);
                    margin: 0 0.25rem;
                }

                .input-area {
                    padding: 1rem;
                    border-top: 1px solid var(--color-border);
                    display: flex;
                    gap: 0.5rem;
                    background: white;
                }
                .query-input {
                    flex: 1;
                    padding: 0.75rem 1rem;
                    border: 1px solid var(--color-border);
                    border-radius: 8px;
                    outline: none;
                }
                .query-input:focus { border-color: var(--color-primary); }
                .send-btn {
                    background: var(--color-primary);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    width: 48px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .send-btn:disabled { background: #94a3b8; cursor: not-allowed; }
                .spin { animation: spin 1s linear infinite; }
                
                .sql-card {
                    margin-top: 1rem;
                    background: #1e293b;
                    border-radius: 8px;
                    overflow: hidden;
                    width: 100%;
                }
                .sql-header {
                    background: #0f172a;
                    color: #94a3b8;
                    padding: 0.5rem 1rem;
                    font-size: 0.75rem;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                .sql-display {
                    width: 100%;
                    background: transparent;
                    color: #e2e8f0;
                    border: none;
                    padding: 1rem;
                    font-family: 'Fira Code', monospace;
                    font-size: 0.85rem;
                    resize: vertical;
                    min-height: 100px;
                    outline: none;
                }
                .sql-actions {
                    padding: 0.75rem;
                    border-top: 1px solid #334155;
                    display: flex;
                    justify-content: flex-end;
                }
                .run-sql-btn {
                    background: #22c55e;
                    color: white;
                    border: none;
                    padding: 0.5rem 1rem;
                    border-radius: 6px;
                    font-size: 0.85rem;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-weight: 500;
                }
                .run-sql-btn:hover { background: #16a34a; }
                .run-sql-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            `}</style>
        </div>
    );
};
